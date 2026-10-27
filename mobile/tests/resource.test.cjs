const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const flush = () => new Promise(setImmediate);

function setup() {
  const slots = [], effects = [], requests = [];
  let cursor = 0, dirty = false, foreground;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((v, i) => v !== slots[index].deps[i])) slots[index] = { fn, deps };
      return slots[index].fn;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((v, i) => v !== slots[index][i])) { slots[index] = deps; effects.push(fn); }
    },
  };
  const auth = { token: "test-token", signOut() {} };
  const modules = {
    react,
    "expo-router": { useFocusEffect: fn => react.useEffect(fn, [fn]) },
    "react-native": { AppState: { addEventListener(_, fn) { foreground = fn; return { remove() {} }; } } },
    "../api": {
      api: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
      apiFailureMessage: async error => error.message,
    },
    "../auth": { useAuth: () => auth },
    "../health/events": { onHealthUpdate: () => () => {} },
  };
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/hooks/useResource.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  function render() {
    let result;
    do { cursor = 0; dirty = false; result = context.exports.useResource("/v1/profile"); effects.splice(0).forEach(fn => fn()); } while (dirty);
    return result;
  }
  return { render, requests, foreground: () => foreground("active") };
}

test("saving replaces a pending refresh; its stale response cannot undo the saved profile", async () => {
  const app = setup();
  app.render();
  app.requests[0].resolve({ age: 31 });
  await flush();
  app.foreground();
  assert.equal(app.render().loading, true);
  app.render().setData({ age: 32 });
  assert.equal(app.render().loading, false);
  app.requests[1].resolve({ age: 31 });
  await flush();
  assert.equal(app.render().data.age, 32);
  app.foreground();
  app.requests[2].resolve({ age: 33 });
  await flush();
  assert.equal(app.render().data.age, 33);
});

test("a superseded refresh failure cannot replace a successful update with an error", async () => {
  const app = setup();
  app.render().setData({ age: 32 });
  app.render().setData(current => ({ ...current, age: current.age + 1 }));
  app.requests[0].reject(Error("Сеть недоступна"));
  await flush();
  const result = app.render();
  assert.equal(result.data.age, 33);
  assert.equal(result.error, null);
  assert.equal(result.loading, false);
});
