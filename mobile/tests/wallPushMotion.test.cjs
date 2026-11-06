const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyTiming, isFullBodyMovement, render } = require('../scripts/render-full-body.cjs');
const data = require('../src/workouts/character/wallPushContours.json');
const { asset, joints, rig, upperArm, forearm } = require('../scripts/build-wall-push.cjs');
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const distanceToEdge = (p,a,b) => {
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
  return distance(p,[a[0]+t*dx,a[1]+t*dy]);
};
const close = (a,b,label) => assert.ok(Math.abs(a-b)<1e-8,`${label}: ${a} vs ${b}`);

test('wall push uses the detailed renderer with eased holds, a seamless loop and phase guidance', () => {
  assert.equal(isFullBodyMovement('wall_push'),true);
  assert.equal(fullBodyTiming.wall_push.duration,4);
  assert.equal(data.timeline.length,120);
  assert.equal(data.fillRule,'nonzero');
  assert.deepEqual(data,asset,'checked-in contours must match the reproducible rig');
  for(let n=0;n<120;n++) {
    const frame=fullBodyFrame('wall_push',n/120);
    assert.equal(frame.pose,data.timeline[n]);
    if(n<12||n>=114) assert.equal(frame.pose,data.timeline[0]);
    if(n>=60&&n<72) assert.equal(frame.pose,data.timeline[60]);
  }
  assert.notEqual(data.timeline[0],data.timeline[60]);
  assert.equal(render('wall_push',0),render('wall_push',1));
  assert.match(fullBodyFrame('wall_push',.25).label,/согните/);
  assert.match(fullBodyFrame('wall_push',.75).label,/Оттолкнитесь/);
  assert.match(render('wall_push',.55,true),/scale\(-1 1\)/);
  assert.match(render('wall_push',.55),/clip-rule="nonzero"/);
});

test('the arm bends without shortening while the torso is rigid and wall/ground contacts stay fixed', () => {
  const first=joints[0],low=joints[60];
  for(const frame of joints) {
    close(distance(frame.shoulder,frame.elbow),upperArm,'upper arm length');
    close(distance(frame.elbow,frame.wrist),forearm,'forearm length');
    close(distance(frame.shoulder,frame.hip),distance(first.shoulder,first.hip),'torso length');
    close(distance(frame.hip,frame.knee),distance(first.hip,first.knee),'thigh length');
    assert.deepEqual(frame.wrist,first.wrist);
    assert.deepEqual(frame.ankle,first.ankle);
    assert.ok(frame.elbow[1]>frame.shoulder[1] && frame.elbow[1]>frame.wrist[1],'elbow bends down, not backwards');
  }
  assert.ok(low.shoulder[0]-first.shoulder[0]>30,'body must approach wall');
  const bottomAngle=Math.acos((upperArm**2+forearm**2-distance(low.shoulder,low.wrist)**2)/(2*upperArm*forearm))*180/Math.PI;
  assert.ok(bottomAngle>75&&bottomAngle<100,'clear elbow bend at bottom');
  const shoe=data.poses[0][4].split('M').at(-1);
  for(let sample=0;sample<120;sample++) {
    const arm=data.poses[data.timeline[sample]][5].split('M')[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
    const contour=Array.from({length:arm.length/2},(_,i)=>[arm[i*2],arm[i*2+1]]);
    const body=rig(data.progress[sample]);
    for(const anchor of [[76,87],[77,119],[64,103]]) {
      const actual=Math.min(...contour.map((p,i)=>distanceToEdge(body.rotate(anchor),p,contour[(i+1)%contour.length])));
      // Offline curve simplification and one-decimal coordinates allow <0.12px.
      assert.ok(actual<.12,`shoulder attachment deforms at sample ${sample}: ${actual}`);
    }
    for(const anchor of [[220,80],[220,90],[220,99],[217.33333333333334,73],[216,103.5]]) {
      const actual=Math.min(...contour.map((p,i)=>distanceToEdge(anchor,p,contour[(i+1)%contour.length])));
      assert.ok(actual<.12,`finger or palm loses wall contact at sample ${sample}: ${actual}`);
    }
  }
  for(const pose of data.poses) {
    assert.equal(pose[5].split('M').filter(Boolean).length,1,'arm and hand must share one contour');
    assert.equal(pose[6],data.poses[0][6],'finger details must stay fixed');
    assert.equal(pose[4].split('M').at(-1),shoe,'shoe contour moves');
    const coordinates=pose[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
    for(let i=0;i<coordinates.length;i+=2) {
      assert.ok(coordinates[i]>50&&coordinates[i]<222,'body passes through wall or leaves frame');
      assert.ok(coordinates[i+1]>25&&coordinates[i+1]<333,'body leaves frame');
    }
  }
});
