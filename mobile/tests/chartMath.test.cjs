const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const source = ts.transpileModule(
  fs.readFileSync(
    require("node:path").join(__dirname, "../src/chartMath.ts"),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const context = { exports: {} };
vm.runInNewContext(source, context);
const m = context.exports;
test("missing values are excluded and a zero stays a recorded zero", () => {
  const d = m.chartDomain(
    [
      { value: null, date: "2026-01-01" },
      { value: 0, date: "2026-01-02" },
    ],
    2000,
  );
  assert.equal(d.low, 0);
  assert.ok(d.high > 2000);
  assert.ok(Number.isFinite(d.high));
});
test("weight scale does not create a zero baseline and preserves actual date spacing", () => {
  const p = [
    { date: "2026-01-01", value: 80 },
    { date: "2026-01-02", value: 79.9 },
    { date: "2026-01-30", value: 79 },
  ];
  assert.equal(m.chartDomain(p, undefined, true).low, 77);
  assert.ok(m.pointPosition(p, 1, true) < 0.1);
  assert.ok(m.pointPosition(p, 2, true) > 0.9);
});
test("single point has a usable position and scale", () => {
  const p = [{ date: "2026-01-01", value: 70 }];
  assert.equal(m.pointPosition(p, 0, true), 0.5);
  assert.ok(m.chartDomain(p, undefined, true).high > 70);
});
test("calendar arithmetic handles month, year and leap day without device timezone drift", () => {
  assert.equal(m.shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(m.shiftDay("2024-02-28", 1), "2024-02-29");
  assert.equal(m.shiftDay("2026-03-29", 1), "2026-03-30");
});
test("push navigation only opens known internal routes", () => {
  assert.equal(m.allowedNotificationPath("/assistant"), "/assistant");
  assert.equal(m.allowedNotificationPath("/weight"), "/weight");
  for (const value of ["https://evil.example", "/settings/data", {}, null])
    assert.equal(m.allowedNotificationPath(value), null);
});
test("a target below the measurements remains inside the weight chart", () => {
  const domain = m.chartDomain([{ date: "2026-01-01", value: 80 }], 70, true);
  assert.ok(domain.low < 70 && domain.high > 80);
});
