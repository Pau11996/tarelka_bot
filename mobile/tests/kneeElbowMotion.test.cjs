const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/kneeElbowContours.json');
const frame = t => fullBodyFrame('standing_knee_elbow', t);
const outline = t => {
  const coordinates = data.poses[frame(t).pose][0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({ length: coordinates.length / 2 }, (_, i) => coordinates.slice(i * 2, i * 2 + 2));
};
const foot = (points, right) => points.filter(([x, y]) => y > 330 && (right ? x > 110 : x < 110));

test('reference cycle retains top holds, alternation and an identical loop seam', () => {
  assert.equal(fullBodyTiming.standing_knee_elbow.duration, 4);
  assert.equal(render('standing_knee_elbow', 0), render('standing_knee_elbow', 119 / 120));
  assert.equal(frame(0).pose, frame(1).pose);
  assert.equal(frame(.25).pose, frame(.32).pose);
  assert.equal(frame(.75).pose, frame(.82).pose);
  assert.notEqual(frame(.25).pose, frame(.75).pose);
  assert.equal(foot(outline(.25), true).length, 0, 'lifted left foot is still on the floor');
  assert.equal(foot(outline(.75), false).length, 0, 'lifted right foot is still on the floor');
});

test('the supporting shoe stays planted while the opposite leg rises and lowers', () => {
  for (let i = 0; i < 120; i++) {
    const right = i >= 60, points = foot(outline(i / 120), right);
    assert.ok(points.length > 10, `support disappeared at sample ${i}`);
    const anchor = right ? Math.max(...points.map(p => p[0])) : Math.min(...points.map(p => p[0]));
    assert.ok(Math.abs(anchor - (right ? 161.5 : 59.5)) < 1.5, `support slides at sample ${i}`);
    assert.ok(Math.abs(Math.max(...points.map(p => p[1])) - 368) < 2, `support rises at sample ${i}`);
  }
});

test('all vector poses stay inside the canvas and render with the approved green vest', () => {
  for (let i = 0; i < 120; i++) {
    for (const [x, y] of outline(i / 120)) assert.ok(x > 0 && x < 230 && y > 0 && y < 380);
    const svg = render('standing_knee_elbow', i / 120);
    assert.match(svg, /fill="#589565"/);
    assert.doesNotMatch(svg, /NaN|undefined|<image|<video|https?:\/\//);
  }
  const mirrored = fullBodyFrame('standing_knee_elbow', .25, true);
  assert.match(mirrored.label, /Правое колено/);
  assert.match(render('standing_knee_elbow', .25, true), /scale\(-1 1\)/);
});
