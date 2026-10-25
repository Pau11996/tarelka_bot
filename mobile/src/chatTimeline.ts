import type { AchievementMessage, Entry } from "./types";
import type { Operation } from "./operations";

export type ChatMessage = {
  text: string;
  photos?: string[];
  voiceSeconds?: number;
  voiceUri?: string;
};

export type PendingChatMessage = ChatMessage & {
  requestKey: string;
  createdAt: string;
};

export type ChatTimelineItem =
  | { kind: "notice"; key: string; createdAt: string; date: string; notice: AchievementMessage }
  | { kind: "entry"; key: string; createdAt: string; date: string; entry: Entry }
  | { kind: "operation"; key: string; createdAt: string; date: string; operation: Operation }
  | { kind: "pending"; key: string; createdAt: string; date: string; message: PendingChatMessage };

function localDate(timestamp: string) {
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) return timestamp.slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function buildChatTimeline(
  entries: Entry[],
  operations: Operation[],
  pending: PendingChatMessage | null = null,
  notices: AchievementMessage[] = [],
): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  for (const notice of new Map(notices.map((value) => [value.id, value])).values()) {
    items.push({ kind: "notice", key: `notice:${notice.id}`, notice,
      createdAt: notice.created_at, date: localDate(notice.created_at) });
  }
  for (const entry of new Map(entries.map((value) => [value.id, value])).values()) {
    items.push({
      kind: "entry", key: `entry:${entry.id}`, entry,
      createdAt: entry.created_at ?? entry.entry_date,
      date: entry.entry_date,
    });
  }
  const jobs = [...new Map(operations.map((value) => [value.id, value])).values()];
  for (const operation of jobs) {
    if (operation.kind === "review") continue;
    if (operation.status === "done" && !["unknown", "weight_saved"].includes(operation.result?.status)) continue;
    items.push({
      kind: "operation", key: `operation:${operation.id}`, operation,
      createdAt: operation.created_at, date: localDate(operation.created_at),
    });
  }
  if (pending && !jobs.some((operation) => operation.request_key === pending.requestKey)) {
    items.push({
      kind: "pending", key: `pending:${pending.requestKey}`, message: pending,
      createdAt: pending.createdAt, date: localDate(pending.createdAt),
    });
  }
  return items.sort((a, b) => {
    const aTime = Date.parse(a.createdAt) || 0;
    const bTime = Date.parse(b.createdAt) || 0;
    return aTime - bTime || a.key.localeCompare(b.key);
  });
}
