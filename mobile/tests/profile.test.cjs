const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const original = { weight_kg: 72, height_cm: 174, age: 31, sex: "female", goal: "maintain", activity_level: "moderate", daily_calorie_target: 2100, is_complete: true };
const flush = () => new Promise(setImmediate);
const targetContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/profileTarget.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, targetContext);
const weightContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/weightTracking.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, weightContext);

function setup(api, options = {}) {
  const slots = [], effects = [], notices = [], calls = [], dismissed = [], navigations = [];
  let cursor = 0, dirty = false, removalGuard;
  const cleanups = new Map();
  const element = (type, props) => ({ type, props });
  const resource = { data: { ...(options.profile ?? original) }, loading: false, error: null, load() {}, setData(value) { this.data = value; } };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => value !== slots[index][i])) {
        slots[index] = deps; effects.push(() => { cleanups.get(index)?.(); cleanups.set(index, effect()); });
      }
    },
  };
  const modules = {
    react,
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "Fragment" },
    "react-native": {
      ...Object.fromEntries(["ActivityIndicator", "KeyboardAvoidingView", "Modal", "Pressable", "ScrollView", "Text", "TextInput", "View"].map(value => [value, value])),
      Keyboard: { dismiss() {} }, Platform: { OS: "android" }, useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFill: {} },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView", useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "expo-router": {
      router: { canGoBack: () => true, back() {}, push: href => navigations.push(href), replace: href => navigations.push(href), dismissTo: href => navigations.push(href) },
      usePreventRemove(enabled, callback) {
        removalGuard = { enabled, callback };
        return () => { removalGuard.enabled = false; };
      },
      useLocalSearchParams: () => options.setupUserId ? { setup: "1", userId: String(options.setupUserId) } : {},
    },
    "../profileSetup": { dismissProfileSetup: async userId => { dismissed.push(userId); if (options.storageError) throw Error("Storage unavailable"); } },
    "../profileTarget": targetContext.exports,
    "../weightTracking": weightContext.exports,
    "../auth": { useAuth: () => ({ token: "test-token", signOut() {} }) },
    "../api": {
      api: (url, options) => { calls.push({ url, options }); return api ? api(url, options) : Promise.resolve({ ...original, ...options.json }); },
      apiFailureMessage: async error => error.message,
    },
    "../components/Brand": { BrandMark: "BrandMark", Icon: "Icon" }, "./Brand": { Icon: "Icon" }, "../components/Screen": { State: "State" },
    "../components/TransientNotice": { TransientNotice: "TransientNotice" },
    "../hooks/useTransientNotice": { useTransientNotice: () => ({ message: null, show: message => notices.push(message), clear() {} }) },
    "../hooks/useResource": { useResource: () => resource }, "../theme": { colors: {} },
  };
  const context = { exports: {}, require(name) { if (name in modules) return modules[name]; throw Error(name); } };
  const dialog = { exports: {}, require: context.require };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/components/ProfileLeaveDialog.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, dialog);
  modules["../components/ProfileLeaveDialog"] = dialog.exports;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/app/profile.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, context);
  function nodes(node) {
    if (!node || (node.type === "Modal" && !node.props.visible)) return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children)];
  }
  function render() {
    let tree;
    do {
      cursor = 0; dirty = false; tree = context.exports.default();
      effects.splice(0).forEach(effect => effect());
    } while (dirty);
    return nodes(tree);
  }
  const byLabel = label => render().find(node => node.props?.accessibilityLabel === label);
  const button = text => render().find(node => node.type === "Pressable" && nodes(node).some(child => child.type === "Text" && child.props.children === text));
  function enterMetric(label, input, value) {
    byLabel(label).props.onPress();
    byLabel(input).props.onChangeText(value);
    button("Готово").props.onPress();
  }
  function enterWeight(value, desired = false) {
    byLabel(desired ? "Желаемый вес" : "Введите ваш вес").props.onPress();
    byLabel(desired ? "Желаемый вес, кг" : "Вес, кг").props.onChangeText(value);
    button("Готово").props.onPress();
  }
  function remove() {
    render();
    if (removalGuard.enabled) removalGuard.callback({ repeat() { removalGuard.enabled = false; navigations.push("native-back"); } });
    else navigations.push("native-back");
  }
  const changed = () => render().some(node => node.props?.children === "Есть несохранённые изменения");
  return { render, byLabel, button, enterWeight, enterMetric, calls, notices, dismissed, navigations, resource, remove, changed,
    unmount() { for (const cleanup of cleanups.values()) cleanup?.(); },
  };
}

test("editing personal data and activity only saves on confirmation and ignores rapid duplicate taps", async () => {
  let finish;
  const app = setup(() => new Promise(resolve => { finish = resolve; }));
  app.byLabel("Вес, кг").props.onChangeText("73,5");
  app.byLabel("Рост, см").props.onChangeText("175");
  app.byLabel("Возраст").props.onChangeText("32");
  app.button("Мужской").props.onPress();
  app.byLabel("Снизить вес").props.onPress();
  app.byLabel("Выбрать физическую активность").props.onPress();
  app.byLabel("Высокая").props.onPress();
  assert.equal(app.calls.length, 0);
  app.button("Сохранить изменения").props.onPress();
  app.button("Сохраняем…").props.onPress();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, "/v1/profile");
  assert.equal(app.calls[0].options.token, "test-token");
  assert.equal(app.calls[0].options.method, "PUT");
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].options.json)), { weight_kg: 73.5, height_cm: 175, age: 32, sex: "male", goal: "lose", activity_level: "active" });
  finish({ ...original, ...app.calls[0].options.json });
  await flush();
  assert.equal(app.button("Сохранить изменения").props.disabled, false);
  assert.deepEqual(app.notices, ["Профиль сохранён"]);
});

test("the calorie editor discards cancelled drafts, validates bounds and defers saving to the main button", async () => {
  const app = setup();
  app.byLabel("Изменить дневную норму").props.onPress();
  app.byLabel("Дневная норма, ккал").props.onChangeText("2400");
  app.byLabel("Закрыть панель профиля").props.onPress();
  app.byLabel("Изменить дневную норму").props.onPress();
  assert.equal(app.byLabel("Дневная норма, ккал").props.value, "2100");
  app.byLabel("Дневная норма, ккал").props.onChangeText("0");
  app.button("Готово").props.onPress();
  assert.ok(app.render().some(node => node.props?.children === "Укажите норму от 500 до 10 000 ккал."));
  app.byLabel("Дневная норма, ккал").props.onChangeText("2300");
  app.button("Готово").props.onPress();
  assert.equal(app.calls.length, 0);
  app.button("Сохранить изменения").props.onPress();
  await flush();
  assert.equal(app.calls[0].options.json.daily_calorie_target, 2300);
});

test("invalid numbers never reach the API and a failed save keeps the edits available for retry", async () => {
  let attempts = 0;
  const app = setup(async (_, options) => { if (++attempts === 1) throw Error("Сеть недоступна"); return { ...original, ...options.json }; });
  app.byLabel("Возраст").props.onChangeText("31,5");
  app.button("Сохранить изменения").props.onPress();
  await flush();
  assert.equal(app.calls.length, 0);
  app.byLabel("Возраст").props.onChangeText("32");
  app.button("Сохранить изменения").props.onPress();
  await flush();
  assert.equal(app.render().find(node => node.type === "State").props.error, "Сеть недоступна");
  assert.equal(app.byLabel("Возраст").props.value, "32");
  assert.equal(app.button("Сохранить изменения").props.disabled, false);
  app.button("Сохранить изменения").props.onPress();
  await flush();
  assert.equal(app.calls.length, 2);
});

const emptyProfile = { weight_kg: null, height_cm: null, age: null, sex: null, goal: null, activity_level: null, daily_calorie_target: 2000, is_complete: false };

test("leaving the profile returns to the account menu", () => {
  const app = setup();
  app.byLabel("Назад").props.onPress();
  assert.deepEqual(app.navigations, ["/account"]);
});

test("first-time setup can be skipped without saving personal data, even when device storage fails", async () => {
  const app = setup(undefined, { profile: emptyProfile, setupUserId: 42, storageError: true });
  app.enterWeight("72");
  app.button("Заполнить потом").props.onPress();
  await flush();
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.dismissed, [42]);
  assert.deepEqual(app.navigations, ["/(tabs)/chat"]);
});

test("setup calculates only after all inputs, updates its preview and saves that value only on Continue", async () => {
  const app = setup(async (_, options) => ({ ...emptyProfile, ...options.json, is_complete: true }), { profile: emptyProfile, setupUserId: 43 });
  assert.equal(app.byLabel("Изменить дневную норму"), undefined);
  assert.equal(app.button("Продолжить").props.disabled, true);
  app.button("Продолжить").props.onPress();
  await flush();
  assert.equal(app.calls.length, 0);
  assert.equal(app.navigations.length, 0);
  app.enterWeight("72");
  app.enterMetric("Введите ваш рост", "Рост, см", "174");
  app.enterMetric("Укажите ваш возраст", "Возраст", "31");
  app.byLabel("Выберите пол").props.onPress();
  app.button("Женский").props.onPress();
  app.byLabel("Выберите цель").props.onPress();
  app.byLabel("Поддерживать вес").props.onPress();
  assert.equal(app.button("Продолжить").props.disabled, true);
  app.byLabel("Ваша активность").props.onPress();
  app.byLabel("Средняя").props.onPress();
  assert.equal(app.button("Продолжить").props.disabled, false);
  const showsTarget = target => app.render().some(node => node.type === "Text" && String(node.props.children).replace(/\s/g, "") === String(target));
  assert.ok(showsTarget(2312));
  app.byLabel("Введите ваш вес").props.onPress();
  app.byLabel("Вес, кг").props.onChangeText("73,5");
  assert.ok(showsTarget(2312));
  app.button("Готово").props.onPress();
  assert.ok(showsTarget(2335));
  app.byLabel("Выберите цель").props.onPress();
  app.byLabel("Снизить вес").props.onPress();
  assert.ok(showsTarget(1835));
  app.byLabel("Ваша активность").props.onPress();
  app.byLabel("Высокая").props.onPress();
  assert.ok(showsTarget(2099));
  app.byLabel("Укажите ваш возраст").props.onPress();
  app.byLabel("Возраст").props.onChangeText("121");
  app.button("Готово").props.onPress();
  assert.ok(app.render().some(node => node.props?.children === "Укажите возраст целым числом от 1 до 120."));
  assert.ok(showsTarget(2099));
  app.byLabel("Закрыть панель профиля").props.onPress();
  assert.equal(app.calls.length, 0);
  app.button("Продолжить").props.onPress();
  await flush();
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].options.json.daily_calorie_target, 2099);
  assert.deepEqual(app.dismissed, [43]);
  assert.deepEqual(app.navigations, ["/(tabs)/chat"]);
});

test("a failed first-time save keeps the form and its skip action available", async () => {
  const app = setup(async () => { throw Error("Сеть недоступна"); }, { setupUserId: 44 });
  app.button("Продолжить").props.onPress();
  await flush();
  assert.equal(app.render().find(node => node.type === "State").props.error, "Сеть недоступна");
  assert.equal(app.dismissed.length, 0);
  assert.equal(app.navigations.length, 0);
  app.button("Заполнить потом").props.onPress();
  await flush();
  assert.deepEqual(app.navigations, ["/(tabs)/chat"]);
});

test("an optional target in setup sets the direction and is saved with the profile", async () => {
  const app = setup(async (_, options) => ({ ...emptyProfile, ...options.json, is_complete: true }), { profile: emptyProfile, setupUserId: 45 });
  app.enterWeight("80");
  app.enterMetric("Введите ваш рост", "Рост, см", "174");
  app.enterMetric("Укажите ваш возраст", "Возраст", "31");
  app.byLabel("Выберите пол").props.onPress();
  app.button("Женский").props.onPress();
  app.byLabel("Выберите цель").props.onPress();
  app.byLabel("Набрать вес").props.onPress();
  app.byLabel("Ваша активность").props.onPress();
  app.byLabel("Средняя").props.onPress();
  app.enterWeight("70,5", true);
  assert.equal(app.button("Продолжить").props.disabled, false);
  app.button("Продолжить").props.onPress();
  await flush();
  assert.equal(app.calls[0].options.json.target_weight_kg, 70.5);
  assert.equal(app.calls[0].options.json.goal, "lose");
  assert.deepEqual(app.navigations, ["/(tabs)/chat"]);
});

test("an invalid weight stays in its editor without changing the form and an active goal opens its shared editor", () => {
  const setupApp = setup(undefined, { setupUserId: 46 });
  setupApp.byLabel("Желаемый вес").props.onPress();
  setupApp.byLabel("Желаемый вес, кг").props.onChangeText("0");
  setupApp.button("Готово").props.onPress();
  assert.ok(setupApp.render().some(node => node.props?.children === "Введите положительный вес не больше 1000 кг."));
  assert.equal(setupApp.byLabel("Желаемый вес").props.accessibilityValue.text, "Не указано");
  setupApp.byLabel("Желаемый вес, кг").props.onChangeText("");
  setupApp.button("Готово").props.onPress();
  assert.equal(setupApp.button("Продолжить").props.disabled, false);
  const app = setup(undefined, { profile: { ...original, weight_goal: { id: "goal", direction_label: "Снизить вес", target_weight_kg: 65 } } });
  app.byLabel("Изменить цель по весу").props.onPress();
  assert.deepEqual(app.navigations, ["/(tabs)/achievements?editGoal=1"]);
});


test("unsaved values prompt on Back; continuing keeps edits and discarding never saves", () => {
  const app = setup();
  assert.equal(app.changed(), false);
  app.byLabel("Вес, кг").props.onChangeText("73,5");
  assert.equal(app.changed(), true);
  app.byLabel("Назад").props.onPress();
  assert.deepEqual(app.navigations, []);
  assert.ok(app.byLabel("Сохранить изменения?"));
  app.button("Продолжить редактирование").props.onPress();
  assert.equal(app.byLabel("Сохранить изменения?"), undefined);
  assert.equal(app.byLabel("Вес, кг").props.value, "73,5");
  app.byLabel("Назад").props.onPress();
  app.button("Выйти без сохранения").props.onPress();
  assert.deepEqual(app.navigations, ["/account"]);
  assert.equal(app.calls.length, 0);
});

test("native navigation is resumed once, only after Save and exit succeeds", async () => {
  let finish;
  const app = setup(() => new Promise(resolve => { finish = resolve; }));
  app.byLabel("Возраст").props.onChangeText("32");
  app.remove();
  assert.ok(app.byLabel("Сохранить изменения?"));
  const saveAndExit = app.button("Сохранить и выйти").props.onPress;
  saveAndExit();
  saveAndExit();
  assert.equal(app.calls.length, 1);
  assert.equal(app.button("Продолжить редактирование").props.disabled, true);
  assert.equal(app.button("Выйти без сохранения").props.disabled, true);
  app.button("Выйти без сохранения").props.onPress();
  app.button("Продолжить редактирование").props.onPress();
  app.remove();
  assert.deepEqual(app.navigations, []);
  finish({ ...original, age: 32 });
  await flush();
  assert.deepEqual(app.navigations, ["native-back"]);
  assert.equal(app.changed(), false);
});

test("Save and exit keeps the dialog and draft after failure, then permits retry", async () => {
  let attempts = 0;
  const app = setup(async (_, options) => {
    if (++attempts === 1) throw Error("Сеть недоступна");
    return { ...original, ...options.json };
  });
  app.byLabel("Возраст").props.onChangeText("32");
  app.byLabel("Назад").props.onPress();
  app.button("Сохранить и выйти").props.onPress();
  await flush();
  const dialog = app.byLabel("Сохранить изменения?");
  assert.ok(dialog);
  assert.ok(app.render().some(node => node.props?.accessibilityRole === "alert" && node.props.children === "Сеть недоступна"));
  assert.equal(app.changed(), true);
  assert.equal(app.byLabel("Возраст").props.value, "32");
  assert.deepEqual(app.navigations, []);
  app.button("Сохранить и выйти").props.onPress();
  await flush();
  assert.deepEqual(app.navigations, ["/account"]);
  assert.equal(app.calls.length, 2);
});

test("invalid input cannot exit through Save; cancel returns to the unfinished field", async () => {
  const app = setup();
  app.byLabel("Возраст").props.onChangeText("31,5");
  app.byLabel("Назад").props.onPress();
  app.button("Сохранить и выйти").props.onPress();
  await flush();
  assert.equal(app.calls.length, 0);
  assert.equal(app.navigations.length, 0);
  assert.ok(app.byLabel("Сохранить изменения?"));
  app.button("Продолжить редактирование").props.onPress();
  assert.equal(app.byLabel("Возраст").props.value, "31,5");
});

test("equivalent numeric formatting and undoing changes do not trigger a warning", () => {
  const app = setup(undefined, { profile: { ...original, weight_kg: 72.5 } });
  app.byLabel("Вес, кг").props.onChangeText("72,50");
  assert.equal(app.changed(), false);
  app.byLabel("Возраст").props.onChangeText("");
  assert.equal(app.changed(), true);
  app.byLabel("Возраст").props.onChangeText("31");
  app.button("Мужской").props.onPress();
  assert.equal(app.changed(), true);
  app.button("Женский").props.onPress();
  assert.equal(app.changed(), false);
  app.byLabel("Назад").props.onPress();
  assert.deepEqual(app.navigations, ["/account"]);
});

test("foreground refresh keeps changed values and refreshes untouched fields", () => {
  const app = setup();
  app.byLabel("Вес, кг").props.onChangeText("73,5");
  app.button("Мужской").props.onPress();
  app.byLabel("Снизить вес").props.onPress();
  app.resource.data = { ...original, height_cm: 175, activity_level: "active" };
  assert.equal(app.byLabel("Вес, кг").props.value, "73,5");
  assert.equal(app.byLabel("Рост, см").props.value, "175");
  assert.equal(app.button("Мужской").props.accessibilityState.checked, true);
  assert.equal(app.byLabel("Снизить вес").props.accessibilityState.checked, true);
  assert.equal(app.byLabel("Выбрать физическую активность").props.accessibilityValue.text, "Высокая");
  assert.equal(app.changed(), true);
});

test("refresh preserves the calorie change and input still being edited in a sheet", () => {
  const app = setup();
  app.byLabel("Изменить дневную норму").props.onPress();
  app.byLabel("Дневная норма, ккал").props.onChangeText("2300");
  app.resource.data = { ...original };
  assert.equal(app.byLabel("Дневная норма, ккал").props.value, "2300");
  app.button("Готово").props.onPress();
  app.resource.data = { ...original };
  assert.equal(app.changed(), true);
  app.byLabel("Изменить дневную норму").props.onPress();
  assert.equal(app.byLabel("Дневная норма, ккал").props.value, "2300");
  const setupApp = setup(undefined, { setupUserId: 47 });
  setupApp.enterWeight("73,5");
  setupApp.byLabel("Введите ваш рост").props.onPress();
  setupApp.byLabel("Рост, см").props.onChangeText("180");
  setupApp.resource.data = { ...original };
  assert.equal(setupApp.byLabel("Рост, см").props.value, "180");
  assert.equal(setupApp.byLabel("Введите ваш вес").props.accessibilityValue.text, "73,5 кг");
  assert.equal(setupApp.calls.length, 0);
});

test("normal save clears the warning and native Back works without another confirmation", async () => {
  const app = setup();
  app.byLabel("Возраст").props.onChangeText("32");
  app.button("Сохранить изменения").props.onPress();
  await flush();
  assert.equal(app.changed(), false);
  app.remove();
  assert.deepEqual(app.navigations, ["native-back"]);
});

test("a late save result after unmount cannot navigate or show success", async () => {
  let finish;
  const app = setup(() => new Promise(resolve => { finish = resolve; }));
  app.byLabel("Возраст").props.onChangeText("32");
  app.byLabel("Назад").props.onPress();
  app.button("Сохранить и выйти").props.onPress();
  app.unmount();
  finish({ ...original, age: 32 });
  await flush();
  assert.deepEqual(app.navigations, []);
  assert.deepEqual(app.notices, []);
});
