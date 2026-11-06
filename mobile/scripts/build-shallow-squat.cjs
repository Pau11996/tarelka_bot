// Derive a shallow, feet-planted squat from the approved squat/kick artwork.
// Build-only: no image decoding, contour fitting or interpolation runs on device.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../src/workouts/character');
const input = fs.readFileSync(path.join(root, 'squatKickContours.json'));
const source = JSON.parse(input);
const samples = [36, 38, 40, 42, 44];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);

function contours(d) {
  return d.split('M').filter(Boolean).map(part => {
    const tokens = ('M' + part).match(/[MQZ]|-?\d+(?:\.\d+)?/g);
    const points = []; let i = 0, current;
    while (i < tokens.length) {
      const command = tokens[i++];
      if (command === 'M') { current = [+tokens[i++], +tokens[i++]]; points.push(current); }
      else if (command === 'Q') {
        const control = [+tokens[i++], +tokens[i++]], end = [+tokens[i++], +tokens[i++]];
        const count = Math.max(4, Math.ceil((distance(current, control) + distance(control, end)) / .35));
        for (let n = 1; n <= count; n++) {
          const t = n / count;
          points.push(mix(mix(current, control, t), mix(control, end, t), t));
        }
        current = end;
      } else if (command !== 'Z') throw Error(`Unexpected path command: ${command}`);
    }
    if (distance(points[0], points.at(-1)) < .001) points.pop();
    return points;
  });
}
function resample(points, count, closed = true) {
  const p = closed ? [...points, points[0]] : points;
  const lengths = [0];
  for (let i = 1; i < p.length; i++) lengths.push(lengths.at(-1) + distance(p[i - 1], p[i]));
  let segment = 1;
  return Array.from({ length: count }, (_, i) => {
    const target = lengths.at(-1) * i / (closed ? count : count - 1);
    while (segment < p.length - 1 && lengths[segment] < target) segment++;
    return mix(p[segment - 1], p[segment], (target - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1] || 1));
  });
}
function align(points, previous) {
  let best = 0, cost = Infinity;
  for (let shift = 0; shift < points.length; shift++) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) sum += distance(previous[i], points[(i + shift) % points.length]) ** 2;
    if (sum < cost) { cost = sum; best = shift; }
  }
  return points.map((_, i) => points[(i + best) % points.length]);
}
function splitAtAnkles(points) {
  const intersections = [];
  for (let i = 1; i < points.length; i++) if ((points[i - 1][1] > 310) !== (points[i][1] > 310)) {
    intersections.push({ i, point: mix(points[i - 1], points[i], (310 - points[i - 1][1]) / (points[i][1] - points[i - 1][1])) });
  }
  if (intersections.length !== 2) throw Error('Expected exactly two ankle crossings');
  const [start, end] = intersections;
  return { before: [...points.slice(0, start.i), start.point],
    top: [start.point, ...points.slice(start.i, end.i), end.point],
    after: [end.point, ...points.slice(end.i)] };
}
const parsed = samples.map(sample => source.poses[source.timeline[sample]].map(contours));
const foot = splitAtAnkles(parsed[0][0][0]);
const layers = parsed.map((pose, key) => pose.map((parts, layer) => parts.map((part, index) => {
  if (layer === 0) {
    const top = resample(splitAtAnkles(part).top, 200, false);
    const startShift = foot.top[0][0] - top[0][0], endShift = foot.top.at(-1)[0] - top.at(-1)[0];
    return top.map((p, i) => [p[0] + (i < top.length / 2 ? startShift : endShift) * ease(Math.max(0, Math.min(1, (p[1] - 290) / 20))), p[1]]);
  }
  // Sole and shoe are identical in every key pose; pin both throughout the loop.
  const fixed = Math.min(...part.map(p => p[1])) > 300;
  return resample(fixed ? parsed[0][layer][index] : part, fixed ? 32 : layer === 4 ? 48 : 64);
})));
for (let key = 1; key < layers.length; key++) for (let layer = 1; layer < layers[key].length; layer++) {
  layers[key][layer] = layers[key][layer].map((points, part) => align(points, layers[key - 1][layer][part]));
}
const pair = p => p.map(v => +v.toFixed(1)).join(',');
function pathFor(points) {
  let d = 'M' + pair(mix(points.at(-1), points[0], .5));
  for (let i = 0; i < points.length; i++) d += 'Q' + pair(points[i]) + ' ' + pair(mix(points[i], points[(i + 1) % points.length], .5));
  return d + 'Z';
}
function position(t) {
  if (t < .1 || t >= .95) return 0;
  if (t < .5) return ease((t - .1) / .4);
  if (t < .6) return 1;
  return 1 - ease((t - .6) / .35);
}
function interpolate(progress) {
  const segment = Math.min(samples.length - 2, Math.floor(progress * (samples.length - 1)));
  const t = progress * (samples.length - 1) - segment;
  return layers[segment].map((parts, layer) => parts.map((points, part) => {
    let result = points.map((p, i) => mix(p, layers[segment + 1][layer][part][i], t));
    if (layer === 0) result = [...resample(foot.before, 20, false).slice(0, -1), ...result, ...resample(foot.after, 20, false).slice(1)];
    return pathFor(result);
  }).join(''));
}
const poses = [], timeline = [], progress = [], lookup = new Map();
for (let sample = 0; sample < 120; sample++) {
  const amount = position(sample / 120), pose = interpolate(amount), key = JSON.stringify(pose);
  if (!lookup.has(key)) { lookup.set(key, poses.length); poses.push(pose); }
  timeline.push(lookup.get(key)); progress.push(+amount.toFixed(8));
}
const asset = {
  movement: 'squat', source: 'squatKickContours.json', sourceSha256: crypto.createHash('sha256').update(input).digest('hex'),
  sourceSamples: samples, sourceRecordingSha256: source.sourceSha256,
  derivation: 'Approved side-view contours; shallow depth, interpolated poses and fixed feet. No kick samples.',
  fps: 30, duration: 4, preview: .55, canvas: [360, 380], transform: [98, 28, .92],
  phases: [[0, 'Исходное положение'], [12, 'Плавно присядьте'], [60, 'Короткая пауза'], [72, 'Плавно выпрямитесь'], [114, 'Исходное положение']],
  cue: 'Таз назад · пятки на полу · глубина комфортная',
  palette: ['#f6b99e', '#589565', '#202b31', '#19252c', '#626463'],
  support: [['#d9dcda', 'M63,333C63,330.8 78.7,329 98,329C117.3,329 133,330.8 133,333C133,335.2 117.3,337 98,337C78.7,337 63,335.2 63,333Z']],
  timeline, progress, poses,
};
const output = path.join(root, 'shallowSquatContours.json');
fs.writeFileSync(output, JSON.stringify(asset) + '\n');
console.log(`${poses.length} poses, ${timeline.length} samples, ${fs.statSync(output).size} bytes → ${output}`);
