const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "../src/authStorage.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { authStorageKeys } = context.exports;

test("sessions and pending Telegram logins stay with their API", () => {
  const endpoints = [
    "http://192.168.100.178:8012",
    "http://192.168.100.178:8001",
    "http://127.0.0.1:8001",
    "https://192.168.100.178:8001",
    "https://api.example.com/mobile",
    "https://api.example.com/other",
  ];
  const keys = endpoints.flatMap((endpoint) => Object.values(authStorageKeys(endpoint)));
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.match(key, /^[a-zA-Z0-9._-]+$/);
});

test("a trailing slash does not sign the user out", () => {
  assert.deepEqual(
    authStorageKeys("https://api.example.com/"),
    authStorageKeys("https://api.example.com"),
  );
});

test("escaped URL characters do not collide with literal underscores", () => {
  assert.notEqual(
    authStorageKeys("https://api.example.com/a/b").token,
    authStorageKeys("https://api.example.com/a_2f_b").token,
  );
});
