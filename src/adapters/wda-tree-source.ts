import { WdaServer, type WdaServerOptions } from './wda.js';
import { parseWdaSourceValue } from './wda-source.js';
import type { IosTreeSource } from './ios-tree-source.js';
import type { UiNode } from './types.js';

/**
 * The WebDriverAgent adapter at the iOS tree-source seam (ios-tree-source.ts):
 * owns ONE WdaServer for its simulator and turns `/source` into the
 * normalized tree. This is the only module that joins wda.ts (the server's
 * lifecycle) to wda-source.ts (the payload's parsing); the two stay coupled
 * through nothing but `source(): Promise<unknown>`, on purpose — each is
 * testable without the other.
 *
 * The server is constructed with the source. That is cheap (a per-UDID port
 * allocation and a log path — no process until the first read, since
 * WdaServer.source() runs ensureRunning itself) and it makes the source
 * terminal after dispose(). That state IS reachable from a tool call: run_flow
 * and ensure_state hold one adapter across many reads, and a select_device
 * that lands mid-flow evicts and disposes that adapter (registry.evict). Before
 * 2026-10-02 the next read then built a fresh WdaServer for the DESELECTED
 * simulator — an orphan of the 0.8.1 bug class, since nothing would dispose
 * it (IosAdapter had cleared its server promise on dispose). Now the read is
 * refused, with wording for the two ways it happens — the device was
 * deselected, or averi is shutting down — rather than WdaServer's own "the
 * process is exiting", which is only true for the second.
 *
 * Ownership runs lifecycle → registry → IosAdapter → here → WdaServer, and
 * disposal runs down the same chain, never across it: dispose() IS
 * WdaServer.shutdown(), which stops the child and waits for the port to go
 * quiet — the part of a process shutdown that takes time, and the reason the
 * chain returns promises all the way up
 * (docs/bugs/2026-09-18-wda-orphan-after-server-restart.md).
 *
 * Takes WdaServerOptions whole, so the fakes that drive WdaServer's own tests
 * (fetch, spawn, exec, DerivedData) drive this adapter unchanged. There is
 * deliberately no second seam for a fake server: the one adapter it would
 * ever have is WdaServer, and one adapter means a hypothetical seam.
 */
export class WdaTreeSource implements IosTreeSource {
  readonly kind = 'wda' as const;
  private readonly udid: string;
  private readonly server: WdaServer;
  private disposed = false;

  constructor(opts: WdaServerOptions) {
    this.udid = opts.udid;
    this.server = new WdaServer(opts);
  }

  async read(): Promise<UiNode> {
    if (this.disposed) throw this.released();
    let payload: unknown;
    try {
      payload = await this.server.source();
    } catch (err) {
      // The common case during run_flow: the read is INSIDE /source (hundreds
      // of ms) or still bringing the server up when a select_device disposes
      // this source. WdaServer then fails the read in its own words — "the
      // process is exiting", "stopped during startup" — neither of which
      // names the deselection or how to recover. The flag decides: a failure
      // after dispose is the release, whatever the server called it; before
      // it, the server's wording stands (review 2026-10-02, round 3).
      if (this.disposed) throw this.released(err);
      throw err;
    }
    return parseWdaSourceValue(payload);
  }

  private released(cause?: unknown): Error {
    return new Error(
      `The WebDriverAgent tree source for simulator ${this.udid} has been released — ` +
        'this simulator was deselected or averi is shutting down; select the device again and rerun',
      cause === undefined ? undefined : { cause },
    );
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.server.shutdown();
  }
}
