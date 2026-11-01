// Frames for a short visual review; this does not change the workout player.
const fs = require('node:fs');
const path = require('node:path');
const { renderCharacter } = require('./render-workout-character-concept.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(__dirname, '../../outputs/workout-character/motion-v6-frames');
fs.mkdirSync(out, {recursive: true});
(async () => {
  for (let i = 0; i < 160; i++) {
    const figure = (name, phase, x) => renderCharacter(name, phase).replace(/<svg[^>]*>/, `<svg x="${x}" y="40" width="360" height="380" viewBox="0 0 360 380" fill="none">`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="460"><rect width="720" height="460" fill="#f3f5e9"/>
      <g font-family="DejaVu Sans,sans-serif" font-size="16" fill="#476046"><text x="180" y="30" text-anchor="middle">Подъём рук</text><text x="540" y="30" text-anchor="middle">Шаг на месте</text></g>
      ${figure('arm_raise', i / 160, 0)}${figure('march', (i / 160 * 3) % 1, 360)}
      <text x="360" y="445" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="12" fill="#7c8b70">Тарелка · Мягкая зарядка · Движения из приложения</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(out, `${String(i).padStart(4, '0')}.png`));
  }
  console.log(out);
})();
