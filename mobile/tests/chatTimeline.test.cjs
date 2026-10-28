const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/chatTimeline.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText, context);
const { buildChatTimeline } = context.exports;
const entry = (id, minute) => ({ id, entry_date: "2026-10-23", created_at: `2026-10-23T12:${minute}:00Z` });
const operation = (id, minute, status = "failed", extra = {}) => ({
  id, kind: "analyze", status, created_at: `2026-10-23T12:${minute}:00Z`,
  request_key: `request-${id}`, entry_id: null, result: null, ...extra,
});
const keys = rows => Array.from(rows, row => row.key);

test("a limit failure stays between messages sent before and after it", () => {
  const failed = operation("limit", "10", "failed", { limit_reached: { kind: "photo" } });
  const rows = buildChatTimeline([entry(2, "20"), entry(1, "00")], [failed]);
  assert.deepEqual(keys(rows), ["entry:1", "operation:limit", "entry:2"]);
  assert.deepEqual(keys(buildChatTimeline([entry(1, "00"), entry(2, "20"), entry(3, "30")], [failed])),
    ["entry:1", "operation:limit", "entry:2", "entry:3"]);
});

test("saved results appear once; processing, unknown results and failed corrections remain in the timeline", () => {
  const rows = buildChatTimeline([entry(1, "00")], [
    operation("saved", "00", "done", { entry_id: 1, result: { status: "saved" } }),
    operation("queued", "10", "queued"),
    operation("running", "20", "running"),
    operation("unknown", "30", "done", { result: { status: "unknown" } }),
    operation("correction", "40", "failed", { kind: "correct", entry_id: 1 }),
    operation("review", "50", "failed", { kind: "review" }),
  ]);
  assert.deepEqual(keys(rows), ["entry:1", "operation:queued", "operation:running", "operation:unknown", "operation:correction"]);
});

test("accepted jobs replace the upload placeholder even before their terminal result arrives", () => {
  const pending = { text: "", photos: ["file:///food.jpg"], requestKey: "same", createdAt: "2026-10-23T12:10:00Z" };
  assert.deepEqual(keys(buildChatTimeline([], [], pending)), ["pending:same"]);
  for (const status of ["queued", "running", "failed"]) {
    assert.deepEqual(keys(buildChatTimeline([], [operation("job", "10", status, { request_key: "same" })], pending)), ["operation:job"]);
  }
  assert.deepEqual(keys(buildChatTimeline([entry(1, "10")], [operation("job", "10", "done", { request_key: "same", entry_id: 1 })], pending)), ["entry:1"]);
  assert.deepEqual(keys(buildChatTimeline([], [operation("other", "00")], pending)), ["operation:other", "pending:same"]);
});

test("dismissal hides only the matching failure across local/server history and keeps successful results", () => {
  const pending = { text: "Обед", state: "failed", requestKey: "hidden", createdAt: "2026-10-23T12:10:00Z" };
  const dismissed = ["hidden"];
  assert.deepEqual(keys(buildChatTimeline([], [], pending, [], {}, dismissed)), []);
  const failed = operation("hidden", "10", "failed", { request_key: "hidden" });
  for (const anchors of [{}, { hidden: pending.createdAt }]) {
    assert.deepEqual(keys(buildChatTimeline([], [failed, operation("other", "20")], pending, [], anchors, dismissed)), ["operation:other"]);
  }
  assert.deepEqual(keys(buildChatTimeline([], [{ ...failed, status: "done", result: { status: "unknown" } }], pending, [], {}, dismissed)), []);
  assert.deepEqual(keys(buildChatTimeline([], [{ ...failed, status: "running" }], pending, [], {}, dismissed)), ["operation:hidden"]);
  assert.deepEqual(keys(buildChatTimeline([entry(1, "10")], [{ ...failed, status: "done", entry_id: 1, result: { status: "saved" } }], pending, [], {}, dismissed)), ["entry:1"]);
});

test("overlapping history pages cannot duplicate entries or operation cards", () => {
  const old = operation("job", "10", "queued");
  const next = { ...old, status: "failed" };
  const rows = buildChatTimeline([entry(1, "00"), entry(1, "00")], [old, next]);
  assert.deepEqual(keys(rows), ["entry:1", "operation:job"]);
  assert.equal(rows[1].operation.status, "failed");
});

test("a completed weigh-in stays visible across history reloads without becoming a food entry", () => {
  const op = operation("weight", "10", "done", { result: { status: "weight_saved", weight: { weight_kg: 79 } } });
  const rows = buildChatTimeline([], [op, op]);
  assert.deepEqual(keys(rows), ["operation:weight"]);
  assert.equal(rows[0].operation.result.weight.weight_kg, 79);
});

test("goal congratulations remain in chronological chat history once across reloads and overlapping pages", () => {
  const notice = { id: "goal-reached", title: "Цель достигнута!", message: "Поздравляем!", created_at: "2026-10-23T12:15:00Z" };
  const rows = buildChatTimeline([entry(1, "00"), entry(2, "20")], [operation("weight", "10", "done", { result: { status: "weight_saved" } })], null, [notice, notice]);
  assert.deepEqual(keys(rows), ["entry:1", "operation:weight", "notice:goal-reached", "entry:2"]);
  assert.equal(rows[2].notice.message, "Поздравляем!");
});

test("several local sends stay in send order as uploads and analyses finish out of order", () => {
  const pending = ["a", "b", "c"].map((key, index) => ({ requestKey: key, createdAt: `2026-10-23T12:0${index}:00Z`, text: key }));
  const anchors = Object.fromEntries(pending.map(item => [item.requestKey, item.createdAt]));
  assert.deepEqual(keys(buildChatTimeline([], [], pending)), ["pending:a", "pending:b", "pending:c"]);
  const ops = [operation("b", "08", "done", { request_key: "b", entry_id: 2 }), operation("a", "07", "running", { request_key: "a" })];
  const partial = buildChatTimeline([entry(2, "10")], ops, pending, [], anchors);
  assert.deepEqual(keys(partial), ["message:a", "message:b", "message:c"]);
  ops[1] = { ...ops[1], status: "done", entry_id: 1 };
  const done = buildChatTimeline([entry(2, "10"), entry(1, "11")], ops, pending, [], anchors);
  assert.deepEqual(keys(done), ["message:a", "message:b", "message:c"]);
  assert.equal(done[0].createdAt, pending[0].createdAt);
});
