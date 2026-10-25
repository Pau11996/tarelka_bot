export const weightGoalLabels = { lose: "Снизить вес", maintain: "Поддерживать вес", gain: "Набрать вес" } as const;
export const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
export const fullWeekdays = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

export function parseWeight(value: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const weight = Number(value.trim().replace(",", "."));
  return Number.isFinite(weight) && weight > 0 && weight <= 1000 ? weight : null;
}

export function weightDirection(current: number, target: number): "lose" | "maintain" | "gain" {
  return target < current ? "lose" : target > current ? "gain" : "maintain";
}

export function weightNumber(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

export function measurementLabel(count: number): string {
  const last = count % 10, lastTwo = count % 100;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "измерений" : last === 1 ? "измерение" : last >= 2 && last <= 4 ? "измерения" : "измерений";
  return `${count} ${word}`;
}

export function weightChangePeriod(startedAt: string, measuredAt?: string | null, timeZone = "UTC"): string {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) return "с начала цели";
  const date = (value: Date) => value.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone }).replace(/\s*г\.$/, "");
  const end = measuredAt ? new Date(measuredAt) : null;
  // A goal can start after the last weigh-in. That record cannot define a new period.
  if (!end || !Number.isFinite(end.getTime()) || end < start) return `с ${date(start)}`;
  const first = date(start), last = date(end);
  return first === last ? `за ${first}` : `${first} — ${last}`;
}
