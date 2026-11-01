import contours from "./inclinePushupContours.json";

export const inclinePushupTiming = { duration: contours.duration, preview: .5 };
export type InclinePushupFrame = {
  movement: "incline_pushup";
  pose: number;
  mirror: boolean;
  phase: number;
  phases: string[];
  label: string;
  cue: string;
};

/** Preserve the two-second repetition and top/bottom holds in the recording. */
export function inclinePushupFrame(cycle: number, mirror = false): InclinePushupFrame {
  const t = ((cycle % 1) + 1) % 1;
  const sample = Math.min(contours.timeline.length - 1, Math.floor(t * contours.timeline.length + 1e-8));
  const phases = ["Согните локти", "Оттолкнитесь от опоры"];
  const phase = t < 2 / 3 ? 0 : 1;
  return {
    movement: "incline_pushup", pose: contours.timeline[sample], mirror,
    phases, phase, label: phases[phase], cue: "Корпус прямой · ладони и носки остаются на опоре",
  };
}

export const inclinePushupPoses: readonly (readonly string[])[] = contours.poses;
export const inclinePushupSupport: readonly (readonly string[])[] = contours.support;
