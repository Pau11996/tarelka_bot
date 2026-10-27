import { AppState } from "react-native";
import { useSyncExternalStore } from "react";
import { api } from "../api";
import { appendMedia } from "../media";
import type { Operation } from "../operations";
import { OutboxQueue, type OutboxInput, type OutboxSnapshot } from "./queue";
import { createOutboxStorage } from "./storage";

const EMPTY: OutboxSnapshot = { items: [], anchors: {}, ready: false, error: null };
let queue: OutboxQueue | null = null;
let sessionToken: string | null = null;
let transition = Promise.resolve();
let detach: (() => void) | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSnapshot = () => queue?.getSnapshot() ?? EMPTY;

/** Auth awaits this before exposing the account. Uploads never belong to a screen. */
export function setChatOutboxSession(token: string | null) {
  // Stop old uploads immediately, even if another transition is still settling.
  if (token !== sessionToken) queue?.setActive(false);
  transition = transition.catch(() => {}).then(async () => {
    if (sessionToken === token) return;
    const previous = queue;
    detach?.(); detach = undefined;
    queue = null; sessionToken = null; notify();
    await previous?.close();
    if (!token) return;
    const storage = await createOutboxStorage(token);
    const current = new OutboxQueue(storage, async (item, signal) => {
      const form = new FormData();
      form.append("request_key", item.requestKey);
      if (item.text) form.append("text", item.text);
      if (item.entryId != null) form.append("entry_id", String(item.entryId));
      if (item.voiceId) form.append("voice_id", item.voiceId);
      for (const photo of item.photos) await appendMedia(form, "image", photo, signal);
      if (signal.aborted) throw new Error("Upload paused");
      return api<Operation>("/v1/operations", { token, body: form, signal });
    });
    sessionToken = token; queue = current;
    const unsubscribe = current.subscribe(notify);
    const appState = AppState.addEventListener("change", state => current.setActive(state === "active"));
    detach = () => { unsubscribe(); appState.remove(); };
    current.setActive(AppState.currentState === "active");
    await current.initialize();
    notify();
  });
  return transition;
}

export function useChatOutbox() { return useSyncExternalStore(subscribe, getSnapshot, getSnapshot); }
export function enqueueMessage(input: OutboxInput) {
  if (!queue) throw new Error("Очередь отправки ещё загружается.");
  queue.enqueue(input);
}
export function retryMessage(key: string) { queue?.retry(key); }
export function reopenOutbox() { return queue?.initialize(); }
export function reconcileOutbox(operations: Operation[], entryIds: number[]) { queue?.reconcile(operations, entryIds); }
export function observeOutbox(operations: Operation[]) { queue?.observe(operations); }
