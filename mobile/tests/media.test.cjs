const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { test } = require('node:test');
const assert = require('node:assert/strict');
function compile(file, requireMock) {
  const context = { exports: {}, require: requireMock, Blob, Uint8Array, TextEncoder, Math };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const serializer = compile(path.join(__dirname, '../node_modules/expo/src/winter/fetch/convertFormData.ts'), () => ({
  blobToArrayBufferAsync: blob => blob.arrayBuffer(),
}));
function setup(exists = true) {
  const media = compile(path.join(__dirname, '../src/media.ts'), name => {
    if (name === 'react-native') return { Platform: { OS: 'android' } };
    if (name === 'expo-file-system') return { File: class {
      constructor(uri) { this.uri = uri; this.exists = exists; this.name = uri.split('/').pop(); this.type = this.name.endsWith('.m4a') ? 'audio/mp4' : 'image/jpeg'; }
      async bytes() { return new Uint8Array([1, 2, 3]); }
    }};
    throw new Error(name);
  });
  const parts = [];
  const form = { append: (...args) => parts.push(args), entries: () => parts };
  return { media, form, parts };
}
for (const [field, name] of [['image', 'photo.jpg'], ['audio', 'voice.m4a']]) {
  test(`${field}: native file passes actual Expo multipart serializer`, async () => {
    const { media, form } = setup();
    form.append('request_key', 'stable-request');
    await media.appendMedia(form, field, { uri: `file:///cache/${name}`, name, type: '' });
    const { body } = await serializer.convertFormDataAsync(form, 'test-boundary');
    const text = new TextDecoder().decode(body);
    assert.ok(text.includes(`name="${field}"; filename="${name}"`));
    assert.ok(text.includes('stable-request'));
    assert.ok(text.includes('\x01\x02\x03'));
  });
}
test('unavailable native file gives actionable error before fetch', async () => {
  const { media, form, parts } = setup(false);
  await assert.rejects(media.appendMedia(form, 'image', { uri: 'file:///gone.jpg' }), /Файл больше недоступен/);
  assert.equal(parts.length, 0);
});
