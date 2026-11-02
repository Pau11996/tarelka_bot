const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { test } = require('node:test'), assert = require('node:assert/strict');
const ts = require('typescript');
const flush = () => new Promise(setImmediate);

function load(file, modules = {}) {
  const filename = path.resolve(__dirname, '../src/billing', file);
  const scope = { exports: {}, require(name) {
    if (name in modules) return modules[name];
    if (name === './availability') return load('availability.ts');
    throw Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, scope);
  return scope.exports;
}

test('Play country controls the Russian notice; unsupported or failed queries never assume a region', async () => {
  let country = 'RU', calls = 0, available = true, failure = false, expoGo = false;
  const platform = { OS: 'android' };
  const modules = {
    expo: { isRunningInExpoGo: () => expoGo, requireOptionalNativeModule() {
      if (!available) return null;
      return { async getCountryCode() { calls++; if (failure) throw Error('offline'); return country; } };
    } },
    'react-native': { Platform: platform },
  };
  const { checkBillingAvailability: check } = load('native.ts', modules);
  assert.equal(await check(), 'russia_unavailable');
  for (country of ['BY', 'KZ', 'DE', 'US']) assert.equal(await check(), 'google_play_setup');
  for (country of [null, '', 'ru', 'Europe/Moscow', 'RUS', 123]) assert.equal(await check(), 'unavailable');
  failure = true; assert.equal(await check(), 'unavailable');
  available = false; assert.equal(await check(), 'unsupported');
  available = true; const previous = calls;
  expoGo = true; assert.equal(await check(), 'unsupported');
  expoGo = false; platform.OS = 'web'; assert.equal(await check(), 'unsupported');
  assert.equal(calls, previous);
});

function screenHarness() {
  const hooks = [], requests = [];
  let cursor = 0, focus, appState, removed = false;
  const element = (type, props) => ({ type, props });
  const { SubscriptionAvailability } = load('SubscriptionAvailability.tsx', {
    react: {
      useCallback: fn => fn,
      useRef(initial) { const i = cursor++; return hooks[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => hooks[i] = value]; },
    },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Text: 'Text', ActivityIndicator: 'Spinner', AppState: {
      addEventListener(_, fn) { appState = fn; return { remove() { removed = true; } }; },
    } },
    'expo-router': { useFocusEffect(fn) { focus = fn; } },
    '../components/Screen': { Panel: 'Panel', design: {} },
    '../ui': { SecondaryButton: 'Button' }, '../theme': { colors: {} },
    './native': { checkBillingAvailability: () => new Promise(resolve => requests.push(resolve)) },
  });
  const render = () => { cursor = 0; return SubscriptionAvailability(); };
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  render();
  return { requests, render, nodes, mount: () => focus(), background: () => appState('background'), foreground: () => appState('active'),
    title: () => nodes(render()).find(n => n.props?.accessibilityRole === 'header').props.children,
    get removed() { return removed; },
  };
}

test('returning from background rechecks Play and ignores the old country response', async () => {
  const h = screenHarness(), unmount = h.mount();
  h.background(); h.foreground();
  h.requests[1]('russia_unavailable'); await flush();
  assert.equal(h.title(), 'Подписка пока недоступна в России');
  h.requests[0]('google_play_setup'); await flush();
  assert.equal(h.title(), 'Подписка пока недоступна в России');
  h.background(); assert.equal(h.title(), 'Проверяем доступность подписки…');
  h.foreground(); h.requests[2]('google_play_setup'); await flush();
  assert.equal(h.title(), 'Оплата через Google Play скоро появится');
  unmount(); assert.equal(h.removed, true);
});

test('failed availability has a retry action and an unmounted request cannot update the screen', async () => {
  const h = screenHarness(), unmount = h.mount();
  h.requests[0]('unavailable'); await flush();
  const retry = h.nodes(h.render()).find(n => n.type === 'Button');
  assert.equal(retry.props.label, 'Повторить проверку'); retry.props.onPress();
  assert.equal(h.title(), 'Проверяем доступность подписки…');
  unmount(); h.requests[1]('russia_unavailable'); await flush();
  assert.equal(h.title(), 'Проверяем доступность подписки…');
});
