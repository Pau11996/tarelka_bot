const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const cache = new Map();
function load(name) {
  const file = path.resolve(__dirname, "../src", name + ".ts");
  if (cache.has(file)) return cache.get(file);
  const context = { exports: {}, require: value => load(value) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  cache.set(file, context.exports);
  return context.exports;
}
const diary = load("diary");

test("chronicle offers favorites for meals, water and activity and updates the correct entry", () => {
  const element = (type, props) => ({ type, props });
  const context = { exports: {}, require(name) {
    if (name === "react") return {};
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (name === "react-native") return { Pressable: "Pressable", Text: "Text", View: "View", StyleSheet: { create: value => value } };
    if (name === "react-native-svg") return { default: "Svg", Circle: "Circle" };
    if (name === "expo-router") return { router: { push() {} } };
    if (name === "../diary") return diary;
    if (name === "../chartMath") return load("chartMath");
    if (name === "../format") return { mealHeading: () => "Приём пищи" };
    if (name === "../theme") return { colors: {} };
    if (name === "./Brand") return { Icon: "Icon" };
    if (name === "./FavoriteButton") return { FavoriteButton: "FavoriteButton" };
    throw Error(name);
  }};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/DiaryDay.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  function nodes(root) {
    if (!root || typeof root !== "object") return [];
    return [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)];
  }
  const changes = [];
  const entries = ["meal", "water", "activity"].map((entry_type, index) => ({
    id: index + 1, entry_type, title: entry_type, calories: 250, volume_ml: 300,
    favorite_id: index === 2 ? 23 : null,
  }));
  const all = nodes(context.exports.DiaryChronicle({ entries, onFavoriteChange: (...args) => changes.push(args) }));
  const buttons = all.filter(n => n.type === "FavoriteButton");
  assert.deepEqual(buttons.map(n => n.props.entryId), [1, 2, 3]);
  assert.deepEqual(buttons.map(n => n.props.favoriteId), [null, null, 23]);
  buttons.forEach((button, index) => button.props.onChange(index === 2 ? null : 20 + index));
  assert.deepEqual(changes, [[1, 20], [2, 21], [3, null]]);
});

test("week navigation starts on Monday and crosses year and month boundaries", () => {
  assert.deepEqual(Array.from(diary.diaryWeek("2026-01-01")), ["2025-12-29", "2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]);
  assert.equal(diary.diaryWeek("2026-10-25")[0], "2026-10-19");
});

test("the month grid preserves blank cells, leap days and Monday alignment", () => {
  const october = diary.diaryMonth("2026-10");
  assert.equal(october.length, 35);
  assert.deepEqual(Array.from(october.slice(0, 4)), [null, null, null, "2026-10-01"]);
  assert.equal(october.filter(Boolean).length, 31);
  assert.equal(diary.diaryMonth("2024-02").filter(Boolean).length, 29);
  assert.equal(diary.moveDiaryMonth("2026-12", 1), "2027-01");
  assert.equal(diary.moveDiaryMonth("2026-01", -1), "2025-12");
});

test("invalid deep-link dates fall back to today instead of breaking the calendar", () => {
  for (const value of [undefined, null, ["2026-10-23"], "2026-02-30", "2026-13-01", "bad"]) assert.equal(diary.diaryDate(value), null);
  assert.equal(diary.diaryDate("2024-02-29"), "2024-02-29");
});

test("fiber and sugar distinguish missing data, a recorded zero and partial totals", () => {
  const meals = [
    { entry_type: "meal", micronutrients: { fiber_g: 0, sugar_g: 4 } },
    { entry_type: "meal", micronutrients: { sugar_g: 6 } },
    { entry_type: "water", micronutrients: { fiber_g: 500 } },
    { entry_type: "activity", micronutrients: { sugar_g: 500 } },
  ];
  const fiber = diary.dayNutrient(meals, "fiber_g");
  assert.equal(fiber.value, 0);
  assert.equal(fiber.partial, true);
  assert.equal(fiber.recorded, 1);
  assert.equal(fiber.meals, 2);
  const sugar = diary.dayNutrient(meals, "sugar_g");
  assert.equal(sugar.value, 10);
  assert.equal(sugar.partial, false);
  assert.equal(diary.dayNutrient([], "fiber_g").value, null);
  assert.equal(diary.dayNutrient([{ entry_type: "meal", micronutrients: null }], "sugar_g").value, null);
});

test("chronicle interleaves meals, water and activities by time without mutating entries", () => {
  const entries = [
    { id: 3, entry_type: "activity", created_at: "2026-10-23T15:00:00Z" },
    { id: 1, entry_type: "meal", created_at: "2026-10-23T08:00:00Z" },
    { id: 4, entry_type: "meal", created_at: null },
    { id: 2, entry_type: "water", created_at: "2026-10-23T11:00:00Z" },
  ];
  assert.deepEqual(Array.from(diary.diaryChronicle(entries), entry => entry.id), [1, 2, 3, 4]);
  assert.deepEqual(entries.map(entry => entry.id), [3, 1, 4, 2]);
});

test("progress rings cannot overflow, and a zero streak has a visible label", () => {
  assert.equal(diary.diaryProgress(2500, 2000), 1);
  assert.equal(diary.diaryProgress(1000, 2000), 0.5);
  for (const args of [[10, 0], [-10, 100], [NaN, 100]]) assert.equal(diary.diaryProgress(...args), 0);
  for (const [value, expected] of [[0, "0 дней"], [1, "1 день"], [2, "2 дня"], [11, "11 дней"], [21, "21 день"]]) assert.equal(diary.streakLabel(value), expected);
});
