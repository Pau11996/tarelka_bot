const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/sumoSquatContours.json');
const count = data.timeline.length;
const frame = sample => fullBodyFrame('sumo_squat', sample / count);
function outline(sample) {
  const n = data.poses[frame(sample).pose][0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => n.slice(i * 2, i * 2 + 2));
}
const top = sample => Math.min(...outline(sample).map(p => p[1]));

test('wide squat retains the recorded depth, descent, bottom hold and ascent', () => {
  assert.equal(fullBodyTiming.sumo_squat.duration, 91 / 30);
  assert.ok(top(57) - top(0) > 37 && top(57) - top(0) < 41, 'squat depth changed');
  for (let i = 30; i <= 43; i++) assert.ok(top(i) >= top(i - 1) - .5, `descent reverses at ${i}`);
  for (let i = 74; i <= 88; i++) assert.ok(top(i) <= top(i - 1) + .5, `ascent reverses at ${i}`);
  for (let i = 43; i < 74; i++) assert.equal(frame(i).pose, frame(57).pose, 'bottom hold shimmers');
  assert.deepEqual([0, 36, 57, 80].map(i => frame(i).phase), [0, 1, 2, 3]);
});

test('both feet stay planted and the loop joins in the same standing pose', () => {
  assert.equal(render('sumo_squat', 0), render('sumo_squat', 90 / count));
  assert.equal(frame(0).pose, frame(count).pose);
  assert.equal(frame(0).pose, frame(28).pose);
  for (let sample = 0; sample < count; sample++) {
    const feet = [outline(sample).filter(([x, y]) => x < 70 && y > 278),
      outline(sample).filter(([x, y]) => x > 150 && y > 278)];
    feet.forEach((foot, side) => {
      assert.ok(foot.length > 3, `missing foot ${side} at ${sample}`);
      assert.ok(Math.abs(Math.max(...foot.map(p => p[1])) - 292.5) < 1, `foot lifts at ${sample}`);
      assert.ok(Math.abs(Math.min(...foot.map(p => p[0])) - [26.7, 158.7][side]) < 1, `foot slides at ${sample}`);
    });
  }
});

test('native squat frames fit the canvas, keep the green vest and work without external media', () => {
  for (let i = 0; i < count; i++) {
    for (const [x, y] of outline(i)) assert.ok(x > 0 && x < 220 && y > 0 && y < 310);
    const svg = render('sumo_squat', i / count);
    assert.match(svg, /fill="#589565"/);
    assert.doesNotMatch(svg, /NaN|undefined|<image|<video|https?:\/\//);
  }
  assert.match(render('sumo_squat', .6, true), /scale\(-1 1\)/);
});
