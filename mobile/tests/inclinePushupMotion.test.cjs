const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/inclinePushupContours.json');
const frame = t => fullBodyFrame('incline_pushup', t);
function points(path) {
  const n = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => n.slice(i * 2, i * 2 + 2));
}
const outline = t => points(data.poses[frame(t).pose][0]);

test('incline push-up preserves the recorded two-second cycle and stationary holds', () => {
  assert.equal(fullBodyTiming.incline_pushup.duration, 2);
  assert.equal(frame(0).pose, frame(.15).pose);
  assert.equal(frame(.5).pose, frame(.64).pose);
  assert.notEqual(frame(0).pose, frame(.5).pose);
  assert.equal(render('incline_pushup', 0), render('incline_pushup', 59 / 60));
  assert.equal(frame(0).pose, frame(1).pose);
  const headTop = t => Math.min(...points(data.poses[frame(t).pose][4]).filter(([x]) => x > 180).map(([, y]) => y));
  assert.ok(headTop(.5) - headTop(0) > 50, 'the upper body must visibly lower towards the support');
});

test('both palms stay on the support and the toes stay on the ground throughout a repetition', () => {
  for (let i = 0; i < 60; i++) {
    const p = outline(i / 60);
    const foot = p.filter(([x, y]) => x < 70 && y > 232);
    const nearHand = p.filter(([x, y]) => x > 260 && y > 158 && y < 179);
    const farHand = p.filter(([x, y]) => x > 257 && y > 140 && y < 156);
    for (const contact of [foot, nearHand, farHand]) assert.ok(contact.length > 2, `lost contact at ${i}`);
    assert.ok(Math.abs(Math.max(...foot.map(p => p[1])) - 240.5) < 1, `foot lifts at ${i}`);
    // The source toe is at x=47; smoothing/control points vary by <=1 px.
    assert.ok(Math.abs(Math.max(...foot.map(p => p[0])) - 47) <= 1, `toe slides at ${i}`);
    assert.ok(Math.abs(Math.max(...nearHand.map(p => p[1])) - 172) < 2, `near palm lifts at ${i}`);
    assert.ok(Math.abs(Math.max(...farHand.map(p => p[1])) - 151.5) < 1, `far palm lifts at ${i}`);
  }
});

test('support geometry is static, frames stay on canvas, and the native figure uses a green vest', () => {
  for (let i = 0; i < 60; i++) {
    const svg = render('incline_pushup', i / 60);
    for (const [fill, path] of data.support) assert.ok(svg.includes(`d="${path}" fill="${fill}"`));
    for (const [x, y] of outline(i / 60)) assert.ok(x > 0 && x < 320 && y > 0 && y < 260);
    assert.match(svg, /fill="#589565"/);
    assert.doesNotMatch(svg, /NaN|undefined|<image|<video|https?:\/\//);
  }
  assert.match(render('incline_pushup', .5, true), /scale\(-1 1\)/);
});
