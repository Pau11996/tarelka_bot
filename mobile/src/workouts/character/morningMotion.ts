import type { AnimationName } from "../types";

/** World coordinates: x across the screen, y up, z towards the viewer.
 * L/R are screen sides, so the coach can be followed like a mirror.
 * All lengths are fixed; only joints rotate (projection may foreshorten them).
 */
export type V3 = [number, number, number];
export type P2 = [number, number];
export type MorningMovement = "march" | "shoulders" | "arm_raise" | "side_step" | "calf_raise" | "side_bend" | "chest";
export const morningMovements: MorningMovement[] = ["march", "shoulders", "arm_raise", "side_step", "calf_raise", "side_bend", "chest"];
export const isMorningMovement = (name: AnimationName): name is MorningMovement => morningMovements.includes(name as MorningMovement);
export const motionDuration: Record<MorningMovement, number> = { march: 2.4, shoulders: 5, arm_raise: 8, side_step: 4.8, calf_raise: 5, side_bend: 12, chest: 12 };
export const previewProgress: Record<MorningMovement, number> = { march: .22, shoulders: .4, arm_raise: .43, side_step: .35, calf_raise: .4, side_bend: .4, chest: .4 };
export const proportions = { upperArm: 37, forearm: 34, thigh: 66, shin: 64, ankleHeight: 22, pelvisHeight: 151.5, shoulderHalfWidth: 24, shoulderHeight: 74 };
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, n: number): V3 => [a[0] * n, a[1] * n, a[2] * n];
const sub = (a: V3, b: V3) => add(a, scale(b, -1));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3) => scale(a, 1 / (Math.hypot(...a) || 1));
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * t * (t * (t * 6 - 15) + 10); };
const pulse = (t: number, start: number, end: number) => t <= start || t >= end ? 0 : Math.sin((t - start) / (end - start) * Math.PI) ** 2;
const envelope = (t: number, up: number, hold: number, down: number) => t < up ? ease(t / up) : t < hold ? 1 : t < down ? 1 - ease((t - hold) / (down - hold)) : 0;
export const cycleAt = (elapsedMs: number, movement: MorningMovement) => ((elapsedMs / (motionDuration[movement] * 1000)) % 1 + 1) % 1;

export type Foot = { x: number; z: number; lift: number; pitch: number };
export type Side = { shoulder: V3; elbow: V3; wrist: V3; hip: V3; knee: V3; ankle: V3; foot: Foot };
export type MorningFrame = {
  left: Side; right: Side; head: V3; neck: V3; pelvis: V3; lean: number; yaw: number;
  opening: number; shrug: number; phase: number; label: string; cue: string; phases: string[];
};

/** Rotate a shoe around its toe: the contact point never lifts on calf raises. */
export function footPoint(foot: Foot, x: number, y: number, z: number): V3 {
  const a = foot.pitch;
  return [foot.x + x, foot.lift + y * Math.cos(a) - (z - 22) * Math.sin(a),
    foot.z + 22 + (z - 22) * Math.cos(a) + y * Math.sin(a)];
}

/** Two-bone IK with a forward knee. Reaching limits are checked in motion tests. */
export function kneeBetween(hip: V3, ankle: V3): V3 {
  const direction = sub(ankle, hip), distance = Math.hypot(...direction), axis = unit(direction);
  const upper = proportions.thigh, lower = proportions.shin;
  const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
  const bend = unit(sub([0, 0, 1], scale(axis, dot([0, 0, 1], axis))));
  return add(add(hip, scale(axis, along)), scale(bend, Math.sqrt(Math.max(0, upper ** 2 - along ** 2))));
}

export function project(point: V3, yaw = 0): P2 {
  const depth = point[2] * Math.cos(yaw) - point[0] * Math.sin(yaw);
  return [180 + point[0] * Math.cos(yaw) + point[2] * Math.sin(yaw), 344 - point[1] + depth * .13];
}

export function motionGuide(name: MorningMovement, cycle: number, mirror = false) {
  const t = ((cycle % 1) + 1) % 1;
  let phases: string[], phase: number, cue: string;
  switch (name) {
    case "march": phases = ["Шаг левой", "Шаг правой"]; phase = t < .5 ? 0 : 1; cue = "Невысокие шаги · руки в противоход"; break;
    case "side_step": phases = ["Шаг вправо", "Приставьте левую", "Шаг влево", "Приставьте правую"]; phase = Math.min(3, Math.floor(t * 4)); cue = "Без прыжков · мягко ставьте стопу"; break;
    case "shoulders": phases = ["Плечи вверх", "Небольшая задержка", "Плавно опустите", "Расслабьте плечи"]; phase = t < .32 ? 0 : t < .44 ? 1 : t < .82 ? 2 : 3; cue = "Голова ровно · руки свободны"; break;
    case "arm_raise": phases = ["Руки через стороны", "Удобная высота", "Плавно опустите", "Расслабьте руки"]; phase = t < .4 ? 0 : t < .5 ? 1 : t < .9 ? 2 : 3; cue = "Локти мягкие · поясница неподвижна"; break;
    case "calf_raise": phases = ["Поднимите пятки", "Удержите равновесие", "Медленно опустите", "Стопы на полу"]; phase = t < .3 ? 0 : t < .45 ? 1 : t < .85 ? 2 : 3; cue = "Носки остаются на полу · можно опереться о стену"; break;
    case "side_bend": phases = [mirror ? "Мягко вправо" : "Мягко влево", "Удерживайте наклон", "Вернитесь в центр"]; phase = t < .2 ? 0 : t < .78 ? 1 : 2; cue = "Ладонь вдоль бедра · таз неподвижен"; break;
    case "chest": phases = ["Мягко раскройте руки", "Удерживайте · дышите", "Плавно опустите"]; phase = t < .2 ? 0 : t < .78 ? 1 : 2; cue = "Плечи вниз · без прогиба в пояснице"; break;
  }
  return { phases, phase, label: phases[phase], cue };
}

export function morningFrame(name: MorningMovement, cycle: number, mirror = false): MorningFrame {
  const t = ((cycle % 1) + 1) % 1;
  let rootX = 0, rootY = proportions.pelvisHeight, rootZ = 0, lean = 0, shrug = 0, opening = 0;
  let armAngle = .12, armSwing = 0;
  const leftFoot: Foot = { x: -24, z: 0, lift: 0, pitch: 0 };
  const rightFoot: Foot = { x: 24, z: 0, lift: 0, pitch: 0 };
  if (name === "march") {
    const l = pulse(t, 0, .45), r = pulse(t, .5, .95);
    leftFoot.lift = l * 30; leftFoot.z = l * 9;
    rightFoot.lift = r * 30; rightFoot.z = r * 9;
    rootX = (l - r) * 4; rootY -= (l + r) * 1.2;
    armSwing = r - l;
  } else if (name === "side_step") {
    const frames = [[-24, 24], [-24, 58], [10, 58], [-24, 58], [-24, 24]];
    const stage = Math.floor(t * 4), local = t * 4 - stage, p = ease(local);
    leftFoot.x = frames[stage][0] + (frames[stage + 1][0] - frames[stage][0]) * p;
    rightFoot.x = frames[stage][1] + (frames[stage + 1][1] - frames[stage][1]) * p;
    const lift = Math.sin(local * Math.PI) ** 2 * 6;
    if (stage === 0 || stage === 3) rightFoot.lift = lift; else leftFoot.lift = lift;
    rootX = (leftFoot.x + rightFoot.x) / 2;
    // Lower the pelvis while the stance widens, keeping both legs reachable.
    const spread = (rightFoot.x - leftFoot.x) / 2 - 16;
    rootY = 22 + Math.sqrt(129.5 ** 2 - spread ** 2) - Math.sin(local * Math.PI) ** 2 * 1.5;
    armAngle = .18;
  } else if (name === "shoulders") {
    shrug = envelope(t, .32, .44, .82) * 6;
  } else if (name === "arm_raise") {
    opening = envelope(t, .4, .5, .9);
    armAngle = .12 + opening * 2.42;
    shrug = opening * 1.5;
  } else if (name === "calf_raise") {
    opening = envelope(t, .3, .45, .85);
    leftFoot.pitch = rightFoot.pitch = opening * .48;
    const ankle = footPoint(leftFoot, 0, proportions.ankleHeight, 0);
    rootY += ankle[1] - proportions.ankleHeight; rootZ = ankle[2];
  } else if (name === "side_bend") {
    opening = envelope(t, .2, .78, 1);
    lean = (mirror ? 1 : -1) * opening * .18;
  } else if (name === "chest") {
    opening = envelope(t, .2, .78, 1);
    armAngle = .12 + opening * 1.12;
  }
  const pelvis: V3 = [rootX, rootY, rootZ];
  const body = (x: number, y: number, z = 0): V3 => [rootX + x * Math.cos(lean) + y * Math.sin(lean), rootY + y * Math.cos(lean) - x * Math.sin(lean), rootZ + z];
  const arm = (side: -1 | 1, foot: Foot): Side => {
    const shoulder = body(side * proportions.shoulderHalfWidth, proportions.shoulderHeight + shrug, name === "chest" ? -opening * 2 : 0);
    let upper: V3 = [side * Math.sin(armAngle), -Math.cos(armAngle), 0];
    let lower: V3 = [side * Math.sin(armAngle + .06), -Math.cos(armAngle + .06), .05];
    if (name === "march") {
      const swing = side * armSwing * -.34;
      upper = [side * .15, -Math.cos(swing), Math.sin(swing)];
      const bend = swing + .48 + Math.max(0, swing) * .7;
      lower = [side * .12, -Math.cos(bend), Math.sin(bend)];
    } else if (name === "chest") {
      upper[2] = -.18 * opening;
      lower[2] = -.3 * opening;
    } else if (name === "side_bend") {
      // Hands hang down instead of rotating rigidly with the torso.
      upper = [side * .08 - Math.sin(lean) * .7, -1, .04];
      lower = [side * .08 - Math.sin(lean) * .35, -1, .06];
    }
    const rotateArm = (v: V3): V3 => [v[0] * Math.cos(lean) + v[1] * Math.sin(lean), v[1] * Math.cos(lean) - v[0] * Math.sin(lean), v[2]];
    const elbow = add(shoulder, scale(unit(rotateArm(upper)), proportions.upperArm));
    const wrist = add(elbow, scale(unit(rotateArm(lower)), proportions.forearm));
    const hip: V3 = [rootX + side * 16, rootY, rootZ];
    const ankle = footPoint(foot, 0, proportions.ankleHeight, 0);
    return { shoulder, elbow, wrist, hip, knee: kneeBetween(hip, ankle), ankle, foot };
  };
  return { left: arm(-1, leftFoot), right: arm(1, rightFoot), head: body(0, 97), neck: body(0, 83), pelvis, lean,
    yaw: name === "calf_raise" ? .8 : name === "march" ? .48 : name === "chest" ? .22 : 0,
    opening, shrug, ...motionGuide(name, t, mirror) };
}
