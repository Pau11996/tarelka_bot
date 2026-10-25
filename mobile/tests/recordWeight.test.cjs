const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const flush = () => new Promise(setImmediate);
const compiled = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function setup(api) {
  const slots = [], calls = [], navigations = [];
  let cursor = 0, ids = 0, updates = 0;
  const weightContext = { exports: {} };
  vm.runInNewContext(compiled("weightTracking.ts"), weightContext);
  const element = (type, props) => ({ type, props });
  const modules = {
    react: { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; }, useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; } },
    "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": { ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Pressable", "ScrollView", "Text", "TextInput", "View"].map(name => [name, name])), Keyboard: { dismiss() {} }, Platform: { OS: "android" }, StyleSheet: { create: value => value } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-router": { router: { canGoBack: () => false, replace: href => navigations.push(href) } },
    "expo-crypto": { randomUUID: () => `record-${++ids}` },
    "../api": { api: (url, options) => { calls.push({ url, options }); return api(url, options); }, apiFailureMessage: async error => error.message },
    "../auth": { useAuth: () => ({ token: "test", signOut() {} }) }, "../components/Brand": { Icon: "Icon" }, "../theme": { colors: {} },
    "../weightTracking": weightContext.exports, "../health/events": { healthUpdated: () => updates++ },
  };
  const context = { exports: {}, require: name => { if (name in modules) return modules[name]; throw Error(name); } };
  vm.runInNewContext(compiled("app/weight.tsx"), context);
  function nodes(node) { if (!node) return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
  function render() { cursor = 0; return nodes(context.exports.default()); }
  const field = () => render().find(node => node.props?.accessibilityLabel === "Вес, кг");
  const save = () => render().find(node => node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && ["Сохранить измерение", "Сохраняем…"].includes(child.props.children)));
  return { field, save, calls, navigations, updates: () => updates };
}

test("weight save ignores duplicate taps and a retry reuses its operation id", async () => {
  let finish;
  const app = setup(() => new Promise((resolve, reject) => { finish = { resolve, reject }; }));
  app.field().props.onChangeText("72,5");
  app.save().props.onPress(); app.save().props.onPress();
  assert.equal(app.calls.length, 1);
  finish.reject(Error("Нет сети")); await flush();
  assert.equal(app.field().props.value, "72,5");
  app.save().props.onPress();
  assert.equal(app.calls[1].options.json.operation_id, app.calls[0].options.json.operation_id);
  finish.resolve({}); await flush();
  assert.equal(app.updates(), 1);
  assert.deepEqual(app.navigations, ["/(tabs)/achievements"]);
});

test("invalid input is not sent and a different measurement gets a new operation id", async () => {
  const app = setup(async () => { throw Error("Нет сети"); });
  app.field().props.onChangeText("0"); app.save().props.onPress();
  assert.equal(app.calls.length, 0);
  app.field().props.onChangeText("70"); app.save().props.onPress(); await flush();
  app.field().props.onChangeText("71"); app.save().props.onPress(); await flush();
  assert.notEqual(app.calls[0].options.json.operation_id, app.calls[1].options.json.operation_id);
});
