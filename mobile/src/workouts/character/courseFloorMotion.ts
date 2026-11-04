export type FloorMovement = "glute_bridge" | "bird_dog" | "quadruped_leg";
export type Point = [number, number];
type Limb = { root: Point; joint: Point; end: Point };
export type FloorFrame = { movement: FloorMovement; shoulder: Point; hip: Point; head: Point; arms: Limb[]; legs: Limb[]; lift: number[]; label: string };
export const floorTiming = { glute_bridge: { duration: 5, preview: .45 }, bird_dog: { duration: 10, preview: .25 }, quadruped_leg: { duration: 10, preview: .25 } };
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ease = (t: number) => t * t * (3 - 2 * t);
function liftAt(t: number) { return t < .35 ? ease(t / .35) : t < .55 ? 1 : t < .9 ? 1 - ease((t - .55) / .35) : 0; }
/** Fixed segment lengths keep elbows and knees attached through the entire cycle. */
export function joint(root: Point, end: Point, upper: number, lower: number, bend: number): Point {
  const dx = end[0] - root[0], dy = end[1] - root[1], d = Math.hypot(dx, dy);
  const a = (upper * upper - lower * lower + d * d) / (2 * d), h = Math.sqrt(Math.max(0, upper * upper - a * a));
  return [root[0] + dx / d * a - dy / d * h * bend, root[1] + dy / d * a + dx / d * h * bend];
}
const limb = (root: Point, end: Point, a: number, b: number, bend: number): Limb => ({ root, end, joint: joint(root, end, a, b, bend) });
export function floorFrame(movement: FloorMovement, cycle: number): FloorFrame {
  const t = ((cycle % 1) + 1) % 1;
  if (movement === "glute_bridge") {
    const lift = liftAt(t), shoulder: Point = [92, 238];
    const alignedKnee = joint(shoulder, [288, 249], 172, 72, -1);
    const top = Math.atan2(shoulder[1] - alignedKnee[1], alignedKnee[0] - shoulder[0]);
    const angle = .02 + (top - .02) * lift;
    const hip: Point = [92 + 100 * Math.cos(angle), 238 - 100 * Math.sin(angle)];
    return { movement, shoulder, hip, head: [60, 244], lift: [lift, lift],
      arms: [limb([96, 233], [174, 242], 40, 40, 1), limb([96, 238], [174, 247], 40, 40, 1)],
      legs: [limb([hip[0] - 5, hip[1] - 5], [279, 243], 72, 72, -1), limb(hip, [288, 249], 72, 72, -1)],
      label: t < .35 ? "Плавно поднимите таз" : t < .55 ? "Удержите · ягодицы напряжены" : t < .9 ? "Медленно опуститесь" : "Исходное положение" };
  }
  const local = t < .5 ? t * 2 : (t - .5) * 2, lift = liftAt(local);
  // Far arm + near leg, then near arm + far leg: genuinely opposite sides.
  const legLift = t < .5 ? [0, lift] : [lift, 0];
  const armLift = movement === "quadruped_leg" ? [0, 0] : [legLift[1], legLift[0]];
  const shoulder: Point = [245, 170], hip: Point = [170, 170];
  return { movement, shoulder, hip, head: [275, 166], lift: legLift,
    arms: armLift.map((v, i) => { const r: Point = [245, 170 + i * 5]; return limb(r, mix([248 + i * 5, 250 + i * 5], [328, 170 + i * 5], v), 43, 43, -1); }),
    legs: legLift.map((v, i) => { const r: Point = [170, 170 + i * 5]; return limb(r, mix([102, 241 + i * 5], [29, 170 + i * 5], v), 78, 64, -1); }),
    label: local < .35 ? movement === "quadruped_leg" ? "Плавно вытяните одну ногу" : "Вытяните противоположные руку и ногу" : local < .55 ? "Таз ровно · спокойно дышите" : local < .9 ? "Вернитесь на четвереньки" : "Смените сторону" };
}
