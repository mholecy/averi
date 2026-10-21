import { exec as defaultExec, type ExecFn } from './exec.js';
import { runIdb } from './idb.js';
import { rebootSimulatorAdvice } from './simulator-reboot.js';
import { formatSeconds } from '../util/duration.js';
import { attachFieldErrors } from './field-errors.js';
import { IOS_ROLE_MAP, normalizeIosElement, type IosTreeSourceKind } from './ios-node.js';
import { WdaTreeSource } from './wda-tree-source.js';
import type { WdaServerOptions } from './wda.js';
import { rectArea, rectIntersection, zeroRect, type Rect, type UiNode } from './types.js';
import { countOf } from '../util/count.js';

/**
 * The iOS tree-source seam (2026-10-02). `simctl` cannot read the
 * accessibility tree, so IosAdapter reads it through one of two backends:
 * `idb ui describe-all` (a FLAT list of AX elements) or WebDriverAgent's
 * `/source` (the NESTED XCUIElement tree that still carries the React Native
 * host-view identifiers idb drops — docs/plans/ios-wda-tree-source.md).
 * Before this file the adapter held both: a `treeSource` flag, a dispatch in
 * uiTree(), the lazily started WdaServer and its disposal, and a copy of the
 * per-node normalization that wda-source.ts also had. Two real adapters
 * behind one small interface is what makes this a seam and not a flag.
 *
 * The interface is deliberately small: three methods. `read()` returns a
 * fresh normalized tree per call (the layers above mutate nodes — field-error
 * pairing writes `error` — so no source may hand out a cached graph).
 * `applicationLabel()` answers the one question the normalized tree cannot —
 * which app a read is of — for IosAdapter.launch alone (2026-10-09; its doc
 * below). `dispose()` releases whatever the source started; it is awaited by the
 * process shutdown, so it resolves when the resource is gone, not when the
 * release was queued (the WDA source stops its WebDriverAgent and waits for
 * the port to go quiet). Both sources are bound to ONE concrete simulator at
 * construction: idb rejects simctl's `booted` alias and WDA needs a UDID for
 * `xcodebuild -destination`, so the alias is resolved by whoever constructs
 * the source — the registry, which only ever binds concrete device ids.
 *
 * Only the tree read lives behind this seam. Taps, typing, install and launch
 * stay on idb/simctl whichever source is configured (plan, decision 4): WDA
 * frames are points, the same units idb rects use, so the coordinates agree.
 */
export interface IosTreeSource {
  /**
   * The configured kind this source serves (mcp/registry.ts wires it). No reader above the adapter dispatches on it: a
   * tree says its own source by its marks (UiNode.flatList, idb's), which is what a miss reads (ui-tree/miss.ts).
   */
  readonly kind: IosTreeSourceKind;
  read(): Promise<UiNode>;
  /**
   * Which app a fresh read is OF: the label of the payload's `Application`
   * element — its display name ("Skeleton Internal", "Contacts"), or `' '`
   * for SpringBoard (2026-10-09). Asked by IosAdapter.launch only
   * (ios-foreground.ts), never by a reader of the tree: the normalized tree
   * keeps no element types (idb's Application is a plain `other`), so the
   * question is answered from the raw payload, by the source that has it.
   * The three answers are ApplicationLabel's. Throws as `read()` throws; one
   * device read per call, like `read()` — except a `declined` source, which
   * reads nothing.
   */
  applicationLabel(): Promise<ApplicationLabel>;
  dispose(): Promise<void>;
}

/**
 * IosTreeSource.applicationLabel's answer — a tagged union, not
 * `string | null | undefined` (review 2026-10-09: the two absences meant
 * different things and only a comment told them apart).
 *
 * - `label`: the Application element's label as read — SpringBoard's `' '`
 *   included, never trimmed (the caller names it).
 * - `unlabelled`: the read cannot say — it lists no Application element, or
 *   one whose label is missing or empty (both unmeasured; the launch's wait
 *   reads on, and says it could not check if nothing better follows).
 * - `declined`: the source does not ask (WdaTreeSource, which says why) and
 *   read nothing; the launch's wait then waits for nothing and says nothing.
 */
export type ApplicationLabel = { kind: 'label'; label: string } | { kind: 'unlabelled' } | { kind: 'declined' };

/**
 * The seams the two sources already take, for a caller that has fakes: idb
 * needs only `exec`; wda takes WdaServer's own injectable fetch, spawn, exec
 * and DerivedData. One optional object, never a DI layer — the registry
 * passes none and gets the real backends.
 */
export type IosTreeSourceDeps = Omit<WdaServerOptions, 'udid'>;

/**
 * The adapter for a configured kind, bound to one simulator. Lives with the
 * seam, not in the registry: which backend serves a kind is adapter knowledge
 * (ARCHITECTURE §2, §3), and the registry's one line is to ask for it.
 * A Record over the kind, so a new kind without a constructor is a compile
 * error here — not a runtime default somewhere above (moved out of
 * mcp/registry.ts on review 2026-10-03).
 */
const constructors: Record<IosTreeSourceKind, (udid: string, deps: IosTreeSourceDeps) => IosTreeSource> = {
  idb: (udid, deps) => new IdbTreeSource({ udid, exec: deps.exec }),
  wda: (udid, deps) => new WdaTreeSource({ ...deps, udid }),
};

export function createIosTreeSource(kind: IosTreeSourceKind, udid: string, deps: IosTreeSourceDeps = {}): IosTreeSource {
  return constructors[kind](udid, deps);
}

// --- idb adapter at the seam ---

interface IdbElement {
  type?: string;
  AXLabel?: string | null;
  AXUniqueId?: string | null;
  AXValue?: string | null;
  frame?: Rect;
  /** idb's accessibility traits (`["StaticText", "Header", "Scrollable"]`): read for `Header` alone (UiNode.heading). */
  traits?: string[] | null;
}

/**
 * `idb ui describe-all --json` returns a FLAT array of elements, not a tree —
 * normalize under a synthetic root with all elements as direct children,
 * marked with idb's dialect (`markIdbDialect`). (ui-tree/geometry.ts relies on that root
 * being 0x0: it infers the screen size from the children, never from a
 * wrapper.)
 */
export function parseIdbDescribeAll(json: string): UiNode {
  return idbTree(idbElements(json));
}

/** The raw element list — kept apart from the tree so `IdbTreeSource.read` can name an empty payload's types without a second parse. */
function idbElements(json: string): IdbElement[] {
  const elements = JSON.parse(json) as IdbElement[];
  if (!Array.isArray(elements)) throw new Error('idb describe-all did not return an array');
  return elements;
}

/**
 * The idb source's dialect, marked on its flat list's root: a flat list (UiNode.flatList: ui-tree/draw-order.ts reads
 * the list's order by a rule of its own) listed in READING order, not draw order (UiNode.readingOrder,
 * docs/adr/0015-flat-list-reading-order-break.md). THE marks: the parser sets them on every tree, and an idb
 * `ui_snapshot` capture that lacks them (older captures do) is given them with this
 * (scripts/differential/recorded-source.ts), so it is judged as the live source's tree. Returns `tree`.
 */
export function markIdbDialect<T extends UiNode>(tree: T): T {
  tree.flatList = true;
  tree.readingOrder = true;
  return tree;
}

function idbTree(elements: IdbElement[]): UiNode {
  const children: UiNode[] = elements.map((el) => {
    const node = normalizeIosElement(
      { type: el.type, label: el.AXLabel, identifier: el.AXUniqueId, value: el.AXValue, rect: el.frame },
      IOS_ROLE_MAP,
      [],
    );
    if (el.traits?.includes('Header') === true) node.heading = true;
    return node;
  });
  attachFieldErrors(children);
  return markIdbDialect({
    role: 'container',
    label: null,
    identifier: null,
    value: null,
    rect: zeroRect(),
    children,
    ...(listsPresentedLayer(elements) && { presentation: 'screen' as const }),
  });
}

/** The identifier UIKit gives the dimming view it lays under a sheet or a popover presented over a screen (idb's `AXUniqueId`, WDA's `name`). */
const DISMISS_REGION = 'PopoverDismissRegion';

/**
 * The list IS A PRESENTED LAYER, listed alone (types.ts#UiNode.presentation on the root, `screen`): it holds UIKit's
 * dismiss region — the dimming view under a sheet or a popover, `Group 'dismiss popup' id=PopoverDismissRegion` —
 * and that region covers the whole screen (the `Application` element's frame). idb's describe-all lists only what
 * accessibility exposes, and a presentation hides the screen beneath it: the lab's medium sheet lists the region
 * (twice, `-402,-874 1206x2622`) and its own button, nothing of the host (tests/fixtures/truth/ios-iphone17-ios27/
 * sheet-medium.idb.json; over the scrolled host, sheet-medium-edges.idb.json, the regions alone). So a target beneath
 * is never in this tree: the presentation module reads the root's mark as Android's one presented window
 * (ui-tree/presentation.ts#byMarks: `scroll_until` sends no stroke for a target not in the tree — one at (201,175)
 * on the dim dismissed the sheet and read the target "fully visible after 1 swipe" — and the tap's wait says close it
 * first, `Presentation.alone`). Read here, where the raw element is, as android.ts#presentedWindow reads its dump.
 * Specific: of every idb capture committed (the lab's 31, tests/fixtures/idb-*.json) only those two hold the region.
 * Residuals, stated: a presentation UIKit lays with no dimming view — a large-detent or full-screen sheet
 * (sheet-background.idb.json lists the sheet's button alone, no sign of the sheet), an alert, a transparent cover —
 * is no presented layer here; a dismiss region that does not reach the whole screen (a popover's on an iPad?
 * unmeasured) neither; and the screen beneath the region, were idb ever to list it too (unmeasured), reads as the
 * layer's own — covered by nothing, as the whole listing is the layer.
 * docs/truth/live-ios-2026-10-18-visibility.md (iOS point 4); ADR 0018 residual 6.
 */
function listsPresentedLayer(elements: readonly IdbElement[]): boolean {
  const app = elements.find((el) => el.type === 'Application')?.frame;
  if (app === undefined || rectArea(app) === 0) return false;
  return elements.some((el) => {
    if (el.AXUniqueId !== DISMISS_REGION || el.frame === undefined) return false;
    const on = rectIntersection(el.frame, app);
    return on !== undefined && rectArea(on) === rectArea(app);
  });
}

/**
 * idb answered, but with no tree: an empty list, or elements none of which
 * has a frame with any area — measured 2026-10-06 as a lone
 * `{"type":"Application","AXFrame":"{{0, 0}, {0, 0}}"}` that idb kept
 * returning for 2.5 to 4+ minutes on a RENDERED screen, on two apps, while
 * WDA read the same screen in full (docs/bugs/2026-10-06-ios-idb-empty-tree-
 * persists-on-pin-screen.md). Parsed as a tree, it is a screen on which
 * nothing matches, so every `wait`/`detect`/`requires` read "absent", an
 * `absent` wait passed, and an ensure_state ladder escalated into its
 * `clearState` rung. Thrown as a READ error it is what it is — the device was
 * not read — and the layers above already handle that: a poll retries it and
 * quotes it on timeout, the detect probe says so, and the ladder refuses a
 * destructive rung on a probe that never read a tree (flow/engine.ts).
 *
 * The measured trigger (2026-10-07, docs/bugs/2026-10-07-one-wda-session-
 * makes-idb-stick-until-reboot.md) is an earlier WebDriverAgent session on
 * the simulator: its teardown leaves every LATER app launch with this tree
 * until a reboot. IosAdapter.launch re-enables accessibility automation
 * before each launch (and deep link) — device-checked 2026-10-07, 5/5 — so
 * this error is what an already-running stuck process, or a launch averi did
 * not make, still reads. For that process the write is too late: neither the
 * keys alone nor a `launch_app` on the running app (same pid) cured it; a
 * terminate and a new launch did (docs/bugs/2026-10-07-idb-empty-tree-advice-
 * relaunch-does-not-restart.md). Hence the advice names terminate-then-launch,
 * then a reboot.
 *
 * The reboot names the simulator this source is bound to (2026-10-08, the iOS
 * adapter stack review's candidate 2): the command comes from
 * simulator-reboot.ts with the real UDID, not a `<udid>` placeholder the
 * reader had to fill in. And the advice no longer says "or the stderr said
 * that write failed": averi's reader is an agent reading a tool result, who
 * never sees the server's stderr, and the reboot is the next step whether
 * the pre-launch write failed or not — so the condition added nothing it
 * could act on. (Saying WHICH it was would need the source to know the
 * adapter's last write — the review's larger version, one module per
 * simulator owning the write and this error; not done.)
 *
 * The signature is deliberately narrow — no element with positive area, NOT
 * ui-tree/bare-tree.ts's `isBareTree`. A full-frame `Application` alone is
 * idb's normal launch transient and must stay a tree, and so must the other
 * bare shapes (a splash, a spinner): they are loading and will change.
 * Widening it waits on the device protocol's raw payloads. The synthetic root
 * is always 0×0 (parseIdbDescribeAll), so only the elements are asked.
 *
 * Not only the stuck state wears it (2026-10-08, docs/plans/2026-10-08-
 * round3-phase2-device-check.md, finding 5): on a healthy idb a read 0.4 s
 * after launch_app came back as this same 0×0 Application, and was bare a
 * moment later. The signature stays — the shapes are identical, and it is
 * still an unread device, never a rendered one — and the two are told apart
 * by time: IosAdapter.uiTree's one `settle` re-read (IDB_EMPTY_RETRY_MS) for
 * a one-shot caller, which throws this error again with `reread` set so the
 * message says the read was already retried — as Android's settle error says
 * "retried once after 1 s" or "read once" (android.ts), the adapter being
 * the one thing that knows. The unretried form carries no launch sentence:
 * its readers are pollers (assert, scroll, wait timeouts, the keyboard
 * looks), which have read past the launch's first second over their budget,
 * and a one-shot read without `settle` has no reader to advise.
 * IdbTreeSource.read stays one read.
 */
export class IdbEmptyTreeError extends Error {
  /** The simulator the read was made on — the one the reboot advice names. */
  readonly udid: string;
  /** The raw payload's element types, in order — what the message names as the shape. */
  readonly types: readonly (string | undefined)[];
  /** Set when this is a RE-read's error: how long after the first empty read it was made, in ms. */
  readonly reread?: number;

  constructor(udid: string, types: readonly (string | undefined)[], opts: { reread?: number } = {}) {
    // The cause on the first line, the advice after a newline: a trace entry
    // quotes only the first line (flow/engine.ts `headline`), so a probe
    // that fails every round repeats the cause, not a paragraph of advice.
    // The first line is the same in both forms for that reason.
    super(
      `idb returned an empty accessibility tree (${describeEmptyPayload(types)})\n` +
        (opts.reread === undefined
          ? ''
          : `The read was retried once after ${formatSeconds(opts.reread)} and was still empty; a healthy idb had a tree with area ` +
            'by +1 s on 10 of 10 measured launches, so the rest of this applies (a first render slower than that on ' +
            'a loaded host is unmeasured: if launch_app returned under about two seconds ago, one more read settles it). ') +
        'The app may still be rendered: idb can stay stuck like this for minutes on a rendered screen. ' +
        'Compare with screenshot; if the screen is rendered, the tree source is stuck, not the app. ' +
        'The measured trigger is an earlier WebDriverAgent session on this simulator (e.g. treeSource: wda; ' +
        'likely any XCTest-based driver): every app launched after it starts with an empty idb tree. ' +
        'averi re-enables accessibility automation before each launch, but only a NEW app process picks it up: ' +
        'terminate the app and launch it again through averi (terminate_app, then launch_app) — a launch_app on the ' +
        `running app keeps the same stuck process; if that does not clear it, ${rebootSimulatorAdvice(udid)}; ` +
        'app.ios.treeSource: wda in averi.yaml reads the tree through WebDriverAgent instead',
    );
    this.name = 'IdbEmptyTreeError';
    this.udid = udid;
    this.types = types;
    this.reread = opts.reread;
  }
}

/** "an empty list", "only a 0×0 Application" (the measured shape), or "N elements, none with any area" for anything else. */
const describeEmptyPayload = (types: readonly (string | undefined)[]): string => {
  if (types.length === 0) return 'an empty list';
  if (types.length === 1 && types[0] === 'Application') return 'only a 0×0 Application';
  return `${countOf(types.length, 'element')}, none with any area`;
};

/** The budget uiTree() gave describe-all before the seam existed — a busy screen is slower than a tap. */
const DESCRIBE_ALL_TIMEOUT_MS = 15_000;

/**
 * The default tree source: one `idb ui describe-all --json` per read, nothing
 * to start and nothing to dispose. `exec` defaults to the real one — the same
 * function IosAdapter defaults to, so in production the two share the
 * memoized Xcode probe without anyone passing anything. A test passes its
 * fake to both for the same effect, and to see the command line.
 */
export class IdbTreeSource implements IosTreeSource {
  readonly kind = 'idb' as const;
  private readonly udid: string;
  private readonly exec: ExecFn;

  constructor(opts: { udid: string; exec?: ExecFn }) {
    this.udid = opts.udid;
    this.exec = opts.exec ?? defaultExec;
  }

  async read(): Promise<UiNode> {
    return (await this.readOnce()).tree;
  }

  /**
   * The first `Application` element's AXLabel. idb's flat list starts with
   * it (measured 2026-10-09 on iOS 27.0: "Skeleton Internal", "Contacts",
   * SpringBoard's `' '`), but the element is found by type, not by place.
   * The same read as `read()` — an empty payload throws IdbEmptyTreeError
   * here too, so the caller can tell idb's launch transient (no tree yet)
   * from a tree of the wrong app. An empty AXLabel is `unlabelled`, as a
   * missing one is: no app is named by nothing.
   */
  async applicationLabel(): Promise<ApplicationLabel> {
    const label = (await this.readOnce()).elements.find((el) => el.type === 'Application')?.AXLabel;
    return label === undefined || label === null || label === '' ? { kind: 'unlabelled' } : { kind: 'label', label };
  }

  private async readOnce(): Promise<{ elements: IdbElement[]; tree: UiNode }> {
    const { stdout } = await runIdb(this.exec, this.udid, ['ui', 'describe-all', '--json'], { timeoutMs: DESCRIBE_ALL_TIMEOUT_MS });
    const elements = idbElements(stdout.toString('utf8'));
    const tree = idbTree(elements);
    // Area on the NORMALIZED rects (rounded, a missing frame zeroed); the raw types only name the shape.
    if (!tree.children.some((el) => rectArea(el.rect) > 0)) throw new IdbEmptyTreeError(this.udid, elements.map((el) => el.type));
    return { elements, tree };
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
