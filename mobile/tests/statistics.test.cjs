const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function harness(paid = true) {
  let cursor = 0;
  const hooks = [], cache = new Map(), requests = [], navigations = [];
  const element = (type, props) => ({ type, props });
  const react = {
    forwardRef: fn => fn, memo: fn => fn, useCallback: fn => fn, startTransition: fn => fn(), useEffect() {}, useImperativeHandle() {},
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
  };
  const report = {
    start_date: "2026-10-22", end_date: "2026-10-23", average_calories: 100,
    daily_calorie_target: 2100, profile_complete: true, logged_days: 1, advanced_available: paid,
    weight: [], targets: { protein_g: 115, fat_g: 63, carbs_g: 268 },
    days: [
      { date: "2026-10-22", logged: false, entry_count: 1, calories: null, water_ml: 300 },
      { date: "2026-10-23", logged: true, entry_count: 1, calories: 100, protein_g: 10, fat_g: 3, carbs_g: 15, fiber_g: 0, sugar_g: null },
    ],
    nutrients: {
      fiber_g: { average: 0, recorded_days: 1, total_meals: 2, meals_with_data: 1 },
      sugar_g: { average: null, recorded_days: 0, total_meals: 2, meals_with_data: 0 },
    },
  };
  function load(file) {
    const filename = path.resolve(__dirname, "../src", file);
    if (cache.has(filename)) return cache.get(filename);
    const context = { exports: {}, require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", RefreshControl: "RefreshControl", StyleSheet: { create: v => v } };
      if (name === "react-native-svg") return { default: "Svg", Circle: "Circle", Line: "Line", Rect: "Rect", Path: "Path", Text: "Label" };
      if (name === "expo-router") return { router: { push(url) { navigations.push(url); }, setParams() {} }, useLocalSearchParams: () => ({}) };
      if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (name === "../../components/AccountMenu") return { AccountMenu: "AccountMenu" };
      if (name === "../../components/DiaryDay") return Object.fromEntries(["DiaryCalendar", "DiaryChronicle", "DiaryEnergy", "DiaryHabits", "DiaryNutrients", "StreakBadge"].map(name => [name, name]));
      if (name === "../../components/DiaryStatistics") return { DiaryStatistics: "DiaryStatistics" };
      if (name === "../../components/DiaryDetails") return { DiaryDetails: "DiaryDetails" };
      if (name === "../../components/DailyNormShare") return { DailyNormShare: "DailyNormShare" };
      if (name === "../../components/DeviceHealth") return { DeviceHealthDay: "DeviceHealthDay" };
      if (name === "../../components/Screen") return { State: "State" };
      if (name === "../../hooks/useResource") return { useResource: () => ({ data: { date: "2026-10-23", balance: { streak: 3 }, entries: [], nutrient_targets: {} }, loading: false, error: null, async load() {}, setData() {} }) };
      if (name === "./Brand") return { Icon: "Icon" };
      if (name === "./Chart") return { Chart: "Chart" };
      if (name === "./Screen") return { State: "State", design: {} };
      if (name === "../hooks/useResource") return { useResource: resource => {
        requests.push(resource);
        return { data: report, load() {}, loading: false };
      } };
      const relative = path.resolve(path.dirname(filename), name);
      return load(fs.existsSync(relative + ".ts") ? relative + ".ts" : relative + ".tsx");
    }};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, context);
    cache.set(filename, context.exports);
    return context.exports;
  }
  return { report, requests, navigations, load, render: (fn, props) => { cursor = 0; return fn(props); } };
}
function nodes(root, expand = false) {
  if (!root || typeof root !== "object") return [];
  if (expand && typeof root.type === "function") return nodes(root.type(root.props), true);
  return [root, ...[root.props?.children].flat(Infinity).flatMap(n => nodes(n, expand))];
}
function texts(root) { return nodes(root, true).filter(n => n.type === "Text").flatMap(n => [n.props.children].flat(Infinity)).filter(v => typeof v === "string" || typeof v === "number").join(" "); }

test("averages exclude missing days while retaining a recorded zero, and ring labels do not hide over-goal values", () => {
  const { load, report } = harness();
  const { recordedAverage, statisticsPercent } = load("statistics.ts");
  assert.equal(recordedAverage(report.days, "fiber_g"), 0);
  assert.equal(recordedAverage(report.days, "sugar_g"), null);
  assert.equal(recordedAverage(report.days, "calories"), 100);
  assert.equal(statisticsPercent(null, 2100), null);
  assert.equal(statisticsPercent(100, 0), null);
  assert.equal(statisticsPercent(2520, 2100), 120);
});

test("range arithmetic includes both dates, leap day and year boundaries, and never advances into the future", () => {
  const h = harness(), math = h.load("statistics.ts");
  assert.deepEqual({ ...math.statisticsPeriod("2026-01-03", 7) }, { start: "2025-12-28", end: "2026-01-03" });
  assert.equal(math.statisticsRangeDays(math.statisticsRange("2024-03-01", "2024-02-28")), 3);
  assert.equal(math.statisticsRangeDays(math.statisticsRange("2026-10-23", "2026-10-23")), 1);
  assert.deepEqual({ ...math.moveStatisticsRange({ start: "2026-10-14", end: "2026-10-20" }, 1, "2026-10-23") }, { start: "2026-10-17", end: "2026-10-23" });
});

test("weekly reports load for free and paid accounts with period buttons above calories and weight", () => {
  for (const paid of [false, true]) {
    const h = harness(paid), { DiaryStatistics } = h.load("components/DiaryStatistics.tsx");
    h.report.weight.push({ recorded_at: "2026-10-23T12:00:00Z", weight_kg: 72 });
    const root = h.render(DiaryStatistics, {}), all = nodes(root);
    assert.deepEqual(h.requests, ["/v1/stats?days=7"]);
    assert.equal(root.props.children[0].props.accessibilityLabel, "Период статистики");
    const periods = all.filter(n => n.props?.accessibilityRole === "tab");
    assert.deepEqual(periods.map(texts), ["Неделя", "Месяц", "3 месяца"]);
    assert.deepEqual(periods.map(n => n.props.accessibilityState.selected), [true, false, false]);
    assert.equal(texts(root).includes("Календарь записей"), false);
    assert.equal(texts(root).includes("Выбрать даты"), false);
    const charts = all.filter(n => n.type === "Chart");
    assert.deepEqual(charts.slice(0, 2).map(n => n.props.unit), ["ккал", "кг"]);
    assert.ok(charts.every(chart => chart.props.onDay === undefined));
    const content = texts({ type: "View", props: { children: root.props.children.slice(1) } });
    assert.equal(content.includes("Клетчатка"), false);
    assert.equal(content.includes("Сахар"), false);
    assert.equal(content.includes("В среднем за день"), false);
    assert.equal(all.some(n => n.props?.accessibilityLabel === "График: Белки"), paid);
  }
});

test("week and month switch the report period for free and paid accounts", () => {
  for (const paid of [false, true]) {
    const h = harness(paid), { DiaryStatistics } = h.load("components/DiaryStatistics.tsx");
    let all = nodes(h.render(DiaryStatistics, {}));
    all.find(n => n.props?.accessibilityRole === "tab" && texts(n) === "Месяц").props.onPress();
    all = nodes(h.render(DiaryStatistics, {}));
    assert.equal(h.requests.at(-1), "/v1/stats?days=30");
    assert.deepEqual(all.filter(n => n.props?.accessibilityRole === "tab").map(n => n.props.accessibilityState.selected), [false, true, false]);
    all.find(n => n.props?.accessibilityRole === "tab" && texts(n) === "Неделя").props.onPress();
    all = nodes(h.render(DiaryStatistics, {}));
    assert.equal(h.requests.at(-1), "/v1/stats?days=7");
    assert.deepEqual(all.filter(n => n.props?.accessibilityRole === "tab").map(n => n.props.accessibilityState.selected), [true, false, false]);
  }
});

test("macro points stay in statistics", () => {
  const h = harness(), { DiaryStatistics } = h.load("components/DiaryStatistics.tsx");
  let all = nodes(h.render(DiaryStatistics, {}));
  all.find(n => n.props?.accessibilityLabel === "График: Углеводы").props.onPress();
  all = nodes(h.render(DiaryStatistics, {}));
  const chart = all.find(n => n.type === "Chart" && n.props.unit === "г");
  assert.equal(chart.props.target, 268);
  assert.deepEqual(Array.from(chart.props.points, p => p.value), [null, 15]);
  assert.equal(chart.props.onDay, undefined);
});

test("compact chart keeps point selection, opening the selected day and the accessible values list", () => {
  const h = harness(), { Chart } = h.load("components/Chart.tsx");
  const selected = [], props = { compact: true, unit: "г", onDay: day => selected.push(day), points: [{ date: "2026-10-22", label: "22.10", value: null }, { date: "2026-10-23", label: "23.10", value: 15 }] };
  let all = nodes(h.render(Chart, props));
  all.find(n => n.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 600 } } });
  all = nodes(h.render(Chart, props));
  assert.ok(all.some(n => n.props?.viewBox === "0 0 600 160"));
  all.find(n => n.props?.accessibilityLabel === "23.10: 15 г").props.onPress();
  all = nodes(h.render(Chart, props));
  all.find(n => n.type === "Pressable" && texts(n).includes("Открыть записи дня")).props.onPress();
  assert.deepEqual(selected, ["2026-10-23"]);
  all.find(n => n.type === "Pressable" && texts(n).includes("Списком")).props.onPress();
  all = nodes(h.render(Chart, props));
  assert.ok(all.some(n => n.type === "Text" && n.props.children === "Нет записей"));
});


test("switching diary tabs hides the entire Android refresh wrapper and retains both screen subtrees", () => {
  const h = harness(), Diary = h.load("app/(tabs)/today.tsx").default;
  let all = nodes(h.render(Diary, {}));
  const dayType = all.find(n => n.type === "ScrollView").props.children.type;
  const getTab = (label) => all.find(n => n.props?.accessibilityRole === "tab" && texts(n) === label);
  getTab("Статистика").props.onPress();
  all = nodes(h.render(Diary, {}));
  let pages = all.filter(n => n.type === "ScrollView");
  let panes = all.filter(n => n.type === "View" && n.props.children?.type === "ScrollView");
  assert.equal(pages.length, 2);
  assert.equal(panes.length, 2);
  assert.equal(pages[0].props.children.type, dayType);
  assert.equal(panes[0].props.style.display, "none");
  assert.equal(panes[0].props.importantForAccessibility, "no-hide-descendants");
  assert.equal(panes[1].props.style.flex, 1);
  assert.ok(panes.every(pane => pane.props.collapsable === false));
  assert.ok(pages.every(page => page.props.refreshControl && page.props.style.display === undefined));
  assert.equal(pages[1].props.children.type, "DiaryStatistics");
  getTab("Сегодня").props.onPress();
  all = nodes(h.render(Diary, {}));
  pages = all.filter(n => n.type === "ScrollView");
  panes = all.filter(n => n.type === "View" && n.props.children?.type === "ScrollView");
  assert.equal(pages.length, 2);
  assert.equal(pages[0].props.children.type, dayType);
  assert.equal(pages[1].props.children.type, "DiaryStatistics");
  assert.equal(panes[1].props.style.display, "none");
  assert.equal(panes[1].props.importantForAccessibility, "no-hide-descendants");
  assert.equal(panes[0].props.style.flex, 1);
  assert.ok(pages.every(page => page.props.refreshControl && page.props.style.display === undefined));
});

test("three months loads 90 days for subscribers and opens subscription for free accounts", () => {
  for (const paid of [false, true]) {
    const h = harness(paid), { DiaryStatistics } = h.load("components/DiaryStatistics.tsx");
    const all = nodes(h.render(DiaryStatistics, {}));
    all.find(n => n.props?.accessibilityRole === "tab" && texts(n) === "3 месяца").props.onPress();
    h.render(DiaryStatistics, {});
    assert.equal(h.requests.at(-1), paid ? "/v1/stats?days=90" : "/v1/stats?days=7");
    assert.deepEqual(h.navigations, paid ? [] : ["/pay"]);
  }
});
