import { catalogueCourses } from "./course";
import type { CourseVariant, Workout, WorkoutCatalogue } from "./types";

/** Offer only current days of the selected programmes. Preserve all old
 * definitions in the catalogue for historical results and offline drafts. */
export function availableWorkouts(catalogue: WorkoutCatalogue | null, sex?: CourseVariant | null): Workout[] {
  if (!catalogue || catalogue.version < 2) return [];
  const courses = catalogueCourses(catalogue, sex);
  if (courses.length) {
    const ids = new Set(courses.flatMap(course => course.days.flatMap(day => Object.values(day.workout_ids))));
    return catalogue.workouts.filter(workout => ids.has(workout.id));
  }
  return catalogue.workouts.filter(workout => workout.id === "body_short");
}
