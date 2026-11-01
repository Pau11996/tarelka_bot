const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const flush = () => new Promise(setImmediate);

function setup(api) {
  const slots = [], requests = [], tokens = [], busyChanges = [], timers = new Map();
  let cursor = 0, now = 1000000, changedEmail = 0, login = 0;
  const element = (type, props) => ({ type, props });
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => value !== slots[i].deps[index])) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; } },
  };
  const modules = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": { Text: "Text", View: "View", StyleSheet: { create: value => value } },
    "../api": { api: async (url, options) => { requests.push({ url, options }); return api(url, options); }, apiFailureMessage: async error => error.message },
    "../theme": { colors: {} },
    "../ui": { Field: "Field", PrimaryButton: "PrimaryButton", SecondaryButton: "SecondaryButton", ErrorText: ({ message }) => message ? element("Text", { children: message }) : null },
  };
  const context = { exports: {}, require: name => modules[name], Date: { now: () => now },
    setInterval: callback => { const id = Symbol(); timers.set(id, callback); return id; }, clearInterval: id => timers.delete(id) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/EmailVerificationForm.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  const props = { registration: { registration_id: "test-registration", email: "person@example.test", resend_after: 60 },
    onVerified: async token => { tokens.push(token); }, onChangeEmail: () => changedEmail++, onLogin: () => login++, onBusyChange: value => busyChanges.push(value) };
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  function render() { cursor = 0; return nodes(context.exports.EmailVerificationForm(props)); }
  return { requests, tokens, busyChanges, render,
    field: () => render().find(node => node.type === "Field"),
    button: label => render().find(node => node.props?.label === label),
    advance(ms) { now += ms; for (const callback of timers.values()) callback(); },
    navigation: () => ({ changedEmail, login }),
  };
}

test("verification requires six digits and enters the app only after a successful response", async () => {
  let finish;
  const app = setup(() => new Promise(resolve => { finish = resolve; }));
  app.button("Подтвердить почту").props.onPress();
  assert.equal(app.requests.length, 0);
  assert.ok(app.render().some(node => node.props?.children === "Введите 6 цифр из письма"));
  app.field().props.onChangeText("01a23 4567");
  assert.equal(app.field().props.value, "012345");
  const submit = app.button("Подтвердить почту");
  submit.props.onPress(); submit.props.onPress();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, "/v1/auth/email/register/verify");
  assert.deepEqual(JSON.parse(JSON.stringify(app.requests[0].options.json)), { registration_id: "test-registration", code: "012345" });
  assert.equal(app.button("Изменить email").props.disabled, true);
  assert.deepEqual(app.tokens, []);
  finish({ access_token: "verified-token" }); await flush();
  assert.deepEqual(app.tokens, ["verified-token"]);
  assert.deepEqual(app.busyChanges, [true, false]);
});

test("an invalid or expired code keeps the form available for correction", async () => {
  let calls = 0;
  const app = setup(async () => { if (++calls === 1) throw Error("Код неверный или истёк"); return { access_token: "token" }; });
  app.field().props.onChangeText("123456");
  app.button("Подтвердить почту").props.onPress(); await flush();
  assert.deepEqual(app.tokens, []);
  assert.equal(app.field().props.value, "123456");
  assert.ok(app.render().some(node => node.props?.children === "Код неверный или истёк"));
  app.field().props.onChangeText("654321");
  app.button("Подтвердить почту").props.onPress(); await flush();
  assert.deepEqual(app.tokens, ["token"]);
});

test("resend waits one minute, clears the old code only on success, and resets the timer", async () => {
  let fail = true;
  const app = setup(async () => { if (fail) throw Error("Письмо не отправлено"); return { resend_after: 60 }; });
  app.button("Отправить ещё раз через 60 с").props.onPress();
  assert.equal(app.requests.length, 0);
  app.advance(60000);
  app.field().props.onChangeText("123456");
  app.button("Отправить код ещё раз").props.onPress(); await flush();
  assert.equal(app.field().props.value, "123456");
  fail = false;
  app.button("Отправить код ещё раз").props.onPress(); await flush();
  assert.equal(app.requests[1].url, "/v1/auth/email/register/resend");
  assert.equal(app.requests[1].options.json.registration_id, "test-registration");
  assert.equal(app.field().props.value, "");
  assert.equal(app.button("Отправить ещё раз через 60 с").props.disabled, true);
  assert.deepEqual(app.tokens, []);
  app.button("Изменить email").props.onPress();
  app.button("Вернуться ко входу").props.onPress();
  assert.deepEqual(app.navigation(), { changedEmail: 1, login: 1 });
});
