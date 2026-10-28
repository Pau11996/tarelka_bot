const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const element = (type, props) => ({ type, props });
const context = { exports: {}, require(name) {
  if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
  if (name === "react-native") return { Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: v => v } };
  if (name === "expo-router") return { router: { push() {} } };
  if (name === "../theme") return { colors: { dangerSoft: "red-background", danger: "red-text" } };
  if (name === "../format") return { grams: String, ml: String, mealHeading: () => "Приём пищи" };
  if (name === "./Brand") return { BrandMark: "BrandMark", Icon: "Icon" };
  if (name === "./PhotoPreview") return { PhotoPreview: "PhotoPreview" };
  if (name === "./FavoriteButton") return { FavoriteButton: "FavoriteButton" };
  if (name === "./DeleteEntryButton") return { DeleteEntryButton: "DeleteEntryButton" };
  if (name === "./StarterTargetNotice") return { StarterTargetNotice: "StarterTargetNotice" };
  throw Error(name);
}};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/components/ChatCards.tsx"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
).outputText, context);
function nodes(root) {
  if (!root || typeof root !== "object") return [];
  if (typeof root.type === "function") return nodes(root.type(root.props));
  return [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)];
}
const photos = [{ uri: "https://api/food1", previewUri: "file:///food1" }, { uri: "https://api/food2" }];
const { EntryCard, AnalysisFailureCard } = context.exports;

for (const entry_type of ["meal", "water", "activity"]) {
  test(`chat ${entry_type} card can add and remove a favorite`, () => {
    const changes = [];
    for (const favorite_id of [null, 23]) {
      const all = nodes(EntryCard({
        entry: { id: 7, title: "Запись", entry_type, favorite_id, calories: 250, volume_ml: 300, duration_minutes: 35 },
        onCorrect() {}, onDeleted() {}, onFavoriteChange: id => changes.push(id),
      }));
      const buttons = all.filter(n => n.type === "FavoriteButton");
      assert.equal(buttons.length, 1);
      assert.equal(buttons[0].props.entryId, 7);
      assert.equal(buttons[0].props.favoriteId, favorite_id);
      buttons[0].props.onChange(favorite_id === null ? 23 : null);
    }
    assert.deepEqual(changes, [23, null]);
  });
}

test("the dismissible failure card shows one error, contains all photos and keeps both recovery actions", () => {
  let limits = 0, retries = 0, dismissals = 0;
  const message = "Не удалось обработать запись: достигнут дневной лимит.";
  const root = AnalysisFailureCard({ message, photos, onLimit: () => limits++, onRetry: () => retries++, onDismiss: () => dismissals++ });
  const all = nodes(root);
  const alerts = all.filter(n => n.props?.accessibilityRole === "alert");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].props.children, message);
  assert.equal(all.filter(n => n.type === "PhotoPreview").length, photos.length);
  assert.deepEqual(all.filter(n => n.type === "PhotoPreview").map(n => n.props.uri), photos.map(p => p.uri));
  const buttons = all.filter(n => n.type === "Pressable");
  for (const button of buttons) button.props.onPress();
  assert.equal(limits, 1);
  assert.equal(retries, 1);
  assert.equal(dismissals, 1);
  assert.ok(buttons.find(n => n.props.accessibilityLabel === "Скрыть сообщение об ошибке"));
  const disabled = nodes(AnalysisFailureCard({ message, onRetry() {}, disabled: true }));
  assert.equal(disabled.find(n => n.type === "Pressable").props.disabled, true);
});

test("successful analysis keeps every photo inside its card with independent preview and detail actions", () => {
  const root = EntryCard({ entry: { id: 1, title: "Обед", entry_type: "meal", calories: 400 }, photos, onCorrect() {}, onDeleted() {}, onFavoriteChange() {} });
  const all = nodes(root);
  assert.deepEqual(all.filter(n => n.type === "PhotoPreview").map(n => n.props.uri), photos.map(p => p.uri));
  assert.equal(all.find(n => n.type === "PhotoPreview").props.previewUri, photos[0].previewUri);
  const details = all.find(n => n.props?.accessibilityLabel === "Открыть запись: Обед");
  assert.ok(details);
  assert.equal(nodes(details).some(n => n.type === "PhotoPreview"), false);
});

test("a starter calorie reference depends on profile completion, not the number 2000", () => {
  for (const complete of [false, true]) {
    const tree = context.exports.DaySummary({ day: { profile_complete: complete, balance: { target: 2000, activity_bonus: 0, consumed: 500, remaining: 1500 } }, onPress() {} });
    const all = nodes(tree);
    assert.equal(all.some(n => n.type === "StarterTargetNotice"), !complete);
    const copy = all.filter(n => n.type === "Text").flatMap(n => [n.props.children].flat()).join(" ");
    assert.equal(copy.includes("Стартовый ориентир"), !complete);
    assert.equal(copy.includes("до цели"), complete);
  }
});
