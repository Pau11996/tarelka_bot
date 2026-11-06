// Offline rig of the approved character. Runtime only reads local SVG poses.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../src/workouts/character');
const input = fs.readFileSync(path.join(root, 'squatKickContours.json'));
const source = JSON.parse(input), sourceSample = 36;
const palette = ['#f6b99e', '#589565', '#202b31', '#19252c', '#626463', '#f6b99e', '#dda58e'];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const add = (a, b, k = 1) => a.map((v, i) => v + b[i] * k);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ease = t => t * t * t * (t * (t * 6 - 15) + 10);
const pair = p => p.map(v => +v.toFixed(1)).join(',');

function contours(d) {
  return d.split('M').filter(Boolean).map(part => {
    const tokens = ('M' + part).match(/[MQZ]|-?\d+(?:\.\d+)?/g);
    const points = []; let i = 0, current;
    while (i < tokens.length) {
      const command = tokens[i++];
      if (command === 'M') { current = [+tokens[i++], +tokens[i++]]; points.push(current); }
      else if (command === 'Q') {
        const control = [+tokens[i++], +tokens[i++]], end = [+tokens[i++], +tokens[i++]];
        const count = Math.max(4, Math.ceil((distance(current, control) + distance(control, end)) / .5));
        for (let n = 1; n <= count; n++) {
          const t = n / count;
          points.push(mix(mix(current, control, t), mix(control, end, t), t));
        }
        current = end;
      } else if (command !== 'Z') throw Error(`Unexpected command ${command}`);
    }
    return simplify(points, .08);
  });
}
// Keep source curves within 0.08 source pixels while avoiding thousands of points.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const a = points[0], b = points.at(-1), dx = b[0] - a[0], dy = b[1] - a[1];
  let largest = 0, split = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const t = Math.max(0, Math.min(1, ((points[i][0] - a[0]) * dx + (points[i][1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const d = distance(points[i], mix(a, b, t));
    if (d > largest) { largest = d; split = i; }
  }
  return largest <= tolerance ? [a, b] : [...simplify(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplify(points.slice(split), tolerance)];
}
function clip(points, axis, value, keepGreater) {
  const output = [], inside = p => keepGreater ? p[axis] >= value : p[axis] <= value;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (inside(a)) output.push(a);
    if (inside(a) !== inside(b)) output.push(mix(a, b, (value - a[axis]) / (b[axis] - a[axis])));
  }
  return output;
}
function polygon(points) {
  // Matching winding makes overlapping anatomical parts a union under nonzero.
  const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
  const p = area < 0 ? [...points].reverse() : points;
  return 'M' + p.map(pair).join('L') + 'Z';
}
function cubicOutline(start, segments) {
  const points = [start]; let current = start;
  for (const [a,b,end] of segments) {
    const segment=[current];
    for (let i=1;i<=12;i++) {
      const t=i/12;
      segment.push(mix(mix(mix(current,a,t),mix(a,b,t),t),mix(mix(a,b,t),mix(b,end,t),t),t));
    }
    // Preserve fixed segments exactly when neighboring arm curves move.
    points.push(...simplify(segment,.035).slice(1));
    current=end;
  }
  return points;
}
const original = source.poses[source.timeline[sourceSample]].map(contours);
const skin = original[0][0];
const head = clip(clip(skin, 0, 105, false), 1, 88, false);
const lower = clip(clip(skin, 1, 145, true), 1, 315, false);
// The tank outline also defines the torso, so the skin mask cannot trim its edges.
const torso = original[1][0];
// The source armhole belonged to a bent fist pose. Close its notch under the
// new arm, keeping the cloth behind the arm and continuing into the chest edge.
const armhole = cubicOutline([64,110],[
  [[80,108],[95,111],[99,117]],
  [[100,121],[100.4,127],[100.4,131]],
  [[97,136],[76,137],[65,131]],
  [[63,123],[63,115],[64,110]],
]);
const shoulderSkin=clip(clip(clip(skin,0,96,false),1,80,true),1,138,false);
const ankle = [84,313], shoulderLocal = [82,103], hipLocal = [80,175], kneeLocal = [89,240];
const wrist = [211,98], upperArm = 48, forearm = 46;
const atWrist = p => add(wrist,p);
// Reduce hand thickness by one third, keeping the palm against the wall.
const narrowHand = ([x,y]) => [220 + (x - 220) * 2 / 3, y];
const wristTop=narrowHand(atWrist([-2,-4])),wristBottom=narrowHand(atWrist([1,6]));
// One open contour runs from the back of the wrist, along grouped extended
// fingers, down the flat wall contact, and back through the heel of the palm.
// These segments are embedded directly in the arm instead of attached as a blob.
const handSegments=[
  [[210,92],[209.5,89],[210,86]],
  [[210.5,83],[210.5,79],[211,77]],
  [[211.4,75],[212.7,74.7],[213.5,75.5]],
  [[213.8,73.3],[215,72.1],[216,73]],
  [[216.8,73],[217.6,74],[217.9,75]],
  [[219.1,74.6],[220,75.6],[220,77]],
  [[220,84],[220,94],[220,100]],
  [[220,102],[217,102.8],[214,103.5]],
  [[215,103.5],[214,103.5],atWrist([1,6])],
].map(segment => segment.map(narrowHand));
const handDetails=[
  cubicOutline([213.2,78],[
    [[213.5,80.5],[213.5,84],[213.4,86.5]],
    [[213.5,87.3],[214,87.3],[214,86.5]],
    [[214.2,83.5],[214.1,80],[213.8,78]],
    [[213.7,77.5],[213.3,77.5],[213.2,78]],
  ]),
  cubicOutline([216,76.5],[
    [[216.3,79],[216.4,83],[216.2,86.5]],
    [[216.3,87.3],[216.8,87.3],[216.9,86.5]],
    [[217,82.5],[216.9,78.8],[216.6,76.5]],
    [[216.5,76],[216.1,76],[216,76.5]],
  ]),
  cubicOutline([211,92.5],[
    [[213,92],[215,94.5],[215.7,98]],
    [[215.9,98.7],[216.3,98.4],[216.3,97.9]],
    [[215.8,94],[213.2,91.3],[211.2,91.9]],
    [[210.7,92.1],[210.7,92.5],[211,92.5]],
  ]),
].map(points => polygon(points.map(narrowHand))).join('');
// One shoe shape supplies both the silhouette and the complete solid fill.
// No skin-colored source foot or separate broken sole lies underneath it.
const shoePoints=cubicOutline([73.5,315],[
  [[79,315],[85,314],[89,312]],
  [[92,312],[95,316],[99,317]],
  [[104,319],[111,319],[112,324]],
  [[113,328],[111,330.5],[107,330.5]],
  [[96,330.5],[84,330.5],[76,330.5]],
  [[72,330.5],[72,328],[72.5,324]],
  [[72.6,321],[73,317], [73.5,315]],
]);
const shoe=polygon(shoePoints);
function depth(t) {
  if (t < .1 || t >= .95) return 0;
  if (t < .5) return ease((t - .1) / .4);
  if (t < .6) return 1;
  return 1 - ease((t - .6) / .35);
}
function rig(progress) {
  const angle = (10 + progress * 9) * Math.PI / 180;
  const rotate = p => [ankle[0] + (p[0] - ankle[0]) * Math.cos(angle) - (p[1] - ankle[1]) * Math.sin(angle), ankle[1] + (p[0] - ankle[0]) * Math.sin(angle) + (p[1] - ankle[1]) * Math.cos(angle)];
  const shoulder = rotate(shoulderLocal), d = distance(shoulder, wrist);
  if (d >= upperArm + forearm || d <= Math.abs(upperArm - forearm)) throw Error('Unreachable wrist');
  const u = [(wrist[0] - shoulder[0]) / d, (wrist[1] - shoulder[1]) / d], n = [-u[1], u[0]];
  const along = (upperArm ** 2 - forearm ** 2 + d * d) / (2 * d);
  const elbow = add(add(shoulder, u, along), n, Math.sqrt(upperArm ** 2 - along ** 2));
  return { rotate, shoulder, elbow, wrist, ankle, hip: rotate(hipLocal), knee: rotate(kneeLocal), angle };
}
function arm(r) {
  const { shoulder: s, elbow: e, wrist: w } = r;
  const u = [(e[0] - s[0]) / upperArm, (e[1] - s[1]) / upperArm], v = [(w[0] - e[0]) / forearm, (w[1] - e[1]) / forearm];
  const un = [-u[1], u[0]], vn = [-v[1], v[0]], normal = add(un, vn), norm = Math.hypot(...normal);
  const en = normal.map(x => x / norm);
  const elbowTangent=[en[1],-en[0]];
  const capTop=r.rotate([76,87]), capBottom=r.rotate([77,119]);
  const upperFront=add(mix(s,e,.42),un,-10.5);
  const inner=add(e,en,-10.5);
  const forearmFront=add(mix(e,w,.36),vn,-7.2);
  const forearmBack=add(mix(e,w,.35),vn,8.2);
  const tip=add(e,en,7.5);
  const upperBack=add(mix(s,e,.6),un,10.5);
  // The deltoid is anchored to the torso. Two distinct tapered segments meet
  // at a small elbow curve; the outer contour is not one elastic capsule.
  const outer=cubicOutline(capTop,[
    [r.rotate([87,86]),add(upperFront,u,-8),upperFront],
    [add(upperFront,u,10),add(inner,elbowTangent,-3),inner],
    [add(inner,elbowTangent,3),add(forearmFront,v,-7),forearmFront],
    [add(forearmFront,v,10),add(wristTop,[-3,6]),wristTop],
    ...handSegments,
    [add(wristBottom,[-6,1.5]),add(forearmBack,v,8),forearmBack],
    [add(forearmBack,v,-7),add(tip,elbowTangent,5),tip],
    [add(tip,elbowTangent,-5),add(upperBack,u,7),upperBack],
    [add(upperBack,u,-9),r.rotate([85,120]),capBottom],
    [r.rotate([68,119]),r.rotate([63,113]),r.rotate([64,103])],
    [r.rotate([64,94]),r.rotate([68,88]),capTop],
  ]);
  return { outer };
}
function makePose(progress) {
  const r = rig(progress), a = arm(r);
  const leg = lower.map(p => {
    const rotated = r.rotate(p);
    // Ankle rolls above a stationary shoe; the sole never rotates or slides.
    return mix(rotated, p, ease(Math.max(0, Math.min(1, (p[1] - 295) / 20))));
  });
  const body = [head.map(r.rotate),torso.map(r.rotate),armhole.map(r.rotate),shoulderSkin.map(r.rotate),leg,shoePoints,a.outer].map(polygon).join('');
  return [body,polygon(torso.map(r.rotate))+polygon(armhole.map(r.rotate)),polygon(original[2][0].map(r.rotate)),'',polygon(original[4][0].map(r.rotate))+shoe,polygon(a.outer),handDetails];
}
const poses = [], timeline = [], progress = [], joints = [], lookup = new Map();
for (let sample = 0; sample < 120; sample++) {
  const amount = depth(sample / 120), pose = makePose(amount), key = JSON.stringify(pose), r = rig(amount);
  if (!lookup.has(key)) { lookup.set(key, poses.length); poses.push(pose); }
  timeline.push(lookup.get(key)); progress.push(+amount.toFixed(8));
  joints.push(Object.fromEntries(['shoulder','elbow','wrist','ankle','hip','knee'].map(key => [key,r[key]])));
}
const asset = {
  movement:'wall_push',source:'squatKickContours.json',sourceSha256:crypto.createHash('sha256').update(input).digest('hex'),sourceSample,
  sourceRecordingSha256:source.sourceSha256,derivation:'Approved head, clothes and leg contours; authored wall-push rig with anchored shoulder, two-bone arm IK, fixed palm and solid shoes.',
  fps:30,duration:4,preview:.55,canvas:[360,380],transform:[30,18,.96],fillRule:'nonzero',
  phases:[[0,'Исходное положение'],[12,'Плавно согните локти'],[60,'Короткая пауза'],[72,'Оттолкнитесь от стены'],[114,'Исходное положение']],
  cue:'Корпус ровный · ладони на стене · стопы не скользят',palette,
  support:[['#e7ebe3','M220,34L245,24L245,332L220,332Z'],['#c8d1c4','M220,34H222V333H220Z'],['#d9dcda','M64,333C64,329 78,328 98,328C118,328 132,330 132,333C132,336 118,337 98,337C78,337 64,336 64,333Z']],
  timeline,progress,poses,
};
function build() {
  const output = path.join(root,'wallPushContours.json');
  fs.writeFileSync(output,JSON.stringify(asset)+'\n');
  console.log(`${poses.length} poses, ${timeline.length} samples, ${fs.statSync(output).size} bytes → ${output}`);
}
module.exports = { asset, rig, depth, joints, upperArm, forearm };
if (require.main === module) build();
