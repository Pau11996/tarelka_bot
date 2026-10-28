const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(t) {
  const slots = [], effects = [], cleanups = [], calls = [], listeners = new Set();
  let cursor = 0, prepared = false, isRecording = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i], deps)) {
        slots[i] = deps;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); });
      }
    },
  };
  const behavior = { granted: true, durationMillis: 2400 };
  const appState = {
    currentState: "active",
    addEventListener(_, fn) { listeners.add(fn); return { remove() { listeners.delete(fn); } }; },
  };
  const recorder = {
    uri: "file:///voice.m4a",
    async prepareToRecordAsync() {
      calls.push("prepare");
      if (prepared) throw Error("Recorder already prepared");
      await behavior.prepare?.();
      prepared = true;
    },
    record() {
      calls.push("record");
      if (!prepared) throw Error("Recorder not prepared");
      if (behavior.record) behavior.record();
      else isRecording = true;
    },
    getStatus() { return { isRecording, durationMillis: behavior.durationMillis }; },
    async stop() {
      calls.push("stop");
      try { await behavior.stop?.(); }
      finally { prepared = false; isRecording = false; }
    },
  };
  const modules = {
    react,
    "react-native": { AppState: appState, Platform: { OS: "android" } },
    "expo-audio": {
      RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorder: () => recorder,
      useAudioRecorderState: () => recorder.getStatus(),
      AudioModule: {
        getRecordingPermissionsAsync: async () => ({ granted: behavior.granted }),
        async requestRecordingPermissionsAsync() {
          calls.push("permission");
          return behavior.permission ? behavior.permission() : { granted: behavior.granted };
        },
      },
      async setAudioModeAsync(mode) {
        calls.push(mode.allowsRecording ? "mode:on" : "mode:off");
        await behavior.mode?.(mode);
      },
    },
    "../api": {
      async api(url, options) {
        calls.push(url);
        return behavior.transcribe ? behavior.transcribe(options) : { transcript: "Овсянка", media_id: "voice-1" };
      },
      apiFailureMessage: async error => error.message,
    },
    "../media": { appendMedia: async () => {} },
    "../components/RequestLimitDialog": { useRequestLimit: () => ({ handleLimit: async () => false }) },
  };
  const context = {
    exports: {}, require: name => {
      if (!modules[name]) throw Error(name);
      return modules[name];
    },
    Error, Promise, AbortController, FormData,
    setTimeout: () => 1, clearTimeout() {},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/hooks/useVoiceDraft.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const unmount = () => { cleanups.splice(0).forEach(fn => fn?.()); };
  t.after(unmount);
  return {
    behavior, calls, recorder, unmount,
    render() {
      cursor = 0;
      const voice = context.exports.useVoiceDraft("token", async () => {});
      effects.splice(0).forEach(fn => fn());
      return voice;
    },
    appState(next) {
      appState.currentState = next;
      for (const fn of listeners) fn(next);
    },
  };
}

for (const transition of ["background", "inactive"]) {
  test(`permission dialog (${transition}) does not cancel the first recording`, async t => {
    const app = setup(t);
    app.behavior.granted = false;
    app.behavior.permission = async () => {
      app.appState(transition);
      app.appState("active");
      return { granted: true };
    };
    await app.render().start();
    assert.equal(app.render().recording, true);
    assert.equal(app.render().visible, true);
    assert.equal(app.render().error, null);
  });
}

test("permission can resolve before foreground resumes; microphone starts only after active", async t => {
  const app = setup(t);
  app.behavior.granted = false;
  app.behavior.permission = async () => {
    app.appState("background");
    return { granted: true };
  };
  const pending = app.render().start();
  await tick();
  assert.equal(app.calls.includes("prepare"), false);
  assert.equal(app.render().recording, false);
  app.appState("active");
  await pending;
  assert.equal(app.render().recording, true);
});

test("denied permission leaves an error and the next attempt can start", async t => {
  const app = setup(t);
  app.behavior.granted = false;
  await app.render().start();
  assert.match(app.render().error, /Разреши доступ к микрофону/);
  assert.equal(app.calls.includes("prepare"), false);
  app.behavior.granted = true;
  await app.render().start();
  assert.equal(app.render().error, null);
  assert.equal(app.render().recording, true);
});

for (const phase of ["prepare", "record"]) {
  test(`a native ${phase} failure releases the recorder and allows retry`, async t => {
    const app = setup(t);
    app.behavior[phase] = () => { throw Error("Microphone unavailable"); };
    await app.render().start();
    assert.match(app.render().error, /Microphone unavailable/);
    assert.equal(app.render().visible, false);
    assert.equal(app.render().recording, false);
    assert.equal(app.calls.at(-1), "mode:off");
    delete app.behavior[phase];
    await app.render().start();
    assert.equal(app.render().recording, true);
  });
}

test("a native start that returns without recording reports an error and can be retried", async t => {
  const app = setup(t);
  app.behavior.record = () => {};
  await app.render().start();
  assert.match(app.render().error, /Не удалось начать запись/);
  assert.equal(app.render().visible, false);
  delete app.behavior.record;
  await app.render().start();
  assert.equal(app.render().recording, true);
});

for (const phase of ["mode", "prepare"]) {
  test(`backgrounding during ${phase} cancels startup and releases audio`, async t => {
    const app = setup(t);
    const gate = deferred();
    app.behavior[phase] = () => gate.promise;
    const pending = app.render().start();
    await tick();
    app.appState("background");
    gate.resolve();
    await pending;
    assert.equal(app.calls.includes("record"), false);
    assert.equal(app.calls.at(-1), "mode:off");
    app.appState("active");
    await app.render().start();
    assert.equal(app.render().recording, true);
  });
}

test("backgrounding an active recording stops it; retry waits for native cleanup", async t => {
  const app = setup(t);
  await app.render().start();
  const gate = deferred();
  app.behavior.stop = () => gate.promise;
  app.appState("background");
  assert.equal(app.render().visible, false);
  app.appState("active");
  const pending = app.render().start();
  await tick();
  assert.equal(app.calls.filter(call => call === "prepare").length, 1);
  gate.resolve();
  await pending;
  assert.equal(app.render().recording, true);
  assert.deepEqual(app.calls.slice(-5), ["stop", "mode:off", "mode:on", "prepare", "record"]);
});

test("double tapping starts only one recording", async t => {
  const app = setup(t);
  const gate = deferred();
  app.behavior.prepare = () => gate.promise;
  const pending = app.render().start();
  await app.render().start();
  gate.resolve();
  await pending;
  assert.equal(app.calls.filter(call => call === "record").length, 1);
});

for (const action of ["cancel", "unmount"]) {
  test(`${action} while waiting for foreground prevents a delayed recording`, async t => {
    const app = setup(t);
    app.behavior.granted = false;
    app.behavior.permission = async () => {
      app.appState("background");
      return { granted: true };
    };
    const pending = app.render().start();
    await tick();
    if (action === "cancel") app.render().cancel();
    else app.unmount();
    await pending;
    app.appState("active");
    assert.equal(app.calls.includes("record"), false);
  });
}

test("unmounting during recording releases the microphone", async t => {
  const app = setup(t);
  await app.render().start();
  app.unmount();
  await tick();
  assert.equal(app.recorder.getStatus().isRecording, false);
  assert.equal(app.calls.at(-1), "mode:off");
});

test("stopping creates a voice draft and transcribes it once", async t => {
  const app = setup(t);
  await app.render().start();
  const pending = app.render().stop();
  await app.render().stop();
  await pending;
  const voice = app.render();
  assert.equal(voice.visible, true);
  assert.equal(voice.recording, false);
  assert.equal(voice.draft.media.uri, "file:///voice.m4a");
  assert.equal(voice.draft.seconds, 2.4);
  assert.equal(voice.transcript, "Овсянка");
  assert.equal(voice.mediaId, "voice-1");
  assert.equal(app.calls.filter(call => call === "/v1/voice/transcribe").length, 1);
});

test("failed stop still resets the audio mode and permits another recording", async t => {
  const app = setup(t);
  await app.render().start();
  app.behavior.stop = () => { throw Error("Stop failed"); };
  await app.render().stop();
  assert.match(app.render().error, /Не удалось сохранить запись/);
  assert.equal(app.calls.at(-1), "mode:off");
  delete app.behavior.stop;
  await app.render().start();
  assert.equal(app.render().recording, true);
});
