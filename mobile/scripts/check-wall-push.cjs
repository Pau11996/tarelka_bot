// Pixel checks for every frame of the production SVG, including in-between poses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render-full-body.cjs');
const { asset, rig } = require('./build-wall-push.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/2026-11-05-wall-push-animation'));
function components(pixels, width, height, opaque = true) {
  const mask = new Uint8Array(width * height), sizes = [], queue = new Int32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = (pixels[i * 4 + 3] > 120) === opaque ? 1 : 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start]) continue;
    let head = 0, tail = 1; queue[0] = start; mask[start] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (next >= 0 && mask[next]) { mask[next] = 0; queue[tail++] = next; }
      }
    }
    sizes.push(tail);
  }
  return sizes.sort((a, b) => b - a);
}
(async () => {
  let first, feet, palm, previousArea, maxAreaChange = 0, maxContactAlphaChange = 0;
  for (let sample = 0; sample < 120; sample++) {
    const { data, info } = await sharp(Buffer.from(render('wall_push', sample / 120, false, false))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    const parts = components(data, info.width, info.height);
    assert.ok(parts[0] > 8000, `body missing at sample ${sample}`);
    assert.ok(parts.slice(1).every(size => size <= 2), `detached body part at ${sample}: ${parts}`);
    const emptyRegions=components(data,info.width,info.height,false);
    assert.ok(emptyRegions.slice(1).every(size=>size<=2), `hole inside body at ${sample}: ${emptyRegions}`);
    // The previous source armhole left an open notch at these torso positions.
    // It must now be covered by cloth or by the arm in every intermediate pose.
    const body=rig(asset.progress[sample]);
    for (const point of [[97.5,124],[98,125]]) {
      const p=body.rotate(point),[tx,ty,scale]=asset.transform;
      const pixel=(Math.floor(ty+p[1]*scale)*info.width+Math.floor(tx+p[0]*scale))*4;
      assert.ok(data[pixel+3]>=240,`shirt opens under arm at sample ${sample}`);
    }
    const strip = data.subarray(321 * info.width * 4, 339 * info.width * 4);
    const contact = Buffer.concat(Array.from({length: 37}, (_, row) => data.subarray(((86 + row) * info.width + 236) * 4, ((86 + row) * info.width + 244) * 4)));
    if (!first) { first = Buffer.from(data); feet = Buffer.from(strip); palm = Buffer.from(contact); }
    for (let i=3;i<contact.length;i+=4) {
      assert.equal(contact[i]>120,palm[i]>120,`wall contact outline changes at ${sample}`);
      maxContactAlphaChange=Math.max(maxContactAlphaChange,Math.abs(contact[i]-palm[i]));
    }
    assert.ok(contact.some((value, i) => i % 4 === 3 && value > 120), 'wall contact region is empty');
    assert.ok(strip.equals(feet), `foot shifts or deforms at ${sample}`);
    let shoePixels=0;
    for (let i=0;i<strip.length;i+=4) if (strip[i+3]===255) {
      // Check solid interiors, excluding the one-pixel antialiased outer edge.
      const pixel=321*info.width+i/4;
      const interior=[-info.width-1,-info.width,-info.width+1,-1,1,info.width-1,info.width,info.width+1]
        .every(offset=>data[(pixel+offset)*4+3]===255);
      if (!interior) continue;
      shoePixels++;
      assert.ok(Math.abs(strip[i]-98)<=1 && Math.abs(strip[i+1]-100)<=1 && Math.abs(strip[i+2]-99)<=1,
        `shoe contains a skin-colored gap or contrasting sole at sample ${sample}`);
    }
    assert.ok(shoePixels>200,'solid shoe region is missing');
    if (sample < 12 || sample >= 114) assert.ok(data.equals(first), `standing hold / loop seam changes at ${sample}`);
    if (previousArea) maxAreaChange = Math.max(maxAreaChange, Math.abs(parts[0] - previousArea) / previousArea);
    previousArea = parts[0];
  }
  assert.ok(maxAreaChange < .025, `unexpected silhouette jump: ${maxAreaChange}`);
  fs.mkdirSync(out, { recursive: true });
  // SVG antialiasing of an overlapping moving path may alter a boundary alpha by 1–2.
  assert.ok(maxContactAlphaChange<=2, `wall contact edge jumps: ${maxContactAlphaChange}`);
  const result = { framesChecked: 120, connectedBodyEveryFrame: true, noInternalHoles: true, underarmContinuous: true, feetPixelIdentical: true, shoesSolidFill: true, wallContactMaskIdentical: true, maxContactAlphaChange, standingHoldAndLoopSeamPixelIdentical: true, maxAdjacentSilhouetteAreaChange: maxAreaChange };
  fs.writeFileSync(path.join(out, 'qa.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
