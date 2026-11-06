const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, isFullBodyMovement, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/shallowSquatContours.json');
const frame = sample => fullBodyFrame('squat', sample / 120);

test('ordinary squats use the detailed renderer with a four-second cycle and explicit holds', () => {
  assert.equal(isFullBodyMovement('squat'), true);
  assert.equal(fullBodyTiming.squat.duration, 4);
  assert.equal(data.timeline.length, 120);
  for (const sample of [...Array.from({length:12},(_,i)=>i),114,115,116,117,118,119]) assert.equal(frame(sample).pose,frame(0).pose);
  for (let sample=60;sample<72;sample++) assert.equal(frame(sample).pose,frame(60).pose);
  assert.notEqual(frame(0).pose,frame(60).pose);
  assert.equal(render('squat',0),render('squat',1));
  assert.match(frame(24).label,/присядьте/);
  assert.match(frame(90).label,/выпрямитесь/);
});

function points(path) {
  const n=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  return Array.from({length:n.length/2},(_,i)=>[n[i*2],n[i*2+1]]);
}
test('squat stays shallow, moves the hips back, keeps the sole planted and never includes a kick', () => {
  const stand=points(data.poses[frame(0).pose][0]), low=points(data.poses[frame(60).pose][0]);
  const top=p=>Math.min(...p.map(v=>v[1]));
  assert.ok(top(low)-top(stand)>20 && top(low)-top(stand)<35,'shallow head descent');
  assert.ok(Math.min(...low.map(v=>v[0]))<Math.min(...stand.map(v=>v[0]))-20,'hip must move back');
  const fixedShoe=data.poses[frame(0).pose][4].split('M')[2];
  for(const pose of data.poses){
    const outline=points(pose[0]);
    assert.equal(pose[4].split('M')[2],fixedShoe,'shoe must remain identical');
    assert.ok(Math.max(...outline.map(v=>v[0]))<140,'no leg extension / kick');
    assert.ok(Math.max(...outline.map(v=>v[1]))<332 && Math.max(...outline.map(v=>v[1]))>330,'ground contact');
    assert.ok(outline.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0&&x<250&&y<342));
  }
  assert.match(render('squat',.55,true),/scale\(-1 1\)/);
  assert.match(render('squat',.55),/fill="#589565"/);
});
