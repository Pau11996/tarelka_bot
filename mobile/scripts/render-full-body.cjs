const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src/workouts/character');
const tags = { default: 'svg', Svg: 'svg', G: 'g', Path: 'path', Ellipse: 'ellipse', Defs: 'defs', ClipPath: 'clipPath' };
const svg = { __esModule: true, ...Object.fromEntries(Object.entries(tags).map(([key, tag]) => [key, props => React.createElement(tag, props)])) };
const cache = new Map();
function load(file) {
  if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (cache.has(file)) return cache.get(file);
  const scope = { exports: {}, require: name => {
    if (name === 'react-native-svg') return svg;
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    return load([base, base + '.ts', base + '.tsx'].find(file => fs.existsSync(file)));
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, scope);
  cache.set(file, scope.exports); return scope.exports;
}
const motion = load(path.join(root, 'fullBodyMotion.ts'));
const { FullBodyCharacter } = load(path.join(root, 'FullBodyCharacter.tsx'));
const render = (movement, cycle, mirror = false, backdrop = true) => renderToStaticMarkup(React.createElement(FullBodyCharacter, { frame: motion.fullBodyFrame(movement, cycle, mirror), size: 360, backdrop }));
module.exports = { ...motion, render };
if (require.main === module) {
  const sharp = require(require.resolve('sharp', { paths: ['/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
  const out = path.resolve(__dirname, '../../outputs/workout-reference/full-body');
  fs.mkdirSync(out, { recursive: true });
  const steps = [...motion.fullBodyMovements, 'quad_stretch'];
  const titles = ['Колени к локтям', 'Вприсядку', 'Присед + удар', 'Отжимания от опоры', 'Отжимания от стула', 'Локти к бокам лёжа', 'Планка → V', 'Ноги к себе / от себя', 'Пресс', 'Руки за спиной', 'Растяжка · правая', 'Растяжка · левая'];
  const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const cell = (name, cycle, i, width = 360) => {
    const x = (i % 4) * width, y = Math.floor(i / 4) * 420;
    const figure = render(name, cycle, i === 11), box = figure.match(/viewBox="([^"]+)"/)[1];
    return figure.replace(/<svg[^>]*>/, `<svg x="${x}" y="${y + 28}" width="${width}" height="380" viewBox="${box}" fill="none">`)
      + `<text x="${x + width / 2}" y="${y + 23}" text-anchor="middle" font-size="17" fill="#35553d">${i + 1}. ${escape(titles[i])}</text>`;
  };
  (async () => {
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1260" font-family="DejaVu Sans"><rect width="1440" height="1260" fill="#f5f7f2"/>${steps.map((name, i) => cell(name, motion.fullBodyTiming[name].preview, i)).join('')}</svg>`;
    fs.writeFileSync(path.join(out, 'character-sheet.svg'), sheet);
    await sharp(Buffer.from(sheet)).png().toFile(path.join(out, 'character-sheet.png'));
    if (process.argv.includes('--video')) {
      const frames = path.join(out, 'preview-frames'); fs.mkdirSync(frames, { recursive: true });
      for (let i = 0; i < 240; i++) {
        const content = steps.map((name, j) => cell(name, (i / 20 / motion.fullBodyTiming[name].duration) % 1, j)).join('');
        await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1260" font-family="DejaVu Sans"><rect width="1440" height="1260" fill="#f5f7f2"/>${content}</svg>`)).resize(1080, 945).png().toFile(path.join(frames, `${String(i).padStart(4, '0')}.png`));
      }
    }
    console.log(out);
  })();
}
