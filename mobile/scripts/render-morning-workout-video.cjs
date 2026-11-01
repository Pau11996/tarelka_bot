// Export the same SVG and motion used by the player, in all eight exercise panels.
const fs = require('node:fs');
const path = require('node:path');
const { renderCharacter, morningFrame, motionDuration } = require('./render-workout-character-concept.cjs');
const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const out = path.resolve(__dirname, '../../outputs/workout-character/morning-v6-frames');
const exercises = [ ['march','Шаги на месте'], ['shoulders','Движение плечами'], ['arm_raise','Подъём рук'], ['side_step','Приставные шаги'], ['calf_raise','Подъём на носки'], ['side_bend','Наклон влево'], ['side_bend','Наклон вправо',true], ['chest','Раскрытие груди'] ];
fs.mkdirSync(out, {recursive:true});
(async () => {
  for (let i=0;i<240;i++) {
    const panels=exercises.map(([name,title,mirror=false], n)=>{
      const x=n%4*300, y=Math.floor(n/4)*370, cycle=(i/20/motionDuration[name])%1;
      const svg=renderCharacter(name,cycle,{mirror}).replace(/<svg[^>]*>/,`<svg x="${x}" y="${y+25}" width="300" height="317" viewBox="0 0 360 380" fill="none">`);
      const label=morningFrame(name,cycle,mirror).label;
      return `<text x="${x+150}" y="${y+25}" text-anchor="middle" font-size="16">${n+1}. ${title}</text>${svg}<text x="${x+150}" y="${y+355}" text-anchor="middle" font-size="12" fill="#687b68">${label}</text>`;
    }).join('');
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760"><rect width="1200" height="760" fill="#f5f7f2"/><g font-family="DejaVu Sans,sans-serif" fill="#2c4636">${panels}</g></svg>`)).png().toFile(path.join(out,`${String(i).padStart(4,'0')}.png`));
  }
  console.log(out);
})();
