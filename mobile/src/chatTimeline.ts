import type { AchievementMessage, Entry } from "./types";
import type { Operation } from "./operations";
import type { OutgoingMessage } from "./outbox/queue";

export type ChatMessage = {
  text: string;
  photos?: string[];
  voiceSeconds?: number;
  voiceUri?: string;
};

export type PendingChatMessage = ChatMessage & {
  requestKey: string;
  createdAt: string;
  state?: OutgoingMessage["state"];
  entryId?: number;
  error?: string;
  limitReached?: OutgoingMessage["limitReached"];
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
  pending: PendingChatMessage | PendingChatMessage[] | null = null,
  notices: AchievementMessage[] = [],
  anchors: Record<string, string> = {},
): ChatTimelineItem[] {
  const items: ChatTimelineItem[] = [];
  const jobs = [...new Map(operations.map((value) => [value.id, value])).values()];
  for (const notice of new Map(notices.map((value) => [value.id, value])).values()) {
    items.push({ kind: "notice", key: `notice:${notice.id}`, notice,
      createdAt: notice.created_at, date: localDate(notice.created_at) });
  }
  for (const entry of new Map(entries.map((value) => [value.id, value])).values()) {
    const original = jobs.find(op => op.entry_id === entry.id && op.kind === "analyze" && op.status === "done");
    items.push({
      kind: "entry", key: original && anchors[original.request_key] ? `message:${original.request_key}` : `entry:${entry.id}`, entry,
      createdAt: original ? anchors[original.request_key] ?? original.created_at : entry.created_at ?? entry.entry_date,
      date: entry.entry_date,
    });
  }
  for (const operation of jobs) {
    if (operation.kind === "review") continue;
    if (operation.status === "done" && !["unknown", "weight_saved"].includes(operation.result?.status)) continue;
    items.push({
      kind: "operation", key: anchors[operation.request_key] ? `message:${operation.request_key}` : `operation:${operation.id}`, operation,
      createdAt: anchors[operation.request_key] ?? operation.created_at, date: localDate(anchors[operation.request_key] ?? operation.created_at),
    });
  }
  for (const message of Array.isArray(pending) ? pending : pending ? [pending] : []) {
    if (jobs.some(operation => operation.request_key === message.requestKey)) continue;
    items.push({
      kind: "pending", key: anchors[message.requestKey] ? `message:${message.requestKey}` : `pending:${message.requestKey}`, message,
      createdAt: message.createdAt, date: localDate(message.createdAt),
    });
  }
  return items.sort((a, b) => {
    const aTime = Date.parse(a.createdAt) || 0;
    const bTime = Date.parse(b.createdAt) || 0;
    return aTime - bTime || a.key.localeCompare(b.key);
  });
}
