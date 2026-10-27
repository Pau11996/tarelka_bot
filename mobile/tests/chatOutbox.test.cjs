const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const tick = () => new Promise(resolve => setImmediate(resolve));
function moduleCode(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function app() {
  const slots = [], pendingEffects = [], cleanups = [], submissions = [], pickResults = [], loops = [];
  const outbox = { ready: true, error: null, items: [], anchors: {} };
  let cursor = 0, key = 0, tree;
  let history = { entries: [], operations: [], media: [], next_before: null, notices: [] };
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(effect, deps) { const i = cursor++; if (!same(slots[i], deps)) { slots[i] = deps; pendingEffects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); }); } },
  };
  const voice = { visible: false, recording: false, transcribing: false, transcript: "", mediaId: null, draft: null,
    cancel() { this.visible = false; this.transcript = ""; this.mediaId = null; this.draft = null; },
    start() {}, stop() {}, retry() {}, setTranscript(value) { voice.transcript = value; } };
  voice.cancel = voice.cancel.bind(voice);
  const auth = { token: "token", signOut: async () => {} };
  const element = (type, props) => ({ type, props });
  const timeline = { exports: {} }; vm.runInNewContext(moduleCode("chatTimeline.ts"), timeline);
  const components = new Proxy({}, { get: (_obj, name) => name });
  const context = { exports: {}, setTimeout: () => 1, clearTimeout: () => {}, AbortController, require(name) {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: "Fragment" };
    if (name === "expo-router") return { router: { push() {} }, useFocusEffect: fn => hooks.useEffect(fn, [fn]) };
    if (name === "react-native") return { ...Object.fromEntries(["ActivityIndicator", "FlatList", "Image", "KeyboardAvoidingView", "Pressable", "RefreshControl", "ScrollView", "Text", "TextInput", "View"].map(name => [name, name])),
      Platform: { OS: "web" }, StyleSheet: { create: value => value }, Keyboard: { dismiss() {} }, AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } };
    if (name === "react-native-safe-area-context") return { SafeAreaView: "SafeAreaView" };
    if (name === "expo-image-picker") return { launchImageLibraryAsync: async () => ({ canceled: false, assets: pickResults.shift() }) };
    if (name === "expo-audio") return {};
    if (name === "@react-native-async-storage/async-storage") return { getItem: async () => null, setItem: async () => {} };
    if (name.endsWith("/auth")) return { useAuth: () => auth };
    if (name.endsWith("/api")) return { api: async url => url === "/v1/chat" ? history : null, apiFailureMessage: async () => "error", ApiError: Error };
    if (name.endsWith("/config")) return { API_URL: "https://example.test" };
    if (name.endsWith("/operations")) return { requestKey: () => `key-${++key}` };
    if (name.endsWith("/chatTimeline")) return timeline.exports;
    if (name.endsWith("/outbox/session")) return {
      useChatOutbox: () => outbox,
      enqueueMessage: message => { submissions.push(message); outbox.items = [...outbox.items, { ...message, state: "uploading" }]; outbox.anchors[message.requestKey] = message.createdAt; },
      reconcileOutbox: operations => { outbox.items = outbox.items.filter(item => !operations.some(op => op.request_key === item.requestKey && op.status === "done")); },
      reopenOutbox() {}, retryMessage() {}, observeOutbox() {},
    };
    if (name.endsWith("/outbox/history")) return { recoverOutboxHistory: async chat => ({ chat, observed: [], recovered: false }) };
    if (name.endsWith("/outbox/poller")) return { ChatPoller: class {
      constructor(refresh) { this.refresh = refresh; loops.push(this); }
      setActive(value) { this.active = value; if (value) void this.refresh(); }
      wake() { if (this.active) void this.refresh(); }
    } };
    if (name.endsWith("/hooks/useVoiceDraft")) return { useVoiceDraft: () => voice };
    if (name.endsWith("/hooks/useOperationLimitNotice")) return { useOperationLimitNotice: () => () => {}, operationLimitKind: () => "photo" };
    if (name.endsWith("/components/AssistantAccess")) return { useAssistantHidden() {} };
    if (name.endsWith("/components/RequestLimitDialog")) return { useRequestLimit: () => ({ handleLimit: async () => false, openLimit() {} }) };
    if (name.includes("/components/")) return components;
    if (name.endsWith("/requestLimits")) return { isLegacyLimitMessage: () => false };
    if (name.endsWith("/theme")) return { colors: {} };
    if (name.endsWith("/health/events")) return { healthUpdated() {} };
    throw Error(name);
  }};
  vm.runInNewContext(moduleCode("app/(tabs)/chat.tsx"), context);
  function render() { cursor = 0; tree = context.exports.default(); pendingEffects.splice(0).forEach(fn => fn()); return tree; }
  function nodes(node = tree) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children ?? null)];
  }
  const find = (type, label) => nodes().find(node => node.type === type && (!label || node.props.label === label));
  const input = () => find("TextInput");
  const send = () => find("IconButton", "Отправить фото") ?? find("IconButton", "Отправить сообщение") ?? find("IconButton", "Сохранить исправление");
  return { render, nodes, find, input, send, submissions, outbox, voice,
    rows: () => find("FlatList").props.data,
    async pick(names) { pickResults.push(names.map(name => ({ uri: `file:///${name}.jpg`, fileName: `${name}.jpg`, mimeType: "image/jpeg" }))); await find("IconButton", "Выбрать фото из галереи").props.onPress(); await tick(); render(); },
    async refresh(next) { history = next; await loops.at(-1).refresh(); render(); },
    dispose() { cleanups.forEach(fn => fn?.()); },
  };
}
const historyFor = submission => ({ entries: [{ id: 1, entry_date: "2026-10-27", created_at: "2026-10-27T13:00:00Z", title: "Food" }],
  operations: [{ id: "op-1", request_key: submission.requestKey, kind: "analyze", status: "done", entry_id: 1, created_at: submission.createdAt, text: submission.text, result: { status: "saved" } }], media: [], notices: [], next_before: null });
test("chat accepts three consecutive sends during upload; grouped photos remain one job and double tap is ignored", async t => {
  const screen = app(); t.after(() => screen.dispose()); screen.render(); await tick(); screen.render();
  for (const names of [["a", "b"], ["c"], ["d"]]) {
    await screen.pick(names);
    assert.notEqual(screen.input().props.editable, false);
    const button = screen.send(); assert.notEqual(button.props.disabled, true);
    button.props.onPress(); button.props.onPress(); screen.render();
    assert.equal(screen.input().props.value, "");
    assert.notEqual(screen.find("IconButton", "Выбрать фото из галереи").props.disabled, true);
  }
  assert.equal(screen.submissions.length, 3);
  assert.deepEqual(screen.submissions.map(row => Array.from(row.photos, p => p.name)), [["a.jpg", "b.jpg"], ["c.jpg"], ["d.jpg"]]);
  assert.equal(screen.rows().length, 3);
});
test("a completed result preserves the next text, selected photos and voice draft", async t => {
  const screen = app(); t.after(() => screen.dispose()); screen.render(); await tick(); screen.render();
  screen.input().props.onChangeText("first"); screen.render(); screen.send().props.onPress(); screen.render();
  screen.input().props.onChangeText("new unsent draft"); screen.render(); await screen.pick(["new-photo"]);
  await screen.refresh(historyFor(screen.submissions[0]));
  assert.equal(screen.input().props.value, "new unsent draft");
  assert.equal(screen.nodes().find(node => node.type === "Image").props.source.uri, "file:///new-photo.jpg");
  screen.voice.visible = true; screen.voice.transcript = "new voice"; screen.voice.mediaId = "voice-new";
  screen.voice.draft = { media: { uri: "file:///voice-new.m4a" }, seconds: 9 }; screen.render();
  await screen.refresh(historyFor(screen.submissions[0]));
  const sheet = screen.find("VoiceSheet"); assert.equal(sheet.props.transcript, "new voice");
  assert.equal(sheet.props.draft.media.uri, "file:///voice-new.m4a");
});
test("a queued correction disables only its entry; the composer and another entry stay available", async t => {
  const screen = app(); t.after(() => screen.dispose()); screen.render(); await tick(); screen.render();
  const history = historyFor({ requestKey: "old", createdAt: "2026-10-27T12:00:00Z", text: "food" });
  history.entries.push({ ...history.entries[0], id: 2 }); await screen.refresh(history);
  const cards = () => screen.rows().filter(row => row.kind === "entry").map(row => {
    const list = screen.find("FlatList"); const tree = list.props.renderItem({ item: row, index: screen.rows().indexOf(row) });
    return screen.nodes(tree).find(node => node.type === "EntryCard");
  });
  cards().find(card => card.props.entry.id === 1).props.onCorrect(); screen.render();
  screen.input().props.onChangeText("half the portion"); screen.render(); screen.send().props.onPress(); screen.render();
  assert.equal(cards().find(card => card.props.entry.id === 1).props.disabled, true);
  assert.equal(cards().find(card => card.props.entry.id === 2).props.disabled, false);
  screen.input().props.onChangeText("another meal"); screen.render(); screen.send().props.onPress(); screen.render();
  assert.equal(screen.submissions.length, 2);
  assert.equal(screen.submissions[0].entryId, 1); assert.equal(screen.submissions[1].entryId, undefined);
});
