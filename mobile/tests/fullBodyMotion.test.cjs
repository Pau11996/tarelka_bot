const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fullBodyFrame, fullBodyMovements, fullBodyTiming, render } = require('../scripts/render-full-body.cjs');

test('every full-body exercise has a renderable recorded pose, timing and guide', () => {
  for(const name of fullBodyMovements) {
    const timing = fullBodyTiming[name];
    assert.ok(timing.duration>0 && timing.preview>=0 && timing.preview<1);
    for(const t of [0,.125,.4,.6,.9,1]) {
      const frame = fullBodyFrame(name,t);
      assert.ok(Number.isInteger(frame.pose) && frame.pose>=0);
      assert.ok(frame.phase>=0 && frame.phase<frame.phases.length && frame.label && frame.cue);
      const svg=render(name,t);
      assert.match(svg,/<path/);
      assert.doesNotMatch(svg,/NaN|undefined|<image|<video|https?:\/\//);
    }
  }
});

test('the twelve exercise illustrations have independent SVG clip identifiers', () => {
  const svg = [...fullBodyMovements.map(name=>render(name,fullBodyTiming[name].preview)),render('quad_stretch',.4,true)].join('');
  const ids = [...svg.matchAll(/<clipPath id="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,8);
  assert.equal(new Set(ids).size,ids.length,'one exercise must not clip another illustration');
});
