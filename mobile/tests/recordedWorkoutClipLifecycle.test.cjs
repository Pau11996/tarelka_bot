const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { fullBodyFrame } = require('../scripts/render-full-body.cjs');

const root = path.resolve(__dirname, '../src/workouts/character');
const moving = {
  chair_dip: require('../src/workouts/character/recordedChairDip.json'),
  prone_pull: require('../src/workouts/character/recordedPronePull.json'),
  plank_pike: require('../src/workouts/character/recordedPlankPike.json'),
  seated_knee_tuck: require('../src/workouts/character/recordedSeatedKneeTuck.json'),
  crunch_reach: require('../src/workouts/character/recordedCrunchReach.json'),
};
const staticAssets = {
  hands_behind: require('../src/workouts/character/recordedHandsBehind.json'),
  quad_stretch: require('../src/workouts/character/recordedQuadRight.json'),
};

// Keep one component identity across updates. SSR creates fresh native state
// for every sample and cannot expose the Android ClipPath cache regression.
function mount(instance) {
  const cache = new Map();
  const react = { memo: component => component, useId: () => instance };
  const svg = { __esModule: true, default: 'svg', Defs: 'defs', ClipPath: 'clipPath', G: 'g', Path: 'path' };
  function load(file) {
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache.has(file)) return cache.get(file);
    const scope = { exports: {}, require(name) {
      if (name === 'react') return react;
      if (name === 'react-native-svg') return svg;
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), name);
        return load(fs.existsSync(resolved) ? resolved : resolved + '.ts');
      }
      return require(name);
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, scope);
    cache.set(file, scope.exports); return scope.exports;
  }
  const { RecordedWorkoutCharacter } = load(path.join(root, 'RecordedWorkoutCharacter.tsx'));
  return (frame, size = 300) => RecordedWorkoutCharacter({ frame, size });
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function clipOf(tree) { return nodes(tree).find(node => node.type === 'clipPath'); }

for (const [movement, data] of Object.entries(moving)) {
  test(`${movement}: a mounted animation replaces the native clip when its pose changes`, () => {
    for (const mirror of [false, true]) {
      const render = mount(`${movement}:${mirror}`);
      let mountedKey, nativeCachedContour, previousFrame, previousClip;
      // A preview followed by two cycles exercises start, moving poses,
      // stationary holds, the loop seam and reuse of a previous pose.
      const cycles = [data.preview, ...Array.from({length: data.timeline.length*2}, (_,i)=>i/data.timeline.length)];
      for (const cycle of cycles) {
        const frame = fullBodyFrame(movement, cycle, mirror), tree = render(frame);
        const clip = clipOf(tree), outline = nodes(clip).find(node=>node.type==='path');
        assert.ok(clip && outline);
        // react-native-svg 15.16 Android caches GroupView.getPath(). The
        // Path inside a definition isn't drawn, so updating d can return
        // early from VirtualView.invalidate() without clearing that cache.
        if (mountedKey !== clip.key) {
          mountedKey = clip.key; nativeCachedContour = outline.props.d;
        }
        assert.ok(nativeCachedContour === data.poses[frame.pose][0], `${movement}: stale mask at pose ${frame.pose}`);
        const body = nodes(tree).find(node=>node.props?.clipPath);
        assert.equal(body.props.clipPath, `url(#${clip.props.id})`);
        if (previousFrame && previousFrame.pose !== frame.pose) {
          assert.notEqual(clip.props.id, previousClip.props.id, 'clip consumer must also invalidate its cached reference');
        }
        assert.equal(tree.props.width, 300);
        assert.equal(tree.props.height, 300*data.canvas[1]/data.canvas[0]);
        previousFrame=frame; previousClip=clip;
      }
    }
  });
}

test('static stretches retain the clip while arrows and muscle dashes animate', () => {
  for (const [movement,data] of Object.entries(staticAssets)) {
    const render=mount(`static:${movement}`);
    const first=clipOf(render(fullBodyFrame(movement,0)));
    for(let i=1;i<data.timeline.length;i++) {
      const clip=clipOf(render(fullBodyFrame(movement,i/data.timeline.length)));
      assert.equal(clip.key,first.key);
      assert.equal(clip.props.id,first.props.id);
    }
  }
});

test('two mounted instances of the same exercise keep independent masks', () => {
  const a=mount('player'), b=mount('exercise-info');
  for(const movement of Object.keys(moving)) {
    const frame=fullBodyFrame(movement,.4);
    assert.notEqual(clipOf(a(frame)).props.id,clipOf(b(frame)).props.id);
  }
});
