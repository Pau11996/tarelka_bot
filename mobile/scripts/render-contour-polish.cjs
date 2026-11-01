// Render the actual native component alongside the archived previous geometry.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
const { render } = require('./render-full-body.cjs');
const root = path.resolve(__dirname, '../../outputs/workout-reference/contour-polish');
const assets = [
  ['hands_behind', 'recordedHandsBehind.json', false, 'Руки за спиной'],
  ['quad_stretch', 'recordedQuadRight.json', false, 'Растяжка · правая'],
  ['quad_stretch', 'recordedQuadLeft.json', true, 'Растяжка · левая'],
  ['crunch_reach', 'recordedCrunchReach.json', false, 'Пресс'],
  ['chair_dip', 'recordedChairDip.json', false, 'Отжимания от стула'],
  ['prone_pull', 'recordedPronePull.json', false, 'Локти к бокам лёжа'],
  ['plank_pike', 'recordedPlankPike.json', false, 'Планка → V'],
  ['seated_knee_tuck', 'recordedSeatedKneeTuck.json', false, 'Ноги к себе / от себя'],
];
function archived(data, sample, backdrop = true) {
  const [width,height] = data.canvas, [x,y,scale] = data.transform, pose=data.poses[data.timeline[sample]];
  const id=`archived-${data.movement}-${data.authoredMirror?'left':'right'}`;
  const support=backdrop?data.support.map(([fill,d])=>`<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`).join(''):'';
  const body=pose.map((d,i)=>`<path d="${d}" fill="${data.palette[i]}" fill-rule="evenodd" stroke="${data.palette[i]}" stroke-width="${i===0?0:.35}" stroke-linejoin="round"/>`).join('');
  const indicators=backdrop?(data.indicators||[]).map(a=>{const [opacity,dx,dy]=a.samples[sample];return `<path d="${a.path}" fill="${a.fill}" opacity="${opacity}" transform="translate(${dx} ${dy})" fill-rule="evenodd"/>`;}).join(''):'';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><clipPath id="${id}"><path d="${pose[0]}" fill-rule="evenodd" clip-rule="evenodd"/></clipPath></defs><g transform="translate(${x} ${y}) scale(${scale})">${support}<g clip-path="url(#${id})">${body}</g>${indicators}</g></svg>`;
}
function wrapped(content,width,height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="DejaVu Sans"><rect width="${width}" height="${height}" fill="#f5f7f2"/>${content}</svg>`;
}
async function main() {
  const chapters=[];
  const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
  for(const [movement,file,mirror,title] of assets) {
    const data=require(`../src/workouts/character/${file}`), before=JSON.parse(fs.readFileSync(path.join(root,'before',file)));
    const dir=path.join(root,movement+(mirror?'_left':''));fs.mkdirSync(dir,{recursive:true});
    const cycle=path.join(dir,'cycle.mp4');
    if(only && only!==movement+(mirror?'_left':'')) { chapters.push(cycle); continue; }
    const bodyCache=new Map();
    for(let i=0;i<data.timeline.length;i++) {
      const offset=45+(380-data.canvas[1])/2;
      const left=archived(before,i).replace('<svg',`<svg y="${offset}"`);
      const right=render(movement,i/data.timeline.length,mirror).replace('<svg',`<svg x="360" y="${offset}"`);
      const text=`<text x="180" y="29" text-anchor="middle" font-size="18" fill="#606960">Было</text><text x="540" y="29" text-anchor="middle" font-size="18" fill="#35553d">Стало</text><text x="360" y="432" text-anchor="middle" font-size="16" fill="#35553d">${title}</text>`;
      await sharp(Buffer.from(wrapped(left+right+text,720,444))).png().toFile(path.join(dir,`compare-${String(i).padStart(3,'0')}.png`));
      for(const [label,svg] of [['before',archived(before,i,false)],['after',render(movement,i/data.timeline.length,mirror,false)]]) {
        const output=path.join(dir,`${label}-${String(i).padStart(3,'0')}.png`);
        if(bodyCache.has(svg)) fs.copyFileSync(bodyCache.get(svg),output);
        else {
          await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${data.canvas[1]}">${svg}</svg>`)).png().toFile(output);
          bodyCache.set(svg,output);
        }
      }
    }
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-framerate','30','-i',path.join(dir,'compare-%03d.png'),'-c:v','libx264','-pix_fmt','yuv420p','-crf','16','-movflags','+faststart','-y',cycle]);
    chapters.push(cycle); console.log(`${movement}${mirror?' left':''}: ${data.timeline.length} frames`);
  }
  const manifest=path.join(root,'chapters.txt');fs.writeFileSync(manifest,chapters.map(p=>`file '${p}'\n`).join(''));
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',manifest,'-c','copy','-movflags','+faststart','-y',path.join(root,'before-after.mp4')]);
  const details=[
    ['hands_behind','recordedHandsBehind.json','Плечи и края майки',[208,76,78,78]],
    ['quad_stretch','recordedQuadRight.json','Пунктиры',[108,156,106,86]],
    ['quad_stretch','recordedQuadRight.json','Подошва',[93,282,50,30]],
  ];
  let content='<text x="300" y="32" text-anchor="middle" font-size="24" fill="#606960">Было</text><text x="900" y="32" text-anchor="middle" font-size="24" fill="#35553d">Стало</text>';
  for(const [index,[movement,file,label,box]] of details.entries()) {
    const data=require(`../src/workouts/character/${file}`),old=JSON.parse(fs.readFileSync(path.join(root,'before',file))), sample=Math.floor(.4*data.timeline.length);
    const [tx,ty,s]=data.transform,[x,y,w,h]=box, viewBox=`${tx+x*s} ${ty+y*s} ${w*s} ${h*s}`;
    const top=70+index*310;
    for(const [col,svg] of [archived(old,sample),render(movement,sample/data.timeline.length)].entries())
      content+=svg.replace(/<svg[^>]*>/,`<svg x="${col*600+30}" y="${top}" width="540" height="270" viewBox="${viewBox}">`);
    content+=`<text x="600" y="${top-12}" text-anchor="middle" font-size="19" fill="#35553d">${label}</text>`;
  }
  await sharp(Buffer.from(wrapped(content,1200,990))).png().toFile(path.join(root,'details.png'));
  console.log(path.join(root,'before-after.mp4'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
