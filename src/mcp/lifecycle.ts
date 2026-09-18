/**
 * Process shutdown for the MCP server: release device-bound resources, then
 * exit — within a budget.
 *
 * Why this exists: the MCP SDK's stdio client closes a server in three steps —
 * stdin EOF, 2 s later SIGTERM, 2 s later SIGKILL (measured 2026-09-18 in
 * @modelcontextprotocol/sdk client/stdio.js). An idle server exits on the EOF
 * (~15 ms) and Node's 'exit' hooks run. A BUSY server — a tool call in flight —
 * survives the EOF, takes the SIGTERM, and Node runs no 'exit' hook for a
 * signal: whatever the adapters owned (a WebDriverAgent) outlives them. So the
 * signal must be handled, and the handling must finish inside the SIGKILL
 * window, or the orphan comes back on the slow path
 * (docs/bugs/2026-09-18-wda-orphan-after-server-restart.md).
 *
 * Kept separate from server.ts so the policy is testable: server.ts is the
 * `bin` and connects stdio on import.
 */

export type ShutdownSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';
export const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP'];

/** Inside the SDK's 2 s SIGTERM→SIGKILL window, with room for exit itself. */
export const SHUTDOWN_BUDGET_MS = 1_500;
/** A transport close is a flush of pending stdout; it never earns more than this. */
const CLOSE_BUDGET_MS = 200;

export interface ShutdownHooks {
  /** Release device-bound resources (the registry). Awaited up to `budgetMs`; a rejection counts as done. */
  dispose: () => Promise<void>;
  /** Close the MCP transport so a half-written response frame is flushed. Best effort. */
  close?: () => Promise<void>;
  budgetMs?: number;
  /** Seams for tests — production uses process.once / process.exit. */
  on?: (signal: ShutdownSignal, handler: () => void) => void;
  exit?: (code: number) => void;
}

/**
 * Register the handlers. `once`, deliberately: a SECOND signal while the
 * first is still disposing meets Node's default handler and kills the process
 * outright (status 128+n) — the "second Ctrl-C forces quit" convention, and the
 * escape hatch if the budget itself is ever wrong. Exit code 0, deliberately:
 * 128+n is what a shell reports for a process KILLED by a signal; this one
 * handled it and shut down cleanly. `process.exit` then runs the 'exit' hooks
 * — WdaServer's killChild among them — as a backstop for anything dispose did
 * not reach.
 */
export function installShutdownHandlers(hooks: ShutdownHooks): void {
  const on = hooks.on ?? ((signal, handler) => process.once(signal, handler));
  const exit = hooks.exit ?? ((code) => process.exit(code));
  for (const signal of SHUTDOWN_SIGNALS) {
    on(signal, () => {
      void shutdown(hooks, exit);
    });
  }
}

/** One shutdown: dispose within budget, flush the transport, exit 0. Exported for tests. */
export async function shutdown(hooks: ShutdownHooks, exit: (code: number) => void): Promise<void> {
  await withinBudget(hooks.dispose().catch(() => undefined), hooks.budgetMs ?? SHUTDOWN_BUDGET_MS);
  if (hooks.close) await withinBudget(hooks.close().catch(() => undefined), CLOSE_BUDGET_MS);
  exit(0);
}

function withinBudget(work: Promise<void>, budgetMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
    timer.unref();
  });
  return Promise.race([work, budget]).finally(() => clearTimeout(timer));
}
