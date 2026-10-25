const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/notifications.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
function load(os, expoGo) {
  let imports = 0, handlers = 0;
  const native = { setNotificationHandler: () => handlers++ };
  const context = { exports: {}, require(name) {
    if (name === 'expo') return { isRunningInExpoGo: () => expoGo };
    if (name === 'react-native') return { Platform: { OS: os } };
    if (name === 'expo-device') return { isDevice: true };
    if (name === 'expo-constants') return { default: {} };
    if (name === '@react-native-async-storage/async-storage') return { default: {} };
    if (name === './api' || name === './chartMath') return {};
    if (name === 'expo-notifications') {
      imports++;
      if (expoGo || os === 'web') throw new Error('Native push module unavailable');
      return native;
    }
    throw new Error(name);
  }};
  vm.runInNewContext(code, context);
  return { api: context.exports, imports: () => imports, handlers: () => handlers };
}
for (const os of ['android', 'ios', 'web']) {
  test(`${os}: Expo Go never loads native push module`, async () => {
    const m = load(os, true);
    assert.equal(m.api.getNotifications(), null);
    await assert.rejects(m.api.registerPush('token'), /Expo Go/);
    assert.equal(m.imports(), 0);
  });
}
test('native development build initializes notifications', () => {
  const m = load('android', false);
  assert.equal(m.imports(), 1);
  assert.equal(m.handlers(), 1);
});
