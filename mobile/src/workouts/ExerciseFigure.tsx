import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors as c } from "../theme";
import { LegacyExerciseFigure } from "./LegacyExerciseFigure";
import { WorkoutCharacter } from "./character/WorkoutCharacter";
import { isMorningMovement, morningFrame, type MorningMovement } from "./character/morningMotion";
import { useExerciseMotion } from "./character/useExerciseMotion";
import { FullBodyCharacter } from "./character/FullBodyCharacter";
import { fullBodyFrame, fullBodyTiming, isFullBodyMovement, type FullBodyMovement } from "./character/fullBodyMotion";
import type { Exercise } from "./types";
import { CourseFloorCharacter } from "./character/CourseFloorCharacter";
import { floorFrame, floorTiming, type FloorMovement } from "./character/courseFloorMotion";

type Props = { exercise: Exercise; playing?: boolean; size?: number; showGuide?: boolean };
function MorningFigure({ exercise, movement, playing = false, size = 240, showGuide = false }: Props & { movement: MorningMovement }) {
  const { cycle, reduced } = useExerciseMotion(movement, `${exercise.id}:${movement}:${!!exercise.mirror}`, playing);
  const frame = morningFrame(movement, cycle, exercise.mirror);
  return <View style={s.wrapper}>
    <View accessible accessibilityRole="image" accessibilityLabel={`${exercise.title}. ${exercise.cue}${exercise.animation === "side_bend" ? " Повторяйте как в зеркале." : ""}`}>
      <WorkoutCharacter frame={frame} size={size} />
    </View>
    {showGuide ? <View style={s.guide}>
      {!reduced ? <View style={s.phases} accessible={false}>{frame.phases.map((label, index) => <View key={label} style={[s.phase, index === frame.phase && s.current]} />)}</View> : null}
      <Text style={s.label}>{reduced ? "Ключевая поза" : frame.label}</Text>
      <Text style={s.cue}>{frame.cue}</Text>
      {movement === "side_bend" ? <Text style={s.mirror}>Повторяйте как в зеркале</Text> : null}
    </View> : null}
  </View>;
}
export const ExerciseFigure = memo(function ExerciseFigure(props: Props) {
  return props.exercise.animation === "glute_bridge" || props.exercise.animation === "bird_dog"
    ? <CourseFloorFigure {...props} movement={props.exercise.animation} />
    : isFullBodyMovement(props.exercise.animation)
    ? <FullBodyFigure {...props} movement={props.exercise.animation} />
    : isMorningMovement(props.exercise.animation)
    ? <MorningFigure {...props} movement={props.exercise.animation} />
    : <LegacyExerciseFigure {...props} />;
});
function CourseFloorFigure({ exercise, movement, playing = false, size = 240, showGuide = false }: Props & { movement: FloorMovement }) {
  const { cycle, reduced } = useExerciseMotion(movement, exercise.id, playing, floorTiming[movement]);
  const frame = floorFrame(movement, cycle);
  return <View style={s.wrapper}><View accessible accessibilityRole="image" accessibilityLabel={`${exercise.title}. ${exercise.cue}`}><CourseFloorCharacter frame={frame} size={size} /></View>{showGuide ? <View style={s.guide}><Text style={s.label}>{reduced ? "Ключевая поза" : frame.label}</Text><Text style={s.cue}>{exercise.cue}</Text></View> : null}</View>;
}
function FullBodyFigure({ exercise, movement, playing = false, size = 240, showGuide = false }: Props & { movement: FullBodyMovement }) {
  const { cycle, reduced } = useExerciseMotion(movement, `${exercise.id}:${movement}:${!!exercise.mirror}`, playing, fullBodyTiming[movement]);
  const frame = fullBodyFrame(movement, cycle, exercise.mirror);
  return <View style={s.wrapper}>
    <View accessible accessibilityRole="image" accessibilityLabel={`${exercise.title}. ${exercise.cue}`}><FullBodyCharacter frame={frame} size={size} /></View>
    {showGuide ? <View style={s.guide}>
      {!reduced ? <View style={s.phases} accessible={false}>{frame.phases.map((label, index) => <View key={`${index}:${label}`} style={[s.phase, index === frame.phase && s.current]} />)}</View> : null}
      <Text style={s.label}>{reduced ? "Ключевая поза" : frame.label}</Text>
      <Text style={s.cue}>{frame.cue}</Text>
    </View> : null}
  </View>;
}
const s = StyleSheet.create({
  wrapper: { alignItems: "center", alignSelf: "stretch" },
  guide: { alignSelf: "stretch", paddingHorizontal: 16, paddingBottom: 12, gap: 5 },
  phases: { flexDirection: "row", justifyContent: "center", gap: 5, marginBottom: 3 },
  phase: { width: 6, height: 4, borderRadius: 2, backgroundColor: c.border },
  current: { width: 20, backgroundColor: c.accentDark },
  label: { textAlign: "center", fontSize: 14, lineHeight: 20, fontWeight: "600", color: c.text },
  cue: { textAlign: "center", fontSize: 12, lineHeight: 18, color: c.muted },
  mirror: { textAlign: "center", fontSize: 11, lineHeight: 16, color: c.muted },
});
