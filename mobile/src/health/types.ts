export const healthTypes = ["Steps", "Distance", "ActiveCaloriesBurned", "ExerciseSession", "Weight"] as const;
export type HealthType = typeof healthTypes[number];
export const healthFields = { Steps: "steps", Distance: "distance_m", ActiveCaloriesBurned: "active_kcal", ExerciseSession: "exercise_minutes" } as const;
export type MetricType = keyof typeof healthFields;
export type HealthWindow = { date: string; start_at: string; end_at: string };
export type HealthConnection = {
  available: boolean; connected: boolean; connection_id: string | null; installation_id?: string;
  generation?: string; permissions: HealthType[]; workout_origin?: string | null; revision?: number;
  timezone?: string; today?: string; history_start?: string; last_synced_at?: string | null; windows?: HealthWindow[];
};
export type HealthDay = { date: string; steps: number | null; distance_m: number | null; active_kcal: number | null; exercise_minutes: number | null; origins?: string[] };
export type ImportedRecord = { record_type: "Weight" | "ExerciseSession"; external_id: string; origin: string; start_at: string; end_at?: string; weight_kg?: number; title?: string; exercise_type?: number; duration_minutes?: number };
export type HealthWorkout = { id: string; source: "health_connect"; origin: string; start_at: string; end_at: string; local_date: string; title?: string; exercise_type?: number; duration_minutes?: number };
export type HealthData = { timezone?: string; connected: boolean; contributes_to_budget: false; last_synced_at: string | null; days: HealthDay[]; workouts: HealthWorkout[] };
export type DeletedRecord = { record_type: "Weight" | "ExerciseSession"; external_id: string };
export type HealthBatch = { connection_id: string; generation: string; batch_id: string; base_revision: number; timezone: string; start_date: string; end_date: string; types: HealthType[]; days: HealthDay[]; records: ImportedRecord[]; deleted: DeletedRecord[]; reconcile: boolean };
export type RecordIndex = Record<string, { start_at: string; end_at?: string }>;
export type SyncState = { generation: string; timezone: string; permissions: string; tokens: Partial<Record<HealthType, string>>; index: RecordIndex; lastSuccess?: number; pending?: { batches: HealthBatch[]; next: number; tokens: Partial<Record<HealthType, string>>; index: RecordIndex } };
export type RawHealthRecord = { recordType: HealthType; metadata?: { id?: string; dataOrigin?: string }; time?: string; startTime?: string; endTime?: string; weight?: { inKilograms?: number }; title?: string; exerciseType?: number };
export type Changes = { upsertionChanges: { record: RawHealthRecord }[]; deletionChanges: { recordId: string }[]; nextChangesToken: string; changesTokenExpired: boolean; hasMore: boolean };
export interface HealthReader {
  permissions(): Promise<HealthType[]>;
  records(kind: HealthType, start: string, end: string): Promise<RawHealthRecord[]>;
  changes(kind: HealthType, token?: string): Promise<Changes>;
  aggregate(kind: MetricType, window: HealthWindow, origin?: string | null): Promise<{ value: number | null; origins: string[] }>;
}
