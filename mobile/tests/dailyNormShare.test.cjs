const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../src", file), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, setTimeout, clearTimeout, Error, Uint8Array, File, atob, AbortController, ...globals,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error(`Unexpected import: ${name}`); },
  };
  vm.runInNewContext(code, context);
  return context.exports;
}
const normModule = load("sharing/dailyNorm.ts");
const day = { balance: { target: 2100, consumed: 1650, activity_bonus: 900, remaining: 1350, protein_g: 50, fat_g: 40, carbs_g: 180 }, nutrient_targets: { protein_g: 120.4, fat_g: 60, carbs_g: 270.1 }, profile_complete: true };
const png = "iVBORw0KGgo=";
const flush = () => new Promise(setImmediate);

test("shared targets come from the server, excluding consumption and activity bonuses", () => {
  const norm = normModule.dailyNorm(day);
  assert.deepEqual(JSON.parse(JSON.stringify(norm)), { calories: 2100, protein: 120, fat: 60, carbs: 270, personalized: true });
  assert.equal(normModule.normDescription(norm), "Моя дневная норма: 2 100 ккал, белки 120 г, жиры 60 г, углеводы 270 г.");
  assert.equal(normModule.normTitle(normModule.dailyNorm({ ...day, profile_complete: false })), "Стартовый ориентир");
  for (const target of [NaN, Infinity, -10, 0, null]) assert.equal(normModule.dailyNorm({ ...day, balance: { ...day.balance, target } }), null);
  assert.equal(normModule.dailyNorm({ ...day, nutrient_targets: { ...day.nutrient_targets, fat_g: NaN } }), null);
  assert.equal(normModule.dailyNorm({ ...day, nutrient_targets: { ...day.nutrient_targets, carbs_g: 0 } }).carbs, 0);
  assert.equal(normModule.normNumber(10000), "10 000");
});

function sharing(platform, extra = {}, globals = {}) {
  return load("sharing/shareImage.ts", { "react-native": { Platform: { OS: platform } }, "../api": {}, ...extra }, globals);
}

test("render sends the displayed norm with authentication and cancellation, and rejects invalid images", async () => {
  const calls = [];
  let response = { image_base64: png };
  const api = sharing("web", { "../api": { api: async (path, options) => { calls.push({ path, options }); return response; } } });
  const norm = normModule.dailyNorm(day), controller = new AbortController();
  assert.equal(await api.renderNorm(norm, "session-token", controller.signal), png);
  assert.equal(calls[0].path, "/v1/share/daily-norm");
  assert.equal(calls[0].options.json, norm);
  assert.equal(calls[0].options.token, "session-token");
  assert.equal(calls[0].options.signal, controller.signal);
  for (response of [{}, { image_base64: "" }, { image_base64: "not-a-png" }]) {
    await assert.rejects(api.renderNorm(norm, "session-token", controller.signal), /Invalid PNG/);
  }
});

test("web share receives a PNG file synchronously in the click and cancellation is recognized", async () => {
  let calls = 0;
  const api = sharing("web", {}, { navigator: {
    canShare: data => data.files[0].type === "image/png",
    share(data) { calls++; assert.equal(data.files[0].name, "tarelka-daily-norm.png"); return Promise.resolve(); },
  } });
  const image = await api.prepareShareImage(png);
  assert.equal(image.label, "Поделиться");
  const pending = image.share();
  assert.equal(calls, 1);
  await pending;
  assert.equal(api.shareCancelled(Object.assign(new Error("Cancelled"), { name: "AbortError" })), true);
  assert.equal(api.shareCancelled(new Error("Failed")), false);
});

test("a browser without file sharing downloads the PNG and releases its URL later", async () => {
  const events = [];
  let revoke;
  const link = { click() { events.push(this.download, this.href); }, remove() { events.push("removed"); } };
  const api = sharing("web", {}, {
    navigator: { canShare: () => false, share() { throw Error("Unsupported"); } },
    document: { createElement: () => link, body: { appendChild() {} } },
    URL: { createObjectURL: file => { assert.equal(file.type, "image/png"); return "blob:png"; }, revokeObjectURL: url => events.push(url) },
    setTimeout: callback => { revoke = callback; },
  });
  const image = await api.prepareShareImage(png);
  assert.equal(image.label, "Скачать картинку");
  await image.share();
  assert.deepEqual(events, ["tarelka-daily-norm.png", "blob:png", "removed"]);
  revoke();
  assert.equal(events.at(-1), "blob:png");
});

test("native sharing awaits the write, keeps fresh files and cleans only expired exports", async () => {
  let finishWrite, shared = 0, deleted = [];
  class NativeFile {
    constructor(directory, name) { this.uri = `file:///cache/shares/${name}`; this.modificationTime = Date.now(); }
    write(value, options) { assert.equal(value, png); assert.equal(options.encoding, "base64"); return new Promise(resolve => { finishWrite = resolve; }); }
    delete() { deleted.push(this.uri); }
  }
  const old = new NativeFile(null, "old.png"); old.modificationTime -= 2 * 86400000;
  const fresh = new NativeFile(null, "fresh.png");
  class Directory { create() {} list() { return [old, fresh]; } }
  const api = sharing("android", {
    "expo-file-system": { File: NativeFile, Directory, Paths: { cache: "cache" } },
    "expo-sharing": { isAvailableAsync: async () => true, shareAsync: async (uri, options) => {
      assert.match(uri, /norm-.*\.png$/); assert.equal(options.mimeType, "image/png"); assert.equal(options.UTI, "public.png"); shared++;
    } },
  });
  let prepared = false;
  const result = api.prepareShareImage(png).then(image => { prepared = true; return image; });
  await flush();
  assert.equal(prepared, false);
  assert.equal(shared, 0);
  finishWrite();
  const image = await result;
  await image.share();
  assert.equal(shared, 1);
  assert.deepEqual(deleted, [old.uri]);
});

function uiSetup(platform = "web", options = {}) {
  let current, cursor = 0, root, preview;
  const tasks = [];
  let prepareResolve, shareResolve, shareReject, shares = 0;
  let displayedDay = day;
  const renders = [];
  const react = {
    useRef(value) { const index = cursor++; return current.hooks[index] ??= { current: value }; },
    useState(value) { const scope = current, index = cursor++; if (!(index in scope.hooks)) scope.hooks[index] = value; return [scope.hooks[index], next => { scope.hooks[index] = typeof next === "function" ? next(scope.hooks[index]) : next; }]; },
    useCallback: callback => callback,
    useEffect(callback, deps) { const scope = current, index = cursor++; const last = scope.effects[index]; if (!last || deps.some((v, i) => v !== last.deps[i])) tasks.push(() => { last?.cleanup?.(); scope.effects[index] = { deps, cleanup: callback() }; }); },
  };
  const element = (type, props, key) => ({ type, props, key });
  const module = load("components/DailyNormShare.tsx", {
    react, "react/jsx-runtime": { jsx: element, jsxs: element },
    "react-native": { ActivityIndicator: "Spinner", Image: "NativeImage", Platform: { OS: platform }, Modal: "Modal", Pressable: "Button", ScrollView: "Scroll", Text: "Text", View: "View", StyleSheet: { create: v => v } },
    "../sharing/dailyNorm": normModule,
    "../sharing/shareImage": { renderNorm: async (norm, token, signal) => {
      renders.push({ norm, token, signal });
      return options.renderNorm ? options.renderNorm() : png;
    }, shareCancelled: e => e.name === "AbortError", prepareShareImage: value => {
      assert.equal(value, png);
      return new Promise(resolve => { prepareResolve = resolve; });
    } },
    "../auth": { useAuth: () => ({ token: "session-token" }) },
    "../theme": { colors: {} }, "./Brand": { Icon: "Icon" },
  }, options.globals);
  function nodes(node) { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
  function clean(scope) { if (scope) scope.effects.forEach(effect => effect?.cleanup?.()); }
  function renderScope(scope, component, props) { current = scope; cursor = 0; return component(props); }
  root = { hooks: [], effects: [] };
  function render() {
    const parent = renderScope(root, module.DailyNormShare, { day: displayedDay });
    const child = nodes(parent).find(n => typeof n.type === "function");
    if (!child) { clean(preview); preview = null; return nodes(parent); }
    if (!preview || preview.key !== child.key) { clean(preview); preview = { hooks: [], effects: [], key: child.key }; }
    const result = [...nodes(parent), ...nodes(renderScope(preview, child.type, child.props))];
    while (tasks.length) tasks.shift()();
    return result;
  }
  const button = label => render().find(n => n.type === "Button" && (n.props.accessibilityLabel === label || nodes(n).some(c => c.type === "Text" && c.props.children === label)));
  return { render, button, renders, setDay: value => { displayedDay = value; },
    async ready() {
      button("Поделиться нормой").props.onPress(); render(); await flush();
      render(); await flush();
    },
    finishPrepare() { prepareResolve({ label: "Поделиться", share() { shares++; return new Promise((resolve, reject) => { shareResolve = resolve; shareReject = reject; }); } }); },
    finishShare: () => shareResolve(), failShare: error => shareReject(error), shares: () => shares,
    close() { button("Закрыть").props.onPress(); render(); },
  };
}

test("preview waits for export, prevents double shares, allows retry and ignores cancellation", async () => {
  const app = uiSetup();
  await app.ready();
  assert.equal(app.button("Готовим картинку…").props.disabled, true);
  app.finishPrepare(); await flush();
  const share = app.button("Поделиться");
  share.props.onPress(); share.props.onPress();
  assert.equal(app.shares(), 1);
  app.failShare(new Error("Failed")); await flush();
  assert.ok(app.render().find(n => n.props.accessibilityRole === "alert"));
  app.button("Поделиться").props.onPress();
  app.failShare(Object.assign(new Error("Cancelled"), { name: "AbortError" })); await flush();
  assert.equal(app.render().find(n => n.props.accessibilityRole === "alert"), undefined);
  assert.equal(app.button("Поделиться").props.disabled, false);
  app.close();
});

test("closing during preparation cannot reopen a stale preview", async () => {
  const app = uiSetup();
  await app.ready(); app.close(); app.finishPrepare(); await flush();
  assert.equal(app.render().find(n => n.type === "Modal"), undefined);
  assert.equal(app.renders[0].signal.aborted, true);
});

test("Android prepares and reopens a complete PNG without waiting for layout or image callbacks", async () => {
  const app = uiSetup("android");
  for (let i = 0; i < 2; i++) {
    await app.ready(); app.finishPrepare(); await flush();
    assert.equal(app.button("Поделиться").props.disabled, false);
    assert.equal(app.render().find(n => n.type === "NativeImage").props.source.uri, `data:image/png;base64,${png}`);
    assert.equal(app.render().find(n => n.props.onLayout || n.props.onLoad), undefined);
    app.close();
  }
});

test("an open preview keeps its snapshot when current day data changes", async () => {
  const app = uiSetup();
  await app.ready();
  app.setDay({ ...day, balance: { ...day.balance, target: 1800 } });
  app.render();
  assert.equal(app.renders.length, 1);
  assert.equal(app.renders[0].norm.calories, 2100);
  app.finishPrepare(); await flush(); app.close();
  await app.ready();
  assert.equal(app.renders[1].norm.calories, 1800);
  app.finishPrepare(); await flush(); app.close();
});

test("render failures can be retried and a closed request is aborted", async () => {
  let calls = 0;
  const app = uiSetup("android", { renderNorm: async () => { if (++calls === 1) throw Error("offline"); return png; } });
  await app.ready();
  assert.ok(app.render().find(n => n.props.accessibilityRole === "alert"));
  app.button("Попробовать ещё раз").props.onPress(); app.render(); await flush();
  app.finishPrepare(); await flush();
  assert.equal(app.button("Поделиться").props.disabled, false);
  app.close();
  assert.equal(app.renders.every(call => call.signal.aborted), true);
});

test("a hung render times out, aborts and never replaces the error with a late image", async () => {
  let timeout, finish;
  const app = uiSetup("android", {
    renderNorm: () => new Promise(resolve => { finish = resolve; }),
    globals: { setTimeout: callback => { timeout = callback; return 1; }, clearTimeout() {} },
  });
  await app.ready(); timeout();
  assert.equal(app.renders[0].signal.aborted, true);
  assert.ok(app.button("Попробовать ещё раз"));
  finish(png); await flush();
  assert.equal(app.render().find(n => n.type === "NativeImage"), undefined);
  app.close();
});
