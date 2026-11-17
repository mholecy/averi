import { errorMessage } from '../util/error-message.js';
import { withNoteLine } from '../util/note-line.js';
import type { IosTreeSourceKind } from './ios-node.js';
import type { Typeable } from './typeable.js';
import { mayStartBeforeLaunch } from './wda-tree-source.js';
import type { ApplicationLabel, IosTreeSource } from './ios-tree-source.js';
import type { SystemAlert, UiNode } from './types.js';

/**
 * The line every claiming reply carries once `auto` fell back to idb (IosTreeSource.fallback; the tools print it as
 * `⚠ <line>`). Says the one fact that changes the claim — idb lists no presented layer and no scroll clip, so neither
 * was judged — why WebDriverAgent did not come up, in a few words (`reason`, fallbackReason), and the way to try again
 * (a select_device of the simulator drops a fallen-back adapter: mcp/registry.ts#select). The whole error is on stderr.
 */
export const idbFallbackNote = (reason: string): string =>
  `read through idb: WebDriverAgent did not come up (${reason}; select_device again to retry) and idb lists no ` +
  'presented layer or scroll clip — a layer over the target or a clip cutting it was not judged';

/** The reason when WDA's error says none. */
const NO_REASON = 'no reason given';

/** The most a fallback's reason may run to in the note — WDA's errors run to hundreds of characters, with log paths. */
const REASON_MAX = 80;

/**
 * WDA's error in a few words for the note: its first clause — up to the first ` — `, `. `, `, `, ` (` or `: ` — cut at
 * REASON_MAX with an ellipsis. `WebDriverAgent requires the appium-webdriveragent package`, `A WebDriverAgent answers
 * /status on port 8100`, `WDA did not answer /status on port 8100 within 60 s`, `WDA build failed`.
 */
export function fallbackReason(err: unknown): string {
  const clause = errorMessage(err).split(/ — |\. |, | \(|: |\n/)[0].trim();
  if (clause === '') return NO_REASON;
  return clause.length <= REASON_MAX ? clause : `${clause.slice(0, REASON_MAX - 1)}…`;
}

/**
 * WebDriverAgent's source as `auto` uses it: a tree source that can be asked to come up without reading a tree, and
 * whether its build is cached (what decides a start before a launch).
 */
export type WdaSide = IosTreeSource & { bringUp(): Promise<void>; buildCached(): Promise<boolean> };

/**
 * `treeSource: auto` (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md): WebDriverAgent
 * when it can be brought up, idb when it cannot — ONE source per adapter, chosen once, never two trees reconciled
 * (ADR 0032). The choice is made by asking WDA to come up within its own bounds (WdaTreeSource.bringUp: the package,
 * a first build, /status) — at the first tree read, or before it by a launch (below); constructing the source asks
 * nothing. It is kept for the adapter's life:
 * - WDA came up → every call is WDA's, exactly as under `treeSource: wda` — a later WDA failure is WDA's error, never a
 *   switch to idb.
 * - It did not → the reason is said once on stderr, WDA is shut down, every read is idb's, and `fallback` is set: the
 *   tools add it to each reply that claims what it read (idbFallbackNote). No read is refused for it; a text idb
 *   cannot type is refused as under `treeSource: idb`, with the note's line (typeable, typeWide).
 *
 * Before the choice, what is asked without a tree read is idb's: a launch's application label (WDA's would be
 * `declined` — it is not up), `kind` (the label's wording) and no settle cadence (the default 500). Typing waits for
 * the choice (typeWide).
 *
 * The choice may be made before the first read (startBeforeLaunch): a launch awaits it before it touches the app,
 * when WDA's build is cached. It is the same choice — one attempt, which a read joins, and whose outcome is the one that
 * read would have met.
 */
export class AutoTreeSource implements IosTreeSource {
  private readonly wda: WdaSide;
  private readonly idb: IosTreeSource;
  /** The source the first read chose — undefined until it has. */
  private chosen: IosTreeSource | undefined;
  /** The choice in flight, shared by every read that starts before it is made. */
  private choosing: Promise<IosTreeSource> | undefined;
  /** The fallback to idb, its note naming why WDA did not come up (fallbackReason) — set with the choice of idb. */
  private fellBackTo: { readonly note: string } | undefined;
  /** WDA's shutdown after a fallback, awaited by dispose(). */
  private wdaReleased: Promise<void> | undefined;
  private disposed = false;

  constructor(opts: { wda: WdaSide; idb: IosTreeSource }) {
    this.wda = opts.wda;
    this.idb = opts.idb;
  }

  get kind(): IosTreeSourceKind {
    return this.chosen === this.wda ? 'wda' : 'idb';
  }

  get settleCadenceMs(): number | undefined {
    return this.chosen?.settleCadenceMs;
  }

  /** Set once the choice was idb: WebDriverAgent did not come up (IosTreeSource.fallback). */
  get fallback(): { readonly note: string } | undefined {
    return this.fellBackTo;
  }

  /**
   * WDA's set while WDA is or may be chosen; idb's once idb was, its every refusal ending with the claim note's line
   * (Typeable.note: the reason, the retry), so a fallback refuses what idb cannot type before anything is sent (ADR
   * 0037) and says why that set applies.
   */
  get typeable(): Typeable {
    return this.fellBackTo === undefined ? this.wda.typeable : { ...this.idb.typeable, note: this.fellBackTo.note };
  }

  /**
   * Makes the choice (a text sent here is one idb cannot type) and hands the text to the chosen source: WDA types it;
   * after a fallback idb refuses it, and the refusal gets the claim note's line here, once — nothing typed.
   */
  async typeWide(text: string): Promise<void> {
    const chosen = await this.source();
    if (chosen === this.wda) return this.wda.typeWide(text);
    try {
      await chosen.typeWide(text);
    } catch (err) {
      throw new Error(withNoteLine(errorMessage(err), this.fellBackTo?.note), { cause: err });
    }
  }

  async read(): Promise<UiNode> {
    return (await this.source()).read();
  }

  /**
   * Makes the choice before a launch and resolves once it is made (IosTreeSource.startBeforeLaunch, ADR 0046's A41d
   * amendment): the same single attempt the first read would make, so the read after the launch finds it made.
   * - A choice in flight (a read making it) is joined.
   * - WDA chosen → WDA's own startBeforeLaunch: nothing while it is up; one that died since is started again before
   *   the launch, and its failure is WDA's error (a later WDA failure never switches to idb).
   * - idb chosen (the fallback) → nothing: select_device is the retry.
   * - No choice started and not mayStartBeforeLaunch (no cached build, or released) → nothing: the first read builds
   *   and chooses.
   * A WDA that does not come up is the fallback (choose): the start resolves, with the stderr line and the claim note
   * the first read would have met. Released: nothing; released mid-choice: the read's released error.
   */
  async startBeforeLaunch(bundleId: string): Promise<void> {
    if (this.disposed) return;
    if (this.chosen !== undefined) return this.chosen === this.wda ? this.wda.startBeforeLaunch?.(bundleId) : undefined;
    if (this.choosing === undefined && !(await mayStartBeforeLaunch(this.wda, () => this.disposed))) return;
    await this.source();
  }

  applicationLabel(): Promise<ApplicationLabel> {
    return (this.chosen ?? this.idb).applicationLabel();
  }

  async systemAlert(): Promise<SystemAlert | undefined> {
    return this.chosen === this.wda ? this.wda.systemAlert?.() : undefined;
  }

  private source(): Promise<IosTreeSource> {
    if (this.chosen !== undefined) return Promise.resolve(this.chosen);
    this.choosing ??= this.choose();
    return this.choosing;
  }

  private async choose(): Promise<IosTreeSource> {
    try {
      await this.wda.bringUp();
      this.chosen = this.wda;
    } catch (err) {
      // Released mid-choice: the release is the answer, not a fallback (WdaTreeSource words it).
      if (this.disposed) throw err;
      console.error(
        "averi: treeSource auto — WebDriverAgent did not come up, so this simulator's tree is read through idb: " +
          errorMessage(err),
      );
      this.fellBackTo = { note: idbFallbackNote(fallbackReason(err)) };
      this.wdaReleased = this.wda.dispose().catch(() => undefined);
      this.chosen = this.idb;
    }
    return this.chosen;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([this.wdaReleased ?? this.wda.dispose(), this.idb.dispose()]);
  }
}
