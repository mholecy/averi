import { errorMessage } from '../util/error-message.js';
import { withNoteLine } from '../util/note-line.js';
import type { IosTreeSourceKind } from './ios-node.js';
import { idbTypingRefusal } from './ios-typing.js';
import type { ApplicationLabel, IosTreeSource } from './ios-tree-source.js';
import type { SystemAlert, UiNode } from './types.js';

/**
 * The line every claiming reply carries once `auto` fell back to idb (IosTreeSource.claimNote; the tools print it as
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
 * whether its build is cached (what decides a pre-warm, A41b).
 */
export type WdaSide = IosTreeSource & { bringUp(): Promise<void>; buildCached(): Promise<boolean> };

/**
 * `treeSource: auto` (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md): WebDriverAgent
 * when it can be brought up, idb when it cannot — ONE source per adapter, chosen once, never two trees reconciled
 * (ADR 0032). The choice is made by asking WDA to come up within its own bounds (WdaTreeSource.bringUp: the package,
 * a first build, /status) — at the first tree read, or before it by a pre-warm (below); constructing the source asks
 * nothing. It is kept for the adapter's life:
 * - WDA came up → every call is WDA's, exactly as under `treeSource: wda` — a later WDA failure is WDA's error, never a
 *   switch to idb.
 * - It did not → the reason is said once on stderr, WDA is shut down, every read is idb's, and `claimNote` is set: the
 *   tools add it to each reply that claims what it read (idbFallbackNote). Nothing is refused for it.
 *
 * Before the choice, what is asked without a tree read is idb's: a launch's application label (WDA's would be
 * `declined` — it is not up), `kind` (the label's wording) and no settle cadence (the default 500). Typing waits for
 * the choice (typeText).
 *
 * The choice may start before the first read (prewarm, A41b): the registry asks it when it builds the adapter, and a
 * launch asks again after `simctl launch`, so WDA's start runs beside the agent's work, when its build is cached. It is the same choice — one
 * attempt, which the first read joins, and whose outcome is the one that read would have met.
 */
export class AutoTreeSource implements IosTreeSource {
  private readonly wda: WdaSide;
  private readonly idb: IosTreeSource;
  /** The source the first read chose — undefined until it has. */
  private chosen: IosTreeSource | undefined;
  /** The choice in flight, shared by every read that starts before it is made. */
  private choosing: Promise<IosTreeSource> | undefined;
  /** Why WDA did not come up (fallbackReason), set with a fallback to idb. */
  private reason: string | undefined;
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

  /** The first read chose idb: WebDriverAgent did not come up. */
  get fellBack(): boolean {
    return this.chosen === this.idb;
  }

  get claimNote(): string | undefined {
    return this.fellBack ? idbFallbackNote(this.reason ?? NO_REASON) : undefined;
  }

  /**
   * WDA's typer while WDA is or may be chosen; none once idb was — what IosAdapter's `typeable` and its typing route
   * read per call, so a fallback refuses what idb cannot type before anything is sent (ADR 0037). Before the choice it
   * makes it: a text sent here is one idb cannot type, and if WDA does not come up it is refused as idb refuses it,
   * with the claim note's line (the reason, the retry) — nothing typed.
   */
  get typeText(): ((text: string) => Promise<void>) | undefined {
    return this.chosen === this.idb ? undefined : this.typeThroughWda;
  }

  private readonly typeThroughWda = async (text: string): Promise<void> => {
    if ((await this.source()) !== this.wda || this.wda.typeText === undefined) {
      throw new Error(withNoteLine(idbTypingRefusal(text), this.claimNote));
    }
    return this.wda.typeText(text);
  };

  async read(): Promise<UiNode> {
    return (await this.source()).read();
  }

  /**
   * Starts the choice in the background and returns at once (A41b) — only while none is made or in flight, and only
   * when WDA's build is cached: an uncached first build is up to 10 minutes of xcodebuild beside the agent's own work,
   * which the first read then runs, as before (ADR 0046's A41b amendment). Never rejects: a WDA that does not come up
   * is the fallback the first read meets (choose); a release mid-choice is that read's error.
   */
  prewarm(): void {
    // `choosing` is set once a choice started, and stays: made, in flight, or never asked.
    if (this.choosing !== undefined || this.disposed) return;
    void this.chooseIfBuilt().catch(() => undefined);
  }

  private async chooseIfBuilt(): Promise<void> {
    if ((await this.wda.buildCached()) && !this.disposed) await this.source();
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
      this.reason = fallbackReason(err);
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
