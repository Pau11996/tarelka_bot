export type AnimationName = "march" | "side_step" | "shoulders" | "arm_raise" | "squat" | "wall_push" | "calf_raise" | "leg_side" | "chest" | "side_bend" | "calf_stretch"
  | "standing_knee_elbow" | "sumo_squat" | "squat_kick" | "incline_pushup" | "chair_dip" | "prone_pull" | "plank_pike" | "seated_knee_tuck" | "crunch_reach" | "hands_behind" | "quad_stretch" | "glute_bridge" | "bird_dog" | "quadruped_leg";
export type ActivityLevel = "light" | "medium" | "intense";
export type CourseDay = { day: number; week: number; title: string; description: string; kind: "strength" | "mobility" | "walk" | "rest"; workout_ids: Partial<Record<ActivityLevel, string>>; walk_minutes: number | null };
export type WorkoutCourse = { id: string; title: string; days: CourseDay[]; revision?: number };
export type CourseCompletion = { day: number; completed_at: string; local_date: string; session_id: string | null };
export type CourseCheckIn = { day: number; course_id: string; completed_at: string; timezone: string; blocked?: boolean; error?: string };
export type Exercise = { id: string; title: string; cue: string; instruction: string; animation: AnimationName; mirror: boolean; met: number; equipment: string[]; easier?: string; repetition_note?: string };
export type WorkoutStep = { id: string; exercise_id: string; duration_seconds: number | null; repetitions: number | null; expected_seconds: number; rest_seconds: number; section?: "warmup" | "main" | "cooldown" | "stretch" | "mobility"; optional?: boolean };
export type Workout = { id: string; title: string; subtitle: string; focus: string; level: string; equipment: string[]; space: string; preview_exercise_id: string; duration_seconds: number; steps: WorkoutStep[]; course_id?: string; course_day?: number; activity_level?: ActivityLevel; kind?: CourseDay["kind"]; curriculum_revision?: number };
export type WorkoutCatalogue = { version: number; exercises: Exercise[]; workouts: Workout[]; course?: WorkoutCourse };
export type WorkoutSettings = { auto_log: boolean; sound: boolean; activity_level?: ActivityLevel };
export type StepResult = { step_id: string; active_seconds: number; rest_seconds: number; completed: boolean };
export type SessionInput = { workout_id: string; catalogue_version: number; status: "completed" | "interrupted"; started_at: string; ended_at: string; timezone: string; auto_log: boolean; steps: StepResult[] };
export type WorkoutSession = { id: string; workout_id: string; catalogue_version: number; title: string; status: SessionInput["status"]; started_at: string; ended_at: string; local_date: string; active_seconds: number; rest_seconds: number; completed_steps: number; total_steps: number; steps: (StepResult & { exercise_id: string; exercise_title: string })[]; calories: number | null; weight_kg: number | null; auto_log: boolean; diary_entry_id: number | null; diary_added: boolean; needs_weight: boolean; course_progress?: CourseCompletion[] };
export type WorkoutDraft = {
  id: string; workout: Workout; exercises: Exercise[]; catalogue_version: number;
  started_at: string; timezone: string; auto_log: boolean;
  index: number; phase: "prepare" | "exercise" | "rest" | "finished"; paused: boolean;
  /** Monotonic clock; replaced on restore. Never used for the calendar date. */
  tick_at: number; rest_target: number; results: StepResult[];
  /** Setup time is saved for resuming, but never counted as exercise time. */
  preparation_seconds?: number;
  status?: SessionInput["status"]; ended_at?: string;
};
export type WorkoutEffort = "easy" | "comfortable" | "hard";
export type LocalWorkout = { id: string; title: string; payload?: SessionInput; server?: WorkoutSession; diary_requested?: boolean; error?: string; blocked?: boolean; effort?: WorkoutEffort };
export type WorkoutData = { catalogue: WorkoutCatalogue | null; settings: WorkoutSettings; settings_dirty: boolean; timezone: string; draft: WorkoutDraft | null; records: LocalWorkout[]; course_progress?: CourseCompletion[]; course_queue?: CourseCheckIn[] };
export type WorkoutSnapshot = WorkoutData & { ready: boolean; syncing: boolean; error: string | null; storage_error: boolean; next_offset: number | null };
