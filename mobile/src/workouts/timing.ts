import type { Workout, WorkoutStep } from "./types";

export const PREPARATION_SECONDS = 15;
export const REST_EXTENSION_SECONDS = 20;
export const MAX_REST_SECONDS = 3600;

/** Include a transition after every exercise, including the last one. */
export const restSeconds = (step: WorkoutStep) => Math.max(15, step.rest_seconds);

/** Player timing is independent of the immutable server catalogue. */
export const workoutSeconds = (workout: Workout) => PREPARATION_SECONDS +
  workout.steps.reduce((total, step) => total + step.expected_seconds + restSeconds(step), 0);
