// Build the compact 1080 × 144 Telegram artwork from D6 without extra captions.
// Requires mobile dependencies and sharp (or SHARP_MODULE pointing to its path).
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const req = Module.createRequire(path.join(root, 'mobile/package.json'));
const React = req('react');
const Native = req('react-native-web');
const ts = req('typescript');
const render = req('react-dom/server').renderToStaticMarkup;
const originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name === 'react-native') return Native;
  if (name.endsWith('/resolveAssetUri')) return { resolveAssetUri: source => ({ uri: typeof source === 'string' ? source : source.uri }) };
  return originalLoad.call(this, name, ...rest);
};
const svg = req('./node_modules/react-native-svg/lib/commonjs/elements.web.js');
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'mobile/src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require(name) {
    if (name === 'react-native') return Native;
    if (name === 'react-native-svg') return svg;
    if (name === '../sharing/dailyNorm') return load('sharing/dailyNorm.ts');
    return req(name);
  } };
  vm.runInNewContext(code, context);
  return context.exports;
}
const Card = load('components/DailyNormCard.tsx').DailyNormCard;
const cat = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'mobile/assets/share/meme-cat.png')).toString('base64');
const norm = { calories: 2100, protein: 120, fat: 60, carbs: 270, personalized: true };
let markup = render(React.createElement(Card, { norm, cat, onCatLoad() {} }));
markup = markup.replace('width="100%"', 'width="1080"').replace('height="100%"', 'height="144"');
let removed = 0;
markup = markup.replace(/<text\b[^>]*\by="(?:23|76|98)"[^>]*>[\s\S]*?<\/text>/g, () => { removed++; return ''; });
if (removed !== 6) throw new Error('D6 text positions changed; update the Telegram renderer too.');
// Reposition the original artwork; keep the metric fonts at their full size.
const compactLayout = [
  ['viewBox="0 0 540 108"', 'viewBox="0 0 540 72"'],
  ['<rect width="540" height="108"', '<rect width="540" height="72"'],
  ['<rect width="177" height="108"', '<rect width="177" height="72"'],
  ['d="M177 0v108"', 'd="M177 0v72"'],
  ['x="-4" y="9" width="110" height="110"', 'x="-4" y="0" width="90" height="90"'],
  ['rotate(-5 51 64)', 'rotate(-5 41 45)'],
  ['x="136" y="85"', 'x="143" y="69"'],
  ['rotate(13 150 74)', 'rotate(13 150 68)'],
  ['font-size:29;', 'font-size:22;'],
  ['<g fill="#274d35"', '<g transform="translate(0 -25)" fill="#274d35"'],
  ['translate(468 86)', 'translate(468 77)'],
  ['x="484" y="99"', 'x="484" y="90"'],
];
for (const [original, replacement] of compactLayout) {
  if (!markup.includes(original)) throw new Error(`D6 artwork changed: missing ${original}`);
  markup = markup.replace(original, replacement);
}
const sharp = require(process.env.SHARP_MODULE || 'sharp');
sharp(Buffer.from(markup)).png().toFile(path.join(root, 'src/bot/assets/share/daily-norm-template.png')).catch(error => {
  console.error(error); process.exitCode = 1;
});
