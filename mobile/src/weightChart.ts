import { chartDomain, pointPosition } from "./chartMath";
import type { WeightMeasurement } from "./types";

export function weightChartGeometry(history: WeightMeasurement[], width: number, target?: number) {
  const rows = history.filter(row => Number.isFinite(row.weight_kg) && row.weight_kg > 0).slice(-30);
  const points = rows.map(row => ({ date: row.recorded_at, value: row.weight_kg }));
  const bounds = chartDomain(points, target, true);
  const low = Math.floor(bounds.low * 2) / 2;
  const step = Math.max(0.5, Math.ceil((bounds.high - low) / 4 * 2) / 2);
  const domain = { low, high: low + step * 4 };
  const height = 214, left = 44, right = Math.max(200, width) - 10, top = 22, bottom = 178;
  const y = (value: number) => bottom - (value - domain.low) / (domain.high - domain.low) * (bottom - top);
  const coordinates = rows.map((row, index) => ({
    row, x: left + pointPosition(points, index, true) * (right - left), y: y(row.weight_kg),
  }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const first = coordinates[0], last = coordinates.at(-1);
  const area = first && last && coordinates.length > 1 ? `${line} L${last.x},${bottom} L${first.x},${bottom} Z` : "";
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = domain.low + (domain.high - domain.low) * index / 4;
    return { value, y: y(value) };
  });
  return { coordinates, domain, height, left, right, top, bottom, line, area, ticks,
    grid: ticks.map(tick => tick.y),
    targetY: target === undefined ? null : y(target) };
}

export function closestWeightPoint(points: { x: number }[], x: number) {
  let selected = -1, distance = Infinity;
  points.forEach((point, index) => {
    const next = Math.abs(point.x - x);
    // Equal timestamps keep the last operation selected, as on the server.
    if (next <= distance) { selected = index; distance = next; }
  });
  return selected;
}
