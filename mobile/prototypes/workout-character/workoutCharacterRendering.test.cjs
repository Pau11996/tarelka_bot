// Render the actual artwork on transparency: every pose must be one connected body.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { renderCharacter, morningMovements } = require('../../scripts/render-workout-character-concept.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));

function components(data, width, height, channels) {
  const visited = new Uint8Array(width * height), areas = [];
  const opaque = i => data[i * channels + channels - 1] >= 64;
  for (let i = 0; i < visited.length; i++) {
    if (visited[i] || !opaque(i)) continue;
    const queue = [i]; visited[i] = 1;
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head], x = p % width;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n < 0 || n >= visited.length || visited[n] || !opaque(n)) continue;
        visited[n] = 1; queue.push(n);
      }
    }
    areas.push(queue.length);
  }
  return areas.sort((a, b) => b - a);
}

test('head, torso, hands and feet stay joined in every sampled warm-up pose', async () => {
  const movements = morningMovements.map(name => ({ name, mirror: false }));
  movements.push({ name: 'side_bend', mirror: true });
  for (const { name, mirror } of movements) for (let i = 0; i < 24; i++) {
    const svg = renderCharacter(name, i / 24, { mirror, backdrop: false });
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const areas = components(data, info.width, info.height, info.channels);
    assert.ok(areas[0] > 6500, `${name}: missing body`);
    assert.ok((areas[1] || 0) < 5, `${name}, mirror=${mirror}, phase=${i}/24: detached pieces ${areas.join(', ')}`);
  }
});
