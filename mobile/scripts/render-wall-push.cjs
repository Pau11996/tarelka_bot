// Render the same SVG component used by the course player and exercise preview.
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const data = require('../src/workouts/character/wallPushContours.json');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/2026-11-05-wall-push-animation'));
const wrap = figure => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="600"><rect width="640" height="600" fill="#f5f7f2"/>${figure.replace(/<svg[^>]*>/,'<svg x="70" y="18" width="500" height="550" viewBox="0 0 360 380" fill="none">')}</svg>`;
const wrapHand = figure => `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="450"><rect width="480" height="450" fill="#f5f7f2"/>${figure.replace(/<svg[^>]*>/,'<svg width="480" height="450" viewBox="195 78 55 68" fill="none">')}</svg>`;
(async () => {
  fs.mkdirSync(path.join(out,'frames'),{recursive:true});
  fs.mkdirSync(path.join(out,'hand-frames'),{recursive:true});
  const frames = [];
  for (let sample=0;sample<data.timeline.length;sample++) {
    const svg=render('wall_push',sample/data.timeline.length);
    frames.push(svg);
    await sharp(Buffer.from(wrap(svg))).png().toFile(path.join(out,'frames',`${String(sample).padStart(3,'0')}.png`));
    await sharp(Buffer.from(wrapHand(svg))).png().toFile(path.join(out,'hand-frames',`${String(sample).padStart(3,'0')}.png`));
  }
  fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({fps:data.fps,duration:data.duration,phases:data.phases,cue:data.cue,frames}));
  console.log(out);
})().catch(error=>{console.error(error);process.exitCode=1;});
