import type { ActivityLevel, LocalWorkout, Workout, WorkoutData } from "./types";

export function ratedWorkout(data: WorkoutData, record: LocalWorkout): Workout | undefined {
  const session = record.server ?? record.payload;
  const workout = data.catalogue?.workouts.find(item => item.id === session?.workout_id);
  return session?.status === "completed" && workout?.course_id && workout.kind === "strength" && workout.steps.some(step => step.section === "main" && step.repetitions) ? workout : undefined;
}

/** Offer a choice for the next workout. Never increase load automatically. */
export function effortSuggestion(data: WorkoutData, record: LocalWorkout) {
  const workout = ratedWorkout(data, record);
  if (!record.effort || !workout?.activity_level) return null;
  const history = data.records.filter(item => {
    const other = ratedWorkout(data, item);
    return other && other.course_id === workout.course_id && other.course_variant === workout.course_variant;
  }).sort((a, b) =>
    (b.server?.started_at ?? b.payload?.started_at ?? "").localeCompare(a.server?.started_at ?? a.payload?.started_at ?? ""));
  if (history[0]?.id !== record.id) return null;
  const levels: ActivityLevel[] = ["light", "medium", "intense"], index = levels.indexOf(workout.activity_level);
  if (record.effort === "hard") return {
    level: levels[Math.max(0, index - 1)],
    message: "В следующий раз снизьте нагрузку, используйте облегчения и продлевайте отдых. Не продолжайте через боль.",
  };
  const previous = history[1];
  if (record.effort === "easy" && previous?.effort === "easy" && ratedWorkout(data, previous)?.activity_level === workout.activity_level && index < levels.length - 1) return {
    level: levels[index + 1],
    message: "Две тренировки подряд дались легко. Если движения уверенные и вы восстановились, можно попробовать следующий уровень. Менять его необязательно.",
  };
  return { level: workout.activity_level, message: "Сохраните удобный уровень. Осваивайте движения без спешки; календарь курса сам не увеличивает нагрузку." };
}
