const { test } = require('node:test'), assert = require('node:assert/strict');
const { floorFrame, render } = require('../scripts/render-course-floor.cjs');
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
test('floor motions keep limb lengths, joints and loop endpoints continuous', () => {
  for (const name of ['glute_bridge','bird_dog','quadruped_leg']) {
    assert.deepEqual(floorFrame(name,0),floorFrame(name,1));
    const initial = floorFrame(name,0), reference = [...initial.arms, ...initial.legs];
    for (let i=0;i<=200;i++) {
      const f = floorFrame(name,i/200), limbs = [...f.arms,...f.legs];
      limbs.forEach((limb,j) => {
        assert.ok(Math.abs(distance(limb.root,limb.joint)-distance(reference[j].root,reference[j].joint))<1e-6);
        assert.ok(Math.abs(distance(limb.joint,limb.end)-distance(reference[j].joint,reference[j].end))<1e-6);
      });
      if (name==='glute_bridge') {
        assert.deepEqual(f.shoulder,initial.shoulder); assert.deepEqual(f.head,initial.head);
        assert.deepEqual(f.legs.map(l=>l.end), initial.legs.map(l=>l.end));
      } else {
        assert.deepEqual(f.hip,initial.hip); assert.deepEqual(f.shoulder,initial.shoulder);
        const raisedArm = f.arms.findIndex((l,j)=>distance(l.end,initial.arms[j].end)>1);
        if(raisedArm>=0) { assert.ok(f.lift[1-raisedArm]>0); assert.equal(f.lift[raisedArm],0); }
      }
      assert.doesNotMatch(render(name,i/200), /NaN|undefined/);
    }
  }
});
test('beginner quadruped leg movement keeps both hands down and alternates one leg at a time', () => {
  const initial = floorFrame('quadruped_leg', 0);
  for (const [phase, leg] of [[.25, 1], [.75, 0]]) {
    const frame = floorFrame('quadruped_leg', phase);
    assert.deepEqual(frame.arms, initial.arms);
    assert.equal(frame.lift[leg], 1); assert.equal(frame.lift[1-leg], 0);
    assert.deepEqual(frame.legs[1-leg], initial.legs[1-leg]);
    assert.ok(distance(frame.legs[leg].end, initial.legs[leg].end) > 30);
  }
});
test('bridge finishes with shoulder hip and knee aligned without lumbar overextension', () => {
  const f = floorFrame('glute_bridge',.45), k = f.legs[1].joint;
  const cross = (f.hip[0]-f.shoulder[0])*(k[1]-f.hip[1])-(f.hip[1]-f.shoulder[1])*(k[0]-f.hip[0]);
  assert.ok(Math.abs(cross)<1e-6);
});
