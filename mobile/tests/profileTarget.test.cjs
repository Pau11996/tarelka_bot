const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/profileTarget.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, context);
const { calculateSetupTarget } = context.exports;
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "../../tests/fixtures/profile_targets.json"), "utf8"));
const complete = { weight: "72", height: "174", age: "31", sex: "female", goal: "maintain", activity_level: "moderate" };

test("the live target matches the server for every activity and goal, including half-even rounding and the minimum", () => {
  for (const { profile, target } of fixtures) {
    const draft = { ...profile, weight: String(profile.weight_kg), height: String(profile.height_cm), age: String(profile.age) };
    assert.equal(calculateSetupTarget(draft), target, JSON.stringify(profile));
  }
});

test("partial and invalid answers hide the target; decimal commas remain valid", () => {
  assert.equal(calculateSetupTarget(complete), 2312);
  assert.equal(calculateSetupTarget({ ...complete, weight: "73,5" }), 2335);
  for (const key of Object.keys(complete)) assert.equal(calculateSetupTarget({ ...complete, [key]: "" }), null, key);
  for (const patch of [{ weight: "-1" }, { weight: "Infinity" }, { weight: "90000" }, { height: "0" }, { height: "abc" }, { age: "31,5" }, { age: "121" }, { age: "0" }]) {
    assert.equal(calculateSetupTarget({ ...complete, ...patch }), null, JSON.stringify(patch));
  }
});
