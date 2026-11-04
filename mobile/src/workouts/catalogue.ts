import type { Workout, WorkoutCatalogue } from "./types";

/** Temporarily offer only the reviewed full-body routine. Keep the complete
 * versioned catalogue in storage for previous results and unfinished sessions. */
export function availableWorkouts(catalogue: WorkoutCatalogue | null): Workout[] {
  if (!catalogue || catalogue.version < 2) return [];
  if (catalogue.course) {
    const ids = new Set(catalogue.course.days.flatMap(day => Object.values(day.workout_ids)));
    return catalogue.workouts.filter(workout => ids.has(workout.id));
  }
  return catalogue.workouts.filter(workout => workout.id === "body_short");
}
