import type { AchievementMessage, Entry } from "../types";
import type { Operation } from "../operations";
import type { OutgoingMessage } from "./queue";

export type ChatHistory = {
  notices?: AchievementMessage[];
  entries: Entry[];
  operations: Operation[];
  media: { id: string; operation_id: string; mime: string; url: string }[];
  next_before: number | null;
};

/** An accepted job may finish outside the latest page while the app is closed. */
export async function recoverOutboxHistory(
  chat: ChatHistory, items: OutgoingMessage[], fetch: <T>(path: string) => Promise<T>,
) {
  const observed: Operation[] = [];
  const recovered: ChatHistory[] = [];
  for (const item of items) {
    if (!item.operation || chat.operations.some(op => op.id === item.operation!.id)) continue;
    try {
      const op = ["queued", "running"].includes(item.operation.status)
        ? await fetch<Operation>(`/v1/operations/${item.operation.id}`) : item.operation;
      observed.push(op);
      if (op.status === "done" && op.entry_id != null && !chat.entries.some(entry => entry.id === op.entry_id)) {
        recovered.push(await fetch<ChatHistory>(`/v1/chat?before=${op.entry_id + 1}&limit=1`));
      }
    } catch (error) {
      if ((error as { status?: number })?.status === 401) throw error;
      if ((error as { status?: number })?.status === 404) observed.push({ ...item.operation,
        status: "failed", result: null, error: "Запрос больше недоступен." });
      // One unavailable old job must not hide fresh history; retry on the next poll.
    }
  }
  const unique = <T extends { id: string | number }>(values: T[]) => [...new Map(values.map(value => [value.id, value])).values()];
  return { observed, recovered: recovered.length > 0, chat: {
    ...chat,
    entries: unique([...recovered.flatMap(page => page.entries), ...chat.entries]),
    operations: unique([...recovered.flatMap(page => page.operations), ...chat.operations]),
    media: unique([...recovered.flatMap(page => page.media), ...chat.media]),
  } };
}
