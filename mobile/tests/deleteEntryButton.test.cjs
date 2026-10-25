const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const flush = () => new Promise(setImmediate);

function setup(api, disabled = false) {
  let busy = false, deleted = 0;
  const lock = { current: false };
  const alerts = [];
  const element = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/components/DeleteEntryButton.tsx"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  const context = { exports: {}, require(name) {
    if (name === "react") return { useRef: () => lock, useState: () => [busy, value => { busy = value; }] };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element };
    if (name === "react-native") return {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable",
      Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: value => value },
    };
    if (name === "../api") return { api, apiFailureMessage: async error => error.message };
    if (name === "../auth") return { useAuth: () => ({ token: "test-token", signOut: async () => {} }) };
    if (name === "../theme") return { colors: {} };
    if (name === "./Brand") return { Icon: "Icon" };
    throw Error(name);
  }};
  vm.runInNewContext(code, context);
  return {
    render: () => context.exports.DeleteEntryButton({ entryId: 42, disabled, onDeleted: () => deleted++ }),
    deleted: () => deleted,
    alerts,
  };
}

test("cross deletes the selected entry once on rapid taps without opening its details", async () => {
  const requests = [];
  let finish;
  const app = setup((path, options) => {
    requests.push({ path, options });
    return new Promise(resolve => { finish = resolve; });
  });
  const button = app.render();
  let stopped = 0;
  button.props.onPress({ stopPropagation: () => stopped++ });
  button.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/entries/42");
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.token, "test-token");
  assert.equal(app.render().props.disabled, true);
  assert.equal(app.render().props.children.type, "ActivityIndicator");
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
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(app.deleted(), 0);
  assert.equal(app.render().props.disabled, false);
  assert.equal(app.alerts[0][1], "Сеть недоступна");
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(app.deleted(), 1);
});

test("a disabled cross does not delete an entry while analysis is running", async () => {
  let requests = 0;
  const app = setup(async () => requests++, true);
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(requests, 0);
  assert.equal(app.deleted(), 0);
});
