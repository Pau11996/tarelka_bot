import contours from "./squatKickContours.json";

export const squatKickTiming = { duration: contours.duration, preview: .2 };
export type SquatKickFrame = {
  movement: "squat_kick";
  pose: number;
  mirror: boolean;
  phase: number;
  phases: string[];
  label: string;
  cue: string;
};

/** Both original leg actions, including their different thigh/shorts overlap. */
export function squatKickFrame(cycle: number, mirror = false): SquatKickFrame {
  const t = ((cycle % 1) + 1) % 1;
  const sample = Math.min(contours.timeline.length - 1, Math.floor(t * contours.timeline.length + 1e-8));
  const phases = ["Подъём и удар ногой", "Присед", "Подъём и удар другой ногой", "Присед"];
  const phase = sample < 37 ? 0 : sample < 58 ? 1 : sample < 89 ? 2 : 3;
  return {
    movement: "squat_kick", pose: contours.timeline[sample], mirror,
    phases, phase, label: phases[phase], cue: "После удара верните стопу на пол · чередуйте ноги",
  };
}

export const squatKickPoses: readonly (readonly string[])[] = contours.poses;
