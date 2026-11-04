import { sessionDate } from "./engine";
import { workoutSeconds } from "./timing";
import type { ActivityLevel, CourseCompletion, WorkoutData } from "./types";

export const activityLevels: { id: ActivityLevel; title: string }[] = [
  { id: "light", title: "Лёгкий" }, { id: "medium", title: "Средний" }, { id: "intense", title: "Интенсивный" },
];
export const sectionLabels = { warmup: "Разминка", main: "Основная часть", cooldown: "Спокойные шаги", stretch: "Растяжка", mobility: "Подвижность" };
export function courseCompletions(data: WorkoutData): CourseCompletion[] {
  const confirmed = [...(data.course_progress ?? [])].sort((a, b) => a.day - b.day);
  const pending: CourseCompletion[] = (data.course_queue ?? []).filter(item => !item.blocked).map(item => ({ day: item.day, completed_at: item.completed_at,
    local_date: sessionDate(item.completed_at, item.timezone), session_id: null }));
  for (const record of data.records) {
    if (record.server || record.blocked || record.payload?.status !== "completed") continue;
    const definition = data.catalogue?.workouts.find(w => w.id === record.payload?.workout_id);
    if (definition?.course_id !== data.catalogue?.course?.id || !definition?.course_day) continue;
    pending.push({ day: definition.course_day, completed_at: record.payload.ended_at,
      local_date: sessionDate(record.payload.ended_at, record.payload.timezone), session_id: record.id });
  }
  for (const item of pending.sort((a, b) => a.day - b.day)) {
    if (item.day === confirmed.length + 1 && (!confirmed.length || item.local_date > confirmed[confirmed.length - 1].local_date)) confirmed.push(item);
  }
  return confirmed;
}
export function courseState(data: WorkoutData, wall: string) {
  const completed = courseCompletions(data), day = completed.length + 1;
  const today = sessionDate(wall, data.timezone);
  const last = completed[completed.length - 1];
  const available = !last || today > last.local_date;
  return { completed, day, available: day <= 28 && available, finished: day > 28 };
}
export function courseWorkout(data: WorkoutData, day: number, level = data.settings.activity_level ?? "medium") {
  const id = data.catalogue?.course?.days.find(d => d.day === day)?.workout_ids[level];
  return data.catalogue?.workouts.find(w => w.id === id);
}

export function courseSummary(data: WorkoutData) {
  const course = data.catalogue?.course;
  if (!course) return null;
  const workouts = course.days.flatMap(day => {
    const workout = courseWorkout(data, day.day);
    return workout ? [workout] : [];
  });
  const range = (values: number[]) => {
    if (!values.length) return "—";
    const min = Math.min(...values), max = Math.max(...values);
    return min === max ? String(min) : `${min}–${max}`;
  };
  return {
    title: course.title.replace(/\s*[—–]\s*\d+\s*д(?:ень|ня|ней)$/u, ""),
    days: course.days.length,
    minutes: range(workouts.map(workout => Math.round(workoutSeconds(workout) / 60))),
    exercises: course.revision === 2
      ? range(workouts.filter(workout => workout.kind === "strength").map(workout => workout.steps.filter(step => step.section === "main").length))
      : range(workouts.map(workout => workout.steps.length)),
    exerciseLabel: course.revision === 2 ? "в основной части" : "упражнений в занятии",
  };
}
