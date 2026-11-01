import contours from "./kneeElbowContours.json";

// A measured four-second cycle from the user's recording. Projected contours
// preserve the turn and occlusion; fixed 2D bone lengths cannot represent them.
export const kneeElbowTiming = { duration: contours.duration, preview: .25 };
export type KneeElbowFrame = {
  movement: "standing_knee_elbow";
  pose: number;
  mirror: boolean;
  phase: number;
  phases: string[];
  label: string;
  cue: string;
};
export function kneeElbowFrame(cycle: number, mirror = false): KneeElbowFrame {
  const t = ((cycle % 1) + 1) % 1;
  const sample = Math.min(contours.timeline.length - 1, Math.floor(t * contours.timeline.length + 1e-8));
  const left = "Левое колено — правый локоть", right = "Правое колено — левый локоть";
  const phases = [mirror ? right : left, "Вернитесь в стойку", mirror ? left : right, "Вернитесь в стойку"];
  const phase = t < .35 ? 0 : t < .6 ? 1 : t < .85 ? 2 : 3;
  return {
    movement: "standing_knee_elbow", pose: contours.timeline[sample], mirror,
    phases, phase, label: phases[phase], cue: "Руки у головы · поверните корпус к поднятому колену",
  };
}
export const kneeElbowPoses: readonly (readonly string[])[] = contours.poses;
