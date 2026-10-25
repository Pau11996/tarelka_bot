const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const crypto = require("node:crypto");
const { once } = require("node:events");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("typescript");

function compile(file, requireMock, globals = {}) {
  const context = { exports: {}, require: requireMock, ...globals };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, context);
  return context.exports;
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function disk(write = async () => {}, move = async () => {}) {
  const files = new Map(), directories = new Set(), modified = new Map();
  const uri = (...parts) => parts.map((part, i) => {
    const value = typeof part === "string" ? part : part.uri;
    return i ? value.replace(/^\/+|\/+$/g, "") : value.replace(/\/+$/, "");
  }).join("/");
  class File {
    constructor(...parts) { this.uri = uri(...parts); }
    get name() { return this.uri.split("/").at(-1); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    get modificationTime() { return modified.get(this.uri) ?? 0; }
    async write(bytes) {
      files.set(this.uri, Buffer.from(bytes));
      modified.set(this.uri, Date.now());
      await write();
    }
    async move(destination) {
      await move();
      if (!this.exists) throw new Error("Missing source file");
      files.set(destination.uri, files.get(this.uri));
      modified.set(destination.uri, modified.get(this.uri));
      this.delete();
      this.uri = destination.uri;
    }
    delete() { files.delete(this.uri); modified.delete(this.uri); }
  }
  class Directory {
    constructor(...parts) { this.uri = uri(...parts); }
    get exists() { return directories.has(this.uri); }
    create() { directories.add(this.uri); }
    list() { return [...files.keys()].filter((item) => item.startsWith(this.uri + "/") && !item.slice(this.uri.length + 1).includes("/")).map((item) => new File(item)); }
    delete() {
      for (const item of files.keys()) if (item.startsWith(this.uri + "/")) new File(item).delete();
      directories.delete(this.uri);
    }
  }
  return { files, File, Directory, Paths: { cache: "file:///app-cache" } };
}

function loader(apiUrl, fetcher = fetch, write = async () => {}, options = {}) {
  const storage = options.disk ?? disk(write);
  const exports = compile("privateImage.ts", (name) => {
    if (name === "react-native") return { Platform: { OS: options.platform ?? "android" } };
    if (name === "./config") return { API_URL: apiUrl };
    if (name === "./api") return { ApiError };
    if (name === "expo-file-system") return storage;
    if (name === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: async (algorithm, value) => crypto.createHash(algorithm).update(value).digest("hex") };
    throw new Error(name);
  }, { fetch: fetcher, Uint8Array, Blob, URL: options.URL ?? URL, AbortController });
  exports.setPrivateImageSession(options.token ?? "token");
  return { ...exports, files: storage.files, disk: storage };
}

test("private photo is fetched with authorization, reused by other screens and removed on logout", async () => {
  const photo = fs.readFileSync(path.join(__dirname, "../assets/login-hero.jpg"));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ path: req.url, authorization: req.headers.authorization });
    if (req.headers.authorization !== "Bearer session-token") {
      res.writeHead(401).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" });
    res.end(photo);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const api = `http://127.0.0.1:${server.address().port}`;
    const { loadPrivateImage, setPrivateImageSession, files } = loader(api, fetch, undefined, { token: "session-token" });
    const loaded = await loadPrivateImage(`${api}/v1/media/food-photo`, "session-token", new AbortController().signal);
    assert.deepEqual(requests, [{ path: "/v1/media/food-photo", authorization: "Bearer session-token" }]);
    assert.match(loaded.uri, /^file:\/\/\/app-cache\/tarelka-private-photos\/[a-f0-9]{64}\/[a-f0-9]{64}-.*\.jpg$/);
    assert.deepEqual(files.get(loaded.uri), photo);
    assert.ok(!loaded.uri.includes("session-token"));
    loaded.dispose();
    loaded.dispose();
    assert.equal(files.size, 1);
    const details = await loadPrivateImage(`${api}/v1/media/food-photo`, "session-token", new AbortController().signal);
    assert.equal(details.uri, loaded.uri);
    assert.equal(requests.length, 1);
    details.dispose();
    await setPrivateImageSession(null);
    assert.equal(files.size, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("failed downloads do not create a local image and can be retried", async () => {
  let failed = true;
  const { loadPrivateImage, files } = loader("https://api.example", async () => failed
    ? new Response("Unauthorized", { status: 401 })
    : new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } }));
  await assert.rejects(loadPrivateImage("https://api.example/v1/media/photo", "token", new AbortController().signal), (error) => error.status === 401);
  assert.equal(files.size, 0);
  failed = false;
  const loaded = await loadPrivateImage("https://api.example/v1/media/photo", "token", new AbortController().signal);
  assert.equal(files.size, 1);
  loaded.dispose();
});

test("missing sessions, unrelated URLs and cancelled loads never save a private file", async () => {
  let fetched = 0;
  const { loadPrivateImage, files } = loader("https://api.example", async () => {
    fetched++;
    return new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
  });
  const controller = new AbortController();
  await assert.rejects(loadPrivateImage("https://api.example/v1/media/photo", null, controller.signal), (error) => error.status === 401);
  await assert.rejects(loadPrivateImage("https://api.example@other.example/v1/media/photo", "token", controller.signal));
  controller.abort();
  await assert.rejects(loadPrivateImage("https://api.example/v1/media/photo", "token", controller.signal));
  assert.equal(fetched, 0);
  assert.equal(files.size, 0);
});

test("a private photo is not exposed until its asynchronous disk write finishes", async () => {
  let finish;
  const writing = new Promise((resolve) => { finish = resolve; });
  const { loadPrivateImage } = loader("https://api.example", async () =>
    new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } }),
    () => writing);
  let resolved = false;
  const loading = loadPrivateImage("https://api.example/v1/media/photo", "token", new AbortController().signal)
    .then((image) => { resolved = true; return image; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  finish();
  (await loading).dispose();
});

test("failed asynchronous disk writes remove partially saved private photos", async () => {
  const { loadPrivateImage, files } = loader("https://api.example", async () =>
    new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } }),
    async () => { throw new Error("Disk full"); });
  await assert.rejects(loadPrivateImage("https://api.example/v1/media/photo", "token", new AbortController().signal), /Disk full/);
  assert.equal(files.size, 0);
});

test("cancellation during a disk write removes the private photo", async () => {
  const controller = new AbortController();
  const { loadPrivateImage, files } = loader("https://api.example", async () =>
    new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } }),
    async () => controller.abort());
  await assert.rejects(loadPrivateImage("https://api.example/v1/media/photo", "token", controller.signal), /Загрузка отменена/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(files.size, 0);
});

const apiUrl = "https://api.example";
const photoUrl = `${apiUrl}/v1/media/photo`;
const signal = () => new AbortController().signal;
const response = () => new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("chat, details and full-screen viewer share one in-flight download", async () => {
  let requests = 0, finish;
  const app = loader(apiUrl, async () => { requests++; return new Promise((resolve) => { finish = resolve; }); });
  const first = new AbortController();
  const chat = app.loadPrivateImage(photoUrl, "token", first.signal);
  const details = app.loadPrivateImage(photoUrl, "token", signal());
  const fullScreen = app.loadPrivateImage(photoUrl, "token", signal());
  await tick();
  assert.equal(requests, 1);
  first.abort();
  await assert.rejects(chat, /Загрузка отменена/);
  finish(response());
  const [a, b] = await Promise.all([details, fullScreen]);
  assert.equal(a.uri, b.uri);
  a.dispose();
  assert.ok(app.files.has(b.uri));
  b.dispose();
  assert.equal(app.files.size, 1);
});

test("cancelling the last viewer aborts the shared request and allows a fresh retry", async () => {
  let requestSignal, finish, requests = 0;
  const app = loader(apiUrl, async (_uri, options) => {
    requests++;
    requestSignal = options.signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  const controller = new AbortController();
  const pending = app.loadPrivateImage(photoUrl, "token", controller.signal);
  await tick();
  const oldFinish = finish;
  controller.abort();
  await assert.rejects(pending, /Загрузка отменена/);
  assert.equal(requestSignal.aborted, true);
  const retry = app.loadPrivateImage(photoUrl, "token", signal());
  await tick();
  assert.equal(requests, 2);
  oldFinish(response());
  await tick();
  assert.equal(app.files.size, 0);
  finish(response());
  (await retry).dispose();
  assert.equal(app.files.size, 1);
});

test("the disk cache survives restarting the app with the same authenticated session", async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return response(); };
  const first = loader(apiUrl, fetcher);
  const photo = await first.loadPrivateImage(photoUrl, "token", signal());
  photo.dispose();
  const restarted = loader(apiUrl, fetcher, undefined, { disk: first.disk });
  const cached = await restarted.loadPrivateImage(photoUrl, "token", signal());
  assert.equal(cached.uri, photo.uri);
  assert.equal(requests, 1);
  cached.dispose();
  await restarted.setPrivateImageSession(null);
  assert.equal(first.files.size, 0);
});

test("OS cache eviction and corrupted files can be recovered by downloading again", async () => {
  let requests = 0;
  const app = loader(apiUrl, async () => { requests++; return response(); });
  const first = await app.loadPrivateImage(photoUrl, "token", signal());
  first.dispose();
  app.files.delete(first.uri);
  const second = await app.loadPrivateImage(photoUrl, "token", signal());
  assert.equal(requests, 2);
  second.invalidate();
  second.dispose();
  const third = await app.loadPrivateImage(photoUrl, "token", signal());
  assert.equal(requests, 3);
  assert.ok(app.files.has(third.uri));
  third.dispose();
});

test("switching accounts clears cached photos and rejects old credentials", async () => {
  const requests = [];
  const app = loader(apiUrl, async (_uri, options) => { requests.push(options.headers.Authorization); return response(); });
  const first = await app.loadPrivateImage(photoUrl, "token", signal());
  await app.setPrivateImageSession("other-account-token");
  assert.equal(app.files.size, 0);
  await assert.rejects(app.loadPrivateImage(photoUrl, "token", signal()), (error) => error.status === 401);
  const second = await app.loadPrivateImage(photoUrl, "other-account-token", signal());
  assert.notEqual(first.uri, second.uri);
  assert.deepEqual(requests, ["Bearer token", "Bearer other-account-token"]);
  first.dispose();
  assert.ok(app.files.has(second.uri));
  await app.setPrivateImageSession(null);
  assert.equal(app.files.size, 0);
  second.dispose();
});

test("a late disk write from a signed-out session cannot populate the next account's cache", async () => {
  let finish, writes = 0;
  const app = loader(apiUrl, async () => response(), async () => {
    if (++writes === 1) await new Promise((resolve) => { finish = resolve; });
  });
  const old = app.loadPrivateImage(photoUrl, "token", signal());
  const rejected = assert.rejects(old, /Загрузка отменена/);
  await tick();
  await app.setPrivateImageSession(null);
  await app.setPrivateImageSession("other-account-token");
  const next = await app.loadPrivateImage(photoUrl, "other-account-token", signal());
  finish();
  await rejected;
  assert.equal(app.files.size, 1);
  assert.ok(app.files.has(next.uri));
  next.dispose();
});

test("the 100-image limit evicts old idle photos while preserving visible and recently used photos", async () => {
  const app = loader(apiUrl, async () => response());
  const photos = [];
  for (let i = 0; i < 100; i++) {
    const photo = await app.loadPrivateImage(`${photoUrl}-${i}`, "token", signal());
    photos.push(photo);
    if (i !== 1) photo.dispose();
  }
  const recent = await app.loadPrivateImage(`${photoUrl}-0`, "token", signal());
  recent.dispose();
  const newest = await app.loadPrivateImage(`${photoUrl}-100`, "token", signal());
  assert.equal(app.files.size, 100);
  assert.ok(app.files.has(photos[0].uri));
  assert.ok(app.files.has(photos[1].uri));
  assert.equal(app.files.has(photos[2].uri), false);
  photos[1].dispose();
  newest.dispose();
});

test("the disk cache also enforces its 100 MB byte limit", async () => {
  const bytes = new Uint8Array(10 * 1024 * 1024);
  const app = loader(apiUrl, async () => ({ ok: true, headers: new Headers({ "Content-Type": "image/jpeg" }), arrayBuffer: async () => bytes.buffer }));
  let oldest;
  for (let i = 0; i < 11; i++) {
    const photo = await app.loadPrivateImage(`${photoUrl}-${i}`, "token", signal());
    oldest ??= photo.uri;
    photo.dispose();
  }
  assert.equal(app.files.size, 10);
  assert.equal(app.files.has(oldest), false);
});

test("concurrent downloads are not evicted before their viewers can display them", async () => {
  const app = loader(apiUrl, async () => response());
  const visible = await Promise.all(Array.from({ length: 102 }, (_, i) => app.loadPrivateImage(`${photoUrl}-${i}`, "token", signal())));
  assert.equal(app.files.size, 102);
  for (const photo of visible) assert.ok(app.files.has(photo.uri));
  for (const photo of visible) photo.dispose();
  assert.equal(app.files.size, 100);
});

test("incomplete disk writes left by a crash are discarded on restart", async () => {
  const app = loader(apiUrl, async () => response());
  const photo = await app.loadPrivateImage(photoUrl, "token", signal());
  photo.dispose();
  app.files.set(photo.uri.replace(/\.jpg$/, ".part"), Buffer.from([1, 2]));
  const restarted = loader(apiUrl, async () => { throw new Error("Must use disk cache"); }, undefined, { disk: app.disk });
  (await restarted.loadPrivateImage(photoUrl, "token", signal())).dispose();
  assert.equal(app.files.size, 1);
  assert.ok(app.files.has(photo.uri));
});

test("web shares object URLs across screens and revokes them on logout", async () => {
  let requests = 0;
  const revoked = [];
  const app = loader(apiUrl, async () => { requests++; return response(); }, undefined, {
    platform: "web", URL: { createObjectURL: () => "blob:private-photo", revokeObjectURL: (uri) => revoked.push(uri) },
  });
  const first = await app.loadPrivateImage(photoUrl, "token", signal());
  first.dispose();
  const next = await app.loadPrivateImage(photoUrl, "token", signal());
  assert.equal(first.uri, next.uri);
  assert.equal(requests, 1);
  assert.equal(app.files.size, 0);
  assert.equal(revoked.length, 0);
  await app.setPrivateImageSession(null);
  assert.deepEqual(revoked, ["blob:private-photo"]);
  next.dispose();
});

test("the image renderer never requests a protected HTTP URL", async () => {
  const slots = [], effects = [];
  let cursor = 0;
  let requested;
  let finish;
  let disposed = false;
  let invalidated = false;
  const element = (type, props) => ({ type, props });
  const { ProtectedImage } = compile("components/ProtectedImage.tsx", (name) => {
    if (name === "react") return {
      useState: (initial) => {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (value) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
      },
      useEffect: (effect) => effects.push(effect),
    };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (name === "react-native") return {
      Image: "Image", View: "View", Text: "Text", ActivityIndicator: "Spinner", Pressable: "Pressable",
      StyleSheet: { create: (style) => style, flatten: (style) => style, absoluteFill: {} },
    };
    if (name === "../config") return { API_URL: "https://api.example" };
    if (name === "../auth") return { useAuth: () => ({ token: "session-token" }) };
    if (name === "../theme") return { colors: {} };
    if (name === "../privateImage") return { loadPrivateImage: (uri, token, signal) => {
      requested = { uri, token, signal };
      return new Promise((resolve) => { finish = resolve; });
    }};
    throw new Error(name);
  }, { AbortController, setTimeout, clearTimeout, console, __DEV__: true });
  function render() {
    cursor = 0;
    const photo = ProtectedImage({ uri: "https://api.example/v1/media/photo", style: { width: 96, height: 96 } });
    return photo.type(photo.props);
  }
  assert.equal(render().props.children.some((child) => child?.type === "Image"), false);
  const cleanup = effects[0]();
  assert.equal(requested.token, "session-token");
  finish({ uri: "file:///cache/downloaded.jpg", dispose: () => { disposed = true; }, invalidate: () => { invalidated = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  const image = render().props.children.find((child) => child?.type === "Image");
  assert.equal(image.props.source.uri, "file:///cache/downloaded.jpg");
  assert.equal(image.props.source.headers, undefined);
  image.props.onError();
  assert.equal(invalidated, true);
  cleanup();
  assert.equal(disposed, true);
  assert.equal(requested.signal.aborted, true);
});
