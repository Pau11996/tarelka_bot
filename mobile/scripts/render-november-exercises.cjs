// Native component and the same source sample, with screen transitions omitted.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const assets = {
  crunch_reach: ['recordedCrunchReach.json', false, '1 / 4 · Упражнение для пресса'],
  hands_behind: ['recordedHandsBehind.json', false, '2 / 4 · Руки за спиной'],
  quad_stretch: ['recordedQuadRight.json', false, '3 / 4 · Растяжка бедра · правая'],
  quad_left: ['recordedQuadLeft.json', true, '4 / 4 · Растяжка бедра · левая'],
};

async function main() {
  const [video, name] = process.argv.slice(2);
  if (!video || !assets[name]) throw new Error('Pass source video and an exercise name');
  const [file, mirror, title] = assets[name], data = require(`../src/workouts/character/${file}`);
  const out = path.resolve(__dirname, '../../outputs/workout-reference/november-stretches', name);
  const source = path.join(out, 'cycle-source'), frames = path.join(out, 'rendered');
  fs.mkdirSync(source, {recursive:true}); fs.mkdirSync(frames, {recursive:true});
  const start = Math.round(data.sourceStartSeconds * data.fps), count = data.timeline.length;
  const [x, y, width, height] = data.sourceCrop, [tx, ty, scale] = data.transform;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf',
    `fps=${data.fps},select='between(n,${start},${start+count-1})',crop=${width}:${height}:${x}:${y}`,
    '-vsync', 'vfr', '-y', path.join(source, '%03d.png')]);
  const offset = 45 + (380 - data.canvas[1]) / 2;
  for (let i = 0; i < count; i++) {
    const native = render(data.movement, i / count, mirror, false);
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${data.canvas[1]}">${native}</svg>`))
      .png().toFile(path.join(frames, `character-${String(i).padStart(3,'0')}.png`));
    const image = fs.readFileSync(path.join(source, `${String(i+1).padStart(3,'0')}.png`)).toString('base64');
    const own = render(data.movement, i / count, mirror).replace('<svg', `<svg x="360" y="${offset}"`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440" font-family="DejaVu Sans"><rect width="720" height="440" fill="#f5f7f2"/><text x="180" y="30" text-anchor="middle" font-size="18" fill="#535f55">Ваша запись</text><text x="540" y="30" text-anchor="middle" font-size="18" fill="#35553d">В «Тарелке»</text><image x="${tx}" y="${ty+offset}" width="${width*scale}" height="${height*scale}" href="data:image/png;base64,${image}"/>${own}<text x="360" y="431" text-anchor="middle" font-size="16" fill="#35553d">${title}</text></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(frames, `compare-${String(i).padStart(3,'0')}.png`));
  }
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', String(data.fps),
    '-start_number', String(data.comparisonStart), '-i', path.join(frames, 'compare-%03d.png'), '-frames:v', String(data.comparisonCount),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart', '-y', path.join(out, 'cycle.mp4')]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-stream_loop', '1', '-i', path.join(out, 'cycle.mp4'),
    '-c', 'copy', '-movflags', '+faststart', '-y', path.join(out, 'preview.mp4')]);
  console.log(path.join(out, 'preview.mp4'));
}
main().catch(error => { console.error(error); process.exitCode=1; });
