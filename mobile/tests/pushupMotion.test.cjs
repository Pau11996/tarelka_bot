const { test } = require('node:test'), assert = require('node:assert/strict');
const { pushupFrame, render } = require('../scripts/render-pushups.cjs');
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const near = (a, b, message) => assert.ok(Math.abs(a - b) < .001, `${message}: ${a} != ${b}`);
for (const movement of ['push_up', 'knee_push_up']) {
  test(`${movement}: fixed supports, rigid torso and constant limbs through the complete cycle`, () => {
    const start = pushupFrame(movement, 0), knee = movement === 'knee_push_up';
    for (let i = 0; i <= 400; i++) {
      const frame = pushupFrame(movement, i / 400);
      for (let side = 0; side < 2; side++) {
        const arm = frame.arms[side], leg = frame.legs[side];
        near(distance(arm.root, arm.joint), 50, 'upper arm');
        near(distance(arm.joint, arm.end), 50, 'forearm');
        near(distance(leg.root, leg.joint), 66, 'thigh');
        near(distance(leg.joint, leg.end), distance(start.legs[side].joint, start.legs[side].end), 'shin');
        assert.deepEqual(arm.end, start.arms[side].end, 'palms remain planted');
        assert.deepEqual(knee ? leg.joint : leg.end, knee ? start.legs[side].joint : start.legs[side].end, 'knees/toes remain planted');
        assert.ok(arm.joint[1] <= arm.end[1], 'elbow stays above the floor');
      }
      const pivot = knee ? frame.legs[1].joint : frame.legs[1].end;
      near(distance(pivot, frame.hip) + distance(frame.hip, frame.shoulder), distance(pivot, frame.shoulder), 'shoulder/hip/support alignment');
      near(distance(frame.shoulder, frame.hip), knee ? 100 : 114, 'torso length');
    }
  });
  test(`${movement}: continuous loop and finite SVG rendering`, () => {
    for (const t of [0, .45, .55, .95, 1]) {
      const before = pushupFrame(movement, t - .00001), after = pushupFrame(movement, t + .00001);
      assert.ok(distance(before.shoulder, after.shoulder) < .01);
      assert.ok(distance(before.arms[1].joint, after.arms[1].joint) < .02);
    }
    for (const t of [0, .225, .5, .75, 1]) assert.doesNotMatch(render(movement, t), /NaN|Infinity|undefined/);
  });
}
