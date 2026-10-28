// Render the actual diary components with demonstration values for visual review.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const root = path.resolve(__dirname, '../../..');
const req = Module.createRequire(path.join(root, 'mobile/package.json'));
const React = req('react');
const Native = req('react-native-web');
const ts = req('typescript');
const render = req('react-dom/server').renderToStaticMarkup;
const h = React.createElement;
const originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name === 'react-native') return Native;
  return originalLoad.call(this, name, ...rest);
};
const Svg = req('./node_modules/react-native-svg/lib/commonjs/elements.web.js');
const cache = new Map();
function load(file) {
  file = path.resolve(root, 'mobile/src', file);
  if (!path.extname(file)) file += fs.existsSync(file + '.tsx') ? '.tsx' : '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, Intl, console, require(name) {
    if (name === 'react-native') return Native;
    if (name === 'react-native-svg') return Svg;
    if (name === 'expo-router') return { router: { push() {} } };
    if (name === './FavoriteButton') return { FavoriteButton: () => null };
    if (name === './DailyNormCard') return { DailyNormCard: () => null };
    if (name === '../sharing/shareImage') return {};
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
    return req(name);
  } }, { filename: file });
  return module.exports;
}
const day = { profile_complete: true, date: '2026-10-28', entries: [], balance: { target: 2100, consumed: 1650, activity_bonus: 0, remaining: 450, protein_g: 75, fat_g: 54, carbs_g: 195 }, nutrient_targets: { protein_g: 120, fat_g: 60, carbs_g: 270 } };
const { DiaryEnergy, DiaryNutrients } = load('components/DiaryDay.tsx');
const { DailyNormShare } = load('components/DailyNormShare.tsx');
const content = render(h(Native.View, { style: { width: 390, backgroundColor: '#f5f8f3', padding: 16, gap: 14 } },
  h(Native.Text, { accessibilityRole: 'header', style: { fontSize: 28, lineHeight: 36, fontWeight: '700', color: '#182c23', letterSpacing: -.7, marginBottom: 2 } }, 'Дневник'),
  h(DiaryEnergy, { day }), h(DiaryNutrients, { day }), h(DailyNormShare, { day }),
));
Native.AppRegistry.registerComponent('ShareButtonPreview', () => () => null);
const styles = render(Native.AppRegistry.getApplication('ShareButtonPreview').getStyleElement());
fs.writeFileSync(path.join(__dirname, 'share-button.html'), `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Кнопка «Поделиться нормой»</title>${styles}<style>html,body{margin:0;background:#f5f8f3}body{font-family:Arial,sans-serif}main{width:390px}#note{color:#7b897b;font-size:11px;line-height:17px;padding:0 16px 18px;margin:0}</style></head><body><main>${content}<p id="note">Фрагмент дневника · демонстрационные значения</p></main></body></html>`);
console.log('Rendered share-button.html from app components');
