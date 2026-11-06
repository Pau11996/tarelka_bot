import { sessionDate } from "./engine";
import { workoutSeconds } from "./timing";
import type { ActivityLevel, CourseCompletion, CourseVariant, WorkoutCatalogue, WorkoutCourse, WorkoutData, WorkoutStep } from "./types";

export const LEGACY_COURSE_ID = "full_body_28_v1";
export const HOME_COURSE_ID = "full_body_home_28_v1";
export const activityLevels: { id: ActivityLevel; title: string }[] = [
  { id: "light", title: "Лёгкий" }, { id: "medium", title: "Средний" }, { id: "intense", title: "Интенсивный" },
];
export const sectionLabels = { warmup: "Разминка", main: "Основная часть", cooldown: "Заминка", stretch: "Растяжка", mobility: "Подвижность" };
export function stepSectionLabel(step: WorkoutStep) {
  return `${step.section ? sectionLabels[step.section] : ""}${step.round ? ` · круг ${step.round}` : ""}`;
}
/** One selection rule for programme, descriptions, duration, and cover. */
export const courseVariant = (sex?: CourseVariant | null): CourseVariant => sex === "male" ? "male" : "female";
export function catalogueCourses(catalogue: WorkoutCatalogue | null, sex?: CourseVariant | null): WorkoutCourse[] {
  if (!catalogue) return [];
  const variant = courseVariant(sex);
  if (catalogue.courses) return catalogue.courses.map(course => ({ id: course.id, title: course.title, variant, ...course.variants[variant] }));
  return catalogue.course ? [catalogue.course] : [];
}
export function selectedCourse(data: Pick<WorkoutData, "catalogue" | "profile_sex">, courseId = LEGACY_COURSE_ID) {
  return catalogueCourses(data.catalogue, data.profile_sex).find(course => course.id === courseId);
}
export function courseCompletions(data: WorkoutData, courseId = LEGACY_COURSE_ID): CourseCompletion[] {
  const confirmed = [...(data.course_progress_by_id?.[courseId] ?? (courseId === LEGACY_COURSE_ID ? data.course_progress : []) ?? [])].sort((a, b) => a.day - b.day);
  const pending: (CourseCompletion & { start_date?: string })[] = (data.course_queue ?? []).filter(item => !item.blocked && item.course_id === courseId).map(item => ({ day: item.day, completed_at: item.completed_at,
    local_date: sessionDate(item.completed_at, item.timezone), session_id: null }));
  for (const record of data.records) {
    if (record.server || record.blocked || record.payload?.status !== "completed") continue;
    const definition = data.catalogue?.workouts.find(w => w.id === record.payload?.workout_id);
    if (definition?.course_id !== courseId || !definition?.course_day) continue;
    pending.push({ day: definition.course_day, completed_at: record.payload.ended_at,
      local_date: sessionDate(record.payload.ended_at, record.payload.timezone),
      start_date: sessionDate(record.payload.started_at, record.payload.timezone), session_id: record.id });
  }
  for (const item of pending.sort((a, b) => a.day - b.day || a.completed_at.localeCompare(b.completed_at))) {
    if (item.day === confirmed.length + 1 && (!confirmed.length || (item.start_date ?? item.local_date) > confirmed[confirmed.length - 1].local_date)) {
      const { start_date: _, ...completion } = item;
      confirmed.push(completion);
    }
  }
  return confirmed;
}
export function courseState(data: WorkoutData, wall: string, courseId = LEGACY_COURSE_ID) {
  const completed = courseCompletions(data, courseId), day = completed.length + 1;
  const today = sessionDate(wall, data.timezone);
  const last = completed[completed.length - 1], days = selectedCourse(data, courseId)?.days.length ?? 28;
  const available = !last || today > last.local_date;
  return { completed, day, available: day <= days && available, finished: day > days };
}
export function courseWorkout(data: WorkoutData, day: number, level = data.settings.activity_level ?? "medium", courseId = LEGACY_COURSE_ID) {
  const id = selectedCourse(data, courseId)?.days.find(d => d.day === day)?.workout_ids[level];
  return data.catalogue?.workouts.find(w => w.id === id);
}
export function courseDescription(course: WorkoutCourse) {
  return course.description ?? "Тренировки для всего тела, прогулки и восстановление — в своём темпе.";
}
export function courseInstructions(course: WorkoutCourse): string[] {
  return course.instructions ?? [
    "Коврик и свободная стена. Устойчивая опора — по необходимости для равновесия.",
    course.revision === 2 ? "Один подход каждого упражнения. Разминка и спокойные шаги в конце — по пять минут." : "Занятия чередуются с прогулками, подвижностью и отдыхом. Дополнительные подходы необязательны.",
    "Выбирайте посильную нагрузку и продлевайте отдых по необходимости.",
    "Прогулки постепенно увеличиваются от 15 до 30 минут; время можно сокращать и делить на части.",
  ];
}
export function courseSummary(data: WorkoutData, courseId = LEGACY_COURSE_ID) {
  const course = selectedCourse(data, courseId);
  if (!course) return null;
  const workouts = course.days.flatMap(day => {
    const workout = courseWorkout(data, day.day, undefined, courseId);
    return workout ? [workout] : [];
  });
  const range = (values: number[]) => {
    if (!values.length) return "—";
    const min = Math.min(...values), max = Math.max(...values);
    return min === max ? String(min) : `${min}–${max}`;
  };
  const rounds = Math.max(1, ...workouts.flatMap(workout => workout.steps.map(step => step.round ?? 1)));
  const repetitions = workouts.some(workout => workout.steps.some(step => step.repetitions));
  return {
    title: course.title.replace(/\s*[—–]\s*\d+\s*д(?:ень|ня|ней)$/u, ""), days: course.days.length,
    minutes: range(workouts.map(workout => Math.round(workoutSeconds(workout) / 60))),
    exercises: rounds > 1
      ? range(workouts.map(workout => new Set(workout.steps.filter(step => step.round === 1).map(step => step.exercise_id)).size).filter(Boolean))
      : repetitions ? range(workouts.filter(workout => workout.kind === "strength").map(workout => workout.steps.filter(step => step.section === "main").length))
      : range(workouts.map(workout => workout.steps.length)),
    exerciseLabel: rounds > 1 ? `упражнений · ${rounds} круга` : repetitions ? "в основной части" : "упражнений в занятии",
  };
}
