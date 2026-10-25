import { diaryDate } from "./diary";
import { shiftDay } from "./chartMath";
import type { StatsDay } from "./types";

export type StatisticsRange = { start: string; end: string };

export function statisticsRange(first: string, last: string): StatisticsRange {
  return first <= last ? { start: first, end: last } : { start: last, end: first };
}

export function statisticsRangeDays(range: StatisticsRange) {
  return Math.round((Date.parse(`${range.end}T12:00:00Z`) - Date.parse(`${range.start}T12:00:00Z`)) / 86400000) + 1;
}

export function statisticsPeriod(end: string, days: number): StatisticsRange {
  return { start: shiftDay(end, -(days - 1)), end };
}

export function moveStatisticsRange(range: StatisticsRange, direction: -1 | 1, today: string): StatisticsRange {
  const days = statisticsRangeDays(range);
  const end = shiftDay(range.end, days * direction);
  return statisticsPeriod(end > today ? today : end, days);
}

export function recordedAverage(days: StatsDay[], key: keyof StatsDay): number | null {
  const values = days.flatMap((day) => {
    const value = day[key];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function statisticsDates(days: StatsDay[], entryDates: string[] = []) {
  return [...new Set([
    ...entryDates.filter((date) => diaryDate(date) !== null),
    ...days.filter((day) => (day.entry_count ?? 0) > 0 || day.logged || day.water_ml != null || day.activity_minutes != null || day.activity_kcal != null).map((day) => day.date),
  ])].sort();
}

export function statisticsPercent(value: number | null, target: number): number | null {
  return value !== null && Number.isFinite(value) && Number.isFinite(target) && target > 0
    ? Math.max(0, Math.round(value / target * 100)) : null;
}
