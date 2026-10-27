export type RowLayout = { y: number; height: number };

export function moveFavorite<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/** Layouts stay in their original positions while the dragged row floats. */
export function favoriteDropIndex(layouts: RowLayout[], from: number, dy: number): number {
  const center = layouts[from].y + layouts[from].height / 2 + dy;
  return layouts.reduce((index, row, i) => index + (i !== from && center > row.y + row.height / 2 ? 1 : 0), 0);
}

export function favoriteScrollStep(pointerY: number, top: number, height: number, offset: number, max: number): number {
  const edge = Math.min(56, height / 4);
  if (edge <= 0) return offset;
  const proximity = pointerY < top + edge ? (pointerY - top - edge) / edge
    : pointerY > top + height - edge ? (pointerY - top - height + edge) / edge : 0;
  return Math.max(0, Math.min(max, offset + Math.max(-1, Math.min(1, proximity)) * 9));
}
