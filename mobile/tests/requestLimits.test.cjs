const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const limit = {
  code: "daily_limit_reached", message: "Достигнут дневной лимит запросов",
  kind: "photo", limit_mode: "split", limit: 3, used: 3,
  subscription_active: false, can_upgrade: true, upgrade_limit: 30,
  resets_at: "2099-01-02T00:00:00+14:00", timezone: "Pacific/Kiritimati",
  alternatives: ["text", "voice"],
};

function setup(fetch = async () => { throw Error("unexpected fetch"); }) {
  const cache = new Map(), routes = [];
  const element = (type, props) => ({ type, props });
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    vm.runInNewContext(code, { exports, Error, Date, fetch, __DEV__: false, setTimeout, require(name) {
      if (name.endsWith("/config")) return { API_URL: "http://test-api" };
      if (name.endsWith("/auth")) return { useAuth: () => ({ token: "test-token", signOut: async () => {} }) };
      if (name.endsWith("/theme")) return { colors: {} };
      if (name.endsWith("/ui")) return { PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton" };
      if (name === "./Brand") return { Icon: "Icon" };
      if (name === "react") return { createContext: () => ({}), useCallback: value => value, useContext: () => null, useEffect() {}, useState() {}, useRef() {} };
      if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
      if (name === "react-native") return {
        Modal: "Modal", Pressable: "Pressable", Text: "Text", View: "View", ScrollView: "ScrollView",
        StyleSheet: { create: value => value }, Alert: {}, Keyboard: {},
      };
      if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
      if (name === "expo-router") return { router: { push: route => routes.push(route) } };
      const base = path.resolve(path.dirname(file), name);
      return load(fs.existsSync(base + ".ts") ? base + ".ts" : base + ".tsx");
    }});
    return exports;
  }
  return { load: file => load(path.resolve(__dirname, "../src", file)), routes };
}

function nodes(root) {
  if (!root || typeof root !== "object") return [];
  return [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(root) {
  if (typeof root === "string" || typeof root === "number") return String(root);
  return [root?.props?.children].flat(Infinity).map(child => typeof child === "object" ? text(child) : child ?? "").join(" ");
}

test("HTTP quota error is typed; login throttling remains an ordinary API error", async () => {
  let detail = limit;
  const app = setup(async () => ({ ok: false, status: 429, json: async () => ({ detail }) }));
  const { api, ApiError } = app.load("api.ts");
  await assert.rejects(api("/v1/voice/transcribe"), error => error instanceof ApiError && error.limitReached === limit);
  detail = "Слишком много попыток. Попробуйте позже.";
  await assert.rejects(api("/v1/auth/email/login"), error => error.status === 429 && !error.limitReached && error.message === detail);
});

test("background operation carries the same quota information to the dialog", async () => {
  const app = setup();
  const { waitOperation } = app.load("operations.ts");
  const { ApiError } = app.load("api.ts");
  await assert.rejects(waitOperation({ status: "failed", error: limit.message, limit_reached: limit }, "token"),
    error => error instanceof ApiError && error.limitReached === limit);
  await assert.rejects(waitOperation({ status: "failed", error: "Сеть недоступна" }, "token"),
    error => !(error instanceof ApiError) && error.message === "Сеть недоступна");
});

test("polling publishes the failed operation before throwing so the timeline keeps the error", async () => {
  const failed = { id: "job", status: "failed", error: limit.message, limit_reached: limit };
  const app = setup(async () => ({ ok: true, json: async () => failed }));
  const { waitOperation } = app.load("operations.ts");
  const progress = [];
  await assert.rejects(waitOperation({ id: "job", status: "running" }, "token", op => progress.push(op)), error => error.status === 429);
  assert.deepEqual(progress.map(op => op.status), ["running", "failed"]);
  assert.equal(progress.at(-1), failed);
});

test("free limit offers subscription; active subscribers only see recovery information", () => {
  const app = setup();
  const { RequestLimitDialog } = app.load("components/RequestLimitDialog.tsx");
  let closed = 0;
  const free = RequestLimitDialog({ info: limit, onClose: () => closed++ });
  assert.match(text(free), /Обновится/);
  assert.match(text(free), /Pacific\/Kiritimati/);
  const upgrade = nodes(free).find(n => n.props?.label === "Посмотреть подписку");
  assert.ok(upgrade);
  upgrade.props.onPress();
  assert.equal(closed, 1);
  assert.deepEqual(app.routes, ["/pay"]);
  free.props.onRequestClose();
  assert.equal(closed, 2);
  const paid = RequestLimitDialog({ info: { ...limit, subscription_active: true, can_upgrade: false }, onClose() {} });
  assert.match(text(paid), /Подписка активна/);
  assert.equal(nodes(paid).some(n => n.props?.label === "Посмотреть подписку"), false);
  assert.ok(nodes(paid).find(n => n.props?.label === "Понятно"));
});

test("old limit notices show recovery after reset, and account timezone determines midnight", () => {
  const app = setup();
  const { formatLimitReset, isLegacyLimitMessage, isRequestLimitInfo } = app.load("requestLimits.ts");
  assert.match(formatLimitReset(limit), /00:00/);
  assert.equal(isRequestLimitInfo(limit), true);
  assert.equal(isRequestLimitInfo({ ...limit, resets_at: "invalid" }), false);
  assert.equal(isLegacyLimitMessage("Вы достигли дневного лимита фото (3 в день).\n\nДлинное старое сообщение"), true);
  assert.equal(isLegacyLimitMessage("Достигнут дневной лимит запросов"), true);
  assert.equal(isLegacyLimitMessage("Не удалось загрузить фото"), false);
  const { RequestLimitDialog } = app.load("components/RequestLimitDialog.tsx");
  const expired = RequestLimitDialog({ info: { ...limit, resets_at: "2020-01-01T00:00:00Z" }, onClose() {} });
  assert.match(text(expired), /лимит обновился/);
  assert.equal(nodes(expired).some(n => n.props?.label === "Посмотреть подписку"), false);
});
