const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const assert = require("node:assert/strict"), { test } = require("node:test");
const tick = () => new Promise(resolve => setImmediate(resolve));
function compiled(file) { return ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/outbox", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; }
function setup(send) {
  const listeners = new Set(), stores = new Map();
  const appState = { currentState: "active", addEventListener(_event, fn) { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } };
  const queue = { exports: {}, setTimeout, clearTimeout, AbortController }; vm.runInNewContext(compiled("queue.ts"), queue);
  const context = { exports: {}, FormData: class { fields = []; append(...args) { this.fields.push(args); } }, require(name) {
    if (name === "./queue") return queue.exports;
    if (name === "react-native") return { AppState: appState };
    if (name === "react") return { useSyncExternalStore: (_subscribe, get) => get() };
    if (name === "../api") return { api: send };
    if (name === "../media") return { appendMedia: async (form, field, photo) => form.append(field, photo.uri) };
    if (name === "./storage") return { createOutboxStorage: async token => ({
      read: async () => stores.get(token) ?? null,
      write: async data => stores.set(token, structuredClone(data)),
      prepare: async item => item, release: async () => {}, clear: async () => stores.delete(token),
    }) };
    throw Error(name);
  }};
  vm.runInNewContext(compiled("session.ts"), context);
  return { ...context.exports, stores, listeners, state(value) { appState.currentState = value; listeners.forEach(fn => fn(value)); } };
}
const item = key => ({ requestKey: key, text: key, createdAt: new Date().toISOString(), photos: [{ uri: `${key}-a.jpg` }, { uri: `${key}-b.jpg` }] });
const result = key => ({ id: `op-${key}`, request_key: key, status: "queued", kind: "analyze" });
test("session uploads without a mounted chat, pauses new uploads in background and serializes grouped files", async t => {
  const calls = [];
  const service = setup(async (url, options) => { calls.push({ url, ...options }); return result(options.body.fields[0][1]); });
  t.after(() => service.setChatOutboxSession(null));
  await service.setChatOutboxSession("first-token");
  service.state("background"); service.enqueueMessage(item("one")); service.enqueueMessage(item("two")); await tick();
  assert.equal(calls.length, 0);
  service.state("active"); await tick(); assert.equal(calls.length, 2);
  assert.equal(calls[0].token, "first-token");
  assert.deepEqual(calls[0].body.fields, [["request_key", "one"], ["text", "one"], ["image", "one-a.jpg"], ["image", "one-b.jpg"]]);
  service.state("background"); service.state("active"); await tick(); assert.equal(calls.length, 2);
});
test("switching accounts aborts the previous request, clears its queue and ignores a late receipt", async t => {
  let resolveOld; const calls = [];
  const service = setup(async (_url, options) => {
    calls.push(options);
    return options.token === "old" ? new Promise(resolve => { resolveOld = resolve; }) : result("new-message");
  });
  t.after(() => service.setChatOutboxSession(null));
  await service.setChatOutboxSession("old"); service.enqueueMessage(item("old-message")); await tick();
  service.dismissChatFailure("old-failure"); await tick();
  assert.ok(service.useChatOutbox().dismissedFailures.includes("old-failure"));
  await service.setChatOutboxSession("new");
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(service.stores.has("old"), false);
  assert.equal(service.useChatOutbox().items.length, 0);
  assert.equal(service.useChatOutbox().dismissedFailures.length, 0);
  resolveOld(result("old-message")); await tick();
  service.enqueueMessage(item("new-message")); await tick();
  assert.equal(calls[1].token, "new");
  assert.deepEqual(Array.from(service.useChatOutbox().items, item => item.requestKey), ["new-message"]);
  await service.setChatOutboxSession(null); assert.equal(service.listeners.size, 0); assert.equal(service.stores.size, 0);
});
