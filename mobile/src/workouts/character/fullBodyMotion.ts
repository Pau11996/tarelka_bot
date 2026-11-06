import type { AnimationName } from "../types";
import { kneeElbowFrame, kneeElbowTiming, type KneeElbowFrame } from "./kneeElbowMotion";
import { inclinePushupFrame, inclinePushupTiming, type InclinePushupFrame } from "./inclinePushupMotion";
import { squatKickFrame, squatKickTiming, type SquatKickFrame } from "./squatKickMotion";
import { sumoSquatFrame, sumoSquatTiming, type SumoSquatFrame } from "./sumoSquatMotion";
import { recordedWorkoutFrame, recordedWorkoutTiming, type RecordedWorkoutFrame } from "./recordedWorkoutMotion";

export type FullBodyMovement = "standing_knee_elbow" | "sumo_squat" | "squat_kick" | "incline_pushup" | "chair_dip" | "prone_pull" | "plank_pike" | "seated_knee_tuck" | "crunch_reach" | "hands_behind" | "quad_stretch" | "squat" | "wall_push";
export const fullBodyMovements: FullBodyMovement[] = ["standing_knee_elbow", "sumo_squat", "squat_kick", "incline_pushup", "chair_dip", "prone_pull", "plank_pike", "seated_knee_tuck", "crunch_reach", "hands_behind", "quad_stretch", "squat", "wall_push"];
export const isFullBodyMovement = (name: AnimationName): name is FullBodyMovement => fullBodyMovements.includes(name as FullBodyMovement);
export const fullBodyTiming: Record<FullBodyMovement, { duration: number; preview: number }> = {
  standing_knee_elbow: kneeElbowTiming, sumo_squat: sumoSquatTiming,
  squat_kick: squatKickTiming, incline_pushup: inclinePushupTiming,
  chair_dip: recordedWorkoutTiming("chair_dip"), prone_pull: recordedWorkoutTiming("prone_pull"),
  plank_pike: recordedWorkoutTiming("plank_pike"), seated_knee_tuck: recordedWorkoutTiming("seated_knee_tuck"),
  crunch_reach: recordedWorkoutTiming("crunch_reach"), hands_behind: recordedWorkoutTiming("hands_behind"),
  quad_stretch: recordedWorkoutTiming("quad_stretch"),
  squat: recordedWorkoutTiming("squat"),
  wall_push: recordedWorkoutTiming("wall_push"),
};
export type FullBodyFrame = KneeElbowFrame | InclinePushupFrame | SquatKickFrame | SumoSquatFrame | RecordedWorkoutFrame;

/** Source body motion and annotation motion remain independent. */
export function fullBodyFrame(name: FullBodyMovement, cycle: number, mirror = false): FullBodyFrame {
  if (name === "standing_knee_elbow") return kneeElbowFrame(cycle, mirror);
  if (name === "incline_pushup") return inclinePushupFrame(cycle, mirror);
  if (name === "squat_kick") return squatKickFrame(cycle, mirror);
  if (name === "sumo_squat") return sumoSquatFrame(cycle, mirror);
  return recordedWorkoutFrame(name, cycle, mirror);
}
