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

function harness(file, overrides = {}, runtime = {}) {
  const slots = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const react = {
    useCallback(callback) { return callback; },
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
      BackHandler: { addEventListener: () => ({ remove() {} }) },
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
    "../../components/FavoriteCorrectionForm": { FavoriteCorrectionForm: "FavoriteCorrectionForm" },
    "../../components/RequestLimitDialog": { useRequestLimit: () => ({ openLimit() {} }) },
    "../../operations": { requestKey: () => `favorite-request-${Math.random()}` },
    "./Brand": { Icon: "Icon" }, "../../components/Brand": { Icon: "Icon" },
    "./MacroBars": { MacroComposition: "MacroComposition" },
    "../../components/Screen": { Screen: "Screen", State: "State" },
    "../../components/FavoriteCards": { FavoriteCard: "FavoriteCard" },
    "../../components/FavoriteOrderEditor": { FavoriteOrderEditor: "FavoriteOrderEditor" },
    "../../components/AnalysisDetails": { AnalysisDetails: "AnalysisDetails" },
    "../../components/TransientNotice": { TransientNotice: "TransientNotice" },
    "../../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show() {}, clear() {} }) },
    "../config": { API_URL: "https://api.example" },
    "./PhotoPreview": { PhotoPreview: "PhotoPreview" },
    ...overrides,
  };
  modules["expo-router"] = { useFocusEffect() {}, ...modules["expo-router"] };
  const context = { exports: {}, setTimeout, clearTimeout, ...runtime, require(name) {
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

test("reordering uses the full list despite filters, cancel is local, save locks and recovers from errors", async () => {
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const all = [favorite, { ...favorite, id: 78, title: "Вода", entry_type: "water" }];
  const calls = [], notices = [];
  let resolve, reject, reloads = 0;
  const resource = { data: { favorites: all }, loading: false, load() { reloads++; }, setData(data) { this.data = data; } };
  const render = harness("app/(tabs)/favorites.tsx", {
    "../../hooks/useResource": { useResource: () => resource },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": { ApiError, api(url, options) { calls.push({ url, options }); return new Promise((ok, fail) => { resolve = ok; reject = fail; }); }, apiFailureMessage: async e => e.message },
    "../../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show: text => notices.push(text), clear() {} }) },
  });
  const screen = () => render("default");
  const button = label => screen().find(n => n.props?.accessibilityLabel === label);
  const editor = () => screen().find(n => n.type === "FavoriteOrderEditor").props;
  button("Вода: 1").props.onPress();
  button("Изменить порядок").props.onPress();
  assert.equal(editor().items.length, 2);
  editor().onChange([...all].reverse());
  editor().onCancel();
  assert.equal(calls.length, 0);
  assert.equal(resource.data.favorites, all);
  button("Изменить порядок").props.onPress();
  editor().onChange([...all].reverse());
  editor().onSave(); editor().onSave();
  assert.equal(calls.length, 1);
  assert.equal(editor().saving, true);
  assert.equal(calls[0].url, "/v1/favorites/order");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.json)), { favorite_ids: [78, 77], original_ids: [77, 78] });
  reject(new ApiError(0, "Нет сети")); await flush();
  assert.equal(editor().error, "Нет сети");
  assert.equal(editor().saving, false);
  assert.deepEqual(Array.from(editor().items, i => i.id), [78, 77]);
  editor().onSave();
  resolve({ favorites: [...all].reverse() }); await flush();
  assert.ok(!screen().some(n => n.type === "FavoriteOrderEditor"));
  assert.deepEqual(notices, ["Порядок сохранён"]);
  assert.equal(reloads, 2);
  button("Изменить порядок").props.onPress();
  editor().onChange(all); editor().onSave();
  reject(new ApiError(409, "Избранное изменилось")); await flush();
  assert.equal(editor().conflict, true);
  editor().onSave();
  assert.equal(calls.length, 3);
  editor().onCancel();
  assert.equal(reloads, 3);
});

test("favorites always open their own details; only the plus logs and failures allow retry", async () => {
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
  assert.equal(opened[1], "/favorite/77");
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

test("a favorite keeps editable saved details and requires confirmation before removal", async () => {
  const removed = [];
  let returned = 0;
  const render = harness("app/favorite/[id].tsx", {
    "expo-router": { useLocalSearchParams: () => ({ id: "77" }), router: { canGoBack: () => true, back() { returned++; } } },
    "../../hooks/useResource": { useResource: path => {
      assert.equal(path, "/v1/favorites/77");
      return { data: { favorite, operation: null }, loading: false };
    } },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": { api: async (url, options) => { removed.push({ url, options }); }, apiFailureMessage: async error => error.message },
  });
  const all = () => render("default");
  assert.equal(all().find(node => node.type === "AnalysisDetails").props.entry.id, favorite.id);
  assert.ok(all().some(node => node.type === "FavoriteCorrectionForm"));
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

const correctionJob = (status = "queued") => ({
  id: "favorite-job", request_key: "favorite-request-key", kind: "correct_favorite",
  status, text: "Порция 300 г", error: null, result: null,
});

function correctionHarness({ operation = null, api = async () => {}, load = async () => {}, extra = {} } = {}, runtime = {}) {
  const notices = [], limits = [];
  const resource = {
    data: { favorite: { ...favorite, source_entry_id: 42 }, operation }, loading: false, load,
    setData(value) { this.data = typeof value === "function" ? value(this.data) : value; },
  };
  const render = harness("app/favorite/[id].tsx", {
    "expo-router": { useLocalSearchParams: () => ({ id: "77" }), router: { canGoBack: () => true, back() {} } },
    "../../hooks/useResource": { useResource: () => resource },
    "../../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../../api": { api, apiFailureMessage: async error => error.message },
    "../../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show: text => notices.push(text), clear() {} }) },
    "../../components/RequestLimitDialog": { useRequestLimit: () => ({ openLimit: (info, kind) => limits.push({ info, kind }) }) },
    ...extra,
  }, runtime);
  const all = () => render("default");
  return { all, form: () => all().find(n => n.type === "FavoriteCorrectionForm").props, resource, notices, limits };
}

test("favorite correction preserves its request key after a lost reply and only addresses the template", async () => {
  const calls = [];
  let resolve, reject;
  const h = correctionHarness({ api(url, options) { calls.push({ url, options }); return new Promise((ok, fail) => { resolve = ok; reject = fail; }); } });
  h.form().onChange("Порция 300 г");
  h.form().onSubmit(); h.form().onSubmit();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/v1/favorites/77/correct");
  assert.equal(calls[0].options.json.text, "Порция 300 г");
  assert.equal(h.form().disabled, true);
  reject(Error("Ответ потерян")); await flush();
  assert.equal(h.form().disabled, false);
  assert.equal(h.form().value, "Порция 300 г");
  h.form().onSubmit();
  assert.equal(calls[0].options.json.request_key, calls[1].options.json.request_key);
  resolve({ ...correctionJob(), request_key: calls[0].options.json.request_key }); await flush();
  assert.equal(h.form().label, "В очереди…");
  assert.equal(h.form().disabled, true);
  h.resource.data = { favorite: { ...favorite, calories: 500 }, operation: { ...h.resource.data.operation, status: "done", result: { status: "saved" } } };
  h.all();
  assert.equal(h.form().value, "");
  assert.deepEqual(h.notices, ["Избранное обновлено"]);
  assert.equal(h.all().find(n => n.type === "AnalysisDetails").props.entry.calories, 500);
});

test("reopened favorites recover pending corrections and completion preserves a different draft", () => {
  const calls = [];
  const h = correctionHarness({ operation: correctionJob(), api: (...args) => { calls.push(args); } });
  h.all();
  assert.equal(h.form().value, "Порция 300 г");
  assert.equal(h.form().disabled, true);
  const log = h.all().find(n => n.type === "PrimaryButton" && n.props.label === "Добавить на сегодня");
  assert.equal(log.props.disabled, true);
  log.props.onPress();
  assert.equal(calls.length, 0);
  h.resource.data.operation = correctionJob("running");
  assert.equal(h.form().label, "Пересчитываю…");
  h.form().onChange("Следующее уточнение");
  h.resource.data.operation = { ...correctionJob("done"), result: { status: "saved" } };
  h.all();
  assert.equal(h.form().value, "Следующее уточнение");
  assert.equal(h.form().disabled, false);
  assert.equal(calls.length, 0);
});

test("failed favorite correction keeps the draft, shows its limit and retries with the same key", async () => {
  const calls = [];
  const info = { code: "daily_limit_reached", kind: "text" };
  const h = correctionHarness({
    operation: { ...correctionJob("failed"), error: "Лимит запросов", limit_reached: info },
    api: async (url, options) => { calls.push({ url, options }); return correctionJob(); },
  });
  h.all();
  assert.equal(h.form().value, "Порция 300 г");
  assert.equal(h.form().disabled, false);
  assert.equal(h.all().find(n => n.type === "State").props.error, "Лимит запросов");
  assert.equal(h.limits.length, 1);
  assert.equal(h.limits[0].info, info);
  h.form().onSubmit(); await flush();
  assert.equal(calls[0].options.json.request_key, "favorite-request-key");
  assert.equal(h.form().disabled, true);
});

test("unknown correction retains text for a new request; adding to today does not clear a draft", async () => {
  const calls = [];
  const h = correctionHarness({ operation: { ...correctionJob("done"), result: { status: "unknown", message: "Уточните порцию" } }, api: async (...args) => { calls.push(args); } });
  h.all();
  assert.equal(h.form().value, "Порция 300 г");
  h.form().onChange("Без сахара");
  h.all().find(n => n.type === "PrimaryButton" && n.props.label === "Добавить на сегодня").props.onPress();
  await flush();
  assert.equal(h.form().value, "Без сахара");
  assert.equal(calls[0][0], "/v1/favorites/77/log");
});

test("favorite polling pauses in background, refreshes on return and stops after leaving the screen", async () => {
  const timers = new Map();
  let next = 0, focus, listener, loads = 0, removed = 0;
  const appState = { currentState: "active", addEventListener(_, callback) { listener = callback; return { remove() { removed++; } }; } };
  const h = correctionHarness({ operation: correctionJob(), load: async () => { loads++; }, extra: {
    "expo-router": { useLocalSearchParams: () => ({ id: "77" }), useFocusEffect: callback => { focus = callback; } },
    "react-native": { AppState: appState, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: value => value } },
  } }, { setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  h.all();
  const leave = focus();
  assert.equal(timers.size, 1);
  appState.currentState = "background"; listener("background");
  assert.equal(timers.size, 0);
  assert.equal(loads, 0);
  appState.currentState = "active"; listener("active"); await flush();
  assert.equal(loads, 1);
  assert.equal(timers.size, 1);
  leave();
  assert.equal(timers.size, 0);
  assert.equal(removed, 1);
});
