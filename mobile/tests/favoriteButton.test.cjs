const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const flush = () => new Promise(setImmediate);

function setup(api) {
  let busy = false;
  const lock = { current: false };
  const changes = [], alerts = [];
  let props = { entryId: 42, favoriteId: null, onChange(id) { changes.push(id); props.favoriteId = id; } };
  const element = (type, props) => ({ type, props });
  const code = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/components/FavoriteButton.tsx"), "utf8"),
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
  return { render: () => context.exports.FavoriteButton(props), changes, alerts };
}

test("star saves once on rapid taps, stops entry navigation, and removes on the next tap", async () => {
  const requests = [];
  let resolve;
  const app = setup((path, options) => {
    requests.push({ path, options });
    if (options.method === "POST") return new Promise(done => { resolve = done; });
    return Promise.resolve();
  });
  const button = app.render();
  let stopped = 0;
  button.props.onPress({ stopPropagation: () => stopped++ });
  button.props.onPress({ stopPropagation: () => stopped++ });
  assert.equal(stopped, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/v1/entries/42/favorite");
  assert.equal(requests[0].options.token, "test-token");
  assert.equal(app.render().props.disabled, true);
  resolve({ favorite: { id: 77 } });
  await flush();
  assert.deepEqual(app.changes, [77]);
  assert.equal(app.render().props.accessibilityState.selected, true);
  assert.equal(app.render().props.children.props.filled, true);
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.equal(requests[1].path, "/v1/favorites/77");
  assert.equal(requests[1].options.method, "DELETE");
  assert.deepEqual(app.changes, [77, null]);
  assert.equal(app.render().props.accessibilityState.selected, false);
});

test("failed favorite request keeps the prior state and allows retry", async () => {
  let attempts = 0;
  const app = setup(async () => {
    attempts++;
    if (attempts === 1) throw Error("Сеть недоступна");
    return { favorite: { id: 77 } };
  });
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.deepEqual(app.changes, []);
  assert.equal(app.render().props.accessibilityState.selected, false);
  assert.equal(app.render().props.disabled, false);
  assert.equal(app.alerts[0][1], "Сеть недоступна");
  app.render().props.onPress({ stopPropagation() {} });
  await flush();
  assert.deepEqual(app.changes, [77]);
});
