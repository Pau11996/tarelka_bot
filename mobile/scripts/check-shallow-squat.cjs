// Pixel checks for every frame of the production SVG, including in-between poses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/2026-11-05-squat-animation'));
function components(pixels, width, height) {
  const mask = new Uint8Array(width * height), sizes = [], queue = new Int32Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 120 ? 1 : 0;
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
  let first, feet, previousArea, maxAreaChange = 0;
  for (let sample = 0; sample < 120; sample++) {
    const { data, info } = await sharp(Buffer.from(render('squat', sample / 120, false, false))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.channels, 4);
    const parts = components(data, info.width, info.height);
    assert.ok(parts[0] > 8000, `body missing at sample ${sample}`);
    assert.ok(parts.slice(1).every(size => size <= 2), `detached body part at ${sample}: ${parts}`);
    const strip = data.subarray(318 * info.width * 4, 338 * info.width * 4);
    if (!first) { first = Buffer.from(data); feet = Buffer.from(strip); }
    assert.ok(strip.equals(feet), `foot shifts or deforms at ${sample}`);
    if (sample < 12 || sample >= 114) assert.ok(data.equals(first), `standing hold / loop seam changes at ${sample}`);
    if (previousArea) maxAreaChange = Math.max(maxAreaChange, Math.abs(parts[0] - previousArea) / previousArea);
    previousArea = parts[0];
  }
  assert.ok(maxAreaChange < .025, `unexpected silhouette jump: ${maxAreaChange}`);
  fs.mkdirSync(out, { recursive: true });
  const result = { framesChecked: 120, connectedBodyEveryFrame: true, feetPixelIdentical: true, standingHoldAndLoopSeamPixelIdentical: true, maxAdjacentSilhouetteAreaChange: maxAreaChange };
  fs.writeFileSync(path.join(out, 'qa.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
