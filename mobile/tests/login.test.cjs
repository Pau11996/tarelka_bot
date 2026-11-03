const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const flush = () => new Promise(setImmediate);

function setup({ api, pollLogin, startGoogleSignIn, finishGoogleSignIn } = {}) {
  const slots = [], requests = [], signedIn = [], links = [], storage = new Map();
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const auth = { ready: true, token: null, async signIn(token) { signedIn.push(token); auth.token = token; } };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect() {},
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Modal", "Pressable", "ScrollView", "Text", "View"].map(value => [value, value])),
      Platform: { OS: "android" }, StyleSheet: { create: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390, height: 844 }),
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { Link: "Link", Redirect: "Redirect" },
    "expo-linking": { openURL: async url => { links.push(url); } },
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async key => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); }, removeItem: async key => { storage.delete(key); } } },
    "../api": { api: (url, options) => { requests.push({ url, options }); return api(url, options); }, pollLogin: code => pollLogin(code), apiFailureMessage: async error => error.message },
    "../auth": { useAuth: () => auth }, "../authStorage": { authStorageKeys: () => ({ pendingLogin: "pending" }) },
    "../config": { API_URL: "https://api.example.test", SITE_URL: "https://example.test" },
    "../theme": { colors: {}, welcomeColors: {} }, "../components/Brand": { Icon: "Icon" },
    "../components/LoginWelcome": { LoginWelcome: props => element("Welcome", props) },
    "../components/GoogleSignInButton": { GoogleSignInButton: props => element("Pressable", { ...props, accessibilityLabel: "Войти через Google" }) },
    "../googleSignIn": { supportsGoogleSignIn: true, startGoogleSignIn, finishGoogleSignIn },
    "../components/PasswordRecoveryForm": { PasswordRecoveryForm: "PasswordRecoveryForm" },
    "../components/EmailVerificationForm": { EmailVerificationForm: "EmailVerificationForm" },
    "../ui": { Field: "Field", Loading: "Loading", PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton", ErrorText: ({ message }) => message ? element("Text", { children: message }) : null },
  };
  const context = { exports: {}, require: name => modules[name], setTimeout, Error };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/app/login.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (node.type === "Modal" && !node.props.visible) return [];
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  function render() { cursor = 0; return nodes(context.exports.default()); }
  return {
    render, requests, signedIn, links, storage,
    byLabel: label => render().find(node => node.props?.accessibilityLabel === label),
    button: label => render().find(node => node.props?.label === label || (node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && child.props.children === label))),
  };
}

test("the registration sheet validates, submits once, and blocks closing while the request is running", async () => {
  let finish;
  const app = setup({ api: () => new Promise(resolve => { finish = resolve; }) });
  app.button("Создать аккаунт").props.onPress();
  app.byLabel("Email").props.onChangeText("person@example.test");
  app.byLabel("Пароль").props.onChangeText("short");
  app.button("Зарегистрироваться").props.onPress();
  assert.equal(app.requests.length, 0);
  app.byLabel("Пароль").props.onChangeText("preview42");
  app.byLabel("Повторите пароль").props.onChangeText("different");
  app.button("Зарегистрироваться").props.onPress();
  assert.equal(app.requests.length, 0);
  app.byLabel("Повторите пароль").props.onChangeText("preview42");
  const submit = app.button("Зарегистрироваться");
  submit.props.onPress(); submit.props.onPress();
  app.byLabel("Закрыть форму").props.onPress();
  await flush();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "/v1/auth/email/register");
  assert.equal(app.requests[0].options.json.email, "person@example.test");
  assert.equal(app.requests[0].options.json.password, "preview42");
  assert.equal(typeof app.requests[0].options.json.timezone, "string");
  assert.equal(app.button("Отправляем код…").props.disabled, true);
  finish({ status: "verification_required", registration_id: "registration-id", email: "person@example.test", resend_after: 60 });
  await flush();
  assert.deepEqual(app.signedIn, []);
  const verification = app.render().find(node => node.type === "EmailVerificationForm");
  assert.equal(verification.props.registration.email, "person@example.test");
  await verification.props.onVerified("registered-token");
  assert.deepEqual(app.signedIn, ["registered-token"]);
  assert.equal(app.render().find(node => node.type === "Redirect").props.href, "/");
});

test("closing an email sheet clears passwords; login failure keeps the form available for retry", async () => {
  let attempts = 0;
  const app = setup({ api: async () => { if (++attempts === 1) throw Error("Неверный пароль"); return { access_token: "login-token" }; } });
  app.button("Создать аккаунт").props.onPress();
  app.byLabel("Email").props.onChangeText("person@example.test");
  app.byLabel("Пароль").props.onChangeText("do-not-keep-this");
  app.byLabel("Закрыть форму").props.onPress();
  assert.equal(app.byLabel("Email"), undefined);
  app.button("Войти по email").props.onPress();
  assert.equal(app.byLabel("Пароль").props.value, "");
  assert.equal(app.byLabel("Email").props.value, "person@example.test");
  assert.equal(app.byLabel("Повторите пароль"), undefined);
  app.byLabel("Пароль").props.onChangeText("preview42");
  app.button("Войти").props.onPress(); await flush();
  assert.equal(app.requests[0].url, "/v1/auth/email/login");
  assert.equal("timezone" in app.requests[0].options.json, false);
  assert.ok(app.render().some(node => node.props?.children === "Неверный пароль"));
  app.button("Войти").props.onPress(); await flush();
  assert.deepEqual(app.signedIn, ["login-token"]);
});

test("registration never accepts a direct token without the email verification step", async () => {
  const app = setup({ api: async () => ({ access_token: "unverified-token" }) });
  app.button("Создать аккаунт").props.onPress();
  app.byLabel("Email").props.onChangeText("person@example.test");
  app.byLabel("Пароль").props.onChangeText("preview42");
  app.byLabel("Повторите пароль").props.onChangeText("preview42");
  app.button("Зарегистрироваться").props.onPress(); await flush();
  assert.deepEqual(app.signedIn, []);
  assert.ok(app.render().some(node => node.props?.children === "Подтверждение почты временно недоступно. Попробуйте позже."));
});

test("Google signs in once, disables competing actions and redirects to the existing diary", async () => {
  let finish, starts = 0;
  const pending = { challenge_id: "challenge", id_token: "private-google-token", timezone: "Europe/Minsk" };
  const app = setup({
    startGoogleSignIn: async () => { starts++; return pending; },
    finishGoogleSignIn: data => { assert.equal(data, pending); return new Promise(resolve => { finish = resolve; }); },
  });
  const button = app.byLabel("Войти через Google");
  button.props.onPress(); button.props.onPress();
  await flush();
  assert.equal(starts, 1);
  assert.equal(app.byLabel("Войти через Google").props.disabled, true);
  app.button("Создать аккаунт").props.onPress();
  assert.equal(app.byLabel("Email"), undefined);
  finish({ access_token: "google-session" }); await flush();
  assert.deepEqual(app.signedIn, ["google-session"]);
  assert.equal(app.render().find(node => node.type === "Redirect").props.href, "/");
  assert.equal(JSON.stringify([...app.storage]).includes("private-google-token"), false);
});

test("cancelled Google account selection leaves the form ready for another method", async () => {
  let requests = 0;
  const app = setup({ startGoogleSignIn: async () => null, finishGoogleSignIn: async () => { requests++; } });
  app.button("Создать аккаунт").props.onPress();
  app.byLabel("Войти через Google").props.onPress(); await flush();
  assert.deepEqual(app.signedIn, []);
  assert.equal(requests, 0);
  assert.equal(app.byLabel("Войти через Google").props.disabled, false);
  assert.equal(app.byLabel("Email").props.editable, true);
});

test("Google errors are shown and the button becomes usable again", async () => {
  const app = setup({ startGoogleSignIn: async () => { throw Error("Вход через Google временно недоступен"); } });
  app.byLabel("Войти через Google").props.onPress(); await flush();
  assert.ok(app.render().some(node => node.props?.children === "Вход через Google временно недоступен"));
  assert.equal(app.byLabel("Войти через Google").props.disabled, false);
});

test("Google linking asks for the existing password and retries without reopening the chooser", async () => {
  const calls = [];
  let starts = 0;
  const app = setup({
    startGoogleSignIn: async () => { starts++; return { challenge_id: "challenge", id_token: "id-token" }; },
    finishGoogleSignIn: async (_data, password) => {
      calls.push(password);
      if (password === undefined) return { status: "password_required", email: "person@example.com" };
      if (password !== "correct-password") throw Error("Неверный пароль от существующего аккаунта.");
      return { access_token: "linked-session" };
    },
  });
  app.byLabel("Войти через Google").props.onPress(); await flush();
  assert.deepEqual(app.signedIn, []);
  app.byLabel("Пароль").props.onChangeText("wrong");
  app.button("Подключить Google и войти").props.onPress(); await flush();
  assert.ok(app.render().some(node => node.props?.children === "Неверный пароль от существующего аккаунта."));
  app.byLabel("Пароль").props.onChangeText("correct-password");
  app.button("Подключить Google и войти").props.onPress(); await flush();
  assert.equal(starts, 1);
  assert.deepEqual(calls, [undefined, "wrong", "correct-password"]);
  assert.deepEqual(app.signedIn, ["linked-session"]);
});

test("Telegram entry still opens the bot and cancellation ignores a late confirmation", async () => {
  let confirm;
  const app = setup({ api: async () => ({ code: "test-code", bot_url: "https://t.me/example_bot?start=test", expires_in: 600 }), pollLogin: () => new Promise(resolve => { confirm = resolve; }) });
  app.button("Войти через Telegram").props.onPress(); await flush();
  assert.equal(app.requests[0].url, "/v1/auth/telegram/start");
  assert.deepEqual(app.links, ["https://t.me/example_bot?start=test"]);
  assert.equal(app.storage.has("pending"), true);
  app.button("Отменить вход через Telegram").props.onPress();
  confirm({ access_token: "late-token" }); await flush();
  assert.deepEqual(app.signedIn, []);
  assert.equal(app.storage.has("pending"), false);
});
