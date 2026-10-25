const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
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

function loader(apiUrl, fetcher = fetch, write = async () => {}) {
  const files = new Map();
  const { loadPrivateImage } = compile("privateImage.ts", (name) => {
    if (name === "react-native") return { Platform: { OS: "android" } };
    if (name === "./config") return { API_URL: apiUrl };
    if (name === "./api") return { ApiError };
    if (name === "expo-file-system") return { Paths: { cache: "file:///app-cache/" }, File: class {
      constructor(base, name) { this.uri = base + name; }
      async write(bytes) { files.set(this.uri, Buffer.from(bytes)); await write(); }
      get exists() { return files.has(this.uri); }
      delete() { files.delete(this.uri); }
    }};
    throw new Error(name);
  }, { fetch: fetcher, Uint8Array, Blob, URL });
  return { loadPrivateImage, files };
}

test("private photo is fetched with authorization, rendered from disk and removed afterwards", async () => {
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
    const { loadPrivateImage, files } = loader(api);
    const loaded = await loadPrivateImage(`${api}/v1/media/food-photo`, "session-token", new AbortController().signal);
    assert.deepEqual(requests, [{ path: "/v1/media/food-photo", authorization: "Bearer session-token" }]);
    assert.match(loaded.uri, /^file:\/\/\/app-cache\/tarelka-photo-.*\.jpg$/);
    assert.deepEqual(files.get(loaded.uri), photo);
    assert.ok(!loaded.uri.includes("session-token"));
    loaded.dispose();
    loaded.dispose();
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
  assert.equal(files.size, 0);
});

test("the image renderer never requests a protected HTTP URL", async () => {
  const slots = [], effects = [];
  let cursor = 0;
  let requested;
  let finish;
  let disposed = false;
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
  finish({ uri: "file:///cache/downloaded.jpg", dispose: () => { disposed = true; } });
  await new Promise((resolve) => setImmediate(resolve));
  const image = render().props.children.find((child) => child?.type === "Image");
  assert.equal(image.props.source.uri, "file:///cache/downloaded.jpg");
  assert.equal(image.props.source.headers, undefined);
  cleanup();
  assert.equal(disposed, true);
  assert.equal(requested.signal.aborted, true);
});
