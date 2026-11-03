const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ts = require("typescript"), assert = require("node:assert/strict"), { test } = require("node:test");

function load({ platform = "android", native } = {}) {
  const calls = [];
  const scope = { exports: {}, require(name) {
    if (name === "react-native") return { Platform: { OS: platform } };
    if (name === "expo-modules-core") return { requireOptionalNativeModule: () => native ?? null };
    if (name === "./api") return { api: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith("/start") ? { challenge_id: "challenge", nonce: "one-use-nonce", web_client_id: "server-client-id" }
        : { access_token: "session" };
    } };
    throw Error(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/googleSignIn.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  return { ...scope.exports, calls };
}

test("the server nonce and client id reach Google; only its ID token is submitted to the API", async () => {
  const nativeCalls = [];
  const app = load({ native: { async signIn(...args) { nativeCalls.push(args); return "google-id-token"; } } });
  const pending = await app.startGoogleSignIn();
  assert.deepEqual(nativeCalls, [["server-client-id", "one-use-nonce"]]);
  await app.finishGoogleSignIn(pending);
  assert.equal(app.calls[1].url, "/v1/auth/google/login");
  assert.equal(app.calls[1].options.json.id_token, "google-id-token");
  assert.equal(app.calls[1].options.json.challenge_id, "challenge");
  assert.equal("password" in app.calls[1].options.json, false);
  assert.equal("email" in app.calls[1].options.json, false);
});

test("native cancellation returns no token and missing native code fails before calling the server", async () => {
  const app = load({ native: { signIn: async () => null } });
  assert.equal(await app.startGoogleSignIn(), null);
  for (const platform of ["android", "web", "ios"]) {
    const missing = load({ platform });
    await assert.rejects(() => missing.startGoogleSignIn(), /обновите приложение/);
    assert.equal(missing.calls.length, 0);
  }
});

test("logout clears the credential provider session", async () => {
  let cleared = 0;
  const app = load({ native: { signOut: async () => { cleared++; } } });
  await app.clearGoogleSignIn();
  assert.equal(cleared, 1);
  await load({ platform: "web" }).clearGoogleSignIn();
});
