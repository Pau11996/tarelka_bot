const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src/workouts/character');
const svg = { __esModule: true, ...Object.fromEntries(Object.entries({ default: 'svg', G: 'g', Path: 'path' }).map(([key, tag]) => [key, props => React.createElement(tag, props)])) };
function load(file) {
  const scope = { exports: {}, require: name => name === 'react-native-svg' ? svg : require(name) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, scope);
  return scope.exports;
}
const motion = load('courseFloorMotion.ts');
const { CourseFloorCharacter } = load('CourseFloorCharacter.tsx');
const render = (name, t) => renderToStaticMarkup(React.createElement(CourseFloorCharacter, { frame: motion.floorFrame(name, t), size: 360 }));
module.exports = { ...motion, render };
if (require.main === module) (async () => {
  const sharp = require('/home/paul/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
  const out = path.resolve(__dirname, '../../outputs/workout-course'); fs.mkdirSync(out, { recursive: true });
  const names = ['glute_bridge', 'bird_dog'];
  const cells = names.flatMap((name, row) => [0, .2, .5, .7].map((t, col) => render(name, t).replace(/<svg[^>]+>/, `<svg x="${col * 360}" y="${row * 300}" width="360" height="300" viewBox="0 0 360 300">`))).join('');
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="600"><rect width="1440" height="600" fill="#f5f7f2"/>${cells}</svg>`)).png().toFile(path.join(out, 'new-exercises.png'));
  if (process.argv.includes('--video')) {
    fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
    for (let i = 0; i < 200; i++) {
      const body = names.map((name, col) => render(name, (i / 20 / motion.floorTiming[name].duration) % 1).replace(/<svg[^>]+>/, `<svg x="${col * 360}" width="360" height="300" viewBox="0 0 360 300">`)).join('');
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300"><rect width="720" height="300" fill="#f5f7f2"/>${body}</svg>`)).png().toFile(path.join(out, 'frames', `${String(i).padStart(4,'0')}.png`));
    }
  }
  console.log(out);
})();
