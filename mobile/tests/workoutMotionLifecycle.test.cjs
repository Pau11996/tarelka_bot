const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const transpile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/workouts/character', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

// Run the actual hook with deterministic lifecycle events and animation frames.
async function mount(playing = true, reduced = false, timing) {
  const slots = [], effects = [], queued = new Map(), listeners = new Map();
  let cursor = 0, dirty = true, serial = 0, value, props = ['arm_raise', 'arms-1', playing, timing];
  const React = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { if (v !== slots[i]) { slots[i] = v; dirty = true; } }]; },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || deps.some((d, n) => d !== old.deps[n])) {
        old?.cleanup?.(); const slot = slots[i] = { deps }; effects.push(() => { slot.cleanup = fn(); });
      }
    },
  };
  const subscribe = (name, fn) => { listeners.set(name, fn); return { remove: () => listeners.delete(name) }; };
  const rn = { AppState: { currentState: 'active', addEventListener: subscribe }, AccessibilityInfo: { isReduceMotionEnabled: async () => reduced, addEventListener: subscribe } };
  const motion = { exports: {} }; vm.runInNewContext(transpile('morningMotion.ts'), motion);
  const scope = { exports: {}, require: name => name === 'react' ? React : name === 'react-native' ? rn : motion.exports,
    requestAnimationFrame: fn => { queued.set(++serial, fn); return serial; }, cancelAnimationFrame: id => queued.delete(id) };
  vm.runInNewContext(transpile('useExerciseMotion.ts'), scope);
  function render() {
    for (let n = 0; dirty && n < 10; n++) {
      dirty = false; cursor = 0; value = scope.exports.useExerciseMotion(...props);
      while (effects.length) effects.shift()();
    }
    assert.equal(dirty, false, 'hook did not settle');
  }
  render(); await Promise.resolve(); render();
  return {
    get value() { return value; }, get frames() { return queued.size; },
    frame(now) { const batch = [...queued.values()]; queued.clear(); batch.forEach(fn => fn(now)); render(); },
    update(patch) { props = props.map((v, i) => patch[i] ?? v); dirty = true; render(); },
    event(name, arg) { listeners.get(name)?.(arg); render(); },
    unmount() { for (const s of slots) s?.cleanup?.(); },
    get listeners() { return listeners.size; },
  };
}

test('pause/background freeze the current pose and resume without counting hidden time', async () => {
  const h = await mount(); h.frame(100); h.frame(150); h.frame(200);
  const before = h.value.cycle; assert.ok(before > 0);
  h.update({ 2: false }); assert.equal(h.frames, 0); h.frame(10000); assert.equal(h.value.cycle, before);
  h.update({ 2: true }); h.frame(10100); assert.equal(h.value.cycle, before);
  h.frame(10150); assert.ok(h.value.cycle > before);
  const resumed = h.value.cycle;
  h.event('change', 'background'); assert.equal(h.frames, 0); h.frame(50000); assert.equal(h.value.cycle, resumed);
  h.event('change', 'active'); h.frame(50100); assert.equal(h.value.cycle, resumed);
  h.frame(50150); assert.ok(h.value.cycle > resumed);
  h.unmount(); assert.equal(h.frames, 0); assert.equal(h.listeners, 0);
});

test('new exercise starts at its own beginning and a delayed frame cannot jump a whole repetition', async () => {
  const h = await mount(); h.frame(100); h.frame(150);
  const before = h.value.cycle; h.frame(10000); assert.ok(h.value.cycle - before <= .011);
  h.update({ 0: 'side_bend', 1: 'bend-right' }); assert.equal(h.value.cycle, 0);
  h.frame(10100); h.frame(10150); assert.ok(h.value.cycle > 0 && h.value.cycle < .01); h.unmount();
});

test('reduced motion and static previews do not schedule animations', async () => {
  const h = await mount(true, true); assert.equal(h.frames, 0); assert.equal(h.value.reduced, true); assert.equal(h.value.cycle, .43);
  h.event('reduceMotionChanged', false); assert.equal(h.frames, 1);
  h.event('reduceMotionChanged', true); assert.equal(h.frames, 0); h.unmount();
  const card = await mount(false); assert.equal(card.frames, 0); assert.equal(card.value.cycle, .43); card.unmount();
});

test('a recorded four-second cycle uses its timing and freezes on the exact current sample', async () => {
  const h = await mount(true, false, { duration: 4, preview: .25 });
  h.update({ 0: 'standing_knee_elbow', 1: 'knees-1' });
  h.frame(100);
  for (let t = 150; t <= 1100; t += 50) h.frame(t);
  assert.equal(h.value.cycle, .25);
  h.update({ 2: false }); h.frame(3000); assert.equal(h.value.cycle, .25);
  h.update({ 2: true }); h.frame(4000); assert.equal(h.value.cycle, .25);
  h.frame(4050); assert.equal(h.value.cycle, .2625);
  h.event('reduceMotionChanged', true);
  assert.equal(h.value.cycle, .25); assert.equal(h.frames, 0);
  h.unmount();
});

test('both push-ups pause in place and use a still bottom pose with reduced motion', async () => {
  for (const movement of ['push_up', 'knee_push_up']) {
    const h = await mount(true, false, { duration: 4, preview: .5 });
    h.update({ 0: movement, 1: movement }); h.frame(100); h.frame(150);
    const before = h.value.cycle;
    h.update({ 2: false }); h.frame(10000); assert.equal(h.value.cycle, before);
    h.update({ 2: true }); h.frame(11000); assert.equal(h.value.cycle, before);
    h.event('reduceMotionChanged', true);
    assert.equal(h.value.cycle, .5); assert.equal(h.frames, 0); h.unmount();
  }
});
