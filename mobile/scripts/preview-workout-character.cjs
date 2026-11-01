// Render the isolated character prototype into a standalone review page.
// No second drawing implementation, CDN, account or API is required by the page.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(root, 'outputs/workout-character'));
fs.mkdirSync(out, { recursive: true });
const tags = { Svg: 'svg', Circle: 'circle', ClipPath: 'clipPath', Defs: 'defs', Ellipse: 'ellipse', G: 'g', LinearGradient: 'linearGradient', Path: 'path', RadialGradient: 'radialGradient', Stop: 'stop' };
const svg = Object.fromEntries(Object.entries(tags).map(([name, tag]) => [name, ({ accessible, ...props }) => React.createElement(tag, props)]));
svg.default = svg.Svg; svg.__esModule = true;
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const scope = { exports: {}, require(name) {
    if (name === 'react-native-svg') return svg;
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
    return require(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, scope);
  cache.set(file, scope.exports); return scope.exports;
}
const { morningFrame, motionDuration, previewProgress } = load(path.join(root, 'mobile/src/workouts/character/morningMotion.ts'));
const { WorkoutCharacter } = load(path.join(root, 'mobile/src/workouts/character/WorkoutCharacter.tsx'));
// Pipe the catalogue from src.shared.workouts; never maintain a duplicate here.
const catalogue = JSON.parse(fs.readFileSync(process.argv[3] || 0, 'utf8'));
const routine = catalogue.workouts.find(w => w.id === 'morning');
const drawings = [], lookup = new Map();
const drawing = (exercise, phase, size = 360) => renderToStaticMarkup(React.createElement(WorkoutCharacter, { frame: morningFrame(exercise.animation, phase, exercise.mirror), size, still: true }), { identifierPrefix: `preview-${exercise.id}-${size}-` });
const exercises = routine.steps.map(step => {
  const exercise = catalogue.exercises.find(e => e.id === step.exercise_id);
  const frames = [], count = Math.ceil(motionDuration[exercise.animation] * 30);
  for (let i = 0; i < count; i++) {
    const rendered = drawing(exercise, i / count);
    if (!lookup.has(rendered)) { lookup.set(rendered, drawings.length); drawings.push(rendered); }
    const { label, phase, cue, phases } = morningFrame(exercise.animation, i / count, exercise.mirror);
    frames.push({ svg: lookup.get(rendered), label, phase, cue, phases });
  }
  return { ...exercise, seconds: motionDuration[exercise.animation], frames, preview: drawing(exercise, previewProgress[exercise.animation], 180) };
});
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const thumbnails = exercises.map((e, i) => `<button class="exercise" data-index="${i}" aria-pressed="${i === 0}"><span class="thumb">${e.preview}</span><span class="number">0${i + 1}</span><span>${escape(e.title)}</span></button>`).join('');
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Мягкая зарядка — персонаж «Тарелки»</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f8f9f1;color:#2c4636;font:15px system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:36px 28px}header{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}.brand{font-size:12px;letter-spacing:.17em;font-weight:750}.tag{font-size:12px;color:#6a7c60;background:#eaf0df;border-radius:20px;padding:8px 14px}h1{font-size:38px;letter-spacing:-1.1px;line-height:1.12;margin:12px 0}p{color:#73816a;line-height:1.6}.layout{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start}.stage{border:1px solid #dce5d0;border-radius:30px;overflow:hidden;background:#f0f3e6}.stage-top{display:flex;justify-content:space-between;padding:20px 24px 0;color:#738168;font-size:12px}.view{height:390px;display:flex;align-items:center;justify-content:center}.view svg{height:100%;width:auto;max-width:100%}.guide{padding:16px 24px 20px;border-top:1px solid #dce5d0;text-align:center;min-height:82px}.label{font-size:16px;font-weight:650}.cue{color:#74816c;margin-top:6px;font-size:13px}.dots{display:flex;gap:4px;justify-content:center;margin-bottom:9px}.dot{height:4px;width:5px;border-radius:4px;background:#bac9aa}.dot.active{width:18px;background:#557d53}.panel{padding:8px 2px}h2{font-size:24px;letter-spacing:-.5px;line-height:1.2;margin:16px 0 12px}.eyebrow{font-size:11px;letter-spacing:.16em;color:#799064;font-weight:700}.instruction{min-height:80px}.controls{margin:24px 0 28px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}button,select{font:inherit;color:inherit;border:1px solid #d5dfca;border-radius:14px;background:#fffdf5;padding:11px 16px;cursor:pointer}button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #8fab6e;outline-offset:3px}#play{background:#41684b;color:#fff;border:0;min-width:138px}input[type=range]{width:100%;accent-color:#557f50;cursor:pointer}.scrub{display:flex;justify-content:space-between;color:#7c8874;font-size:12px;margin:8px 0}.note{padding:17px 18px;background:#edf1e3;border-radius:18px;font-size:13px;line-height:1.6;color:#68785f}.exercise-list{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:28px}.exercise{position:relative;text-align:left;padding:10px 12px 14px;min-width:0;line-height:1.4;font-size:12px;font-weight:600;background:#fafbf5}.exercise[aria-pressed=true]{border:2px solid #6a8a53;padding:9px 11px 13px;background:#edf2df}.thumb{display:flex;justify-content:center;height:134px;overflow:hidden}.thumb svg{width:126px;height:133px}.number{position:absolute;top:12px;left:12px;color:#9aa68a;font-size:10px}footer{margin-top:28px;font-size:12px;color:#8b967f}.status{color:#839274;font-size:12px}@media(max-width:700px){main{padding:22px 18px}.layout{grid-template-columns:1fr;gap:18px}h1{font-size:30px}.view{height:330px}.exercise-list{grid-template-columns:repeat(2,1fr)}.instruction{min-height:0}.tag{display:none}.panel{padding:0}.controls{margin:18px 0}.thumb{height:110px}.thumb svg{height:110px}.stage-top{padding:18px 20px 0}}</style>
<main><header><span class="brand">ТАРЕЛКА / ДВИЖЕНИЕ</span><span class="tag">Проработка персонажа</span></header><div class="layout"><div><div class="eyebrow">СПОКОЙНОЕ НАЧАЛО ДНЯ</div><h1>Мягкая зарядка</h1><p>8 движений. Один понятный, спокойный тренер.</p><div class="stage"><div class="stage-top"><span id="position">01 / 08</span><span id="status">Демонстрация</span></div><div class="view" id="view" role="img" aria-label="Демонстрация упражнения"></div><div class="guide"><div class="dots" id="dots"></div><div class="label" id="label"></div><div class="cue" id="cue"></div></div></div></div><section class="panel"><div class="eyebrow">ТЕХНИКА ДВИЖЕНИЯ</div><h2 id="title"></h2><p class="instruction" id="instruction"></p><div class="controls"><button id="play">Пауза</button><label for="speed">Темп</label><select id="speed"><option value=".5">× 0,5</option><option value="1" selected>× 1</option><option value="1.5">× 1,5</option></select></div><input id="scrub" type="range" min="0" max="1000" value="0" aria-label="Фаза движения"><div class="scrub"><span>Начало движения</span><span>Полный цикл</span></div><p class="note">Повторяйте как в зеркале, в своём темпе. Можно остановить демонстрацию и рассмотреть любую позу. Ползунок меняет только показ движения.</p><div class="exercise-list">${thumbnails}</div></section></div><footer>Демонстрации из приложения. Повторяйте в удобном темпе; направления показаны как в зеркале.</footer></main>
<script type="application/json" id="data">${JSON.stringify({ exercises: exercises.map(({ preview, ...e }) => e), drawings }).replaceAll('<', '\\u003c')}</script>
<script>const {exercises,drawings}=JSON.parse(document.getElementById('data').textContent);const $=id=>document.getElementById(id);let selected=0,elapsed=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=0,lastIndex=-1,rate=1;function draw(){const e=exercises[selected],i=Math.min(e.frames.length-1,Math.floor(elapsed/e.seconds*e.frames.length)),f=e.frames[i];if(i!==lastIndex){$('view').innerHTML=drawings[f.svg];$('label').textContent=f.label;$('cue').textContent=f.cue;$('dots').innerHTML=f.phases.map((_,n)=>'<span class="dot '+(n===f.phase?'active':'')+'"></span>').join('');lastIndex=i;}$('scrub').value=elapsed/e.seconds*1000;$('play').textContent=playing?'Пауза':'Продолжить';$('status').textContent=playing?'Демонстрация':'На паузе';}function select(i){selected=i;elapsed=0;lastIndex=-1;const e=exercises[i];$('title').textContent=e.title;$('instruction').textContent=e.instruction;$('position').textContent=String(i+1).padStart(2,'0')+' / 08';$('view').setAttribute('aria-label',e.title);document.querySelectorAll('.exercise').forEach((b,n)=>b.setAttribute('aria-pressed',n===i));draw();}document.querySelectorAll('.exercise').forEach(b=>b.onclick=()=>select(Number(b.dataset.index)));$('play').onclick=()=>{playing=!playing;draw()};$('speed').onchange=e=>rate=Number(e.target.value);$('scrub').oninput=e=>{playing=false;elapsed=Number(e.target.value)/1000*(exercises[selected].seconds-.00001);draw()};document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;draw()}});function tick(now){if(playing&&last)elapsed=(elapsed+Math.min((now-last)/1000,.08)*rate)%exercises[selected].seconds;last=now;draw();requestAnimationFrame(tick)}select(0);requestAnimationFrame(tick);</script></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
let sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="920" viewBox="0 0 1440 920"><rect width="1440" height="920" fill="#f3f5e9"/><text x="40" y="44" font-family="sans-serif" font-size="26" font-weight="bold" fill="#2c4636">Тарелка · Мягкая зарядка</text>';
exercises.forEach((e, i) => {
  const x = i % 4 * 360, y = 70 + Math.floor(i / 4) * 420;
  sheet += drawing(e, previewProgress[e.animation], 340).replace('<svg ', `<svg x="${x + 10}" y="${y + 32}" `);
  sheet += `<text x="${x + 180}" y="${y + 20}" text-anchor="middle" font-family="sans-serif" fill="#486348" font-size="16">${i + 1}. ${escape(e.title)}</text>`;
});
fs.writeFileSync(path.join(out, 'all-exercises.svg'), sheet + '</svg>');
console.log(JSON.stringify({ output: out, exercises: exercises.length, uniqueFrames: drawings.length, htmlBytes: Buffer.byteLength(html) }));
