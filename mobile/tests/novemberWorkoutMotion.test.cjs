const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');
const crunch = require('../src/workouts/character/recordedCrunchReach.json');
const hands = require('../src/workouts/character/recordedHandsBehind.json');
const right = require('../src/workouts/character/recordedQuadRight.json');
const left = require('../src/workouts/character/recordedQuadLeft.json');
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

const bounds = p => [Math.min(...p.map(p=>p[0])), Math.min(...p.map(p=>p[1])), Math.max(...p.map(p=>p[0])), Math.max(...p.map(p=>p[1]))];

test('recorded crunch retains the four-second lift, return, arms and planted feet', () => {
  assert.equal(fullBodyTiming.crunch_reach.duration, 4);
  const pose = i => crunch.poses[crunch.timeline[i]];
  const headTop = i => Math.min(...pose(i)[5].split('M').filter(Boolean).map(p => bounds(points('M'+p)))
    .filter(([x0,y0,x1,y1]) => x1 < 160 && x1-x0>10 && y1-y0>10).map(b=>b[1]));
  assert.ok(headTop(15) - headTop(75) > 55, 'shoulders/head must rise visibly');
  const handsForward = i => Math.max(...points(pose(i)[0]).filter(([,y])=>y<100).map(([x])=>x));
  assert.ok(handsForward(75)-handsForward(15)>40, 'arms must reach towards the knees');
  const foot = i => bounds(points(pose(i)[0]).filter(([x,y])=>x>300&&y>160));
  const first = foot(0);
  for(let i=0;i<crunch.timeline.length;i++) {
    assert.ok(Math.abs(foot(i)[2]-first[2])<1.1 && Math.abs(foot(i)[3]-first[3])<1.1, `foot moves at ${i}`);
  }
  assert.equal(crunch.timeline[0], crunch.timeline.at(-1));
  assert.equal(render('crunch_reach',0),render('crunch_reach',119/120));
});

for(const [name,mirror,data] of [['hands_behind',false,hands],['quad_stretch',false,right],['quad_stretch',true,left]]) {
  test(`${name} ${mirror?'left':'right'}: body remains completely static while the reference indicators animate`, () => {
    assert.equal(data.poses.length,1);
    const body = render(name,0,mirror,false), fullFrames = new Set();
    for(let i=0;i<data.timeline.length;i++) {
      assert.equal(render(name,i/data.timeline.length,mirror,false),body, `body moved at ${i}`);
      fullFrames.add(render(name,i/data.timeline.length,mirror));
    }
    assert.ok(fullFrames.size>20,'indicators must animate independently of the body');
    assert.equal(render(name,0,mirror),render(name,(data.timeline.length-1)/data.timeline.length,mirror));
    assert.ok(!fullBodyFrame(name,.4,mirror).label.includes('Отпустите'), 'do not add an exit/re-entry movement');
  });
}

test('muscle dashes fade in and out without changing their location', () => {
  for(const data of [hands,right,left]) {
    const muscle = data.indicators[0];
    assert.match(muscle.path, /^M.*C/);
    assert.doesNotMatch(muscle.path, /Z/, 'muscle guide is one smooth open centreline, not traced pixel blobs');
    assert.equal(muscle.fill, 'none');
    assert.equal(muscle.strokeLinecap, 'round');
    assert.ok(muscle.strokeWidth > 0);
    assert.ok(muscle.strokeDasharray.every(length => length > muscle.strokeWidth), 'dashes and clear gaps must remain distinct after round caps');
    assert.equal(muscle.samples[0][0],0);
    assert.equal(muscle.samples.at(-1)[0],0);
    assert.equal(Math.max(...muscle.samples.map(p=>p[0])),1);
    assert.ok(muscle.samples.some(p=>p[0]>.1&&p[0]<.9),'source fade must not become an on/off flash');
    assert.ok(muscle.samples.every(([a,x,y])=>Number.isFinite(a)&&a>=0&&a<=1&&x===0&&y===0));
  }
});

test('planted soles have a flat middle and do not ripple below the contact line', () => {
  for (const [data, x0, x1, ground] of [[hands, 95, 126, 326.5], [right, 102, 131, 307.5], [left, 110, 138, 307.5]]) {
    const sole = points(data.poses[0][0]).filter(([x,y])=>x>x0 && x<x1 && y>ground-.8);
    assert.ok(sole.length>8, 'missing planted sole');
    assert.ok(sole.every(([,y])=>Math.abs(y-ground)<.015), 'the visible sole must be a straight segment');
  }
});

test('all three shoulder arrows move along the recorded directions', () => {
  assert.equal(hands.indicators.length,4);
  for(const [index,arrow] of hands.indicators.slice(1).entries()) {
    const active = arrow.samples.filter(p=>p[0]>.3);
    const dx = active.map(p=>p[1]);
    assert.ok(Math.max(...dx)-Math.min(...dx)>10,'arrow must translate, not only flash');
    assert.ok((active.at(-1)[1]-active[0][1])*[-1,1,-1][index]>10,'arrow travels in the wrong source direction');
    assert.ok(arrow.samples.every(p=>p.length===3&&p.every(Number.isFinite)));
  }
});

test('left quad stretch uses its own recorded pose, wall and muscle path', () => {
  assert.notEqual(left.poses[0][0],right.poses[0][0]);
  assert.notEqual(left.indicators[0].path,right.indicators[0].path);
  const svg = render('quad_stretch',.4,true);
  assert.ok(svg.includes(left.poses[0][0]));
  assert.doesNotMatch(svg,/scale\(-1 1\)/,'left source pose must not be mirrored a second time');
  assert.match(fullBodyFrame('quad_stretch',.4,true).cue,/Левая/);
  assert.match(fullBodyFrame('quad_stretch',.4,false).cue,/Правая/);
});
