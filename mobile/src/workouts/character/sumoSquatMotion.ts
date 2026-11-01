import contours from "./sumoSquatContours.json";

export const sumoSquatTiming = { duration: contours.duration, preview: .6 };
export type SumoSquatFrame = {
  movement: "sumo_squat";
  pose: number;
  mirror: boolean;
  phase: number;
  phases: string[];
  label: string;
  cue: string;
};

/** Original front view, planted feet and hands on hips throughout the squat. */
export function sumoSquatFrame(cycle: number, mirror = false): SumoSquatFrame {
  const t = ((cycle % 1) + 1) % 1;
  const sample = Math.min(contours.timeline.length - 1, Math.floor(t * contours.timeline.length + 1e-8));
  const phases = ["Стойка шире плеч", "Опуститесь в присед", "Задержитесь внизу", "Выпрямитесь"];
  const phase = sample < 29 || sample >= 89 ? 0 : sample < 43 ? 1 : sample < 74 ? 2 : 3;
  return {
    movement: "sumo_squat", pose: contours.timeline[sample], mirror,
    phases, phase, label: phases[phase], cue: "Руки на бёдрах · колени вдоль носков · пятки на полу",
  };
}

export const sumoSquatPoses: readonly (readonly string[])[] = contours.poses;
