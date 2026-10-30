import type { AnimationName } from "./types";
export type Point = [number, number];
export type Pose = { head: Point; shoulderL: Point; shoulderR: Point; elbowL: Point; elbowR: Point; handL: Point; handR: Point; hipL: Point; hipR: Point; kneeL: Point; kneeR: Point; footL: Point; footR: Point };
const mix = (a: Point, b: Point, p: number): Point => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p];
export const animationSeconds = (name: AnimationName) => ["chest", "side_bend", "calf_stretch"].includes(name) ? 8 : ["squat", "wall_push"].includes(name) ? 4 : 3;
export function exercisePose(name: AnimationName, cycle: number): Pose {
  const wave = Math.sin(cycle * 2 * Math.PI), p = (1 - Math.cos(cycle * 2 * Math.PI)) / 2;
  const hold = Math.min(1, p * 4);
  const pose: Pose = { head: [120, 45], shoulderL: [103, 80], shoulderR: [137, 80], elbowL: [94, 111], elbowR: [146, 111], handL: [90, 140], handR: [150, 140], hipL: [109, 145], hipR: [131, 145], kneeL: [106, 189], kneeR: [134, 189], footL: [103, 233], footR: [137, 233] };
  if (name === "march") {
    const left = Math.max(0, wave), right = Math.max(0, -wave);
    pose.kneeL = mix(pose.kneeL, [96, 164], left); pose.footL = mix(pose.footL, [87, 197], left);
    pose.kneeR = mix(pose.kneeR, [144, 164], right); pose.footR = mix(pose.footR, [153, 197], right);
    pose.elbowR = mix(pose.elbowR, [153, 103], left); pose.handR = mix(pose.handR, [148, 78], left);
    pose.elbowL = mix(pose.elbowL, [87, 103], right); pose.handL = mix(pose.handL, [92, 78], right);
  } else if (name === "side_step") {
    // Step out, bring the trailing foot in, then return; one foot stays planted.
    const frames = [[0, 0], [0, 30], [30, 30], [0, 30], [0, 0]];
    const phase = ((cycle % 1) + 1) % 1 * 4, index = Math.floor(phase), t = phase - index;
    const eased = (1 - Math.cos(t * Math.PI)) / 2;
    const left = frames[index][0] + (frames[index + 1][0] - frames[index][0]) * eased;
    const right = frames[index][1] + (frames[index + 1][1] - frames[index][1]) * eased;
    const offset = (left + right) / 2;
    for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key][0] += offset;
    pose.footL = [103 + left, 233 - (index === 1 || index === 2 ? Math.sin(t * Math.PI) * 5 : 0)];
    pose.footR = [137 + right, 233 - (index === 0 || index === 3 ? Math.sin(t * Math.PI) * 5 : 0)];
    pose.kneeL[0] = (pose.hipL[0] + pose.footL[0]) / 2;
    pose.kneeR[0] = (pose.hipR[0] + pose.footR[0]) / 2;
  } else if (name === "shoulders") {
    for (const key of ["shoulderL", "shoulderR", "elbowL", "elbowR", "handL", "handR"] as const) pose[key][1] -= p * 9;
  } else if (name === "arm_raise") {
    // Rotate both arms around their shoulders, retaining segment lengths.
    const angle = p * 2.6;
    pose.elbowL = [103 - 31 * Math.sin(angle), 80 + 31 * Math.cos(angle)];
    pose.handL = [103 - 62 * Math.sin(angle), 80 + 62 * Math.cos(angle)];
    pose.elbowR = [137 + 31 * Math.sin(angle), 80 + 31 * Math.cos(angle)];
    pose.handR = [137 + 62 * Math.sin(angle), 80 + 62 * Math.cos(angle)];
  } else if (name === "squat") {
    for (const key of ["head", "shoulderL", "shoulderR", "hipL", "hipR"] as const) pose[key][1] += p * 22;
    pose.kneeL = mix(pose.kneeL, [86, 198], p); pose.kneeR = mix(pose.kneeR, [154, 198], p);
    pose.elbowL = mix(pose.elbowL, [83, 110], p); pose.handL = mix(pose.handL, [108, 104], p);
    pose.elbowR = mix(pose.elbowR, [157, 110], p); pose.handR = mix(pose.handR, [132, 104], p);
  } else if (name === "calf_raise") {
    for (const key of Object.keys(pose) as (keyof Pose)[]) pose[key][1] -= p * 10;
  } else if (name === "leg_side") {
    pose.kneeR = mix(pose.kneeR, [153, 183], p); pose.footR = mix(pose.footR, [178, 218], p);
    pose.handL = [80, 139]; // relaxed support arm
  } else if (name === "chest") {
    pose.elbowL = mix(pose.elbowL, [72, 90], hold); pose.handL = mix(pose.handL, [43, 98], hold);
    pose.elbowR = mix(pose.elbowR, [168, 90], hold); pose.handR = mix(pose.handR, [197, 98], hold);
  } else if (name === "side_bend") {
    for (const key of ["head", "shoulderL", "shoulderR", "elbowL", "elbowR", "handL", "handR"] as const) {
      const [x, y] = pose[key], angle = hold * .18;
      pose[key] = [120 + (x - 120) * Math.cos(angle) - (y - 145) * Math.sin(angle), 145 + (x - 120) * Math.sin(angle) + (y - 145) * Math.cos(angle)];
    }
  } else if (name === "wall_push") {
    // Side view: wrists stay on the wall; body pivots as a straight line from the ankles.
    const upper = 129 + p * 24, hip = 103 + p * 11;
    Object.assign(pose, { head: [upper + 7, 48], shoulderL: [upper - 4, 82], shoulderR: [upper + 6, 84], hipL: [hip - 4, 151], hipR: [hip + 6, 153],
      elbowL: [173 - p * 6, 81 + p * 22], elbowR: [175 - p * 4, 87 + p * 23], handL: [204, 78], handR: [208, 86],
      kneeL: [90 + p * 6, 192], kneeR: [100 + p * 6, 194], footL: [76, 235], footR: [87, 237] });
  } else if (name === "calf_stretch") {
    const lean = hold * 7;
    Object.assign(pose, { head: [146 + lean, 47], shoulderL: [137 + lean, 81], shoulderR: [147 + lean, 83], elbowL: [173, 87], elbowR: [179, 92], handL: [205, 80], handR: [209, 88],
      hipL: [123, 148], hipR: [134, 151], kneeL: [95, 189], kneeR: [157 + lean, 188], footL: [66, 236], footR: [151, 236] });
  }
  return pose;
}
