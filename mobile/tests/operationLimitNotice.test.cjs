const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function setup() {
  const shown = { current: new Set() }, opened = [];
  let focused = true;
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/hooks/useOperationLimitNotice.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const context = { exports: {}, Date, require(name) {
    if (name === "react") return { useCallback: fn => fn, useRef: () => shown };
    if (name === "expo-router") return { useFocusEffect: fn => { if (focused) fn(); } };
    if (name === "../components/RequestLimitDialog") return { useRequestLimit: () => ({ openLimit: (...args) => opened.push(args) }) };
    if (name === "../requestLimits") return { isLegacyLimitMessage: message => message?.startsWith("Вы достигли дневного лимита") };
    throw Error(name);
  }};
  vm.runInNewContext(code, context);
  return { ...context.exports, opened, focus: value => { focused = value; } };
}

function operation(overrides = {}) {
  return {
    id: "quota-1", kind: "analyze", status: "failed", created_at: "2026-10-22T19:00:00Z",
    error: "Достигнут дневной лимит запросов", limit_reached: { kind: "photo" },
    ...overrides,
  };
}

test("first quota failure in history opens the same dialog once, including after polling or returning", () => {
  const app = setup();
  const op = operation();
  app.useOperationLimitNotice([op], false);
  assert.equal(app.opened.length, 1);
  assert.equal(app.opened[0][0], op.limit_reached);
  assert.equal(app.opened[0][1], "photo");
  app.useOperationLimitNotice([{ ...op }], false);
  app.focus(false);
  app.useOperationLimitNotice([op], false);
  app.focus(true);
  app.useOperationLimitNotice([op], false);
  assert.equal(app.opened.length, 1);
  app.useOperationLimitNotice([op, operation({ id: "quota-2", created_at: "2026-10-22T19:10:00Z" })], false);
  assert.equal(app.opened.length, 2);
});

test("a limit already shown by the live send handler is not reopened by history", () => {
  const app = setup();
  const op = operation();
  const markShown = app.useOperationLimitNotice([op], true);
  assert.equal(app.opened.length, 0);
  markShown(op.id);
  app.useOperationLimitNotice([op], false);
  assert.equal(app.opened.length, 0);
});

test("older pages and successful requests do not revive old limit notices", () => {
  const app = setup();
  app.useOperationLimitNotice([
    operation({ id: "done", status: "done", created_at: "2026-10-22T20:00:00Z", limit_reached: null }),
    operation(),
  ], false);
  assert.equal(app.opened.length, 0);
  app.useOperationLimitNotice([operation({ error: "Ошибка сети", limit_reached: null })], false);
  assert.equal(app.opened.length, 0);
});

test("dismissed failures do not reopen the quota dialog or fall back to an older failure", () => {
  const app = setup();
  const latest = operation({ request_key: "hidden" });
  const older = operation({ id: "older", request_key: "older", created_at: "2026-10-22T18:00:00Z" });
  app.useOperationLimitNotice([older, latest], false, ["hidden"]);
  assert.equal(app.opened.length, 0);
  app.useOperationLimitNotice([latest, operation({ id: "new", request_key: "new", created_at: "2026-10-22T20:00:00Z" })], false, ["hidden"]);
  assert.equal(app.opened.length, 1);
});

test("legacy quota failures use the information button flow with the matching request kind", () => {
  const app = setup();
  app.useOperationLimitNotice([operation({
    error: "Вы достигли дневного лимита голосовых запросов (10 в день).", limit_reached: null,
  })], false);
  assert.equal(app.opened.length, 1);
  assert.equal(app.opened[0][0], null);
  assert.equal(app.opened[0][1], "voice");
});
