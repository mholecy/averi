import { WdaServer, type WdaServerOptions } from './wda.js';
import { parseWdaSourceValue } from './wda-source.js';
import { alertInWda } from './ios-system-alert.js';
import { startInBackgroundIfBuilt } from './prewarm.js';
import type { ApplicationLabel, IosTreeSource } from './ios-tree-source.js';
import type { SystemAlert, UiNode } from './types.js';

/**
 * The cadence at which two WebDriverAgent `/source` reads may prove an element holds still (ADR 0040): 300 ms, measured
 * (A41b, 2026-11-12, docs/truth/live-records/a41-probe/: WDA's settle replayed at 300 ms, 0 wrong in 60 moving,
 * uncensored settles over 60 trials — M1a, M1b, M2 20 each). Until then none was declared and WDA settled at 500.
 */
export const WDA_SETTLE_CADENCE_MS = 300;

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
 * WdaServer.source() runs ensureRunning itself, or a pre-warm, A41b) and it makes the source
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
  readonly settleCadenceMs = WDA_SETTLE_CADENCE_MS;
  private readonly udid: string;
  private readonly server: WdaServer;
  private disposed = false;
  /**
   * The failed activeAppInfo ask, and the WDA start (WdaServer.upGeneration) it failed on: that child is not asked
   * again — its error is thrown again at once — until a /source read succeeds on it (applicationLabel).
   */
  private failedAsk: { generation: number; error: unknown } | undefined;

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
    this.failedAsk = undefined; // WDA answered a read: the launch's wait may ask it again
    return parseWdaSourceValue(payload);
  }

  /**
   * Brings WebDriverAgent up without reading a tree — WdaServer.ensureRunning, within its own bounds (the package, a
   * first build, /status). What `treeSource: auto` asks before its first read (auto-tree-source.ts, A41a): a failure
   * here is "WDA cannot be brought up", unlike a failed /source on a WDA that is up. Released → the released error, as
   * read().
   */
  async bringUp(): Promise<void> {
    if (this.disposed) throw this.released();
    try {
      await this.server.ensureRunning();
    } catch (err) {
      if (this.disposed) throw this.released(err);
      throw err;
    }
  }

  /**
   * Starts WebDriverAgent in the background and returns at once (A41b; startInBackgroundIfBuilt): what a launch
   * asks after `simctl launch` (IosAdapter.launch), so the first read finds WDA up or joins its start
   * (WdaServer.ensureRunning is single-flight). A start that fails is dropped here: the next read starts again and
   * fails in its own words. WDA already up (WdaServer.upGeneration) → nothing, so a launch sends no `/status` probe.
   */
  prewarm(): void {
    if (this.server.upGeneration() !== undefined) return;
    startInBackgroundIfBuilt(this, () => this.disposed, () => this.server.ensureRunning());
  }

  /** Whether WDA's build is cached, so a start runs no `xcodebuild build-for-testing` (WdaServer.isBuilt). */
  buildCached(): Promise<boolean> {
    return this.server.isBuilt();
  }

  /**
   * Which app WebDriverAgent reads — asked only of a WDA that is up (D48,
   * 2026-11-02; ADR 0032's D48 amendment). Until 2026-11-02 this declined
   * always, by decision (2026-10-09): the idb lag after an app switch had not
   * been measured on WDA's sessionless `/source`. It is now: batch-2 D
   * (main 39c1fcda) read Contacts' whole tree in 2 of 5 `ui_snapshot`s right
   * after `launch_app` of the lab app. The mechanism (WDA 16.1.7's source):
   * with no session, `/source` reads `fb_activeApplication` — the first app
   * AX lists as active — and AX still lists the previous app for a moment
   * after `simctl launch` returns.
   *
   * So the launch asks the same question `/source` answers, by bundle id:
   * `GET /wda/activeAppInfo` (WdaServer.activeAppInfo) resolves the app the
   * same way and walks no tree — not `/source` itself (a full tree read per
   * poll, 0.9–1.25 s in that run, and display names to match), and not
   * idb's Application label (another reader, whose lag is not `/source`'s).
   *
   * - WDA not up (WdaServer.upGeneration: no start of ours reached /status, or it
   *   exited or was stopped since) → `declined`, no device call. The
   *   2026-10-09 objection stands for this case: asking would move WDA's
   *   start (a build on first use, then up to 60 s for /status) into every
   *   first `launch_app`, and the first read's own start (7.7 s measured in
   *   that run) outlasts the switch anyway.
   * - up → `bundle` with the payload's `value.bundleId`, `unlabelled` when it
   *   is not a non-empty string; WDA's error (port, log) when the ask fails —
   *   asked once per WDA child until it proves it answers: after a failed
   *   ask the same child is not asked again — the remembered error is thrown
   *   at once, so every later launch still carries its "could not check"
   *   note (never a silent decline, which is D48's bug) without paying the
   *   ask's budget again on a wedged runner (review 2026-11-02). A /source
   *   read that succeeds clears it, and so does a restart (a new
   *   upGeneration).
   *   The bundle id is matched exactly by the wait (ios-foreground.ts): WDA
   *   reports the app's canonical CFBundleIdentifier, the id `simctl launch`
   *   was given — no case folding, by design.
   * - released → the released error, as read() (checked first: a shut-down
   *   server is not up, and `declined` would hide the release).
   */
  async applicationLabel(): Promise<ApplicationLabel> {
    if (this.disposed) throw this.released();
    const generation = this.server.upGeneration();
    if (generation === undefined) return { kind: 'declined' };
    if (this.failedAsk?.generation === generation) throw this.failedAsk.error;
    let payload: unknown;
    try {
      payload = await this.server.activeAppInfo();
    } catch (err) {
      if (this.disposed) throw this.released(err);
      this.failedAsk = { generation, error: err };
      throw err;
    }
    const bundleId = (payload as { value?: { bundleId?: unknown } } | null | undefined)?.value?.bundleId;
    return typeof bundleId === 'string' && bundleId !== '' ? { kind: 'bundle', bundleId } : { kind: 'unlabelled' };
  }

  /**
   * iOS's system alert in one SHORT `/source` (D54, ADR 0032's D54 amendment): asked by a deep link's foreground wait
   * — and a launch's, D56 — at its bound, when activeAppInfo last named SpringBoard. WdaServer.quickSourceIfUp — its
   * own 2 s budget, no start, no /status probe, no restart, unlike read(): an aid to the reply, never a recovery. WDA
   * not up → undefined, no call; a failed read throws as WDA said it (the wait then gives its note); released → the
   * released error. Leaves `failedAsk` alone: this read proves nothing about the ask.
   */
  async systemAlert(): Promise<SystemAlert | undefined> {
    if (this.disposed) throw this.released();
    let payload: unknown;
    try {
      payload = await this.server.quickSourceIfUp();
    } catch (err) {
      if (this.disposed) throw this.released(err);
      throw err;
    }
    return payload === undefined ? undefined : alertInWda(parseWdaSourceValue(payload));
  }

  /**
   * Types `text` into whatever holds keyboard focus through WebDriverAgent (D43, ADR 0037's D43 amendment):
   * WdaServer.keys — a session per WDA start, one retry on a lost session, none after a request that did not complete.
   * IosAdapter sends only what idb cannot type (ios-typing.ts#typingPathOf). Starts WDA when it is not up, as read()
   * does. Released → the released error, nothing sent; a failure after dispose is the release, as read()'s.
   */
  async typeText(text: string): Promise<void> {
    if (this.disposed) throw this.released();
    try {
      await this.server.keys(text);
    } catch (err) {
      if (this.disposed) throw this.released(err);
      throw err;
    }
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
