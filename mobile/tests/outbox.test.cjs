const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
function load(file, require = () => { throw Error("unexpected import"); }, globals = {}) {
  const context = { exports: {}, require, AbortController, setTimeout, clearTimeout, ...globals };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return context.exports;
}
const { OutboxQueue } = load("outbox/queue.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const photo = name => ({ uri: `file:///${name}.jpg`, name: `${name}.jpg`, type: "image/jpeg" });
const message = (key, extra = {}) => ({ requestKey: key, createdAt: `2026-10-27T12:00:0${key.length}Z`, text: key, photos: [photo(key)], ...extra });
const operation = (key, extra = {}) => ({ id: `op-${key}`, request_key: key, kind: "analyze", status: "queued", created_at: "2026-10-27T12:01:00Z", entry_id: null, result: null, error: null, text: key, ...extra });
function storage(initial = null) {
  let saved = initial;
  return { read: async () => saved, write: async data => { saved = structuredClone(data); },
    prepare: async item => structuredClone(item), release: async () => {}, clear: async () => { saved = null; }, saved: () => saved };
}
async function setup(t, send, disk = storage()) {
  const queue = new OutboxQueue(disk, send);
  t.after(() => queue.close());
  await queue.initialize(); queue.setActive(true);
  return queue;
}
test("three sends snapshot their own attachments, upload FIFO, and do not wait for AI", async t => {
  const first = deferred(), calls = [];
  const queue = await setup(t, async item => { calls.push(item); return calls.length === 1 ? first.promise : operation(item.requestKey); });
  const photos = [photo("a"), photo("b")];
  queue.enqueue(message("one", { photos }));
  queue.enqueue(message("two")); queue.enqueue(message("three"));
  photos[0].uri = "changed"; photos.push(photo("new"));
  assert.equal(queue.getSnapshot().items.length, 3);
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0].photos, p => p.uri), ["file:///a.jpg", "file:///b.jpg"]);
  assert.deepEqual(Array.from(queue.getSnapshot().items, row => row.state), ["uploading", "waiting", "waiting"]);
  first.resolve(operation("one")); await tick();
  assert.deepEqual(calls.map(row => row.requestKey), ["one", "two", "three"]);
  assert.ok(queue.getSnapshot().items.every(row => row.operation.status === "queued"));
});
test("lost response and per-message failure do not block later sends; retry keeps original key and photos", async t => {
  const server = new Map(), calls = []; let lose = true;
  const queue = await setup(t, async item => {
    calls.push(item); server.set(item.requestKey, server.get(item.requestKey) ?? operation(item.requestKey));
    if (item.requestKey === "one" && lose) { lose = false; throw Error("response lost"); }
    return server.get(item.requestKey);
  });
  queue.enqueue(message("one")); queue.enqueue(message("two")); await tick();
  assert.deepEqual(Array.from(queue.getSnapshot().items, row => row.state), ["failed", "accepted"]);
  queue.retry("one"); await tick();
  assert.deepEqual(calls.map(row => row.requestKey), ["one", "two", "one"]);
  assert.equal(server.size, 2); assert.equal(calls[2].photos[0].uri, "file:///one.jpg");
});
test("history confirmation wins over a late failed upload response", async t => {
  const pending = deferred();
  const queue = await setup(t, () => pending.promise);
  queue.enqueue(message("one")); await tick();
  queue.reconcile([operation("one", { status: "running" })], []);
  pending.reject(Error("lost response")); await tick();
  assert.equal(queue.getSnapshot().items[0].state, "accepted");
  assert.equal(queue.getSnapshot().items[0].operation.status, "running");
});
test("quick background/foreground cycle resumes an aborted upload with the same key", async t => {
  const pending = deferred(), calls = [];
  const queue = await setup(t, (item, signal) => { calls.push({ item, signal }); return calls.length === 1 ? pending.promise : Promise.resolve(operation(item.requestKey)); });
  queue.enqueue(message("one")); await tick();
  queue.setActive(false); queue.setActive(true);
  assert.equal(calls[0].signal.aborted, true);
  pending.reject(Error("aborted")); await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].item.requestKey, calls[0].item.requestKey);
  assert.equal(queue.getSnapshot().items[0].state, "accepted");
});
test("restart restores interrupted uploads, preserves accepted jobs, and releases files only after history", async t => {
  const released = [], calls = [];
  const disk = storage({ items: [
    { ...message("one"), state: "uploading", prepared: true },
    { ...message("two"), state: "accepted", operation: operation("two") },
  ], anchors: { one: "original-time" } });
  disk.release = async item => released.push(item.requestKey);
  const queue = await setup(t, async item => { calls.push(item.requestKey); return operation(item.requestKey); }, disk);
  await tick(); assert.deepEqual(calls, ["one"]);
  queue.reconcile([operation("one", { status: "done", entry_id: 1 })], []);
  await tick(); assert.equal(released.length, 0);
  queue.reconcile([operation("one", { status: "done", entry_id: 1 }), operation("two", { status: "failed" })], [1]);
  await tick();
  assert.equal(queue.getSnapshot().items.length, 0);
  assert.deepEqual(released, ["one", "two"]);
  assert.equal(disk.saved().items.length, 0);
  assert.equal(queue.getSnapshot().anchors.one, "original-time");
});
test("corrections lock only their entry; a failed correction and limit do not block new messages", async t => {
  const pending = deferred();
  const queue = await setup(t, item => item.requestKey === "correction" ? pending.promise : Promise.resolve(operation(item.requestKey)));
  queue.enqueue(message("correction", { entryId: 7 }));
  assert.throws(() => queue.enqueue(message("duplicate", { entryId: 7 })), /уточняется/);
  queue.enqueue(message("other-correction", { entryId: 8 })); queue.enqueue(message("new")); await tick();
  const limit = { kind: "text", message: "Дневной лимит" };
  pending.reject({ limitReached: limit }); await tick();
  assert.equal(queue.getSnapshot().items[0].limitReached.message, limit.message);
  assert.equal(queue.isCorrecting(7), false);
  assert.equal(queue.getSnapshot().items[2].state, "accepted");
});
test("logout cancels uploads, waits for file preparation, clears disk, ignores late results", async () => {
  const copying = deferred(), disk = storage(), posted = [];
  disk.prepare = () => copying.promise;
  const queue = new OutboxQueue(disk, async item => { posted.push(item); return operation(item.requestKey); });
  await queue.initialize(); queue.setActive(true); queue.enqueue(message("one")); await tick();
  const closed = queue.close(); copying.resolve(message("one")); await closed; await tick();
  assert.equal(disk.saved(), null); assert.equal(posted.length, 0);
});
test("a storage failure never sends an unjournaled message and can be retried", async t => {
  const disk = storage(), originalWrite = disk.write, calls = []; let fail = true;
  disk.write = async data => { if (fail) throw Error("disk full"); await originalWrite(data); };
  const queue = await setup(t, async item => { calls.push(item); return operation(item.requestKey); }, disk);
  queue.enqueue(message("one")); await tick();
  assert.equal(queue.getSnapshot().items[0].state, "failed"); assert.equal(calls.length, 0);
  fail = false; queue.retry("one"); await tick(); assert.equal(calls.length, 1);
});
test("read failure cannot overwrite a saved queue; reopening retries the read", async t => {
  const disk = storage(); let fail = true;
  disk.read = async () => { if (fail) throw Error("disk"); return { items: [], anchors: {} }; };
  const queue = await setup(t, async () => {}, disk);
  assert.equal(queue.getSnapshot().ready, false);
  assert.throws(() => queue.enqueue(message("one")), /загружается/);
  fail = false; await queue.initialize(); assert.equal(queue.getSnapshot().ready, true);
});

test("dismissed local and server failures survive restart and retry can show a new failure", async t => {
  const disk = storage();
  const queue = await setup(t, async () => { throw Error("offline"); }, disk);
  queue.enqueue(message("local")); await tick();
  queue.dismissFailure("local"); queue.dismissFailure("server"); queue.dismissFailure("local");
  await tick();
  assert.deepEqual(disk.saved().dismissedFailures, ["local", "server"]);
  const restored = await setup(t, async () => { throw Error("offline"); }, storage(disk.saved()));
  assert.deepEqual(Array.from(restored.getSnapshot().dismissedFailures), ["local", "server"]);
  assert.equal(restored.getSnapshot().items[0].state, "failed");
  restored.retry("local"); await tick();
  assert.deepEqual(Array.from(restored.getSnapshot().dismissedFailures), ["server"]);
  assert.equal(restored.getSnapshot().items[0].state, "failed");
});
test("one poll loop coalesces wakeups, pauses in background and refreshes immediately on return", async () => {
  const timers = new Map(); let id = 0, calls = 0; const first = deferred();
  const { ChatPoller } = load("outbox/poller.ts", undefined, {
    setTimeout: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
  });
  const loop = new ChatPoller(async () => { calls++; if (calls === 1) await first.promise; }, () => 3000);
  loop.setActive(true); loop.wake(); loop.wake(); assert.equal(calls, 1);
  first.resolve(); await tick(); assert.equal(calls, 2); assert.equal(timers.size, 1);
  loop.setActive(false); assert.equal(timers.size, 0); loop.wake(); assert.equal(calls, 2);
  loop.setActive(true); await tick(); assert.equal(calls, 3); assert.equal(timers.size, 1);
  loop.setActive(false);
});

test("same-millisecond submissions get stable chronological anchors", async t => {
  const queue = await setup(t, async item => operation(item.requestKey));
  const time = "2026-10-27T12:00:00.000Z";
  queue.enqueue(message("z", { createdAt: time })); queue.enqueue(message("a", { createdAt: time }));
  const rows = queue.getSnapshot().items;
  assert.ok(Date.parse(rows[0].createdAt) < Date.parse(rows[1].createdAt));
});
test("restored jobs beyond the first history page recover their own result and media", async () => {
  const { recoverOutboxHistory } = load("outbox/history.ts");
  const latest = { entries: [{ id: 99 }], operations: [], media: [], next_before: 99 };
  const done = operation("one", { status: "done", entry_id: 1 });
  const calls = [];
  const recovered = await recoverOutboxHistory(latest, [{ ...message("one"), operation: operation("one") }], async url => {
    calls.push(url);
    return url.startsWith("/v1/operations/") ? done : { entries: [{ id: 1 }], operations: [done], media: [{ id: "photo-1", operation_id: done.id }], next_before: null };
  });
  assert.deepEqual(calls, ["/v1/operations/op-one", "/v1/chat?before=2&limit=1"]);
  assert.deepEqual(Array.from(recovered.chat.entries, row => row.id), [1, 99]);
  assert.equal(recovered.chat.media[0].operation_id, done.id);
  assert.equal(recovered.chat.next_before, 99);
});
test("an unavailable old job does not block fresh results or other restored jobs", async () => {
  const { recoverOutboxHistory } = load("outbox/history.ts");
  const latest = { entries: [{ id: 99 }], operations: [], media: [], next_before: 99 };
  const recovered = await recoverOutboxHistory(latest, ["one", "two"].map(key => ({ ...message(key), operation: operation(key) })), async url => {
    if (url.endsWith("one")) throw { status: 404 };
    return operation("two", { status: "failed", error: "AI unavailable" });
  });
  assert.deepEqual(Array.from(recovered.chat.entries, row => row.id), [99]);
  assert.equal(recovered.observed.length, 2);
  assert.ok(recovered.observed.every(op => op.status === "failed"));
});
