import type { Workout, WorkoutCatalogue } from "./types";

/** Temporarily offer only the reviewed full-body routine. Keep the complete
 * versioned catalogue in storage for previous results and unfinished sessions. */
export function availableWorkouts(catalogue: WorkoutCatalogue | null): Workout[] {
  if (!catalogue || catalogue.version < 2) return [];
  if (catalogue.course) return catalogue.workouts.filter(workout => workout.course_id === catalogue.course!.id);
  return catalogue.workouts.filter(workout => workout.id === "body_short");
}
