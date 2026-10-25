import { shiftDay } from "./chartMath";
import type { Entry } from "./types";

export function diaryDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function diaryWeek(selected: string) {
  const weekday = new Date(`${selected}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(selected, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}

export function diaryMonth(month: string) {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const offset = (weekday + 6) % 7;
  const count = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, i) => {
    const number = i - offset + 1;
    return number > 0 && number <= count ? `${month}-${String(number).padStart(2, "0")}` : null;
  });
}

export function moveDiaryMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function diaryProgress(value: number, target: number) {
  return Number.isFinite(value) && Number.isFinite(target) && target > 0
    ? Math.max(0, Math.min(1, value / target))
    : 0;
}

export function dayNutrient(entries: Entry[], key: "fiber_g" | "sugar_g") {
  const meals = entries.filter((entry) => entry.entry_type === "meal");
  const values = meals.flatMap((entry) => {
    const value = entry.micronutrients?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [value] : [];
  });
  return {
    value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    recorded: values.length,
    meals: meals.length,
    partial: values.length > 0 && values.length < meals.length,
  };
}

export function diaryChronicle(entries: Entry[]) {
  return [...entries].sort((a, b) => {
    const aTime = a.created_at ? Date.parse(a.created_at) : NaN;
    const bTime = b.created_at ? Date.parse(b.created_at) : NaN;
    const difference = (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity);
    return difference || a.id - b.id;
  });
}

export function streakLabel(value: number) {
  const rest = value % 100;
  const noun = rest >= 11 && rest <= 14 ? "дней" : value % 10 === 1 ? "день" : value % 10 >= 2 && value % 10 <= 4 ? "дня" : "дней";
  return `${value} ${noun}`;
}
