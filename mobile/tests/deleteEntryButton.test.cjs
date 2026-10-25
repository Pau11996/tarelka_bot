const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const flush = () => new Promise(setImmediate);

function setup(api, disabled = false) {
  let cursor = 0, deleted = 0;
  const hooks = [];
  const element = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/components/DeleteEntryButton.tsx"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const context = { exports: {}, require(name) {
    if (name === "react") return {
      useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = value; }]; },
    };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (name === "react-native") return {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", Modal: "Modal", Text: "Text", View: "View",
      StyleSheet: { create: value => value },
    };
    if (name === "../api") return { api, apiFailureMessage: async error => error.message };
    if (name === "../auth") return { useAuth: () => ({ token: "test-token", signOut: async () => {} }) };
    if (name === "../theme") return { colors: {} };
    if (name === "./Brand") return { Icon: "Icon" };
    throw Error(name);
  }};
  vm.runInNewContext(code, context);
  function nodes(root) {
    if (!root || typeof root !== "object") return [];
    if (root.type === "Modal" && !root.props.visible) return [];
    return [root, ...[root.props?.children].flat(Infinity).flatMap(nodes)];
  }
  function render() { cursor = 0; return nodes(context.exports.DeleteEntryButton({ entryId: 42, disabled, onDeleted: () => deleted++ })); }
  return { render, deleted: () => deleted,
    button: label => render().find(n => n.type === "Pressable" && (n.props.accessibilityLabel === label || nodes(n).some(child => child.type === "Text" && child.props.children === label))),
  };
}

test("trash asks for confirmation, cancellation is safe, and confirming twice deletes only once", async () => {
  const requests = [];
  let finish;
  const app = setup((path, options) => {
    requests.push({ path, options });
    return new Promise(resolve => { finish = resolve; });
  });
  const button = app.button("Удалить запись");
  assert.equal(button.props.children.props.name, "trash");
  let stopped = 0;
  button.props.onPress({ stopPropagation: () => stopped++ });
  button.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 2);
  assert.equal(requests.length, 0);
  app.button("Оставить").props.onPress({ stopPropagation() {} });
  assert.equal(app.button("Удалить"), undefined);
  assert.equal(requests.length, 0);
  app.button("Удалить запись").props.onPress({ stopPropagation() {} });
  const confirm = app.button("Удалить");
  confirm.props.onPress({ stopPropagation() {} });
  confirm.props.onPress({ stopPropagation() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/entries/42");
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.token, "test-token");
  assert.equal(app.button("Удалить запись").props.disabled, true);
  assert.equal(app.button("Удалить запись").props.children.type, "ActivityIndicator");
  assert.equal(app.button("Оставить").props.disabled, true);
  assert.equal(app.deleted(), 0);
  finish();
  await flush();
  assert.equal(app.deleted(), 1);
});

test("a failed deletion keeps the entry and allows another attempt", async () => {
  let attempts = 0;
  const app = setup(async () => {
    if (++attempts === 1) throw Error("Сеть недоступна");
  });
  app.button("Удалить запись").props.onPress({ stopPropagation() {} });
  app.button("Удалить").props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(app.deleted(), 0);
  assert.equal(app.button("Удалить").props.disabled, false);
  assert.equal(app.render().find(n => n.props?.accessibilityRole === "alert").props.children, "Сеть недоступна");
  app.button("Удалить").props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(app.deleted(), 1);
});

test("a disabled trash button does not open confirmation while analysis is running", async () => {
  let requests = 0;
  const app = setup(async () => requests++, true);
  app.button("Удалить запись").props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(requests, 0);
  assert.equal(app.button("Удалить"), undefined);
  assert.equal(app.deleted(), 0);
});
