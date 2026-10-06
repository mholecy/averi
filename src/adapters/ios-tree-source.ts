import { exec as defaultExec, type ExecFn } from './exec.js';
import { runIdb } from './idb.js';
import { attachFieldErrors } from './field-errors.js';
import { IOS_ROLE_MAP, normalizeIosElement, type IosTreeSourceKind } from './ios-node.js';
import { WdaTreeSource } from './wda-tree-source.js';
import type { WdaServerOptions } from './wda.js';
import { zeroRect, type Rect, type UiNode } from './types.js';

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
  const elements = JSON.parse(json) as IdbElement[];
  if (!Array.isArray(elements)) throw new Error('idb describe-all did not return an array');
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
    return parseIdbDescribeAll(stdout.toString('utf8'));
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
