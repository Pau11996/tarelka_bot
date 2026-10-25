const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { test } = require("node:test");
const assert = require("node:assert/strict");

function auth(platform) {
  const slots = [], effects = [], sessions = [];
  let cursor = 0, stored = "restored-token";
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/auth.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const element = (type, props) => ({ type, props });
  const storage = {
    getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; },
    getItemAsync: async () => stored, setItemAsync: async (_key, value) => { stored = value; }, deleteItemAsync: async () => { stored = null; },
  };
  const context = { exports: {}, sessionStorage: storage, require(name) {
    if (name === "react") return {
      createContext: () => ({ Provider: "AuthProvider" }), useContext: () => null,
      useEffect: (effect) => effects.push(effect), useMemo: (create) => create(),
      useState: (initial) => {
        const slot = cursor++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (value) => { slots[slot] = value; }];
      },
    };
    if (name === "react/jsx-runtime") return { jsx: element };
    if (name === "react-native") return { Platform: { OS: platform } };
    if (name === "expo-secure-store") return storage;
    if (name === "@react-native-async-storage/async-storage") return { removeItem: async () => {} };
    if (name === "./config") return { API_URL: "https://api.example" };
    if (name === "./authStorage") return { authStorageKeys: () => ({ token: "token-key" }) };
    if (name === "./privateImage") return { setPrivateImageSession: async (token) => sessions.push(token) };
    if (name === "./health/service") return { pauseHealthSync: async () => {} };
    if (name === "./notifications") return { unregisterPush: async () => {} };
    throw new Error(name);
  }};
  vm.runInNewContext(code, context);
  const render = () => { cursor = 0; return context.exports.AuthProvider({ children: null }).props.value; };
  return { render, effects, sessions, stored: () => stored };
}

for (const platform of ["android", "web"]) {
  test(`${platform}: auth restores the photo cache session, switches it on login and clears it on logout`, async () => {
    const app = auth(platform);
    assert.equal(app.render().ready, false);
    const cleanup = app.effects[0]();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(app.render().ready, true);
    assert.equal(app.render().token, "restored-token");
    assert.deepEqual(app.sessions, ["restored-token"]);
    await app.render().signIn("new-token");
    assert.equal(app.render().token, "new-token");
    assert.equal(app.stored(), "new-token");
    assert.deepEqual(app.sessions, ["restored-token", "new-token"]);
    await app.render().signOut();
    assert.equal(app.render().token, null);
    assert.equal(app.stored(), null);
    assert.deepEqual(app.sessions, ["restored-token", "new-token", null]);
    cleanup();
  });
}
