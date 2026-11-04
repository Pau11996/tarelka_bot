import type { SessionInput, Workout, WorkoutCatalogue, WorkoutDraft, WorkoutSettings } from "./types";
import { MAX_REST_SECONDS, PREPARATION_SECONDS, REST_EXTENSION_SECONDS, restSeconds } from "./timing";

export const monotonicNow = () => performance.now();
export function createDraft(id: string, workout: Workout, catalogue: WorkoutCatalogue, settings: WorkoutSettings, timezone: string, now: number, wall: string): WorkoutDraft {
  return { id, workout, exercises: catalogue.exercises, catalogue_version: catalogue.version,
    started_at: wall, timezone, auto_log: settings.auto_log, index: 0, phase: "prepare", paused: false,
    tick_at: now, rest_target: PREPARATION_SECONDS, preparation_seconds: 0,
    results: workout.steps.map(step => ({ step_id: step.id, active_seconds: 0, rest_seconds: 0, completed: false })) };
}
export function restoreDraft(draft: WorkoutDraft, now: number): WorkoutDraft {
  return { ...draft, paused: true, tick_at: now };
}
export function remaining(draft: WorkoutDraft) {
  if (draft.phase === "finished") return 0;
  if (draft.phase === "prepare") return Math.max(0, draft.rest_target - (draft.preparation_seconds ?? 0));
  const step = draft.workout.steps[draft.index], result = draft.results[draft.index];
  return Math.max(0, draft.phase === "rest" ? draft.rest_target - result.rest_seconds : (step.duration_seconds ?? step.expected_seconds * 4) - result.active_seconds);
}
export function finish(draft: WorkoutDraft, status: SessionInput["status"], wall: string): WorkoutDraft {
  const complete = draft.workout.course_id
    ? draft.workout.steps.every((step, i) => !["main", "mobility"].includes(step.section ?? "") || step.optional || draft.results[i].completed)
    : draft.results.some(s => s.completed);
  return { ...draft, paused: true, phase: "finished", status: complete ? status : "interrupted", ended_at: wall };
}
function afterRest(draft: WorkoutDraft, wall: string): WorkoutDraft {
  if (draft.index === draft.workout.steps.length - 1) return finish(draft, "completed", wall);
  return { ...draft, index: draft.index + 1, phase: "exercise", rest_target: 0 };
}
function afterPreparation(draft: WorkoutDraft): WorkoutDraft {
  return { ...draft, phase: "exercise", rest_target: 0 };
}
function afterExercise(draft: WorkoutDraft): WorkoutDraft {
  return { ...draft, phase: "rest", rest_target: restSeconds(draft.workout.steps[draft.index]) };
}
/** A delayed callback can finish one phase, never silently perform the next exercise. */
export function tick(draft: WorkoutDraft, now: number, wall: string): WorkoutDraft {
  if (draft.paused || draft.phase === "finished") return draft;
  const delta = Math.max(0, now - draft.tick_at) / 1000;
  const results = draft.results.map(r => ({ ...r }));
  const current = results[draft.index], step = draft.workout.steps[draft.index];
  const next = { ...draft, results, tick_at: now };
  if (draft.phase === "prepare") {
    next.preparation_seconds = Math.min(draft.rest_target, (draft.preparation_seconds ?? 0) + delta);
    return next.preparation_seconds >= draft.rest_target ? afterPreparation(next) : next;
  }
  if (draft.phase === "rest") {
    current.rest_seconds = Math.min(draft.rest_target, current.rest_seconds + delta);
    return current.rest_seconds >= draft.rest_target ? afterRest(next, wall) : next;
  }
  const maximum = step.duration_seconds ?? step.expected_seconds * 4;
  current.active_seconds = Math.min(maximum, current.active_seconds + delta);
  if (current.active_seconds >= maximum) {
    if (step.duration_seconds != null) {
      current.completed = true;
      return afterExercise(next);
    }
    return { ...next, paused: true }; // Repetitions always require user confirmation.
  }
  return next;
}
export type WorkoutAction = "pause" | "resume" | "skip" | "complete_reps" | "more_rest" | "stop";
export function act(draft: WorkoutDraft, action: WorkoutAction, now: number, wall: string): WorkoutDraft {
  if (draft.phase === "finished") return draft;
  const updated = tick(draft, now, wall);
  if (updated.phase === "finished") return updated;
  // A timer transition wins over a simultaneous tap on the old phase.
  if ((action === "skip" || action === "complete_reps" || action === "more_rest") && (updated.phase !== draft.phase || updated.index !== draft.index)) return updated;
  if (action === "stop") return finish(updated, "interrupted", wall);
  if (action === "pause") return { ...updated, paused: true };
  if (action === "resume") return { ...updated, paused: false, tick_at: now };
  if (action === "more_rest") return updated.phase === "rest" || updated.phase === "prepare"
    ? { ...updated, rest_target: Math.min(MAX_REST_SECONDS, updated.rest_target + REST_EXTENSION_SECONDS) } : updated;
  if (updated.phase === "prepare") return action === "skip" ? afterPreparation(updated) : updated;
  if (updated.phase === "rest") return action === "skip" ? afterRest(updated, wall) : updated;
  if (action === "complete_reps" && updated.workout.steps[updated.index].repetitions == null) return updated;
  const results = updated.results.map(r => ({ ...r }));
  results[updated.index].completed = action === "complete_reps" && results[updated.index].active_seconds > 0;
  return afterExercise({ ...updated, results });
}
export function sessionInput(draft: WorkoutDraft): SessionInput {
  if (draft.phase !== "finished" || !draft.ended_at || !draft.status) throw new Error("Занятие ещё идёт");
  return { workout_id: draft.workout.id, catalogue_version: draft.catalogue_version, started_at: draft.started_at,
    ended_at: draft.ended_at, timezone: draft.timezone, auto_log: draft.auto_log, status: draft.status,
    steps: draft.results.slice(0, draft.status === "completed" ? draft.results.length : draft.index + 1).map(s => ({ ...s,
      active_seconds: Math.floor(s.active_seconds * 1000) / 1000, rest_seconds: Math.floor(s.rest_seconds * 1000) / 1000 })) };
}
export function clock(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function sessionDate(startedAt: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startedAt));
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}

/** Decode only an account namespace; API authorization always verifies the JWT on the server. */
export function workoutAccount(token: string): string {
  const encoded = token.split(".")[1];
  if (!encoded) throw new Error("Войдите в аккаунт заново");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let bits = 0, value = 0, decoded = "";
  for (const char of encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "")) {
    const number = chars.indexOf(char);
    if (number < 0) throw new Error("Некорректная сессия");
    value = (value << 6) | number; bits += 6;
    if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((value >> bits) & 255); }
  }
  const body = JSON.parse(decoded);
  if (!/^[1-9]\d*$/.test(String(body.sub)) || !Number.isInteger(body.ver ?? 0)) throw new Error("Некорректная сессия");
  return `${body.sub}:${body.ver ?? 0}`;
}
