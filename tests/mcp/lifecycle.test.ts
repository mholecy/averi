import { describe, expect, it } from 'vitest';
import { installShutdownHandlers, SHUTDOWN_SIGNALS, shutdown, type ShutdownSignal } from '../../src/mcp/lifecycle.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('mcp/lifecycle — shutdown policy', () => {
  it('installs ONE handler per signal for SIGTERM, SIGINT and SIGHUP, through the seam', () => {
    const registered: ShutdownSignal[] = [];
    installShutdownHandlers({ dispose: async () => undefined, on: (s) => { registered.push(s); }, exit: () => undefined });
    expect(registered).toEqual([...SHUTDOWN_SIGNALS]);
  });

  it('exits 0 only AFTER dispose resolved, and closes the transport in between', async () => {
    const order: string[] = [];
    await shutdown(
      {
        dispose: async () => { await sleep(10); order.push('disposed'); },
        close: async () => { order.push('closed'); },
      },
      (code) => order.push(`exit ${code}`),
    );
    expect(order).toEqual(['disposed', 'closed', 'exit 0']);
  });

  it('a rejecting dispose still exits 0 — the adapter is gone either way', async () => {
    let exited: number | undefined;
    await shutdown({ dispose: () => Promise.reject(new Error('boom')) }, (code) => { exited = code; });
    expect(exited).toBe(0);
  });

  it('a HUNG dispose exits on the budget — the host would SIGKILL us 2 s after its SIGTERM', async () => {
    let exited: number | undefined;
    const t0 = Date.now();
    await shutdown({ dispose: () => new Promise<void>(() => undefined), budgetMs: 40 }, (code) => { exited = code; });
    expect(exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('a hung close() cannot hold the exit beyond its own small budget', async () => {
    let exited: number | undefined;
    const t0 = Date.now();
    await shutdown(
      { dispose: async () => undefined, close: () => new Promise<void>(() => undefined) },
      (code) => { exited = code; },
    );
    expect(exited).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('the installed handler runs the same shutdown: dispose, then exit', async () => {
    const handlers = new Map<ShutdownSignal, () => void>();
    let disposed = false;
    let exited: number | undefined;
    installShutdownHandlers({
      dispose: async () => { disposed = true; },
      on: (s, h) => handlers.set(s, h),
      exit: (code) => { exited = code; },
    });
    handlers.get('SIGTERM')!();
    await sleep(20);
    expect(disposed).toBe(true);
    expect(exited).toBe(0);
  });
});
