// Render the production component beside the user's recording for visual QA.
// Usage: node mobile/scripts/render-incline-pushup.cjs /path/to/отминия.mp4
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { render } = require('./render-full-body.cjs');
const data = require('../src/workouts/character/inclinePushupContours.json');
const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(__dirname, '../../outputs/workout-reference/incline-pushup');

async function main() {
  const video = process.argv[2];
  if (!video) throw new Error('Pass the source recording path');
  const source = path.join(out, 'cycle-source'), frames = path.join(out, 'rendered');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(frames, { recursive: true });
  const start = Math.round(data.sourceStartSeconds * data.fps), count = data.timeline.length;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', video,
    '-vf', `fps=${data.fps},select='between(n,${start},${start + count - 1})',crop=320:260:124:290`,
    '-vsync', 'vfr', '-y', path.join(source, '%03d.png')]);
  for (let i = 0; i < count; i++) {
    const character = render('incline_pushup', i / count, false, false);
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="380">${character}</svg>`))
      .png().toFile(path.join(frames, `character-${String(i).padStart(3, '0')}.png`));
    const image = fs.readFileSync(path.join(source, `${String(i + 1).padStart(3, '0')}.png`)).toString('base64');
    const own = render('incline_pushup', i / count).replace('<svg', '<svg x="360" y="45"');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440" font-family="DejaVu Sans"><rect width="720" height="440" fill="#f5f7f2"/><text x="180" y="30" text-anchor="middle" font-size="18" fill="#535f55">Ваша запись</text><text x="540" y="30" text-anchor="middle" font-size="18" fill="#35553d">В «Тарелке»</text><image x="20" y="135" width="320" height="260" href="data:image/png;base64,${image}"/>${own}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(frames, `compare-${String(i).padStart(3, '0')}.png`));
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', String(data.fps),
    '-i', path.join(frames, 'compare-%03d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    '-movflags', '+faststart', '-y', path.join(out, 'incline-pushup-cycle.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stream_loop', '5', '-i', path.join(out, 'incline-pushup-cycle.mp4'),
    '-c', 'copy', '-movflags', '+faststart', '-y', path.join(out, 'incline-pushup-preview.mp4')]);
  console.log(path.join(out, 'incline-pushup-preview.mp4'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
