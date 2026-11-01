// Before/after preview from archived vector paths and the current native component.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(__dirname, '../../outputs/workout-reference/edge-smoothing');
const steps = [
  ['chair_dip', 'recordedChairDip.json', '1 / 4 · Отжимания от стула'],
  ['prone_pull', 'recordedPronePull.json', '2 / 4 · Локти к бокам лёжа'],
  ['plank_pike', 'recordedPlankPike.json', '3 / 4 · Планка → V'],
  ['seated_knee_tuck', 'recordedSeatedKneeTuck.json', '4 / 4 · Ноги к себе — от себя'],
];

function original(data, sample) {
  const [w, h] = data.canvas, [x, y, scale] = data.transform;
  const support = data.support.map(([fill, d]) => `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`).join('');
  const body = data.poses[data.timeline[sample]].map((d, i) => `<path d="${d}" fill="${data.palette[i]}" fill-rule="evenodd" stroke="${data.palette[i]}" stroke-width="${i === 0 ? 0 : .35}" stroke-linejoin="round"/>`).join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="translate(${x} ${y}) scale(${scale})">${support}${body}</g></svg>`;
}

async function main() {
  const chapters = [];
  for (const [movement, file, title] of steps) {
    const data = JSON.parse(fs.readFileSync(path.join(out, 'before', file), 'utf8'));
    const frames = path.join(out, movement); fs.mkdirSync(frames, { recursive: true });
    const offset = 45 + (380 - data.canvas[1]) / 2;
    for (let i = 0; i < data.timeline.length; i++) {
      const before = original(data, i).replace('<svg', `<svg y="${offset}"`);
      const after = render(movement, i / data.timeline.length).replace('<svg', `<svg x="360" y="${offset}"`);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="440" font-family="DejaVu Sans"><rect width="720" height="440" fill="#f5f7f2"/><text x="180" y="30" text-anchor="middle" font-size="18" fill="#535f55">Было</text><text x="540" y="30" text-anchor="middle" font-size="18" fill="#35553d">Стало</text>${before}${after}<text x="360" y="430" text-anchor="middle" font-size="17" fill="#35553d">${title}</text></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(path.join(frames, `${String(i).padStart(3, '0')}.png`));
    }
    const cycle = path.join(frames, 'cycle.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-framerate', String(data.fps), '-i', path.join(frames, '%03d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', '-y', cycle]);
    chapters.push(cycle, cycle);
  }
  const manifest = path.join(out, 'chapters.txt');
  fs.writeFileSync(manifest, chapters.map(file => `file '${file}'\n`).join(''));
  const result = path.join(out, 'before-after.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', manifest,
    '-c', 'copy', '-movflags', '+faststart', '-y', result]);
  const detailData = JSON.parse(fs.readFileSync(path.join(out, 'before/recordedChairDip.json'), 'utf8'));
  const before = original(detailData, 54).replace(/<svg[^>]*>/, '<svg y="50" width="720" height="660" viewBox="90 90 170 160">');
  const after = render('chair_dip', 54 / detailData.timeline.length, false, true)
    .replace(/<svg[^>]*>/, '<svg x="720" y="50" width="720" height="660" viewBox="90 90 170 160">');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="710" font-family="DejaVu Sans"><rect width="1440" height="710" fill="#f5f7f2"/><text x="360" y="32" font-size="25" text-anchor="middle" fill="#535f55">Было · контуры крупно</text><text x="1080" y="32" font-size="25" text-anchor="middle" fill="#35553d">Стало · плавные кривые</text>${before}${after}</svg>`))
    .png().toFile(path.join(out, 'contour-detail.png'));
  console.log(result);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
