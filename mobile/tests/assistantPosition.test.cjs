const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/assistantPosition.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  context,
);
const m = context.exports;
test("drag stays inside safe areas, clear of chat input and tab bar", () => {
  const b = m.assistantBounds(390, 844, 47, 34, true);
  const p = m.clampAssistant({ x: -999, y: 9999 }, b);
  assert.equal(p.x, 12);
  assert.ok(p.y + m.ASSISTANT_SIZE <= 844 - 34 - 160);
  assert.ok(b.top >= 47 + 92);
  assert.ok(m.assistantBounds(390, 844, 47, 34, false).bottom > b.bottom);
});
test("docking remembers the chosen side and relative height across rotation", () => {
  const b = m.assistantBounds(390, 844, 47, 34, true);
  const dock = m.assistantDock({ x: b.left + 4, y: (b.top + b.bottom) / 2 }, b);
  assert.equal(dock.edge, "left");
  assert.equal(dock.fraction, 0.5);
  const rotated = m.assistantBounds(844, 390, 0, 21, true);
  const p = m.dockPosition(dock, rotated);
  assert.equal(p.x, rotated.left);
  assert.ok(p.y >= rotated.top && p.y <= rotated.bottom);
});
test("compact and wide viewports still have finite reachable positions", () => {
  for (const [w, h] of [
    [320, 480],
    [844, 390],
    [1280, 720],
    [320, 240],
  ]) {
    const b = m.assistantBounds(w, h, 24, 34, true);
    const p = m.dockPosition({ edge: "right", fraction: 1 }, b);
    assert.ok(p.x >= 0 && p.x + m.ASSISTANT_SIZE <= w);
    assert.ok(p.y >= 0 && p.y + m.ASSISTANT_SIZE <= h);
  }
});
test("invalid saved positions fall back safely instead of hiding the assistant", () => {
  for (const raw of [
    null,
    "broken",
    "null",
    "{}",
    '{"edge":"right","fraction":"1"}',
    '{"edge":"middle","fraction":0.5}',
  ])
    assert.equal(m.parseAssistantDock(raw), null);
  assert.equal(
    m.parseAssistantDock('{"edge":"right","fraction":2}').fraction,
    1,
  );
});
