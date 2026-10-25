const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const favorite = {
  id: 77, title: "Овсянка с ягодами", entry_type: "meal", calories: 420,
  protein_g: 12, fat_g: 10, carbs_g: 68, volume_ml: null,
  duration_minutes: null, source_entry_id: null,
};
const flush = () => new Promise(setImmediate);
const nodes = (node) => !node ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function harness(file, overrides = {}) {
  const slots = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const react = {
    useEffect(effect) { effect(); },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      Keyboard: { dismiss() {} },
      ...Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "TextInput", "View"].map(name => [name, name])),
      StyleSheet: { create: value => value, absoluteFill: {} },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
    "react-native-svg": { default: "Svg", Circle: "Circle", Path: "Path" },
    "../format": { grams: value => `${value} г`, kcal: value => `${value} ккал`, ml: value => `${value} мл` },
    "../theme": { colors: {} }, "../../theme": { colors: {} },
    "../ui": { PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton" },
    "../../ui": { PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton" },
    "./Brand": { Icon: "Icon" }, "../../components/Brand": { Icon: "Icon" },
    "./MacroBars": { MacroComposition: "MacroComposition" },
    "../../components/Screen": { Screen: "Screen", State: "State" },
    "../../components/FavoriteCards": { FavoriteCard: "FavoriteCard" },
    "../../components/AnalysisDetails": { AnalysisDetails: "AnalysisDetails" },
    "../../components/TransientNotice": { TransientNotice: "TransientNotice" },
    "../../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show() {}, clear() {} }) },
    "../config": { API_URL: "https://api.example" },
    "./PhotoPreview": { PhotoPreview: "PhotoPreview" },
    ...overrides,
  };
  const context = { exports: {}, require(name) {
    if (name in modules) return modules[name];
    throw Error(`Unexpected module: ${name}`);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  return (component, props) => { cursor = 0; return nodes(context.exports[component](props)); };
}

test("card opens details, while its separate plus only logs and stops propagation", () => {
  const render = harness("components/FavoriteCards.tsx");
  let opened = 0, logged = 0, stopped = 0;
  const props = { item: favorite, busy: false, disabled: false, onOpen: () => opened++, onLog: () => logged++ };
  const buttons = render("FavoriteCard", props).filter(node => node.type === "Pressable");
  assert.equal(buttons.length, 2);
  buttons[0].props.onPress();
  assert.equal(opened, 1);
  assert.equal(logged, 0);
  buttons[1].props.onPress({ stopPropagation() { stopped++; } });
  assert.equal(opened, 1);
  assert.equal(logged, 1);
  assert.equal(stopped, 1);
  const busy = render("FavoriteCard", { ...props, busy: true, disabled: true });
  assert.equal(busy.find(node => node.props?.accessibilityLabel?.startsWith("Добавить")).props.disabled, true);
  assert.ok(busy.some(node => node.type === "ActivityIndicator"));
});

test("favorites open the same analysis route as chat; only the plus logs and failures allow retry", async () => {
  const calls = [];
  const opened = [];
  let reject;
  const resource = { data: { favorites: [favorite] }, loading: false, error: null, load() {} };
  const render = harness("app/(tabs)/favorites.tsx", {
    "expo-router": { router: { push: route => opened.push(route) } },
    "../../hooks/useResource": { useResource: () => resource },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": {
      api(url, options) { calls.push({ url, options }); return new Promise((_, fail) => { reject = fail; }); },
      apiFailureMessage: async error => error.message,
    },
  });
  const card = () => render("default").find(node => node.type === "FavoriteCard");
  card().props.onOpen();
  assert.deepEqual(opened, ["/favorite/77"]);
  resource.data.favorites = [{ ...favorite, source_entry_id: 42 }];
  card().props.onOpen();
  assert.equal(opened[1], "/entry/42");
  assert.equal(calls.length, 0);
  card().props.onLog();
  card().props.onLog();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v1/favorites/77/log");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.token, "test-token");
  assert.equal(card().props.disabled, true);
  reject(Error("Сеть недоступна"));
  await flush();
  assert.equal(card().props.disabled, false);
  assert.equal(render("default").find(node => node.type === "State").props.error, "Сеть недоступна");
  card().props.onLog();
  assert.equal(calls.length, 2);
  reject(Error("Сеть недоступна"));
  await flush();
});

test("an orphaned favorite keeps its saved analysis and requires confirmation before removal", async () => {
  const removed = [];
  let returned = 0;
  const render = harness("app/favorite/[id].tsx", {
    "expo-router": { useLocalSearchParams: () => ({ id: "77" }), router: { canGoBack: () => true, back() { returned++; } } },
    "../../hooks/useResource": { useResource: () => ({ data: { favorites: [favorite] }, loading: false }) },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": { api: async (url, options) => { removed.push({ url, options }); }, apiFailureMessage: async error => error.message },
  });
  const all = () => render("default");
  assert.equal(all().find(node => node.type === "AnalysisDetails").props.entry, favorite);
  assert.equal(all().some(node => node.type === "Field"), false);
  const buttons = () => all().filter(node => node.type === "Pressable");
  const byText = text => buttons().find(node => nodes(node).some(child => child.type === "Text" && child.props.children === text));
  assert.equal(byText("Убрать"), undefined);
  all().find(node => node.type === "AnalysisDetails").props.action.props.onPress();
  assert.equal(removed.length, 0);
  byText("Убрать").props.onPress();
  await flush();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].url, "/v1/favorites/77");
  assert.equal(removed[0].options.method, "DELETE");
  assert.equal(returned, 1);
});

test("successful quick logging sends a short confirmation to the transient notice", async () => {
  const notices = [];
  const render = harness("app/(tabs)/favorites.tsx", {
    "expo-router": { router: { push() {} } },
    "../../hooks/useResource": { useResource: () => ({ data: { favorites: [favorite] }, loading: false }) },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": { api: async () => {}, apiFailureMessage: async error => error.message },
    "../../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show: text => notices.push(text), clear() {} }) },
  });
  render("default").find(node => node.type === "FavoriteCard").props.onLog();
  await flush();
  assert.deepEqual(notices, ["Добавлено на сегодня"]);
});

test("the shared detailed analysis renders every saved photo and the full nutrient and ingredient data", () => {
  const render = harness("components/AnalysisDetails.tsx", {
    "../format": {
      grams: value => `${value} г`, kcal: value => `${value} ккал`, ml: value => `${value} мл`,
      formatWhen: value => value, mealHeading: title => title,
    },
  });
  const entry = {
    ...favorite, created_at: "2026-10-24T12:00:00Z",
    micronutrients: { fiber_g: 6 },
    items: [{ name: "Овсяные хлопья", quantity: "50 г", calories: 190, protein_g: 6, fat_g: 3, carbs_g: 32 }],
    media: [
      { id: "photo-1", mime: "image/jpeg", url: "/v1/media/photo-1" },
      { id: "voice", mime: "audio/m4a", url: "/v1/media/voice" },
      { id: "photo-2", mime: "image/png", url: "/v1/media/photo-2" },
    ],
  };
  const all = render("AnalysisDetails", { entry });
  assert.deepEqual(all.filter(node => node.type === "PhotoPreview").map(node => node.props.uri), ["https://api.example/v1/media/photo-1", "https://api.example/v1/media/photo-2"]);
  const macros = all.find(node => node.type === "MacroComposition");
  assert.equal(macros.props.values, entry);
  assert.equal(macros.props.micronutrients, entry.micronutrients);
  assert.ok(all.some(node => node.type === "Text" && node.props.children === "Овсяные хлопья"));
});
