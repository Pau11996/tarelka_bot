const { test } = require('node:test'), assert = require('node:assert/strict');
const { floorFrame, render } = require('../scripts/render-course-floor.cjs');
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
test('floor motions keep limb lengths, joints and loop endpoints continuous', () => {
  for (const name of ['glute_bridge','bird_dog']) {
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
test('bridge finishes with shoulder hip and knee aligned without lumbar overextension', () => {
  const f = floorFrame('glute_bridge',.45), k = f.legs[1].joint;
  const cross = (f.hip[0]-f.shoulder[0])*(k[1]-f.hip[1])-(f.hip[1]-f.shoulder[1])*(k[0]-f.hip[0]);
  assert.ok(Math.abs(cross)<1e-6);
});
