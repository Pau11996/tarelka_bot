const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const flush = () => new Promise(setImmediate);
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const measurement = { id: "manual:2", weight_kg: 75.8, recorded_at: "2026-10-25T08:00:00Z", local_date: "2026-10-25", source: "manual", origin: null };
const payload = () => ({
  current_weight_kg: 75.8, weight_history: [measurement], latest_measurement: measurement, goal_history: [],
  goal: { id: "goal-1", direction: "lose", start_weight_kg: 80, target_weight_kg: 70, progress: .42, remaining_kg: 5.8, change_kg: -4.2, reached: false, started_at: "2026-10-01T08:00:00Z" },
  achievements: [
    { key: "first_weigh_in", title: "Первое взвешивание", description: "После начального веса", earned: true, progress: 1, target: 1 },
    { key: "diary_7_days", title: "7 дней дневника", description: "Записи каждый день", earned: false, progress: 3, target: 7 },
  ],
  reminder: { enabled: false, effective_enabled: false, weekday: 0, local_time: "09:00", timezone: "Europe/Minsk", delivery_ready: true, channel: "telegram" },
});
function setup(data = payload()) {
  const slots = [], calls = [], routes = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const tracking = { exports: {} };
  vm.runInNewContext(compile("weightTracking.ts"), tracking);
  const modules = {
    react: { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => slots[i] = typeof value === "function" ? value(slots[i]) : value]; }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; }, useEffect() {} },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "expo-router": { router: { push: value => routes.push(value), setParams() {} }, useLocalSearchParams: () => ({}) },
    "react-native": { ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Modal", "Pressable", "RefreshControl", "ScrollView", "Switch", "Text", "TextInput", "View"].map(name => [name, name])), Platform: { OS: "android" }, Keyboard: { dismiss() {} }, StyleSheet: { create: s => s }, useWindowDimensions: () => ({ width: 390, height: 844 }) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    "../../api": { api: async (url, options) => { calls.push({ url, options }); return data; }, apiFailureMessage: async error => error.message },
    "../../auth": { useAuth: () => ({ token: "test", signOut() {} }) },
    "../../components/AccountMenu": { AccountMenu: "AccountMenu" },
    "../../components/Brand": { Icon: "Icon" },
    "../../components/WeightProgressChart": { WeightProgressChart: "WeightProgressChart" },
    "../../components/WeightGoalProgress": { WeightGoalProgress: "WeightGoalProgress" },
    "../../components/AchievementMedal": { AchievementMedal: "AchievementMedal", achievementTone: () => ({ background: "soft", ink: "green" }) },
    "../../components/Screen": { State: "State" }, "../../format": { formatDay: value => value },
    "../../health/events": { healthUpdated() {} }, "../../health/math": { sourceName: value => value },
    "../../hooks/useResource": { useResource: () => ({ data, loading: !data, error: null, setData(value) { data = typeof value === "function" ? value(data) : value; }, load() {} }) },
    "../../theme": { colors: {}, achievementColors: {} }, "../../weightTracking": tracking.exports,
  };
  const context = { exports: {}, require: name => { if (!(name in modules)) throw Error(name); return modules[name]; } };
  vm.runInNewContext(compile("app/(tabs)/achievements.tsx"), context);
  function nodes(node) { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap(nodes); if (node.type === "Modal" && !node.props.visible) return []; return [node, ...nodes(node.props?.children)]; }
  function render() {
    cursor = 0; const all = nodes(context.exports.default());
    const modal = all.find(node => node.type === "Modal" && node.props.visible);
    return modal ? nodes(modal.props.children) : all.filter(node => !node.props?.children || node.type !== "Modal");
  }
  const text = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : text(node?.props?.children ?? "");
  const button = (label, exact = true) => render().find(node => node.type === "Pressable" && (node.props.accessibilityLabel === label || (exact ? text(node) === label : text(node).includes(label))));
  return { render, button, calls, routes, text: () => render().filter(n => n.type === "Text").map(text).join(" ") };
}

test("active goal renders one actual chart and navigation replaces the old goal panel", () => {
  const app = setup();
  const chart = app.render().find(node => node.type === "WeightProgressChart");
  assert.equal(chart.props.history[0].id, measurement.id);
  assert.equal(chart.props.target, 70);
  assert.equal(app.render().find(node => node.type === "WeightGoalProgress").props.progress, .42);
  assert.ok(app.text().includes("ВАША ЦЕЛЬ 70 кг"));
  assert.ok(app.button("Изменить цель по весу").props.accessibilityValue.text.includes("42% пути пройдено"));
  assert.ok(app.text().includes("1 окт. 2026 — 25 окт. 2026"));
  assert.ok(!app.text().includes("Ваш прогресс складывается"));
  assert.ok(!app.text().includes("Привычки остаются"));
  app.button("Записать вес").props.onPress();
  assert.deepEqual(app.routes, ["/weight"]);
});

test("history and award panels are read-only and cannot submit goal changes", () => {
  const app = setup();
  app.button("Открыть историю веса").props.onPress();
  assert.ok(app.text().includes("История веса"));
  assert.equal(app.button("Отменить цель"), undefined);
  assert.equal(app.button("Подтвердить цель"), undefined);
  app.button("Готово").props.onPress();
  app.button("Все награды. Получено 1 из 2").props.onPress();
  assert.ok(app.text().includes("После начального веса"));
  assert.equal(app.button("Отменить цель"), undefined);
  app.button("Готово").props.onPress();
  assert.equal(app.calls.length, 0);
});

test("goal editor keeps the server snapshot and changing a goal submits through the existing API", async () => {
  const app = setup();
  app.button("Изменить цель по весу").props.onPress();
  const input = app.render().find(node => node.props?.accessibilityLabel === "Желаемый вес, кг");
  assert.equal(input.props.value, "70");
  input.props.onChangeText("68,5");
  app.button("Подтвердить цель").props.onPress(); await flush();
  assert.equal(app.calls[0].url, "/v1/weight-goal");
  assert.equal(app.calls[0].options.json.target_weight_kg, 68.5);
  assert.equal(app.calls[0].options.json.expected_goal_id, "goal-1");
  assert.equal(app.calls[0].options.json.expected_weight_kg, 75.8);
});

test("goal completion still requires confirmation and cancellation remains in the editor", async () => {
  const data = payload();data.goal.reached = true;data.goal.progress = 1;
  const app = setup(data);
  app.button("Завершить цель").props.onPress();
  assert.equal(app.calls.length, 0);
  app.button("Завершить цель").props.onPress();await flush();
  assert.equal(app.calls[0].url, "/v1/weight-goal/complete");
  const other = setup();
  other.button("Изменить цель по весу").props.onPress();
  other.button("Отменить текущую цель").props.onPress();
  assert.equal(other.calls.length, 0);
  other.button("Отменить цель").props.onPress();await flush();
  assert.equal(other.calls[0].options.method, "DELETE");
  assert.equal(other.calls[0].url, "/v1/weight-goal?goal_id=goal-1");
});

test("without a goal the invitation and independent weigh-in remain available", () => {
  const data = payload();data.goal = null;data.current_weight_kg = null;data.weight_history = [];
  const app = setup(data);
  assert.ok(app.text().includes("К какому весу идём?"));
  app.button("Указать желаемый вес").props.onPress();
  app.button("Записать текущий вес").props.onPress();
  assert.deepEqual(app.routes, ["/weight"]);
});

test("maintenance shows deviation instead of a percentage", () => {
  const data = payload();Object.assign(data.goal, { direction: "maintain", progress: null, remaining_kg: .2 });
  const app = setup(data);
  assert.ok(app.text().includes("ПОДДЕРЖИВАЕМ ВЕС 70 кг"));
  assert.ok(app.text().includes("Отклонение от ориентира: 0,2 кг"));
  assert.ok(!app.text().includes("% пути"));
  assert.equal(app.render().find(node => node.type === "WeightGoalProgress"), undefined);
});
