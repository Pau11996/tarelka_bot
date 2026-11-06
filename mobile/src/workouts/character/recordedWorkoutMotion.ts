import chairDip from "./recordedChairDip.json";
import pronePull from "./recordedPronePull.json";
import plankPike from "./recordedPlankPike.json";
import seatedKneeTuck from "./recordedSeatedKneeTuck.json";
import crunchReach from "./recordedCrunchReach.json";
import handsBehind from "./recordedHandsBehind.json";
import quadRight from "./recordedQuadRight.json";
import quadLeft from "./recordedQuadLeft.json";
import shallowSquat from "./shallowSquatContours.json";
import wallPush from "./wallPushContours.json";

export type RecordedWorkoutAsset = {
  duration: number; preview: number; canvas: number[]; transform: number[];
  timeline: number[]; poses: string[][]; palette: string[]; support: string[][];
  phases: (number | string)[][]; cue: string; authoredMirror?: boolean; fillRule?: string;
  indicators?: {
    path: string; fill: string; samples: number[][];
    stroke?: string; strokeWidth?: number; strokeDasharray?: number[]; strokeLinecap?: string;
  }[];
};
export const recordedWorkoutAssets = {
  chair_dip: chairDip, prone_pull: pronePull, plank_pike: plankPike, seated_knee_tuck: seatedKneeTuck,
  crunch_reach: crunchReach, hands_behind: handsBehind, quad_stretch: quadRight,
  squat: shallowSquat,
  wall_push: wallPush,
} satisfies Record<string, RecordedWorkoutAsset>;
export type RecordedWorkoutMovement = keyof typeof recordedWorkoutAssets;
const mirroredAssets: Partial<Record<RecordedWorkoutMovement, RecordedWorkoutAsset>> = { quad_stretch: quadLeft };
export const getRecordedWorkoutAsset = (movement: RecordedWorkoutMovement, mirror = false): RecordedWorkoutAsset =>
  (mirror ? mirroredAssets[movement] : undefined) ?? recordedWorkoutAssets[movement];
export const isRecordedWorkoutMovement = (name: string): name is RecordedWorkoutMovement => Object.prototype.hasOwnProperty.call(recordedWorkoutAssets, name);
export type RecordedWorkoutFrame = {
  movement: RecordedWorkoutMovement;
  pose: number;
  sample: number;
  mirror: boolean;
  phase: number;
  phases: string[];
  label: string;
  cue: string;
};
export const isRecordedWorkoutFrame = (frame: { movement: string }): frame is RecordedWorkoutFrame => isRecordedWorkoutMovement(frame.movement);
export const recordedWorkoutTiming = (name: RecordedWorkoutMovement) => {
  const data = recordedWorkoutAssets[name];
  return { duration: data.duration, preview: data.preview };
};

/** Each asset owns its authored depth, holds, return and sample timing. */
export function recordedWorkoutFrame(movement: RecordedWorkoutMovement, cycle: number, mirror = false): RecordedWorkoutFrame {
  const data = getRecordedWorkoutAsset(movement, mirror);
  const t = ((cycle % 1) + 1) % 1;
  const sample = Math.min(data.timeline.length - 1, Math.floor(t * data.timeline.length + 1e-8));
  let phase = 0;
  for (let i = 1; i < data.phases.length; i++) if (sample >= Number(data.phases[i][0])) phase = i;
  const phases = data.phases.map(([, label]) => String(label));
  return { movement, pose: data.timeline[sample], sample, mirror, phase, phases, label: phases[phase], cue: data.cue };
}
