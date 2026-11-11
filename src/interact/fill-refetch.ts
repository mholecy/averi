/**
 * The field found again on a fresh read — every read a fill makes of its field after the focus tap (A28: until then
 * a closure in fill.ts, its twin fallback a function beside it, and why the field was lost a mutable variable the
 * read-back read off it while the clear got `{ lost }` explicitly). One answer a read (fill-facts.ts#FieldRead): the
 * node, or why it was not found (`LostWhy`).
 *
 * Interface: `fieldRefetch(…) → FieldRefetch` — `read()`, `typingStarts()`, `lastTree()`. The rules it owns:
 * - by the selector first (resolveNow on the fresh tree: the one-shot mode of the policy that chose the field);
 * - else by identity (`sameField`), guarded by the screen: before typing freely (a clear's deletes do not navigate);
 *   after it only while the screen is the one the last pre-typing read saw (`sameScreen`) — and never when nothing was
 *   read before typing;
 * - lost: `screen-changed` when the screen is provably another (the pre-typing read's, or — without one, the post-focus
 *   read skipped — the screen the field was resolved on, for the wording only), else `unmatched`.
 * The guard's states are `findAgain`'s, pure. A tree that cannot be read throws the caller's error: the app has a
 * window by then (the focus tap landed), so an unreadable tree is a dead device, not a screen settling. Only the read
 * is wrapped: a refusal from resolveNow (a second match appearing mid-fill) keeps its own wording.
 */

import { everyNode, sameRect, type DeviceAdapter, type UiNode } from '../adapters/types.js';
import { readTreeOrThrow, sameScreen, screenIdentity, type ScreenIdentity } from '../ui-tree/read-tree.js';
import type { FieldRead } from './fill-facts.js';
import { resolveNow, type ResolveOptions, type Target } from './resolve.js';

/**
 * Where the identity fallback stands:
 * - `before-typing`: asked freely;
 * - `typing`: typing started on `screen` (the newest read before it) — asked only while the screen is that one;
 * - `typing-unread`: typing started with no read before it — never asked; `resolvedOn`, when the post-focus read was
 *   skipped, the screen the field was resolved on, which words a `lost` alone.
 */
export type TwinGuard =
  | { phase: 'before-typing' }
  | { phase: 'typing'; screen: ScreenIdentity }
  | { phase: 'typing-unread'; resolvedOn: ScreenIdentity | undefined };

/**
 * The node chosen at focus, found again in a fresh tree by identity — same
 * role, identifier and rect, exactly one such node. The read-back's
 * fallback when the selector no longer matches: a `value:"…"` selector
 * stops matching the moment the clear or the typing changes the value, and
 * until 2026-10-08 that read as "nothing there" (a clear counted as done,
 * a read-back as unverifiable). A field that MOVED (the keyboard pushed the
 * form up) is not found this way and stays unverifiable, as before.
 *
 * Identity is not screen identity: RN forms share one id across fields
 * (`TextFieldWithComponentStyle`), so a NEXT screen with a field at the same
 * rect is a twin too (review 2026-10-08: typing that navigated read the next
 * screen's field). After typing it is therefore asked only while the
 * screen's identity (ui-tree/read-tree.ts#ScreenIdentity) is still the
 * last pre-typing read's (`sameScreen`) — and not at all when nothing was read
 * before typing (`TwinGuard`). The limit: a next screen with the very same set of
 * identified nodes still passes.
 */
export function sameField(tree: UiNode, chosen: UiNode): UiNode | undefined {
  const twins = [...everyNode(tree)].filter(
    (n) => n.role === chosen.role && n.identifier === chosen.identifier && sameRect(n.rect, chosen.rect),
  );
  return twins.length === 1 ? twins[0] : undefined;
}

/** A fresh tree's answer: the selector's match (`bySelector`), else the chosen node's twin where the guard allows, else why it is lost. Pure. */
export function findAgain(tree: UiNode, bySelector: UiNode | undefined, chosen: UiNode, guard: TwinGuard): FieldRead {
  if (bySelector !== undefined) return { node: bySelector };
  const twinOr = (): FieldRead => {
    const twin = sameField(tree, chosen);
    return twin === undefined ? { lost: 'unmatched' } : { node: twin };
  };
  switch (guard.phase) {
    case 'before-typing':
      return twinOr();
    case 'typing':
      // Another screen than the pre-typing read's: its twin is not asked.
      return sameScreen(screenIdentity(tree), guard.screen) ? twinOr() : { lost: 'screen-changed' };
    case 'typing-unread':
      // No twin: nothing was read before typing. The screen the field was resolved on, when known, words the why.
      return { lost: guard.resolvedOn !== undefined && !sameScreen(screenIdentity(tree), guard.resolvedOn) ? 'screen-changed' : 'unmatched' };
  }
}

/** A fill's reads of its field (see the module doc). */
export interface FieldRefetch {
  /** A fresh tree, and the field in it — or why it is not there. Throws `unreadable`'s error on a tree that cannot be read. */
  read(): Promise<FieldRead>;
  /** Typing starts now: the twin fallback's guard becomes the screen of the newest read (none: off). Once; later calls keep it. */
  typingStarts(): void;
  /** The newest tree a read saw; undefined: none yet. */
  lastTree(): UiNode | undefined;
}

/** What `fieldRefetch` reads, and what it looks for. */
export interface RefetchOf {
  adapter: Pick<DeviceAdapter, 'uiTree'>;
  /** The selector the field was resolved by, and the resolution's policy (resolveNow). */
  target: Target;
  resolve: ResolveOptions;
  /** The node chosen at focus — the identity `sameField` looks for. */
  chosen: UiNode;
  /**
   * The screen the field was resolved on, given when the post-focus read was skipped (fill-landing.ts#postFocusReadOf)
   * — the wording of a `lost` alone.
   */
  resolvedOn?: ScreenIdentity;
  /** The error a tree that cannot be read throws, of the read's own. */
  unreadable: (e: Error) => Error;
}

/** The reads of the field `chosen` (see the module doc). */
export function fieldRefetch({ adapter, target, resolve, chosen, resolvedOn, unreadable }: RefetchOf): FieldRefetch {
  let last: UiNode | undefined;
  let guard: TwinGuard = { phase: 'before-typing' };
  return {
    read: async () => {
      const tree = await readTreeOrThrow(adapter, unreadable);
      last = tree;
      return findAgain(tree, resolveNow(tree, target, resolve)?.node, chosen, guard);
    },
    typingStarts: () => {
      if (guard.phase !== 'before-typing') return;
      guard = last === undefined ? { phase: 'typing-unread', resolvedOn } : { phase: 'typing', screen: screenIdentity(last) };
    },
    lastTree: () => last,
  };
}
