import { sessionDate } from "./engine";
import type { ActivityLevel, CourseCompletion, WorkoutData } from "./types";

export const activityLevels: { id: ActivityLevel; title: string; seconds: number }[] = [
  { id: "light", title: "Лёгкий", seconds: 20 }, { id: "medium", title: "Средний", seconds: 30 }, { id: "intense", title: "Интенсивный", seconds: 40 },
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
