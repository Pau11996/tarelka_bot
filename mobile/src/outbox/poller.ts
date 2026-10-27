/** Single, coalescing poll loop. Waking during a request schedules one fresh read. */
export class ChatPoller {
  private enabled = false;
  private running = false;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private refresh: () => Promise<void>, private delay: () => number) {}
  setActive(active: boolean) {
    this.enabled = active;
    clearTimeout(this.timer);
    if (active) this.wake();
  }
  wake() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.dirty = true;
    if (!this.running) void this.run();
  }
  private async run() {
    if (!this.enabled) return;
    this.running = true;
    this.dirty = false;
    try { await this.refresh(); } catch { /* The screen displays refresh errors. */ }
    finally {
      this.running = false;
      if (this.enabled) {
        if (this.dirty) void this.run();
        else this.timer = setTimeout(() => void this.run(), this.delay());
      }
    }
  }
}
