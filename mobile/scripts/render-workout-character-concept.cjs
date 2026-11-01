// Review sheet for the isolated vector prototype. Does not touch the application.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const tags = { Svg: 'svg', Circle: 'circle', ClipPath: 'clipPath', Defs: 'defs', Ellipse: 'ellipse', G: 'g', LinearGradient: 'linearGradient', Path: 'path', RadialGradient: 'radialGradient', Stop: 'stop' };
const svg = Object.fromEntries(Object.entries(tags).map(([name, tag]) => [name, props => React.createElement(tag, props)]));
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
const prototype = path.join(root, 'mobile/src/workouts/character');
const { morningFrame, morningMovements, motionDuration } = load(path.join(prototype, 'morningMotion.ts'));
const { WorkoutCharacter } = load(path.join(prototype, 'WorkoutCharacter.tsx'));
let drawingSerial = 0;
const renderCharacter = (movement, phase, { mirror = false, ...props } = {}) => renderToStaticMarkup(React.createElement(WorkoutCharacter, { frame: morningFrame(movement, phase, mirror), size: 360, still: true, ...props }), { identifierPrefix: `review${drawingSerial++}-` });
const drawing = (movement, phase, x, y, width, height, viewBox = '0 0 360 380', backdrop = true) => {
  const markup = renderCharacter(movement, phase, { backdrop });
  return markup.replace(/<svg[^>]*>/, `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox}" fill="none">`);
};
const label = (x, y, text, size = 16, color = '#6b7d60', weight = 400) => `<text x="${x}" y="${y}" font-family="DejaVu Sans,sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text>`;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1050" viewBox="0 0 1400 1050">
  <rect width="1400" height="1050" fill="#f6f7ef"/>
  ${label(60, 58, 'Т А Р Е Л К А  /  Д В И Ж Е Н И Е', 15, '#607b55', 600)}
  ${label(60, 113, 'Персонаж · версия 06', 38, '#2c4636', 600)}
  ${label(60, 150, 'Спортивная майка · взрослые пропорции · простые формы', 19)}
  <rect x="60" y="190" width="655" height="780" rx="32" fill="#f0f2e9"/>
  ${drawing('shoulders', 0, 60, 205, 655, 730, '75 55 210 310')}
  ${label(92, 940, '01  /  Основной образ', 16, '#526a49')}
  <rect x="745" y="190" width="595" height="325" rx="32" fill="#f0f2e9"/>
  ${drawing('shoulders', 0, 870, 199, 345, 275, '118 48 124 99', false)}
  ${label(775, 488, 'Майка, открытые плечи, простые формы', 16)}
  <rect x="745" y="540" width="285" height="430" rx="28" fill="#f0f2e9"/>
  <rect x="1055" y="540" width="285" height="430" rx="28" fill="#f0f2e9"/>
  ${drawing('arm_raise', .43, 745, 565, 285, 350)}
  ${drawing('march', .22, 1055, 565, 285, 350)}
  ${label(772, 940, '02  /  Подъём рук', 16, '#526a49')}
  ${label(1082, 940, '03  /  Шаг на месте', 16, '#526a49')}
  ${label(60, 1016, 'ПЕРСОНАЖ 06', 13, '#849276', 600)}
  ${label(745, 1016, 'Утверждённый образ · демонстрации для приложения', 13, '#849276')}
</svg>`;
module.exports = { renderCharacter, morningMovements, morningFrame, motionDuration };
if (require.main === module) {
  const out = path.join(root, 'outputs/workout-character');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'character-concept-v6.svg'), sheet);
  const sharp = require(require.resolve('sharp', { paths: [process.env.WORKOUT_RENDER_NODE_MODULES || '/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'] }));
  sharp(Buffer.from(sheet)).png().toFile(path.join(out, 'character-concept-v6.png')).then(() => console.log(path.join(out, 'character-concept-v6.png')));
}
