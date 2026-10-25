const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const { test } = require("node:test");
const assert = require("node:assert/strict");
function load(file, modules = {}) {
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { weightChartGeometry, closestWeightPoint } = load("weightChart.ts", { "./chartMath": load("chartMath.ts") });
const row = (id, date, weight_kg) => ({ id: `manual:${id}`, recorded_at: date, local_date: date.slice(0, 10), weight_kg, source: "manual", origin: null });

test("empty and single-measurement histories do not invent changes", () => {
  const empty = weightChartGeometry([], 276);
  assert.equal(empty.coordinates.length, 0);
  assert.equal(empty.line, "");
  assert.equal(closestWeightPoint([], 10), -1);
  const single = weightChartGeometry([row(1, "2026-10-25T08:00:00Z", 80)], 276, 70);
  assert.equal(single.area, "");
  assert.ok(!single.line.includes("L"));
  assert.ok(single.coordinates[0].x > single.left && single.coordinates[0].x < single.right);
  assert.ok(single.targetY > single.top && single.targetY < single.bottom);
});

test("the weight chart preserves uneven time spacing and repeated values", () => {
  const data = [row(1, "2026-10-01T08:00:00Z", 80), row(2, "2026-10-02T08:00:00Z", 80), row(3, "2026-10-25T08:00:00Z", 79)];
  const chart = weightChartGeometry(data, 346, 70);
  assert.equal(chart.coordinates.length, 3);
  assert.equal(chart.coordinates[0].y, chart.coordinates[1].y);
  assert.ok(chart.coordinates[1].x - chart.coordinates[0].x < (chart.coordinates[2].x - chart.coordinates[1].x) / 10);
  assert.ok(chart.area.endsWith("Z"));
});

test("targets on either side of history remain visible at phone widths", () => {
  for (const width of [276, 346, 556]) for (const target of [40, 80, 120]) {
    const chart = weightChartGeometry([row(1, "2026-10-25T08:00:00Z", 80)], width, target);
    assert.ok(Number.isFinite(chart.targetY));
    assert.ok(chart.targetY >= chart.top && chart.targetY <= chart.bottom);
    assert.ok(!chart.line.includes("NaN"));
  }
});

test("only the last 30 actual measurements are plotted and equal-time selection uses the latest", () => {
  const data = Array.from({ length: 40 }, (_, i) => row(i, `2026-10-25T08:00:${String(i).padStart(2, "0")}Z`, 80));
  const chart = weightChartGeometry(data, 346);
  assert.equal(chart.coordinates.length, 30);
  assert.equal(chart.coordinates[0].row.id, "manual:10");
  assert.equal(chart.coordinates.at(-1).row.id, "manual:39");
  assert.equal(closestWeightPoint([{ x: 10 }, { x: 20 }, { x: 20 }], 20), 2);
});
