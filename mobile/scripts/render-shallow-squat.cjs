// Render the production component, not a separate drawing of the exercise.
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./render-full-body.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const data = require('../src/workouts/character/shallowSquatContours.json');
const out = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/2026-11-05-squat-animation'));
const wrap = figure => `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="600"><rect width="640" height="600" fill="#f5f7f2"/>${figure.replace(/<svg[^>]*>/,'<svg x="70" y="18" width="500" height="550" viewBox="0 0 360 380" fill="none">')}</svg>`;
(async()=>{
  fs.mkdirSync(path.join(out,'frames'),{recursive:true});
  const frames=[];
  for(let sample=0;sample<data.timeline.length;sample++){
    const svg=render('squat',sample/data.timeline.length);
    frames.push(svg);
    await sharp(Buffer.from(wrap(svg))).png().toFile(path.join(out,'frames',`${String(sample).padStart(3,'0')}.png`));
  }
  fs.writeFileSync(path.join(out,'frames.json'),JSON.stringify({fps:30,duration:4,frames}));
  console.log(out);
})().catch(error=>{console.error(error);process.exitCode=1;});
