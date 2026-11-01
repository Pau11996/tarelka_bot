// Compare the actual native component against the matching source frames.
// Usage: node mobile/scripts/render-reference-exercise.cjs /path/to/упражнения.mp4 chair_dip
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const files = { chair_dip: 'recordedChairDip.json', prone_pull: 'recordedPronePull.json',
  plank_pike: 'recordedPlankPike.json', seated_knee_tuck: 'recordedSeatedKneeTuck.json' };

async function main() {
  const [video, movement] = process.argv.slice(2);
  if (!video || !files[movement]) throw new Error('Pass the source video and a supported movement');
  const data = require(`../src/workouts/character/${files[movement]}`);
  const out = path.resolve(__dirname, '../../outputs/workout-reference/exercises-batch', movement);
  const source = path.join(out, 'cycle-source'), frames = path.join(out, 'rendered');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(frames, { recursive: true });
  const start = Math.round(data.sourceStartSeconds * data.fps), count = data.timeline.length;
  const [cx, cy, cw, ch] = data.sourceCrop, [tx, ty, scale] = data.transform;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf',
    `fps=${data.fps},select='between(n,${start},${start + count - 1})',crop=${cw}:${ch}:${cx}:${cy}`,
    '-vsync', 'vfr', '-y', path.join(source, '%03d.png')]);
  const offset = 45 + (380 - data.canvas[1]) / 2;
  for (let i = 0; i < count; i++) {
    const native = render(movement, i / count, false, false);
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${data.canvas[1]}">${native}</svg>`))
      .png().toFile(path.join(frames, `character-${String(i).padStart(3, '0')}.png`));
    const image = fs.readFileSync(path.join(source, `${String(i + 1).padStart(3, '0')}.png`)).toString('base64');
    const own = render(movement, i / count).replace('<svg', `<svg x="360" y="${offset}"`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440" font-family="DejaVu Sans"><rect width="720" height="440" fill="#f5f7f2"/><text x="180" y="30" text-anchor="middle" font-size="18" fill="#535f55">Ваша запись</text><text x="540" y="30" text-anchor="middle" font-size="18" fill="#35553d">В «Тарелке»</text><image x="${tx}" y="${ty + offset}" width="${cw * scale}" height="${ch * scale}" href="data:image/png;base64,${image}"/>${own}</svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(frames, `compare-${String(i).padStart(3, '0')}.png`));
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', String(data.fps), '-i', path.join(frames, 'compare-%03d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', '-y', path.join(out, 'cycle.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stream_loop', '3', '-i', path.join(out, 'cycle.mp4'),
    '-c', 'copy', '-movflags', '+faststart', '-y', path.join(out, 'preview.mp4')]);
  console.log(path.join(out, 'preview.mp4'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
