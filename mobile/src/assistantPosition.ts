export const ASSISTANT_SIZE = 60;
export type Point = { x: number; y: number };
export type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export type AssistantDock = { edge: "left" | "right"; fraction: number };

export function assistantBounds(
  width: number,
  height: number,
  topInset: number,
  bottomInset: number,
  chat: boolean,
): Bounds {
  const left = Math.max(12, (width - 680) / 2 + 12);
  const right = Math.max(left, width - left - ASSISTANT_SIZE);
  const top = Math.min(
    topInset + 92,
    Math.max(12, height - ASSISTANT_SIZE - 12),
  );
  const bottom = Math.max(
    top,
    height - bottomInset - (chat ? 160 : 84) - ASSISTANT_SIZE,
  );
  return { left, right, top, bottom };
}
export function clampAssistant(point: Point, bounds: Bounds): Point {
  return {
    x: Math.max(bounds.left, Math.min(bounds.right, point.x)),
    y: Math.max(bounds.top, Math.min(bounds.bottom, point.y)),
  };
}
export function assistantDock(point: Point, bounds: Bounds): AssistantDock {
  const safe = clampAssistant(point, bounds);
  return {
    edge: safe.x < (bounds.left + bounds.right) / 2 ? "left" : "right",
    fraction:
      bounds.bottom > bounds.top
        ? (safe.y - bounds.top) / (bounds.bottom - bounds.top)
        : 1,
  };
}
export function dockPosition(dock: AssistantDock, bounds: Bounds): Point {
  return {
    x: dock.edge === "left" ? bounds.left : bounds.right,
    y:
      bounds.top +
      Math.max(0, Math.min(1, dock.fraction)) * (bounds.bottom - bounds.top),
  };
}
export function parseAssistantDock(raw: string | null): AssistantDock | null {
  try {
    const value = JSON.parse(raw ?? "null");
    return value &&
      (value.edge === "left" || value.edge === "right") &&
      typeof value.fraction === "number" &&
      Number.isFinite(value.fraction)
      ? { edge: value.edge, fraction: Math.max(0, Math.min(1, value.fraction)) }
      : null;
  } catch {
    return null;
  }
}
