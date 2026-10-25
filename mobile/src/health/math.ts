import { shiftDay } from "../chartMath";
import type { ImportedRecord, RawHealthRecord, RecordIndex } from "./types";

export function localDate(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function indexRecord(record: RawHealthRecord) {
  const start = record.time ?? record.startTime;
  return record.metadata?.id && start && Number.isFinite(Date.parse(start))
    ? { key: `${record.recordType}:${record.metadata.id}`, interval: { start_at: start, ...(record.endTime ? { end_at: record.endTime } : {}) } } : null;
}
export function intervalDates(interval: RecordIndex[string], timezone: string) {
  const first = localDate(interval.start_at, timezone);
  const last = interval.end_at ? localDate(new Date(Math.max(Date.parse(interval.start_at), Date.parse(interval.end_at) - 1)).toISOString(), timezone) : first;
  const dates = [first];
  for (let day = shiftDay(first, 1); day <= last && dates.length < 366; day = shiftDay(day, 1)) dates.push(day);
  return dates;
}
export function normalizeRecord(record: RawHealthRecord): ImportedRecord | null {
  const indexed = indexRecord(record), origin = record.metadata?.dataOrigin;
  if (!indexed || !origin) return null;
  const common = { external_id: record.metadata!.id!, origin, start_at: indexed.interval.start_at };
  if (record.recordType === "Weight") {
    const weight = record.weight?.inKilograms;
    return typeof weight === "number" && Number.isFinite(weight) && weight > 0 && weight <= 1000 ? { ...common, record_type: "Weight", weight_kg: weight } : null;
  }
  if (record.recordType === "ExerciseSession" && record.endTime && Date.parse(record.endTime) > Date.parse(common.start_at)) {
    return { ...common, record_type: "ExerciseSession", end_at: record.endTime, duration_minutes: (Date.parse(record.endTime) - Date.parse(common.start_at)) / 60000, ...(record.title ? { title: record.title.slice(0, 255) } : {}), ...(record.exerciseType != null ? { exercise_type: record.exerciseType } : {}) };
  }
  return null;
}
export function dateChunks(start: string, end: string) {
  const result: { start: string; end: string }[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 31)) result.push({ start: day, end: shiftDay(day, 30) < end ? shiftDay(day, 30) : end });
  return result;
}
export function sourceName(origin: string) {
  return ({ "com.sec.android.app.shealth": "Samsung Health", "com.garmin.android.apps.connectmobile": "Garmin Connect", "com.xiaomi.wearable": "Mi Fitness", "com.huami.watch.hmwatchmanager": "Zepp", "com.google.android.apps.fitness": "Google Fit" } as Record<string, string>)[origin] ?? origin;
}
