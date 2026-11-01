const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/squatKickContours.json');
const frame = sample => fullBodyFrame('squat_kick', sample / 105);
function outline(sample) {
  const n = data.poses[frame(sample).pose][0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => n.slice(i * 2, i * 2 + 2));
}

test('squat/kick retains both distinct leg actions and a complete return between kicks', () => {
  assert.equal(fullBodyTiming.squat_kick.duration, 3.5);
  assert.notEqual(frame(21).pose, frame(74).pose);
  assert.notEqual(data.poses[frame(21).pose][2], data.poses[frame(74).pose][2], 'near/far thigh overlap must change');
  for (const sample of [21, 74]) {
    const p = outline(sample);
    assert.ok(Math.max(...p.map(p => p[0])) > 215, 'leg must visibly extend');
    assert.ok(Math.min(...p.map(p => p[1])) < 45, 'torso must rise before the kick');
  }
  for (const sample of [0, 54]) {
    const p = outline(sample);
    assert.ok(Math.min(...p.map(p => p[1])) > 100, 'missing squat');
    assert.ok(Math.max(...p.map(p => p[0])) < 140, 'leg did not return before squatting');
  }
  for (const sample of [36, 88]) assert.ok(Math.max(...outline(sample).map(p => p[0])) < 150, 'foot did not return after kicking');
});

test('supporting foot stays grounded and the cycle joins on the same held squat', () => {
  assert.equal(render('squat_kick', 0), render('squat_kick', 104 / 105));
  assert.equal(frame(0).pose, frame(105).pose);
  assert.equal(frame(0).pose, frame(5).pose);
  for (let sample = 0; sample < 105; sample++) {
    const foot = outline(sample).filter(([x, y]) => x < 140 && y > 315);
    assert.ok(foot.length > 3, `lost support at ${sample}`);
    assert.ok(Math.abs(Math.max(...foot.map(p => p[1])) - 331.5) <= 1, `foot lifts at ${sample}`);
    assert.ok(Math.abs(Math.min(...foot.map(p => p[0])) - 72.5) <= 2, `support slides at ${sample}`);
  }
});

test('all native frames stay inside the canvas, keep the green vest and require no remote images', () => {
  for (let i = 0; i < 105; i++) {
    const svg = render('squat_kick', i / 105);
    for (const [x, y] of outline(i)) assert.ok(x > 0 && x < 250 && y > 0 && y < 342);
    assert.match(svg, /fill="#589565"/);
    assert.doesNotMatch(svg, /NaN|undefined|<image|<video|https?:\/\//);
  }
  assert.match(render('squat_kick', .2, true), /scale\(-1 1\)/);
});
