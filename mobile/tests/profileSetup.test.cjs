const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function moduleFrom(file, modules = {}) {
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}

function setup() {
  const values = new Map(), requests = [];
  const config = { API_URL: "https://preview.example.com" };
  let user = { id: 1, profile_complete: false };
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const modules = {
    "@react-native-async-storage/async-storage": { __esModule: true, default: storage },
    "./api": { api: async (url, options) => { requests.push({ url, options }); return user; } },
    "./authStorage": moduleFrom("authStorage.ts"), "./config": config,
  };
  return {
    ...moduleFrom("profileSetup.ts", modules), config, values, requests,
    user: next => { user = next; },
  };
}

test("a new incomplete profile opens setup and a complete profile enters the diary", async () => {
  const app = setup();
  assert.equal(await app.profileSetupDestination("first-token"), 1);
  assert.equal(app.requests[0].url, "/v1/me");
  assert.equal(app.requests[0].options.token, "first-token");
  app.user({ id: 1, profile_complete: true });
  assert.equal(await app.profileSetupDestination("first-token"), null);
});

test("skip survives a new session and is isolated by account and API", async () => {
  const app = setup();
  await app.dismissProfileSetup(1);
  assert.equal(await app.profileSetupDestination("new-token"), null);
  app.user({ id: 2, profile_complete: false });
  assert.equal(await app.profileSetupDestination("other-account"), 2);
  app.user({ id: 1, profile_complete: false });
  app.config.API_URL = "https://production.example.com";
  assert.equal(await app.profileSetupDestination("another-api"), 1);
});
