import { act, createDraft, restoreDraft, sessionInput, tick, type WorkoutAction } from "./engine";
import { catalogueCourses, courseState, HOME_COURSE_ID, LEGACY_COURSE_ID, selectedCourse } from "./course";
import { ratedWorkout } from "./effort";
import type { CourseCompletion, CourseProgram, CourseVariant, LocalWorkout, WorkoutCatalogue, WorkoutData, WorkoutEffort, WorkoutSession, WorkoutSettings, WorkoutSnapshot } from "./types";

type Request = <T>(path: string, options: { method?: string; json?: unknown; signal: AbortSignal }) => Promise<T>;
export type WorkoutDependencies = { read(): Promise<WorkoutData | null>; write(data: WorkoutData): Promise<void>; remove(): Promise<void>; request: Request; uuid(): string; now(): number; wall(): string; updated(): void };
const defaults = (): WorkoutData => ({ catalogue: null, settings: { auto_log: false, sound: true, activity_level: "medium" }, settings_dirty: false, timezone: "UTC", draft: null, records: [], profile_sex: null, course_progress_by_id: {}, course_progress: [], course_queue: [] });
const animationNames = new Set(["march", "side_step", "shoulders", "arm_raise", "squat", "wall_push", "calf_raise", "leg_side", "chest", "side_bend", "calf_stretch",
  "standing_knee_elbow", "sumo_squat", "squat_kick", "incline_pushup", "chair_dip", "prone_pull", "plank_pike", "seated_knee_tuck", "crunch_reach", "hands_behind", "quad_stretch", "glute_bridge", "bird_dog", "quadruped_leg", "push_up", "knee_push_up"]);
export function supportedCatalogue(value: WorkoutCatalogue): boolean {
  try {
    if (!value || ![1, 2, 3, 4, 5].includes(value.version) || !Array.isArray(value.workouts) || !Array.isArray(value.exercises)) return false;
    const definitions = new Map(value.workouts.map(workout => [workout.id, workout]));
    const validProgram = (courseId: string, program: CourseProgram, variant?: CourseVariant) =>
      Array.isArray(program?.days) && program.days.length === 28 && program.days.every((day, index) =>
        day.day === index + 1 && day.week === Math.floor(index / 7) + 1 && ["strength", "mobility", "walk", "rest"].includes(day.kind) &&
        (!["strength", "mobility"].includes(day.kind) || (["light", "medium", "intense"] as const).every(level => {
          const workout = definitions.get(day.workout_ids[level]!);
          return workout?.course_id === courseId && workout.course_day === day.day && workout.activity_level === level && workout.kind === day.kind && (!variant || workout.course_variant === variant);
        })));
    if (value.version === 5) {
      if (!Array.isArray(value.courses) || value.courses.length !== 2 || new Set(value.courses.map(course => course.id)).size !== 2) return false;
      if (!value.courses.every(course => [LEGACY_COURSE_ID, HOME_COURSE_ID].includes(course.id) &&
        (["female", "male"] as const).every(variant => validProgram(course.id, course.variants[variant], variant)) &&
        course.variants.female.days.every((day, index) => day.kind === course.variants.male.days[index].kind))) return false;
    } else if (value.version >= 3 && (!value.course || value.course.id !== LEGACY_COURSE_ID || !validProgram(value.course.id, value.course))) return false;
    const ids = new Set(value.exercises.map(ex => ex.id));
    return definitions.size === value.workouts.length && ids.size === value.exercises.length &&
      value.exercises.every(ex => animationNames.has(ex.animation)) && value.workouts.every(w => w.steps.length > 0 && w.steps.every(s => ids.has(s.exercise_id)));
  } catch { return false; }
}
const message = (error: unknown) => error && typeof error === "object" && "status" in error && error.status === 0
  ? "Не удалось подключиться. Проверьте интернет и повторите синхронизацию."
  : error instanceof Error ? error.message : "Не удалось сохранить тренировку";
const status = (error: unknown) => error && typeof error === "object" && "status" in error ? Number(error.status) : 0;

/** Account-scoped durable state. UI never owns uploads or the running workout. */
export class WorkoutStore {
  private state: WorkoutSnapshot = { ...defaults(), ready: false, syncing: false, error: null, storage_error: false, next_offset: null };
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private running: Promise<void> | null = null;
  private syncAgain = false;
  private controller: AbortController | null = null;
  private closed = false;
  private active = true;
  private settingsRevision = 0;
  private lastPersist = 0;
  private diskError = false;
  constructor(private deps: WorkoutDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private patch(next: Partial<WorkoutSnapshot>) {
    if (this.closed) return;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private persist() {
    const { catalogue, settings, settings_dirty, timezone, draft, records, profile_sex, course_progress_by_id, course_progress, course_queue } = this.state;
    const data = { catalogue, settings, settings_dirty, timezone, draft, records, profile_sex, course_progress_by_id, course_progress, course_queue };
    const write = this.writes.catch(() => undefined).then(() => this.deps.write(data));
    this.writes = write;
    void write.then(() => {
      if (this.diskError) {
        this.diskError = false;
        this.patch({ storage_error: false, error: null });
      }
    }, () => {
      this.diskError = true;
      this.patch({ storage_error: true, error: "Не удалось сохранить данные на устройстве. Освободите место и повторите попытку.", draft: this.state.draft ? restoreDraft(this.state.draft, this.deps.now()) : null });
    });
    return write;
  }
  async initialize() {
    try {
      const saved = await this.deps.read();
      if (this.closed) return;
      if (saved) {
        if (!Array.isArray(saved.records) || !saved.settings || typeof saved.settings.auto_log !== "boolean" || (saved.catalogue && !supportedCatalogue(saved.catalogue))) throw Error("Сохранённые данные тренировок повреждены");
        this.patch({ ...saved,
          course_progress_by_id: { [LEGACY_COURSE_ID]: saved.course_progress ?? [], ...saved.course_progress_by_id },
          draft: saved.draft ? restoreDraft(saved.draft, this.deps.now()) : null });
        if (saved.draft?.phase === "finished") await this.finalize();
      }
      this.patch({ ready: true });
      void this.refresh();
    } catch (error) { this.patch({ ready: true, error: message(error) }); }
  }
  async start(workoutId: string) {
    if (this.closed || !this.state.ready) throw Error("Данные ещё загружаются");
    if (this.state.draft) throw Error("Сначала продолжите или завершите текущее занятие");
    const catalogue = this.state.catalogue;
    const workout = catalogue?.workouts.find(w => w.id === workoutId);
    if (!catalogue || !workout) throw Error("Подключитесь к интернету, чтобы загрузить каталог");
    if (workout.course_id) {
      const progress = courseState(this.state, this.deps.wall(), workout.course_id);
      if (workout.course_day !== progress.day || !progress.available) throw Error("Начните с текущего дня курса. Между днями сохраняется время для восстановления.");
      const day = selectedCourse(this.state, workout.course_id)?.days.find(item => item.day === workout.course_day);
      if (!day || !Object.values(day.workout_ids).includes(workout.id)) throw Error("Программа обновилась. Откройте текущий день курса заново.");
    }
    const draft = createDraft(this.deps.uuid(), workout, catalogue, this.state.settings, this.state.timezone, this.deps.now(), this.deps.wall());
    // Starting is durable before the player opens. Disk failures leave a paused draft.
    this.patch({ draft, error: null });
    await this.persist();
    this.diskError = false;
    return draft.id;
  }
  tick() {
    const previous = this.state.draft;
    if (this.closed || !this.active || !previous || previous.paused) return;
    const draft = tick(previous, this.deps.now(), this.deps.wall());
    this.patch({ draft });
    if (draft.phase === "finished") { void this.finalize().catch(() => undefined); return; }
    if (draft.phase !== previous.phase || draft.index !== previous.index || this.deps.now() - this.lastPersist >= 1000) {
      this.lastPersist = this.deps.now();
      void this.persist().catch(() => undefined);
    }
  }
  async action(action: WorkoutAction) {
    if (this.closed || !this.state.draft) return;
    if (action === "resume") {
      await this.persist(); // Never continue a workout that cannot be checkpointed.
      this.diskError = false;
    }
    const draft = act(this.state.draft, action, this.deps.now(), this.deps.wall());
    this.patch({ draft, error: this.diskError ? this.state.error : null });
    if (draft.phase === "finished") await this.finalize();
    else await this.persist();
  }
  private async finalize() {
    const draft = this.state.draft;
    if (!draft || draft.phase !== "finished") return;
    const record: LocalWorkout = { id: draft.id, title: draft.workout.title, payload: sessionInput(draft) };
    this.patch({ draft: null, records: [record, ...this.state.records.filter(r => r.id !== record.id)] });
    await this.persist();
    void this.syncMutation();
  }
  async setSettings(settings: WorkoutSettings) {
    if (this.closed) return;
    this.settingsRevision++;
    this.patch({ settings, settings_dirty: true, error: null });
    await this.persist();
    void this.syncMutation();
  }
  async completeCourseDay(day: number, courseId = LEGACY_COURSE_ID) {
    if (this.closed || !this.state.ready || this.state.draft) throw Error("Сначала завершите текущее занятие");
    const course = selectedCourse(this.state, courseId), progress = courseState(this.state, this.deps.wall(), courseId);
    const definition = course?.days.find(item => item.day === day);
    if (!course || !definition || !["walk", "rest"].includes(definition.kind) || progress.day !== day || !progress.available) throw Error("Этот день пока недоступен");
    this.patch({ course_queue: [...(this.state.course_queue ?? []), { day, course_id: course.id, completed_at: this.deps.wall(), timezone: this.state.timezone }], error: null });
    await this.persist();
    void this.syncMutation();
  }
  async addToDiary(id: string) {
    const record = this.state.records.find(r => r.id === id);
    if (!record || record.server?.diary_added || (record.server?.status ?? record.payload?.status) !== "completed") return;
    this.replaceRecord(id, { diary_requested: true, error: undefined, blocked: false });
    await this.persist();
    await this.syncMutation();
  }
  async rateWorkout(id: string, effort: WorkoutEffort) {
    if (this.closed) return;
    const record = this.state.records.find(item => item.id === id);
    if (!record || !ratedWorkout(this.state, record) || !["easy", "comfortable", "hard"].includes(effort)) throw Error("Оценка доступна после завершённой тренировки курса");
    this.replaceRecord(id, { effort });
    await this.persist();
  }
  private replaceRecord(id: string, changes: Partial<LocalWorkout>) {
    this.patch({ records: this.state.records.map(r => r.id === id ? { ...r, ...changes } : r) });
  }
  private acceptProgress(courseId: string, progress: CourseCompletion[]) {
    this.patch({ course_progress_by_id: { ...this.state.course_progress_by_id, [courseId]: progress },
      ...(courseId === LEGACY_COURSE_ID ? { course_progress: progress } : {}),
      course_queue: this.state.course_queue?.filter(item => item.course_id !== courseId || !progress.some(p => p.day === item.day)) });
  }
  async retry() {
    await this.persist(); this.diskError = false;
    this.patch({ error: null, records: this.state.records.map(r => ({ ...r, blocked: false, error: undefined })), course_queue: this.state.course_queue?.map(r => ({ ...r, blocked: false, error: undefined })) });
    await this.refresh();
  }
  async setActive(active: boolean) {
    if (!active) {
      this.active = false;
      this.controller?.abort();
      await this.action("pause");
    } else {
      this.active = true;
      await this.refresh();
    }
  }
  hasPending() { return this.state.settings_dirty || this.state.records.some(r => !r.blocked && (!r.server || r.diary_requested)) || !!this.state.course_queue?.some(r => !r.blocked); }
  private syncMutation() {
    // A mutation arriving during a request must get its own upload pass.
    // Plain refreshes and network failures never create an unbounded retry loop.
    if (this.running) this.syncAgain = true;
    return this.refresh();
  }
  async refresh() {
    if (this.closed || !this.active || !this.state.ready || this.diskError) return;
    if (this.running) return this.running;
    const task = (async () => {
      do {
        this.syncAgain = false;
        await this.sync();
      } while (this.syncAgain && !this.closed && this.active && !this.diskError);
    })();
    this.running = task;
    try { await task; } finally { if (this.running === task) this.running = null; }
  }
  private async sync() {
    const controller = new AbortController(); this.controller = controller;
    const guard = () => { if (this.closed || !this.active || controller.signal.aborted) throw Error("Синхронизация остановлена"); };
    const request: Request = async (path, options) => { guard(); const value = await this.deps.request(path, { ...options, signal: controller.signal }); guard(); return value as never; };
    this.patch({ syncing: true, error: null });
    try {
      if (this.state.settings_dirty) {
        const revision = this.settingsRevision;
        const settings = catalogueCourses(this.state.catalogue).length ? this.state.settings : { auto_log: this.state.settings.auto_log, sound: this.state.settings.sound };
        await request("/v1/settings/workouts", { method: "PUT", json: settings, signal: controller.signal });
        if (revision === this.settingsRevision) this.patch({ settings_dirty: false });
        await this.persist(); guard();
      }
      // Interleave offline workouts and walk/rest check-ins in their original order.
      const jobs = [
        ...this.state.records.filter(r => !r.blocked && (!r.server || r.diary_requested)).map(item => ({ kind: "record" as const, item, date: item.payload?.ended_at ?? item.server?.ended_at ?? "" })),
        ...(this.state.course_queue ?? []).filter(r => !r.blocked).map(item => ({ kind: "day" as const, item, date: item.completed_at })),
      ].sort((a, b) => a.date.localeCompare(b.date));
      for (const job of jobs) {
        if (job.kind === "day") {
          const { day, course_id, completed_at, timezone } = job.item;
          try {
            const progress = await request<CourseCompletion[]>(`/v1/workouts/course/days/${day}`, { method: "PUT", json: { course_id, completed_at, timezone }, signal: controller.signal });
            this.acceptProgress(course_id, progress);
            await this.persist(); guard();
          } catch (error) {
            guard();
            if ([409, 422].includes(status(error))) {
              this.patch({ course_queue: this.state.course_queue?.map(item => item.day === day && item.course_id === course_id ? { ...item, blocked: true, error: message(error) } : item), error: message(error) });
              await this.persist();
            } else throw error;
          }
          continue;
        }
        const item = job.item;
        try {
          if (!item.server && item.payload) {
            const server = await request<WorkoutSession>(`/v1/workouts/sessions/${item.id}`, { method: "PUT", json: item.payload, signal: controller.signal });
            this.replaceRecord(item.id, { server, error: undefined });
            const courseId = server.course_id ?? this.state.catalogue?.workouts.find(workout => workout.id === item.payload?.workout_id)?.course_id;
            if (server.course_progress && courseId) this.acceptProgress(courseId, server.course_progress);
            await this.persist(); guard(); this.deps.updated();
          }
          if (this.state.records.find(r => r.id === item.id)?.diary_requested) {
            const server = await request<WorkoutSession>(`/v1/workouts/sessions/${item.id}/diary`, { method: "POST", signal: controller.signal });
            this.replaceRecord(item.id, { server, diary_requested: false, error: undefined });
            await this.persist(); guard(); this.deps.updated();
          }
        } catch (error) {
          guard();
          this.replaceRecord(item.id, { error: message(error), blocked: [409, 422].includes(status(error)), ...(status(error) === 422 ? { diary_requested: false } : {}) });
          await this.persist();
          if (status(error) === 0 || status(error) === 401 || status(error) >= 500) throw error;
        }
      }
      const revision = this.settingsRevision;
      const [catalogue, settings, me, history, progress, profile] = await Promise.allSettled([
        request<WorkoutCatalogue>("/v1/workouts/catalogue?max_version=5", { signal: controller.signal }),
        request<WorkoutSettings>("/v1/settings/workouts", { signal: controller.signal }),
        request<{ timezone: string }>("/v1/me", { signal: controller.signal }),
        request<{ items: WorkoutSession[]; next_offset: number | null }>("/v1/workouts/history", { signal: controller.signal }),
        request<CourseCompletion[]>("/v1/workouts/course/progress", { signal: controller.signal }),
        request<{ sex: CourseVariant | null }>("/v1/profile", { signal: controller.signal }),
      ]);
      guard();
      if (catalogue.status === "fulfilled" && !supportedCatalogue(catalogue.value)) throw Error("Обновите приложение для нового каталога тренировок");
      const currentCatalogue = catalogue.status === "fulfilled" ? catalogue.value : this.state.catalogue;
      const extraCourseIds = catalogueCourses(currentCatalogue).map(course => course.id).filter(id => id !== LEGACY_COURSE_ID);
      const extraProgress = await Promise.allSettled(extraCourseIds.map(id => request<CourseCompletion[]>(`/v1/workouts/course/progress?course_id=${encodeURIComponent(id)}`, { signal: controller.signal })));
      guard();
      if (catalogue.status === "fulfilled") {
        this.patch({ catalogue: catalogue.value });
      }
      // A failed profile request must never replace a cached male selection.
      if (profile.status === "fulfilled" && [null, "male", "female"].includes(profile.value.sex)) this.patch({ profile_sex: profile.value.sex });
      if (settings.status === "fulfilled" && revision === this.settingsRevision && !this.state.settings_dirty) this.patch({ settings: settings.value });
      if (me.status === "fulfilled") this.patch({ timezone: me.value.timezone });
      if (history.status === "fulfilled") this.mergeHistory(history.value);
      if (progress.status === "fulfilled") this.acceptProgress(LEGACY_COURSE_ID, progress.value);
      extraProgress.forEach((result, index) => { if (result.status === "fulfilled") this.acceptProgress(extraCourseIds[index], result.value); });
      const failure = [catalogue, settings, me, history, ...(catalogueCourses(this.state.catalogue).length ? [progress, ...extraProgress] : [])].find(r => r.status === "rejected");
      if (failure?.status === "rejected") this.patch({ error: message(failure.reason) });
      await this.persist();
    } catch (error) {
      if (!controller.signal.aborted && !this.closed) this.patch({ error: message(error) });
    } finally {
      if (this.controller === controller) this.controller = null;
      this.patch({ syncing: false });
    }
  }
  private mergeHistory(history: { items: WorkoutSession[]; next_offset: number | null }) {
    const merged = new Map(this.state.records.map(r => [r.id, r]));
    for (const server of history.items) merged.set(server.id, { ...merged.get(server.id), id: server.id, title: server.title, server });
    this.patch({ records: [...merged.values()].sort((a, b) => (b.server?.started_at ?? b.payload?.started_at ?? "").localeCompare(a.server?.started_at ?? a.payload?.started_at ?? "")), next_offset: history.next_offset });
  }
  async loadMore() {
    if (this.state.next_offset == null || this.closed) return;
    if (this.running) await this.running;
    const controller = new AbortController();
    const offset = this.state.next_offset;
    if (offset == null) return;
    const history = await this.deps.request<{ items: WorkoutSession[]; next_offset: number | null }>(`/v1/workouts/history?offset=${offset}`, { signal: controller.signal });
    if (this.closed) return;
    this.mergeHistory(history); await this.persist();
  }
  async forget() {
    this.controller?.abort();
    this.closed = true;
    await this.writes.catch(() => undefined);
    await this.deps.remove();
  }
  async close() {
    if (this.closed) return;
    if (this.state.draft) {
      this.patch({ draft: restoreDraft(tick(this.state.draft, this.deps.now(), this.deps.wall()), this.deps.now()) });
      void this.persist().catch(() => undefined);
    }
    this.closed = true;
    this.controller?.abort();
    await this.writes.catch(() => undefined);
  }
}
