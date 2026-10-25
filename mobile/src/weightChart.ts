import { chartDomain, pointPosition } from "./chartMath";
import type { WeightMeasurement } from "./types";

export function weightChartGeometry(history: WeightMeasurement[], width: number, target?: number) {
  const rows = history.filter(row => Number.isFinite(row.weight_kg) && row.weight_kg > 0).slice(-30);
  const points = rows.map(row => ({ date: row.recorded_at, value: row.weight_kg }));
  const domain = chartDomain(points, target, true);
  const height = 188, left = 8, right = Math.max(200, width) - 8, top = 15, bottom = 152;
  const y = (value: number) => bottom - (value - domain.low) / (domain.high - domain.low) * (bottom - top);
  const coordinates = rows.map((row, index) => ({
    row, x: left + pointPosition(points, index, true) * (right - left), y: y(row.weight_kg),
  }));
  const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const first = coordinates[0], last = coordinates.at(-1);
  const area = first && last && coordinates.length > 1 ? `${line} L${last.x},${bottom} L${first.x},${bottom} Z` : "";
  return { coordinates, domain, height, left, right, top, bottom, line, area,
    grid: [domain.low, (domain.low + domain.high) / 2, domain.high].map(y),
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
