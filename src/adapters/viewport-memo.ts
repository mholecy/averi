import type { DeviceScreen } from './types.js';

/**
 * The memo behind both adapters' `viewport()` — the contract is
 * types.ts#viewport's, written once here so the two adapters cannot drift.
 *
 * - A successful read is kept and every later call shares it.
 * - Calls while a read is in flight share that read.
 * - A FAILED read is dropped once it settles, so the next call asks the
 *   device again. Until the 2026-10-07 parity code review (A3) the rejection
 *   was memoized too: one transient `idb describe` / `wm size` failure took
 *   the device-screen witness away for the life of the MCP server.
 * - `{ fresh: true }` starts a new read and makes it the memo: the screen can
 *   change under a session (a fold or unfold, `wm size`), and the one caller
 *   that needs to know — the window-width check, before refusing a window as
 *   wider than the screen (verify/capture.ts#witnessedWindow) — asks for it.
 */
export class ViewportMemo {
  #pending: Promise<DeviceScreen> | undefined;

  constructor(private readonly read: () => Promise<DeviceScreen>) {}

  get(opts?: { fresh?: boolean }): Promise<DeviceScreen> {
    if (this.#pending !== undefined && opts?.fresh !== true) return this.#pending;
    const attempt = this.read();
    this.#pending = attempt;
    attempt.catch(() => {
      if (this.#pending === attempt) this.#pending = undefined;
    });
    return attempt;
  }
}
