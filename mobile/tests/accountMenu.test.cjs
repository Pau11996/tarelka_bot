const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const flush = () => new Promise(setImmediate);

function setup(signOut) {
  const slots = [], navigations = [];
  let cursor = 0;
  const element = (type, props) => ({ type, props });
  const react = {
    Fragment: "Fragment",
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": {
      ...Object.fromEntries(["ActivityIndicator", "Pressable", "ScrollView", "Text", "View"].map(value => [value, value])),
      Keyboard: { dismiss() {} }, useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: value => value, absoluteFill: {}, hairlineWidth: 1 },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": { router: { push: href => navigations.push(href), canGoBack: () => true, back: () => navigations.push("back") } },
    "../auth": { useAuth: () => ({ signOut }) },
    "../theme": { colors: {} }, "./Brand": { Icon: "Icon" },
  };
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/AccountMenu.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  function render() { cursor = 0; return nodes(context.exports.AccountPanel()); }
  return {
    render, navigations,
    button: title => render().find(node => node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && child.props.children === title)),
    logout: () => render().find(node => node.props?.accessibilityLabel === "Выйти из аккаунта"),
    trigger: () => context.exports.AccountMenu({}),
  };
}

test("account sections open above an account history entry and close returns to the previous screen", () => {
  const app = setup(async () => {});
  app.trigger().props.onPress();
  const profile = app.button("Мой профиль");
  assert.ok(profile);
  profile.props.onPress();
  app.render().find(node => node.props?.accessibilityLabel === "Свернуть меню аккаунта").props.onPress();
  assert.deepEqual(app.navigations, ["/account", "/profile", "back"]);
});

test("signing out ignores duplicate taps and a failure leaves a retry action in the account menu", async () => {
  let attempts = 0, finish;
  const app = setup(() => { attempts++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); });
  const action = app.logout();
  action.props.onPress();
  action.props.onPress();
  assert.equal(attempts, 1);
  assert.equal(app.logout().props.disabled, true);
  finish.reject(Error("Storage unavailable"));
  await flush();
  assert.equal(app.logout().props.disabled, false);
  assert.ok(app.render().some(node => node.props?.children === "Не удалось выйти из аккаунта. Попробуйте ещё раз."));
  app.logout().props.onPress();
  assert.equal(attempts, 2);
  finish.resolve();
  await flush();
  assert.equal(app.logout().props.disabled, false);
});
