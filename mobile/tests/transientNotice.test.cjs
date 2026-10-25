const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");
const { test } = require("node:test");

function setup() {
  const slots = [], cleanups = [], timers = new Map();
  let cursor = 0, now = 0, nextId = 0, updates = 0;
  const context = { exports: {},
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      assert.equal(name, "react");
      return {
        useCallback: callback => callback,
        useState(initial) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = initial;
          return [slots[index], value => { slots[index] = value; updates++; }];
        },
        useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
        useEffect(effect) { const index = cursor++; if (!(index in slots)) { slots[index] = true; cleanups.push(effect()); } },
      };
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/hooks/useTransientNotice.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return {
    render() { cursor = 0; return context.exports.useTransientNotice(); },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
    pending: () => timers.size,
    updates: () => updates,
  };
}

test("a confirmation disappears after 2.5 seconds without user action", () => {
  const app = setup();
  app.render().show("Добавлено на сегодня");
  app.advance(2499);
  assert.equal(app.render().message, "Добавлено на сегодня");
  app.advance(1);
  assert.equal(app.render().message, null);
  assert.equal(app.pending(), 0);
});

test("another addition restarts the timeout, including an identical confirmation", () => {
  const app = setup();
  app.render().show("Добавлено на сегодня");
  app.advance(2000);
  app.render().show("Добавлено на сегодня");
  assert.equal(app.pending(), 1);
  app.advance(500);
  assert.equal(app.render().message, "Добавлено на сегодня");
  app.advance(2000);
  assert.equal(app.render().message, null);
});

test("clearing or leaving the screen cancels pending dismissals", () => {
  const app = setup();
  app.render().show("Добавлено на сегодня");
  app.render().clear();
  assert.equal(app.render().message, null);
  assert.equal(app.pending(), 0);
  app.render().show("Добавлено на сегодня");
  const updates = app.updates();
  app.unmount();
  app.advance(3000);
  assert.equal(app.pending(), 0);
  assert.equal(app.updates(), updates);
});
