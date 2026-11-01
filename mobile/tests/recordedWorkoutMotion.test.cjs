const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const assets = {
  chair_dip: require('../src/workouts/character/recordedChairDip.json'),
  prone_pull: require('../src/workouts/character/recordedPronePull.json'),
  plank_pike: require('../src/workouts/character/recordedPlankPike.json'),
  seated_knee_tuck: require('../src/workouts/character/recordedSeatedKneeTuck.json'),
};
function points(path) {
  // Contact assertions measure the visible curve, not Bezier handles, which
  // can extend past a sole or palm without the actual outline moving there.
  const tokens = path.match(/[MCQZ]|-?\d+(?:\.\d+)?/g) || [], result = [];
  let cursor = 0, position;
  const pair = () => [Number(tokens[cursor++]), Number(tokens[cursor++])];
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === 'M') { position = pair(); result.push(position); }
    else if (command === 'C' || command === 'Q') {
      const start = position, a = pair(), b = pair(), end = command === 'C' ? pair() : b;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        result.push([0, 1].map(axis => command === 'C'
          ? u ** 3 * start[axis] + 3 * u ** 2 * t * a[axis] + 3 * u * t ** 2 * b[axis] + t ** 3 * end[axis]
          : u ** 2 * start[axis] + 2 * u * t * a[axis] + t ** 2 * end[axis]));
      }
      position = end;
    }
  }
  return result;
}
function outline(name, sample, layer = 0) {
  const d = assets[name], f = fullBodyFrame(name, sample / d.timeline.length);
  const pose = d.poses[f.pose];
  if (layer !== 5) return points(pose[layer]);
  // Materials extend beyond the silhouette to cover antialiased seams. Foot
  // contact belongs to the visible, clipped shoe, not that hidden underpaint.
  const polygons = path => path.split('M').filter(Boolean).map(p=>points('M'+p));
  const body = polygons(pose[0]), material = polygons(pose[layer]);
  const inside = ([x,y], polygons) => {
    let contained=false;
    for(const p of polygons) for(let i=0,j=p.length-1;i<p.length;j=i++) {
      const a=p[i],b=p[j];
      if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) contained=!contained;
    }
    return contained;
  };
  return [...material.flat().filter(p=>inside(p,body)), ...body.flat().filter(p=>inside(p,material))];
}
const max = (points, axis) => Math.max(...points.map(p => p[axis]));
const min = (points, axis) => Math.min(...points.map(p => p[axis]));

for (const [name, d] of Object.entries(assets)) {
  test(`${name}: source tempo, stationary holds and seamless repeat survive native rendering`, () => {
    assert.equal(fullBodyTiming[name].duration, d.timeline.length / 30);
    assert.equal(render(name, 0), render(name, (d.timeline.length - 1) / d.timeline.length));
    assert.equal(fullBodyFrame(name, 0).pose, fullBodyFrame(name, 1).pose);
    assert.equal(fullBodyFrame(name, -.25).pose, fullBodyFrame(name, .75).pose);
    assert.match(render(name, d.preview, true), /scale\(-1 1\)/);
    for (let i = 0; i < d.timeline.length; i++) {
      const svg = render(name, i / d.timeline.length);
      assert.match(svg, /fill="#589565"/);
      assert.doesNotMatch(svg, /NaN|undefined|<image|<video|https?:\/\//);
      const [x, y, scale] = d.transform;
      for (const [px, py] of outline(name, i)) {
        assert.ok(x + scale * px > 0 && x + scale * px < d.canvas[0], `clipped horizontally at ${i}`);
        assert.ok(y + scale * py > 0 && y + scale * py < d.canvas[1], `clipped vertically at ${i}`);
      }
      for (const [fill, path] of d.support) assert.ok(svg.includes(`d="${path}" fill="${fill}"`), 'support must stay static');
    }
  });
}

test('chair dip lowers the torso by the recorded depth while the foot and palm keep contact', () => {
  const name = 'chair_dip', d = assets[name];
  assert.equal(fullBodyTiming[name].duration, 3);
  assert.ok(Math.abs(min(outline(name, 54), 1) - min(outline(name, 0), 1) - 35) < 1);
  for (let i = 0; i < d.timeline.length; i++) {
    const p = outline(name, i), foot = p.filter(([x, y]) => x > 210 && y > 232);
    const palm = p.filter(([x, y]) => x > 117 && x < 128 && y > 167 && y < 176);
    assert.ok(foot.length > 3 && palm.length > 2, `missing contact at ${i}`);
    assert.ok(Math.abs(max(foot, 1) - 242.5) < .6 && Math.abs(max(foot, 0) - 260.5) < .6, `foot slides at ${i}`);
    // The visible palm contour crosses the measured seat-edge contact. Its
    // rounded tip can extend lower than the old quadratic control handles.
    assert.ok(Math.min(...p.map(([x, y]) => Math.hypot(x - 120, y - 170))) < 2, `palm leaves seat at ${i}`);
  }
});

test('prone pull retracts both arms while the lower body stays on the mat', () => {
  const name = 'prone_pull', d = assets[name];
  assert.equal(fullBodyTiming[name].duration, 61 / 30);
  assert.ok(max(outline(name, 0), 0) - max(outline(name, 36), 0) > 57);
  assert.equal(d.timeline[0], d.timeline[13]);
  assert.equal(d.timeline[30], d.timeline[43]);
  for (let i = 0; i < d.timeline.length; i++) {
    const foot = outline(name, i).filter(([x, y]) => x < 70 && y > 100);
    assert.ok(foot.length > 3 && Math.abs(max(foot, 1) - 115.5) < .6);
    assert.ok(Math.abs(min(foot, 0) - 31.6) < 1);
  }
});

test('pike preserves the recorded hip rise, palm placement and shoe pivot', () => {
  const name = 'plank_pike', d = assets[name];
  assert.equal(fullBodyTiming[name].duration, 121 / 30);
  assert.ok(min(outline(name, 0, 3), 1) - min(outline(name, 75, 3), 1) > 40);
  const shoe = i => outline(name, i, 5).filter(([x]) => x < 120);
  assert.ok(min(shoe(0), 0) - min(shoe(75), 0) > 10, 'missing source heel pivot');
  const firstPalmX = max(outline(name, 0).filter(([x,y])=>x>280 && y>209), 0);
  assert.ok(Math.abs(firstPalmX-335.5)<.6, 'palm starts outside the measured support');
  for (let i = 0; i < d.timeline.length; i++) {
    const palm = outline(name, i).filter(([x, y]) => x > 280 && y > 209);
    assert.ok(palm.length > 3 && Math.abs(max(palm, 1) - 217.5) < .6, `palm lifts at ${i}`);
    // Check actual drift from the first visible fingertip. The previous
    // absolute 336-px bound was rounded above the source contour (335.1–335.5).
    assert.ok(Math.abs(max(palm, 0) - firstPalmX) < .6, `palm slides at ${i}`);
    assert.ok(Math.abs(max(shoe(i), 0) - 99.5) < 1, `toe pivot slides at ${i}`);
  }
});

test('seated tuck coordinates knee extension and torso lean while keeping the feet airborne', () => {
  const name = 'seated_knee_tuck', d = assets[name];
  assert.equal(fullBodyTiming[name].duration, 2);
  assert.ok(max(outline(name, 36), 0) - max(outline(name, 0), 0) > 85);
  assert.ok(min(outline(name, 36), 1) - min(outline(name, 0), 1) > 15, 'torso must lean back as legs extend');
  for (let i = 0; i < d.timeline.length; i++) {
    const palm = outline(name, i).filter(([x, y]) => x < 145 && y > 171);
    const shoe = outline(name, i, 5).filter(([x]) => x > 220);
    assert.ok(palm.length > 3 && Math.abs(max(palm, 1) - 183.5) < 1, `palm lifts at ${i}`);
    assert.ok(shoe.length > 3 && max(shoe, 1) < 156, `shoe touches mat at ${i}`);
  }
});
