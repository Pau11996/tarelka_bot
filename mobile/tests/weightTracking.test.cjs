const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/weightTracking.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { parseWeight, weightDirection, weightChangePeriod } = context.exports;

test("weight entry accepts decimal comma and rejects malformed, zero and non-finite values", () => {
  assert.equal(parseWeight(" 72,5 "), 72.5);
  assert.equal(parseWeight("72.5"), 72.5);
  for (const value of ["", "0", "-1", "NaN", "Infinity", "1e3", "75 кг", "80,2,3", "1001"]) assert.equal(parseWeight(value), null, value);
});
test("the displayed direction follows the target without depending on calorie settings", () => {
  assert.equal(weightDirection(80, 70), "lose");
  assert.equal(weightDirection(70, 80), "gain");
  assert.equal(weightDirection(70, 70), "maintain");
});

test("weight change dates end at the last measurement, including its local day", () => {
  assert.equal(weightChangePeriod("2026-10-01T08:00:00Z", "2026-10-25T08:00:00Z"), "1 окт. 2026 — 25 окт. 2026");
  assert.equal(weightChangePeriod("2026-10-01T08:00:00Z", "2026-10-24T22:30:00Z", "Europe/Minsk"), "1 окт. 2026 — 25 окт. 2026");
  assert.equal(weightChangePeriod("2025-12-30T08:00:00Z", "2026-01-02T08:00:00Z"), "30 дек. 2025 — 2 янв. 2026");
  assert.equal(weightChangePeriod("2026-10-25T08:00:00Z", "2026-10-25T09:00:00Z"), "за 25 окт. 2026");
});

test("a goal without a subsequent weigh-in shows its start date without inventing an end date", () => {
  assert.equal(weightChangePeriod("2026-10-25T08:00:00Z", "2026-10-01T08:00:00Z"), "с 25 окт. 2026");
  assert.equal(weightChangePeriod("2026-10-25T08:00:00Z", null), "с 25 окт. 2026");
});
