/**
 * Anonymous usage pings (ARCHITECTURE.md §6): tool-call COUNTS only — never
 * screenshots, UI trees, or secrets. Fire-and-forget; failures are silent
 * (billing telemetry must never break the tool). Disabled in dev mode.
 */
export class UsageTracker {
  private counts = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly serviceUrl: string,
    private readonly plan: string,
    private readonly enabled: boolean,
  ) {}

  bump(tool: string): void {
    if (!this.enabled) return;
    this.counts.set(tool, (this.counts.get(tool) ?? 0) + 1);
  }

  start(intervalMs = 15 * 60 * 1000): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref(); // never keep the process alive for telemetry
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.counts.size === 0) return;
    const counts = Object.fromEntries(this.counts);
    this.counts.clear();
    try {
      await fetch(`${this.serviceUrl}/v1/usage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ counts, plan: this.plan }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // restore counts so the next flush retries them
      for (const [tool, n] of Object.entries(counts)) {
        this.counts.set(tool, (this.counts.get(tool) ?? 0) + n);
      }
    }
  }
}
