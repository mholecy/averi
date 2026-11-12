import { errorMessage } from '../util/error-message.js';
import type { IosTreeSourceKind } from './ios-node.js';
import type { ApplicationLabel, IosTreeSource } from './ios-tree-source.js';
import type { SystemAlert, UiNode } from './types.js';

/**
 * The line every claiming reply carries once `auto` fell back to idb (IosTreeSource.claimNote; the tools print it as
 * `⚠ <line>`). Says the one fact that changes the claim — idb lists no presented layer and no scroll clip, so neither
 * was judged — and where the reason WebDriverAgent did not come up was said.
 */
export const IDB_FALLBACK_NOTE =
  'read through idb: WebDriverAgent did not come up (treeSource auto; the reason is on averi\'s stderr) and idb lists ' +
  'no presented layer or scroll clip — a layer over the target or a clip cutting it was not judged';

/** WebDriverAgent's source as `auto` uses it: a tree source that can be asked to come up without reading a tree. */
export type WdaSide = IosTreeSource & { bringUp(): Promise<void> };

/**
 * `treeSource: auto` (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md): WebDriverAgent
 * when it can be brought up, idb when it cannot — ONE source per adapter, chosen once, never two trees reconciled
 * (ADR 0032). The choice is made lazily, at the first tree read, by asking WDA to come up within its own bounds
 * (WdaTreeSource.bringUp: the package, a first build, /status) — no probe at construction or launch. It is kept for
 * the adapter's life:
 * - WDA came up → every call is WDA's, exactly as under `treeSource: wda` — a later WDA failure is WDA's error, never a
 *   switch to idb.
 * - It did not → the reason is said once on stderr, WDA is shut down, every read is idb's, and `claimNote` is set: the
 *   tools add it to each reply that claims what it read (IDB_FALLBACK_NOTE). Nothing is refused for it.
 *
 * Before the choice, what is asked without a tree read is idb's: a launch's application label (WDA's would be
 * `declined` — it is not up), `kind` (the label's wording) and no settle cadence (the default 500). Typing waits for
 * the choice (typeText).
 */
export class AutoTreeSource implements IosTreeSource {
  private readonly wda: WdaSide;
  private readonly idb: IosTreeSource;
  /** The source the first read chose — undefined until it has. */
  private chosen: IosTreeSource | undefined;
  /** The choice in flight, shared by every read that starts before it is made. */
  private choosing: Promise<IosTreeSource> | undefined;
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

  get claimNote(): string | undefined {
    return this.chosen === this.idb ? IDB_FALLBACK_NOTE : undefined;
  }

  /**
   * WDA's typer while WDA is or may be chosen; none once idb was — what IosAdapter's `typeable` and its typing route
   * read per call, so a fallback refuses what idb cannot type before anything is sent (ADR 0037). Before the choice it
   * makes it: a text sent here is one idb cannot type, and if WDA does not come up nothing is typed.
   */
  get typeText(): ((text: string) => Promise<void>) | undefined {
    return this.chosen === this.idb ? undefined : this.typeThroughWda;
  }

  private readonly typeThroughWda = async (text: string): Promise<void> => {
    if ((await this.source()) !== this.wda || this.wda.typeText === undefined) {
      throw new Error(
        "nothing typed: WebDriverAgent did not come up (treeSource auto; the reason is on averi's stderr), and idb types " +
          'only printable ASCII — use a value without the other characters, or enter it by hand',
      );
    }
    return this.wda.typeText(text);
  };

  async read(): Promise<UiNode> {
    return (await this.source()).read();
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
      console.error(`averi: treeSource auto — WebDriverAgent did not come up, so this simulator's tree is read through idb: ${errorMessage(err)}`);
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
