export type AnimationName = "march" | "side_step" | "shoulders" | "arm_raise" | "squat" | "wall_push" | "calf_raise" | "leg_side" | "chest" | "side_bend" | "calf_stretch";
export type Exercise = { id: string; title: string; cue: string; instruction: string; animation: AnimationName; mirror: boolean; met: number; equipment: string[] };
export type WorkoutStep = { id: string; exercise_id: string; duration_seconds: number | null; repetitions: number | null; expected_seconds: number; rest_seconds: number };
export type Workout = { id: string; title: string; subtitle: string; focus: string; level: string; equipment: string[]; space: string; preview_exercise_id: string; duration_seconds: number; steps: WorkoutStep[] };
export type WorkoutCatalogue = { version: number; exercises: Exercise[]; workouts: Workout[] };
export type WorkoutSettings = { auto_log: boolean; sound: boolean };
export type StepResult = { step_id: string; active_seconds: number; rest_seconds: number; completed: boolean };
export type SessionInput = { workout_id: string; catalogue_version: number; status: "completed" | "interrupted"; started_at: string; ended_at: string; timezone: string; auto_log: boolean; steps: StepResult[] };
export type WorkoutSession = { id: string; workout_id: string; catalogue_version: number; title: string; status: SessionInput["status"]; started_at: string; ended_at: string; local_date: string; active_seconds: number; rest_seconds: number; completed_steps: number; total_steps: number; steps: (StepResult & { exercise_id: string; exercise_title: string })[]; calories: number | null; weight_kg: number | null; auto_log: boolean; diary_entry_id: number | null; diary_added: boolean; needs_weight: boolean };
export type WorkoutDraft = {
  id: string; workout: Workout; exercises: Exercise[]; catalogue_version: number;
  started_at: string; timezone: string; auto_log: boolean;
  index: number; phase: "exercise" | "rest" | "finished"; paused: boolean;
  /** Monotonic clock; replaced on restore. Never used for the calendar date. */
  tick_at: number; rest_target: number; results: StepResult[];
  status?: SessionInput["status"]; ended_at?: string;
};
export type LocalWorkout = { id: string; title: string; payload?: SessionInput; server?: WorkoutSession; diary_requested?: boolean; error?: string; blocked?: boolean };
export type WorkoutData = { catalogue: WorkoutCatalogue | null; settings: WorkoutSettings; settings_dirty: boolean; timezone: string; draft: WorkoutDraft | null; records: LocalWorkout[] };
export type WorkoutSnapshot = WorkoutData & { ready: boolean; syncing: boolean; error: string | null; storage_error: boolean; next_offset: number | null };
