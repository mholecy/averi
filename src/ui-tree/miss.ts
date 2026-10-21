import type { UiNode } from '../adapters/types.js';
import type { Edge } from './geometry.js';
import { presentationOf, type MarkedLayer } from './presentation.js';
import { findTarget, hasArea, soleIdOf, type Target } from './selectors.js';
import { clippedOutText, revealText } from './sides.js';
import { presentedLayerName, presentedRemedy } from './standing.js';

/**
 * WHY A TARGET IS NOT IN THE TREE: the one decision behind every reply that says a target is not in the tree — the
 * tap's and fill's wait and the presence check (interact/resolve.ts), `scroll_until`'s "never appeared in the tree"
 * (interact/scroll-text.ts: the `absent` shortfall and the `covered` stop), every assert's "not found within …"
 * (verify/poll-verdict.ts#notFound), a flow's `wait:` on an element (flow/engine.ts#waitTimeoutHint), and the skip line
 * of an optional step that threw one (flow/engine.ts#runOptionalSteps, which reads the `Miss` the error carries,
 * `missCarried`). Asked once, of the target and the LAST read the miss made (`missOf`), and worded once (`missNote`,
 * and `presentedAloneHeadline` for the one reply whose headline it is); each reply only picks the layout — beneath a
 * thrown poll timeout's headline (ui-tree/read-tree.ts#pollTimeoutMessage), or after a one-line not-found in a
 * parenthesis (`withMissNote`) — and adds its own headline and flow-step advice.
 *
 * The facts, in the one precedence (ADR 0018 decision 5):
 * - `unread`: the last read failed — its error is the story, which each reply already words where it puts it (a
 *   note about what an earlier tree held would point the wrong way);
 * - `zeroArea`: the last tree matched the target, but only with zero-area nodes — which says it IS in the tree, so it
 *   outranks every fact about what the tree does not list. Asked of every match the tree holds (selectors.ts
 *   #findTarget), so it is said only by a reader whose resolution filters zero-area nodes out and still missed
 *   (interact/resolve.ts#resolveNow); a tree assert, a `wait:` and `scroll_until` count such a node found, and
 *   never miss on a tree that holds one. idb reports a node scrolled above the top of a scroll view as 0×0, and the
 *   wait read "to appear" for a node the snapshot showed; a collapsed view carries its id at 0×0 too, which is why
 *   the note names both (docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md). Where every such match was dumped
 *   clipped out of its scroll container (Android's inverted bounds, UiNode.clippedOut: Settings' `Apps` under the
 *   collapsing app bar read "0×0" for a `126x-239` node) the note says where, and the way back when the sides agree;
 * - `presented`: the tree's source marks its root presented — a layer listed ALONE (ui-tree/presentation.ts
 *   #Presentation.alone: Android's dialog, a sheet whose scrim the dump carries, its active window; idb's flat list
 *   holding UIKit's dismiss region, its top layer: `ListedAs`), the screen beneath unlisted: the layer named
 *   (`presentedLayerName`) and the remedy, close it first — in one phrase with no parenthesis inside, since a
 *   one-line reply says it in one; the tap's headline keeps `presentedRemedy`'s words;
 * - `activeWindow`: the source lists the active window only (`UiNode.activeWindowOnly`, uiautomator) and marks no
 *   presented window — a sheet or a dialog it does not mark (a fully expanded bottom sheet with no scrim, form-picker;
 *   a full-screen dialog; a window against the screen's edge: ADR 0018's residuals 18 and 19) still hides the screen
 *   beneath, and nothing in the dump tells it from no window at all: ACTIVE_WINDOW_HINT, a possibility, never the cause;
 * - `containerId`: the tree is idb's flat list (its own mark, `UiNode.flatList` — the tree's, not averi.yaml's nor
 *   the adapter's: the mark is on every tree idb's parser gives, adapters/ios-tree-source.ts#markIdbDialect, and on
 *   no other) and the target named an id ALONE (selectors.ts#soleIdOf): idb returns accessibility elements only, so
 *   an identifier set on a CONTAINER (SwiftUI `.accessibilityElement(children: .contain)`, a React Native `testID` on
 *   a non-interactive host view) is in no read at all — a wait on it is not late, it is hopeless (measured
 *   2026-10-05, docs/bugs/2026-10-06-wait-timeout-no-hint-for-ids-idb-cannot-see.md). A possible cause: the miss
 *   knows only that the id was in no tree it read. The tree source's dialect, read from the tree; a second fact of
 *   it (NI1: idb lists a UIKit table row by its text without its id) is one more kind here;
 * - `none`: a tree that lists every window (WDA), or idb's with no presented layer marked and no id-alone target,
 *   and matched nothing.
 *
 * A reader that asks of the tree alone — an assert's not-found (verify/poll-verdict.ts#notFound is not handed the
 * assert's selector), a table of `scroll_until` rounds — passes no target, and gets no fact of the target: no
 * `zeroArea`, no `containerId`.
 */
export type Miss =
  | { readonly of: 'unread' }
  | { readonly of: 'zeroArea'; readonly clippedOut: readonly Edge[] }
  | { readonly of: 'presented'; readonly layer: MarkedLayer; readonly listed: ListedAs }
  | { readonly of: 'activeWindow' }
  | { readonly of: 'containerId'; readonly id: string }
  | { readonly of: 'none' };

/** THE hint of a miss on a tree whose source lists the active window only and marks no window presented (`Miss`'s `activeWindow`). */
export const ACTIVE_WINDOW_HINT = 'the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first';

/**
 * What a tree that lists a presented layer ALONE lists it as (`Miss`'s `presented`), which its sentences name: the
 * active `window` (uiautomator's root, `UiNode.activeWindowOnly`), or the `layer` on top (idb's flat list — what a
 * presentation leaves to accessibility).
 */
export type ListedAs = 'window' | 'layer';

/** What the tree lists when it lists a presented layer alone, as the tap's headline says it (`presentedAloneHeadline`). */
const PRESENTED_ALONE: Record<ListedAs, string> = {
  window: 'lists only the window presented on top (the tree source lists the active window alone)',
  layer: 'lists only the layer presented on top (the tree source lists nothing beneath a presented layer)',
};

/**
 * THE decision: why `target` is not in the last read of a miss (`Miss`, in its precedence). `tree` is that read, or
 * `readError` the error that stood in for it; `target` what the miss looked for, when the reader has it. Asked after a
 * miss: of a tree that holds a match with area it says only the tree's own facts (`presented`, `activeWindow`).
 */
export function missOf({ tree, readError, target }: { tree?: UiNode; readError?: Error; target?: Target }): Miss {
  if (readError !== undefined || tree === undefined) return { of: 'unread' };
  const matched = target === undefined ? [] : findTarget(tree, target);
  if (matched.length > 0 && !matched.some(hasArea)) return { of: 'zeroArea', clippedOut: clippedOutOf(matched) };
  // The root-mark tests are a cost guard too: only a tree whose root is marked presented pays the presentation's walk.
  const alone = tree.presentation === undefined ? undefined : presentationOf(tree).alone;
  if (alone !== undefined) return { of: 'presented', layer: alone, listed: tree.activeWindowOnly === true ? 'window' : 'layer' };
  if (tree.activeWindowOnly === true) return { of: 'activeWindow' };
  const id = tree.flatList === true && target !== undefined && matched.length === 0 ? soleIdOf(target) : undefined;
  return id === undefined ? { of: 'none' } : { of: 'containerId', id };
}

/** The sides every match was dumped clipped out past (UiNode.clippedOut), in first-seen order — none when any match was not. */
function clippedOutOf(matched: readonly UiNode[]): Edge[] {
  const sides = new Set(matched.map((n) => n.clippedOut));
  return sides.has(undefined) ? [] : ([...sides] as Edge[]);
}

/** The note beneath a never-resolved wait whose last tree matched the target only at 0×0, clipped out nowhere it can name. */
const ZERO_AREA_HINT = 'it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first';

/** The zero-area note: where the matches were clipped out, and the scroll back when there is one side (`ZERO_AREA_HINT` when they name none). */
function zeroAreaNote([only, ...more]: readonly Edge[]): string {
  if (only === undefined) return ZERO_AREA_HINT;
  if (more.length > 0) return `it matched only nodes ${clippedOutText([only, ...more])} — scroll_until it first`;
  return `it matched only nodes ${clippedOutText([only])} (scrolled past it) — ${revealText(only)} first`;
}

/**
 * The idb container-id note — the fact and the tree source to read with instead. Flow-step advice ("wait on a
 * button/row id idb does show") is the flow's, added after it (flow/engine.ts#waitTimeoutHint).
 */
const containerIdNote = (id: string): string =>
  `no tree read contained id:${JSON.stringify(id)}. iOS treeSource: idb never exposes an identifier set on a container — ` +
  'SwiftUI .accessibilityElement(children: .contain), React Native testID on a non-interactive view. ' +
  'If the screen is showing, set app.ios.treeSource: wda in averi.yaml';

/** THE words a miss says beneath or after its not-found; undefined for `unread` and `none`, which add nothing. */
export function missNote(miss: Miss): string | undefined {
  switch (miss.of) {
    case 'zeroArea':
      return zeroAreaNote(miss.clippedOut);
    case 'presented':
      return `${presentedLayerName(miss.layer)} is presented over it, and the tree lists only that ${miss.listed} — close it first`;
    case 'activeWindow':
      return ACTIVE_WINDOW_HINT;
    case 'containerId':
      return containerIdNote(miss.id);
    case 'unread':
    case 'none':
      return undefined;
  }
}

/**
 * The headline of the tap's and fill's wait on a `presented` miss (interact/resolve.ts#notFound), which says the miss
 * in place of "… to appear": `element id:"x" is not in the tree, which lists only the window presented on top (the
 * tree source lists the active window alone) — a dialog is presented over it — close it first`.
 */
export const presentedAloneHeadline = (subject: string, { layer, listed }: Extract<Miss, { of: 'presented' }>): string =>
  `${subject} is not in the tree, which ${PRESENTED_ALONE[listed]} — ${presentedRemedy('it', layer)}`;

/** A one-line not-found `what`, the miss's note after it in a parenthesis when it has one. */
export const withMissNote = (what: string, miss: Miss | undefined): string => {
  const note = miss === undefined ? undefined : missNote(miss);
  return note === undefined ? what : `${what} (${note})`;
};

/**
 * An error whose message says a target was not in the tree, carrying what that miss saw for a one-line reader (the
 * optional step's skip, flow/engine.ts): interact's ElementNotFoundError and the engine's `wait:` timeout extend it.
 */
export class MissedError extends Error {
  constructor(
    message: string,
    readonly miss: Miss,
  ) {
    super(message);
  }
}

/** The `Miss` an error carries (a `MissedError`), if it carries one. */
export const missCarried = (e: unknown): Miss | undefined => (e instanceof MissedError ? e.miss : undefined);
