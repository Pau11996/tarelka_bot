import { joint, type Point } from "./courseFloorMotion";

export type PushupMovement = "push_up" | "knee_push_up";
type Limb = { root: Point; joint: Point; end: Point };
export type PushupFrame = {
  movement: PushupMovement; shoulder: Point; hip: Point; neck: Point; head: Point;
  arms: Limb[]; legs: Limb[]; angle: number; depth: number; label: string;
};
export const pushupTiming = { duration: 4, preview: .5 };
const shift = (p: Point, far = false): Point => [p[0] - (far ? 3 : 0), p[1] - (far ? 5 : 0)];
const ease = (x: number) => x * x * (3 - 2 * x);

/** The torso rotates as one segment around fixed toes/knees. Arms are solved
 * at constant lengths between the moving shoulders and fixed palms. */
export function pushupFrame(movement: PushupMovement, cycle: number): PushupFrame {
  const t = ((cycle % 1) + 1) % 1;
  const depth = t < .45 ? ease(t / .45) : t < .55 ? 1 : t < .95 ? 1 - ease((t - .55) / .4) : 0;
  const knees = movement === "knee_push_up";
  const pivot: Point = [knees ? 139 : 58, 237], hand: Point = [303, 237];
  const bodyLength = knees ? 166 : 246, hipDistance = knees ? 66 : 132;
  const top = joint(pivot, hand, bodyLength, 100, -1);
  const topAngle = Math.atan2(pivot[1] - top[1], top[0] - pivot[0]);
  const angle = topAngle + ((knees ? .14 : .10) - topAngle) * depth;
  const along = (distance: number): Point => [pivot[0] + Math.cos(angle) * distance, pivot[1] - Math.sin(angle) * distance];
  const shoulder = along(bodyLength), hip = along(hipDistance);
  const neck = along(bodyLength + 15), head = along(bodyLength + 33);
  const arms = [true, false].map(far => {
    const root = shift(shoulder, far), end = shift(hand, far);
    return { root, joint: joint(root, end, 50, 50, 1), end };
  });
  const legs = [true, false].map(far => ({ root: shift(hip, far),
    joint: shift(knees ? pivot : along(66), far),
    end: shift(knees ? [79, 215] : pivot, far) }));
  return { movement, shoulder, hip, neck, head, arms, legs, angle, depth,
    label: t < .45 ? "Плавно опуститесь" : t < .55 ? "Корпус ровный" : t < .95 ? "Выпрямите руки на выдохе" : "Исходное положение" };
}
