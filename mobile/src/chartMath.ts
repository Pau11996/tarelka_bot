export type ValuePoint = { value: number | null; date: string };
export function chartDomain(
  points: ValuePoint[],
  target?: number,
  line = false,
) {
  const values = points.flatMap((p) =>
    p.value !== null && Number.isFinite(p.value) ? [p.value] : [],
  );
  const low = line && values.length ? Math.max(0, Math.min(...values, ...(target != null ? [target] : [])) - 2) : 0;
  const high = Math.max(low + 1, target ?? 0, ...values) * (line ? 1.02 : 1.12);
  return { low, high };
}
export function pointPosition(
  points: ValuePoint[],
  index: number,
  line = false,
) {
  if (line && points.length > 1) {
    const first = Date.parse(points[0].date),
      last = Date.parse(points[points.length - 1].date),
      current = Date.parse(points[index].date);
    if (Number.isFinite(first) && Number.isFinite(last) && last > first)
      return 0.03 + ((current - first) / (last - first)) * 0.94;
  }
  return (index + 0.5) / Math.max(1, points.length);
}
export function allowedNotificationPath(value: unknown) {
  return typeof value === "string" &&
    ["/assistant", "/pay", "/(tabs)/chat", "/weight"].includes(value)
    ? value
    : null;
}
export function shiftDay(day: string, offset: number) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
