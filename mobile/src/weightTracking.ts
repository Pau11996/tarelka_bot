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
