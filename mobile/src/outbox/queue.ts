import type { LocalMedia } from "../media";
import type { Operation } from "../operations";
import type { RequestLimitInfo } from "../requestLimits";

export type OutgoingMessage = {
  requestKey: string;
  createdAt: string;
  text: string;
  photos: LocalMedia[];
  voiceId?: string;
  voiceMedia?: LocalMedia;
  voiceSeconds?: number;
  entryId?: number;
  previousCalories?: number;
  state: "preparing" | "waiting" | "uploading" | "accepted" | "failed";
  prepared?: boolean;
  error?: string;
  limitReached?: RequestLimitInfo;
  operation?: Operation;
};

export type OutboxData = {
  items: OutgoingMessage[];
  // Keep small ordering anchors after uploaded files have been released.
  anchors: Record<string, string>;
  dismissedFailures?: string[];
};
export type OutboxSnapshot = OutboxData & { ready: boolean; error: string | null };
export type OutboxStorage = {
  read(): Promise<OutboxData | null>;
  write(data: OutboxData): Promise<void>;
  prepare(item: OutgoingMessage): Promise<OutgoingMessage>;
  release(item: OutgoingMessage): Promise<void>;
  clear(): Promise<void>;
};
export type OutboxInput = Omit<OutgoingMessage, "state" | "prepared" | "error" | "operation" | "limitReached">;

/** One upload at a time. Server analysis never occupies this upload slot. */
export class OutboxQueue {
  private snapshot: OutboxSnapshot = { items: [], anchors: {}, ready: false, error: null };
  private listeners = new Set<() => void>();
  private writes: Promise<void> = Promise.resolve();
  private preparations = new Set<Promise<void>>();
  private initializing: Promise<void> | null = null;
  private upload: AbortController | null = null;
  private pausedUploads = new WeakSet<AbortController>();
  private running = false;
  private closed = false;
  private active = false;

  constructor(private storage: OutboxStorage,
    private send: (item: OutgoingMessage, signal: AbortSignal) => Promise<Operation>) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private update(patch: Partial<OutboxSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private patch(key: string, patch: Partial<OutgoingMessage>) {
    this.update({ items: this.snapshot.items.map(item => item.requestKey === key ? { ...item, ...patch } : item) });
  }

  private persist() {
    const data: OutboxData = { items: this.snapshot.items, anchors: this.snapshot.anchors,
      dismissedFailures: this.snapshot.dismissedFailures };
    const write = this.writes.catch(() => {}).then(() => {
      if (!this.closed) return this.storage.write(data);
    });
    this.writes = write;
    return write;
  }

  initialize() {
    if (this.snapshot.ready || this.closed) return Promise.resolve();
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const data = await this.storage.read();
        if (this.closed) return;
        const items = (data?.items ?? []).map(item => item.state === "uploading" ? { ...item, state: "waiting" as const } : item);
        this.update({ items, anchors: data?.anchors ?? {}, dismissedFailures: data?.dismissedFailures ?? [], ready: true, error: null });
        for (const item of items) if (item.state === "preparing") this.prepare(item);
        void this.pump();
      } catch {
        this.update({ error: "Не удалось открыть очередь отправки. Попробуйте ещё раз." });
      } finally { this.initializing = null; }
    })();
    return this.initializing;
  }

  enqueue(input: OutboxInput) {
    if (!this.snapshot.ready || this.closed) throw new Error("Очередь отправки ещё загружается.");
    if (this.snapshot.items.some(item => item.requestKey === input.requestKey)) return;
    if (input.entryId != null && this.isCorrecting(input.entryId)) throw new Error("Эта запись уже уточняется.");
    const lastTime = Math.max(0, ...Object.values(this.snapshot.anchors).map(time => Date.parse(time) || 0));
    const createdAt = new Date(Math.max(Date.parse(input.createdAt) || Date.now(), lastTime + 1)).toISOString();
    const item: OutgoingMessage = { ...input, createdAt, photos: input.photos.map(photo => ({ ...photo })),
      voiceMedia: input.voiceMedia ? { ...input.voiceMedia } : undefined, state: "preparing" };
    this.update({ items: [...this.snapshot.items, item], anchors: { ...this.snapshot.anchors, [item.requestKey]: item.createdAt } });
    this.prepare(item);
  }

  private prepare(item: OutgoingMessage) {
    const task = (async () => {
      try {
        // Journal the message before copying files; a restart can finish preparation.
        await this.persist();
        if (this.closed) return;
        const prepared = await this.storage.prepare(item);
        if (this.closed) return;
        if (this.snapshot.items.find(row => row.requestKey === item.requestKey)?.state !== "preparing") return;
        this.patch(item.requestKey, { ...prepared, prepared: true, state: "waiting", error: undefined });
        await this.persist();
      } catch {
        this.patch(item.requestKey, { state: "failed", error: "Не удалось сохранить сообщение на телефоне. Освободите место и повторите отправку." });
        await this.persist().catch(() => {});
      }
    })().finally(() => { this.preparations.delete(task); void this.pump(); });
    this.preparations.add(task);
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active && this.upload) {
      this.pausedUploads.add(this.upload);
      this.upload.abort();
    }
    else void this.pump();
  }

  isCorrecting(entryId: number) {
    return this.snapshot.items.some(item => item.entryId === entryId && item.state !== "failed"
      && (!item.operation || item.operation.status === "queued" || item.operation.status === "running"));
  }

  retry(key: string) {
    const item = this.snapshot.items.find(item => item.requestKey === key);
    if (!item || item.state !== "failed" || this.closed) return;
    if (item.entryId != null && this.isCorrecting(item.entryId)) return;
    this.update({ dismissedFailures: this.snapshot.dismissedFailures?.filter(value => value !== key) });
    this.patch(key, { state: "preparing", error: undefined, limitReached: undefined });
    this.prepare({ ...item, state: "preparing" });
  }

  dismissFailure(key: string) {
    if (this.closed || !this.snapshot.ready || this.snapshot.dismissedFailures?.includes(key)) return;
    this.update({ dismissedFailures: [...(this.snapshot.dismissedFailures ?? []), key] });
    void this.persist().catch(() => {});
  }

  private async pump() {
    if (this.running || this.closed || !this.active || !this.snapshot.ready) return;
    this.running = true;
    try {
      while (this.active && !this.closed) {
        const item = this.snapshot.items.find(row => row.state === "preparing" || row.state === "waiting");
        if (!item || item.state === "preparing") break;
        const controller = new AbortController();
        this.upload = controller;
        this.patch(item.requestKey, { state: "uploading", error: undefined });
        const timeout = setTimeout(() => controller.abort(), 120_000);
        try {
          await this.persist();
          if (this.closed || controller.signal.aborted) throw new Error("paused");
          const operation = await this.send(item, controller.signal);
          if (this.closed) break;
          const current = this.snapshot.items.find(row => row.requestKey === item.requestKey);
          if (current?.state === "uploading") this.patch(item.requestKey, { state: "accepted", operation });
          // If journaling the receipt fails, the previous durable request key is safe to replay.
          await this.persist().catch(() => {});
        } catch (caught) {
          if (this.closed) break;
          // History may confirm acceptance before a lost/late POST response arrives.
          if (this.snapshot.items.find(row => row.requestKey === item.requestKey)?.state !== "uploading") continue;
          const limitReached = (caught as { limitReached?: RequestLimitInfo })?.limitReached;
          this.patch(item.requestKey, this.pausedUploads.has(controller) ? { state: "waiting" } : {
            state: "failed", limitReached,
            error: limitReached?.message ?? (controller.signal.aborted
              ? "Сервер не ответил вовремя. Повторите отправку — запись не продублируется."
              : "Не удалось отправить сообщение. Проверьте соединение и повторите."),
          });
          await this.persist().catch(() => {});
        } finally { clearTimeout(timeout); this.upload = null; }
      }
    } finally { this.running = false; }
  }

  /** Called only with a complete server chat response, including its entries/media. */
  reconcile(operations: Operation[], entryIds: number[]) {
    if (this.closed || !this.snapshot.ready) return;
    const byKey = new Map(operations.map(op => [op.request_key, op]));
    const released: OutgoingMessage[] = [];
    const items = this.snapshot.items.flatMap(item => {
      const op = byKey.get(item.requestKey);
      if (!op) return [item];
      const terminal = op.status === "failed" || (op.status === "done" && (op.entry_id == null || entryIds.includes(op.entry_id)));
      if (terminal) { released.push(item); return []; }
      return [{ ...item, state: "accepted" as const, operation: op }];
    });
    if (!released.length && JSON.stringify(items) === JSON.stringify(this.snapshot.items)) return;
    const activeKeys = new Set(items.map(item => item.requestKey));
    const anchors = Object.fromEntries(Object.entries(this.snapshot.anchors)
      .filter(([key], index, all) => activeKeys.has(key) || index >= all.length - 500));
    this.update({ items, anchors });
    // Persist removal before releasing files. A late response cannot revive a message.
    void this.persist().then(async () => {
      await Promise.allSettled([...this.preparations]);
      for (const item of released) await this.storage.release(item);
    }).catch(() => {});
  }

  /** A status-only response is useful, but cannot yet replace local attachments. */
  observe(operations: Operation[]) {
    if (this.closed || !this.snapshot.ready) return;
    const byKey = new Map(operations.map(op => [op.request_key, op]));
    const items = this.snapshot.items.map(item => {
      const operation = byKey.get(item.requestKey);
      return operation ? { ...item, state: "accepted" as const, operation } : item;
    });
    if (JSON.stringify(items) === JSON.stringify(this.snapshot.items)) return;
    this.update({ items });
    void this.persist().catch(() => {});
  }

  async close() {
    this.closed = true;
    this.active = false;
    this.upload?.abort();
    await this.initializing;
    await Promise.allSettled([...this.preparations]);
    await this.writes.catch(() => {});
    await this.storage.clear();
    this.listeners.clear();
  }
}
