const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/workouts/character/morningMotion.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, scope);
const { morningFrame, morningMovements, footPoint, project, motionGuide } = scope.exports;
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
const close = (a, b, label = '') => assert.ok(Math.abs(a - b) < .00001, `${label}: ${a} != ${b}`);

test('all eight warm-up demonstrations keep bone lengths and reachable knees through the entire cycle', () => {
  for (const name of morningMovements) for (let i = 0; i <= 240; i++) {
    const f = morningFrame(name, i / 240);
    for (const side of [f.left, f.right]) {
      close(distance(side.shoulder, side.elbow), 37, `${name} upper arm`);
      close(distance(side.elbow, side.wrist), 34, `${name} forearm`);
      close(distance(side.hip, side.knee), 66, `${name} thigh`);
      close(distance(side.knee, side.ankle), 64, `${name} shin`);
      for (const key of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
        assert.ok(side[key].every(Number.isFinite));
        const [x, y] = project(side[key], f.yaw);
        assert.ok(x > 20 && x < 340 && y > 20 && y < 365, `${name} ${key} clipped`);
      }
    }
  }
});

test('marching and side steps always retain a supporting foot and never slide a planted foot', () => {
  for (const name of ['march', 'side_step']) for (let i = 0; i < 240; i++) {
    const f = morningFrame(name, i / 240), next = morningFrame(name, (i + 1) / 240);
    assert.ok(f.left.foot.lift === 0 || f.right.foot.lift === 0, name);
    for (const key of ['left', 'right']) if (f[key].foot.lift === 0 && next[key].foot.lift === 0) {
      close(f[key].foot.x, next[key].foot.x, 'planted foot x');
      close(f[key].foot.z, next[key].foot.z, 'planted foot z');
    }
  }
});

test('calf raise pivots around toes while the heels and body rise together', () => {
  const rest = morningFrame('calf_raise', 0), top = morningFrame('calf_raise', .4);
  assert.ok(top.pelvis[1] - rest.pelvis[1] > 7);
  for (let i = 0; i <= 100; i++) for (const side of Object.values(morningFrame('calf_raise', i / 100)).filter(s => s?.foot)) {
    close(footPoint(side.foot, 0, 0, 22)[1], 0, 'toe stays on the floor');
    assert.ok(footPoint(side.foot, 0, 0, -10)[1] >= 0);
  }
  assert.ok(footPoint(top.left.foot, 0, 0, -10)[1] > 12);
});

test('left and right bends follow screen direction and do not move the pelvis or feet', () => {
  const neutral = morningFrame('side_bend', 0);
  const left = morningFrame('side_bend', .5), right = morningFrame('side_bend', .5, true);
  assert.ok(left.head[0] < neutral.head[0]); assert.ok(right.head[0] > neutral.head[0]);
  close(left.head[0], -right.head[0]);
  for (const f of [left, right]) {
    close(distance(f.pelvis, neutral.pelvis), 0);
    close(distance(f.left.ankle, neutral.left.ankle), 0);
    close(distance(f.right.ankle, neutral.right.ankle), 0);
  }
  assert.match(motionGuide('side_bend', .1).label, /влево/);
  assert.match(motionGuide('side_bend', .1, true).label, /вправо/);
});

test('stretches hold their pose without bouncing and all motion loops close without a jump', () => {
  for (const name of ['side_bend', 'chest']) {
    const first = morningFrame(name, .3), held = morningFrame(name, .7);
    close(distance(first.head, held.head), 0);
    close(distance(first.left.wrist, held.left.wrist), 0);
    close(distance(first.right.wrist, held.right.wrist), 0);
  }
  for (const name of morningMovements) {
    const start = morningFrame(name, 0), end = morningFrame(name, 1 - 1e-6);
    for (const key of ['left', 'right']) for (const joint of ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist']) {
      assert.ok(distance(start[key][joint], end[key][joint]) < .001, `${name}: ${joint}`);
    }
  }
});

test('marching alternates the opposite arm, and shoulder shrugs keep the head still', () => {
  const leftStep = morningFrame('march', .225), rightStep = morningFrame('march', .725);
  assert.ok(leftStep.left.foot.lift > 20 && leftStep.right.wrist[2] > leftStep.left.wrist[2]);
  assert.ok(rightStep.right.foot.lift > 20 && rightStep.left.wrist[2] > rightStep.right.wrist[2]);
  const relaxed = morningFrame('shoulders', 0), raised = morningFrame('shoulders', .4);
  close(distance(relaxed.head, raised.head), 0);
  close(raised.left.shoulder[1] - relaxed.left.shoulder[1], 6);
});

test('side-step captions follow the foot that moves, starting right as in the catalogue', () => {
  const before = morningFrame('side_step', 0), first = morningFrame('side_step', .125);
  assert.equal(first.left.foot.lift, 0); assert.ok(first.right.foot.lift > 0);
  assert.ok(first.right.foot.x > before.right.foot.x); assert.match(first.label, /вправо/);
  const second = morningFrame('side_step', .375);
  assert.ok(second.left.foot.lift > 0); assert.equal(second.right.foot.lift, 0); assert.match(second.label, /левую/);
});

test('arms rise together, chest opening stays below shoulders, and cues change at holds', () => {
  for (let i = 0; i < 120; i++) {
    const arms = morningFrame('arm_raise', i / 120);
    close(arms.left.wrist[1], arms.right.wrist[1]); close(arms.left.wrist[0], -arms.right.wrist[0]);
    const chest = morningFrame('chest', i / 120);
    assert.ok(chest.left.wrist[1] < chest.left.shoulder[1]); assert.ok(chest.right.wrist[1] < chest.right.shoulder[1]);
  }
  assert.match(morningFrame('calf_raise', .4).label, /Удержите/);
  assert.match(morningFrame('calf_raise', .7).label, /опустите/);
});
