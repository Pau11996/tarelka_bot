const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src/workouts/character'), cache = new Map();
const svg = { __esModule: true, default: 'svg', G: 'g', Path: 'path' };
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const scope = { exports: {}, require: name => name === 'react-native-svg' ? svg : name.startsWith('.') ? load(name.slice(2) + '.ts') : require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, scope);
  cache.set(file, scope.exports); return scope.exports;
}
const motion = load('pushupMotion.ts'), { PushupCharacter } = load('PushupCharacter.tsx');
const render = (movement, cycle) => renderToStaticMarkup(React.createElement(PushupCharacter, { frame: motion.pushupFrame(movement, cycle), size: 400 }));
module.exports = { ...motion, render };
if (require.main === module) {
  const out = process.argv[2] ?? path.resolve(__dirname, '../../outputs/workout-pushups');
  fs.mkdirSync(out, { recursive: true });
  const cells = ['push_up', 'knee_push_up'].flatMap((name, row) => [0, .225, .5, .75].map((cycle, col) => render(name, cycle).replace('<svg ', `<svg x="${col * 400}" y="${row * 280}" `))).join('');
  fs.writeFileSync(path.join(out, 'pushups.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="560"><rect width="1600" height="560" fill="#f5f7f2"/>${cells}</svg>`);
  console.log(path.join(out, 'pushups.svg'));
}
