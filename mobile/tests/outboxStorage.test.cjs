const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
function adapter(t, platform = "android") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outbox-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kv = new Map();
  class Entry {
    constructor(...parts) { this.uri = path.join(...parts.map(part => part.uri ?? part)); }
    get exists() { return fs.existsSync(this.uri); }
    get name() { return path.basename(this.uri); }
    delete() { fs.rmSync(this.uri, { recursive: true, force: true }); }
  }
  class Directory extends Entry {
    create() { fs.mkdirSync(this.uri, { recursive: true }); }
    list() { return fs.readdirSync(this.uri, { withFileTypes: true }).map(entry => new (entry.isDirectory() ? Directory : File)(this, entry.name)); }
  }
  class File extends Entry {
    get size() { return this.exists ? fs.statSync(this.uri).size : 0; }
    copy(destination) { fs.copyFileSync(this.uri, destination.uri); }
    move(destination) { fs.renameSync(this.uri, destination.uri); this.uri = destination.uri; }
  }
  const context = { exports: {}, require(name) {
    if (name === "react-native") return { Platform: { OS: platform } };
    if (name === "../config") return { API_URL: "https://example.test" };
    if (name === "expo-file-system") return { Directory, File, Paths: { document: root } };
    if (name === "expo-crypto") return { CryptoDigestAlgorithm: { SHA256: "sha256" }, digestStringAsync: async (algo, value) => crypto.createHash(algo).update(value).digest("hex") };
    if (name === "@react-native-async-storage/async-storage") return {
      getItem: async key => kv.get(key) ?? null, setItem: async (key, value) => kv.set(key, value),
      removeItem: async key => kv.delete(key), getAllKeys: async () => [...kv.keys()], multiRemove: async keys => keys.forEach(key => kv.delete(key)),
    };
    throw Error(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/outbox/storage.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { ...context.exports, root, kv };
}
const item = photo => ({ requestKey: "original-request", text: "food", createdAt: "now", state: "waiting", photos: [photo], voiceMedia: photo });
test("native copies photos and voice out of cache, restores bytes after restart, then cleans up", async t => {
  const app = adapter(t); const source = path.join(app.root, "picker.jpg"); fs.writeFileSync(source, "food-bytes");
  const disk = await app.createOutboxStorage("session-one");
  const prepared = await disk.prepare(item({ uri: source, name: "food.jpg", type: "image/jpeg" }));
  assert.notEqual(prepared.photos[0].uri, source);
  assert.notEqual(prepared.photos[0].uri, prepared.voiceMedia.uri);
  await disk.write({ items: [prepared], anchors: { "original-request": "now" } }); fs.unlinkSync(source);
  const restoredDisk = await app.createOutboxStorage("session-one");
  const restored = (await restoredDisk.read()).items[0];
  assert.equal(fs.readFileSync(restored.photos[0].uri, "utf8"), "food-bytes");
  assert.equal(fs.readFileSync(restored.voiceMedia.uri, "utf8"), "food-bytes");
  const again = await restoredDisk.prepare(restored); assert.equal(again.photos[0].uri, restored.photos[0].uri);
  await restoredDisk.release(restored); assert.equal(fs.existsSync(restored.photos[0].uri), false);
  await restoredDisk.clear(); assert.equal(await restoredDisk.read(), null);
});
test("a different account cannot restore pending messages or attachments; stale session data is purged", async t => {
  const app = adapter(t); const source = path.join(app.root, "picker.jpg"); fs.writeFileSync(source, "private-photo");
  const one = await app.createOutboxStorage("secret-session-one");
  const prepared = await one.prepare(item({ uri: source, name: "food.jpg", type: "image/jpeg" }));
  await one.write({ items: [prepared], anchors: {} });
  assert.ok([...app.kv.keys()].every(key => !key.includes("secret-session-one")));
  const two = await app.createOutboxStorage("secret-session-two");
  assert.equal(await two.read(), null); assert.equal(await one.read(), null);
  assert.equal(fs.existsSync(prepared.photos[0].uri), false);
});
test("web retains File objects for queued uploads without loading native filesystem", async t => {
  const app = adapter(t, "web"); const disk = await app.createOutboxStorage("web");
  const file = new Blob(["photo"], { type: "image/jpeg" });
  const prepared = await disk.prepare(item({ uri: "blob:photo", name: "photo.jpg", type: "image/jpeg", file }));
  await disk.write({ items: [prepared], anchors: {} });
  assert.equal((await disk.read()).items[0].photos[0].file, file);
  await disk.clear(); assert.equal(await disk.read(), null);
});
