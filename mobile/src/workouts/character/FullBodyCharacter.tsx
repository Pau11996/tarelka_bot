import { memo } from "react";
import type { FullBodyFrame } from "./fullBodyMotion";
import { KneeElbowCharacter } from "./KneeElbowCharacter";
import { InclinePushupCharacter } from "./InclinePushupCharacter";
import { SquatKickCharacter } from "./SquatKickCharacter";
import { SumoSquatCharacter } from "./SumoSquatCharacter";
import { RecordedWorkoutCharacter } from "./RecordedWorkoutCharacter";

export const FullBodyCharacter = memo(function FullBodyCharacter({ frame, size = 280, backdrop = true }: {
  frame: FullBodyFrame; size?: number; backdrop?: boolean;
}) {
  if (frame.movement === "standing_knee_elbow") return <KneeElbowCharacter frame={frame} size={size} backdrop={backdrop} />;
  if (frame.movement === "incline_pushup") return <InclinePushupCharacter frame={frame} size={size} backdrop={backdrop} />;
  if (frame.movement === "squat_kick") return <SquatKickCharacter frame={frame} size={size} backdrop={backdrop} />;
  if (frame.movement === "sumo_squat") return <SumoSquatCharacter frame={frame} size={size} backdrop={backdrop} />;
  return <RecordedWorkoutCharacter frame={frame} size={size} backdrop={backdrop} />;
});
