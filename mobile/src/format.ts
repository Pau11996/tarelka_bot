import type { RequestUsage } from "./types";

export function requestUsageSubtitle(view: RequestUsage): string {
  if (view.limit_mode === "split" && view.limits && view.used) {
    return `Фото ${view.used.photo}/${view.limits.photo} · текст ${view.used.text}/${view.limits.text} · голос ${view.used.voice}/${view.limits.voice}`;
  }
  return `${view.requests_used_today} из ${view.daily_limit} запросов`;
}

export function kcal(value: number): string {
  return `${Math.round(value)} ккал`;
}

export function grams(value: number): string {
  return `${Math.round(value)} г`;
}

export function ml(value: number): string {
  return `${Math.round(value)} мл`;
}

const MEAL_SLOT_LABELS: Record<string, string> = {
  breakfast: "Завтрак",
  second_breakfast: "Второй завтрак",
  lunch: "Обед",
  lanch: "Ланч",
  snack: "Перекус",
  afternoon: "Полдник",
  dinner: "Ужин",
  late_dinner: "Поздний ужин",
};

export function mealHeading(
  title: string,
  mealSlot: string | null | undefined,
): string {
  const label = mealSlot ? MEAL_SLOT_LABELS[mealSlot] : undefined;
  return label ? `${label} · ${title}` : title;
}

export function formatDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) {
    return iso;
  }
  return `${day}.${month}.${year}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return formatDay(iso);
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
