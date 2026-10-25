const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/weightTracking.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { parseWeight, weightDirection } = context.exports;

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
