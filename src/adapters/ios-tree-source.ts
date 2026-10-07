import { exec as defaultExec, type ExecFn } from './exec.js';
import { runIdb } from './idb.js';
import { attachFieldErrors } from './field-errors.js';
import { IOS_ROLE_MAP, normalizeIosElement, type IosTreeSourceKind } from './ios-node.js';
import { WdaTreeSource } from './wda-tree-source.js';
import type { WdaServerOptions } from './wda.js';
import { rectArea, zeroRect, type Rect, type UiNode } from './types.js';

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
 * The interface is deliberately two methods. `read()` returns a fresh
 * normalized tree per call (the layers above mutate nodes — field-error
 * pairing writes `error` — so no source may hand out a cached graph).
 * `dispose()` releases whatever the source started; it is awaited by the
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
  /** The configured kind this source serves — what the adapter reports as its `treeSourceKind`. */
  readonly kind: IosTreeSourceKind;
  read(): Promise<UiNode>;
  dispose(): Promise<void>;
}

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
}

/**
 * `idb ui describe-all --json` returns a FLAT array of elements, not a tree —
 * normalize under a synthetic root with all elements as direct children.
 * (ui-tree/geometry.ts relies on that root being 0x0: it infers the screen
 * size from the children, never from a wrapper.)
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

function idbTree(elements: IdbElement[]): UiNode {
  const children: UiNode[] = elements.map((el) =>
    normalizeIosElement(
      { type: el.type, label: el.AXLabel, identifier: el.AXUniqueId, value: el.AXValue, rect: el.frame },
      IOS_ROLE_MAP,
      [],
    ),
  );
  attachFieldErrors(children);
  return {
    role: 'container',
    label: null,
    identifier: null,
    value: null,
    rect: zeroRect(),
    children,
  };
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
 * before each launch (and deep link), so the advice names a relaunch through
 * averi — hedged until that is device-checked — then a reboot; this error is
 * what an already-running stuck process, or a launch averi did not make,
 * still reads.
 *
 * The signature is deliberately narrow — no element with positive area, NOT
 * ui-tree/bare-tree.ts's `isBareTree`. A full-frame `Application` alone is
 * idb's normal launch transient and must stay a tree, and so must the other
 * bare shapes (a splash, a spinner): they are loading and will change.
 * Widening it waits on the device protocol's raw payloads. The synthetic root
 * is always 0×0 (parseIdbDescribeAll), so only the elements are asked.
 */
export class IdbEmptyTreeError extends Error {
  /** `types`: the raw payload's element types, in order — what the message names as the shape. */
  constructor(types: readonly (string | undefined)[]) {
    // The cause on the first line, the advice after a newline: a trace entry
    // quotes only the first line (flow/engine.ts `headline`), so a probe
    // that fails every round repeats the cause, not a paragraph of advice.
    super(
      `idb returned an empty accessibility tree (${describeEmptyPayload(types)})\n` +
        'The app may still be rendered: idb can stay stuck like this for minutes on a rendered screen. ' +
        'Compare with screenshot; if the screen is rendered, the tree source is stuck, not the app. ' +
        'The measured trigger is an earlier WebDriverAgent session on this simulator (e.g. treeSource: wda; ' +
        'likely any XCTest-based driver): every app launched after it starts with an empty idb tree. ' +
        'averi re-enables accessibility automation before each launch_app, so relaunching the app through averi ' +
        "(launch_app, or a flow's launch) should clear it; if it does not, or the stderr said that write failed, " +
        'reboot the simulator (`xcrun simctl shutdown <udid> && xcrun simctl boot <udid>`); ' +
        'app.ios.treeSource: wda in averi.yaml reads the tree through WebDriverAgent instead',
    );
    this.name = 'IdbEmptyTreeError';
  }
}

/** "an empty list", "only a 0×0 Application" (the measured shape), or "N elements, none with any area" for anything else. */
const describeEmptyPayload = (types: readonly (string | undefined)[]): string => {
  if (types.length === 0) return 'an empty list';
  if (types.length === 1 && types[0] === 'Application') return 'only a 0×0 Application';
  return `${types.length} element${types.length === 1 ? '' : 's'}, none with any area`;
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
    const { stdout } = await runIdb(this.exec, this.udid, ['ui', 'describe-all', '--json'], { timeoutMs: DESCRIBE_ALL_TIMEOUT_MS });
    const elements = idbElements(stdout.toString('utf8'));
    const tree = idbTree(elements);
    // Area on the NORMALIZED rects (rounded, a missing frame zeroed); the raw types only name the shape.
    if (!tree.children.some((el) => rectArea(el.rect) > 0)) throw new IdbEmptyTreeError(elements.map((el) => el.type));
    return tree;
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
