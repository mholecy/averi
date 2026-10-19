import type { UiNode } from '../adapters/types.js';
import { presentationOf, type MarkedLayer } from './presentation.js';
import { presentedLayerName, presentedRemedy } from './standing.js';

/**
 * WHAT A MISS SAW: the one decision behind every reply that says a target is not in the tree — the tap's and fill's
 * wait and the presence check (interact/resolve.ts), `scroll_until`'s "never appeared in the tree"
 * (interact/scroll-text.ts: the `absent` shortfall and the `covered` stop), every assert's "not found within …"
 * (verify/poll-verdict.ts#notFound), a flow's `wait:` on an element (flow/engine.ts#waitTimeoutHint), and the skip line
 * of an optional step that threw one (flow/engine.ts#runOptionalSteps, which reads the `Miss` the error carries,
 * `missCarried`). Asked once, of the LAST read the miss made (`missOf`), and worded once (`missNote`, and
 * `presentedAloneHeadline` for the one reply whose headline it is); each reply only picks the layout — beneath a thrown
 * poll timeout's headline (ui-tree/read-tree.ts#pollTimeoutMessage), or after a one-line not-found in a parenthesis
 * (`withMissNote`).
 *
 * The facts, in the one precedence (ADR 0018 decision 5, round 7):
 * - `unread`: the last read failed — its error is the story, which each reply already words where it puts it (a
 *   note about what an earlier tree held would point the wrong way);
 * - `zeroArea`: the last tree matched the target, but only with zero-area nodes — which says it IS in the tree, so it
 *   outranks every fact about what the tree does not list. Only a caller whose resolution filters zero-area nodes out
 *   has it (interact's, which words it: resolve.ts#zeroAreaHint); a tree assert or a `wait:` finds such a node;
 * - `presented`: the tree's source lists the active window only and that window is presented — listed ALONE
 *   (ui-tree/presentation.ts#Presentation.alone: Android's dialog, a sheet whose scrim the dump carries), the screen
 *   beneath unlisted: the layer named (`presentedLayerName`) and the remedy, close it first — in one phrase with no
 *   parenthesis inside, since a one-line reply says it in one; the tap's headline keeps `presentedRemedy`'s words;
 * - `activeWindow`: the source lists the active window only (`UiNode.activeWindowOnly`, uiautomator) and marks no
 *   presented window — a sheet or a dialog it does not mark (a fully expanded bottom sheet with no scrim, form-picker;
 *   a full-screen dialog; a window against the screen's edge: ADR 0018's residuals 18 and 19) still hides the screen
 *   beneath, and nothing in the dump tells it from no window at all: ACTIVE_WINDOW_HINT, a possibility, never the cause;
 * - `none`: a tree that lists every window (WDA, idb) and matched nothing.
 */
export type Miss =
  | { readonly of: 'unread' }
  | { readonly of: 'zeroArea'; readonly hint: string }
  | { readonly of: 'presented'; readonly layer: MarkedLayer }
  | { readonly of: 'activeWindow' }
  | { readonly of: 'none' };

/** THE hint of a miss on a tree whose source lists the active window only and marks no window presented (`Miss`'s `activeWindow`). */
export const ACTIVE_WINDOW_HINT = 'the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first';

/** What the tree lists when it lists a presented window alone, as the tap's headline says it (`presentedAloneHeadline`). */
const PRESENTED_ALONE = 'lists only the window presented on top (the tree source lists the active window alone)';

/**
 * THE decision: what the last read of a miss saw (`Miss`, in its precedence). `last` is that read — its tree, or the
 * error that stood in for it; `zeroArea` the caller's zero-area words for that tree, when its resolution has them.
 */
export function missOf(last: { tree?: UiNode; readError?: Error }, zeroArea?: (tree: UiNode) => string | undefined): Miss {
  const { tree, readError } = last;
  if (readError !== undefined || tree === undefined) return { of: 'unread' };
  const hint = zeroArea?.(tree);
  if (hint !== undefined) return { of: 'zeroArea', hint };
  if (tree.activeWindowOnly !== true) return { of: 'none' };
  // The root-mark test above is a cost guard too: only such a tree pays the presentation's walk.
  const alone = presentationOf(tree).alone;
  return alone !== undefined ? { of: 'presented', layer: alone } : { of: 'activeWindow' };
}

/** THE words a miss says beneath or after its not-found; undefined for `unread` and `none`, which add nothing. */
export function missNote(miss: Miss): string | undefined {
  switch (miss.of) {
    case 'zeroArea':
      return miss.hint;
    case 'presented':
      return `${presentedLayerName(miss.layer)} is presented over it, and the tree lists only that window — close it first`;
    case 'activeWindow':
      return ACTIVE_WINDOW_HINT;
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
export const presentedAloneHeadline = (subject: string, layer: MarkedLayer): string =>
  `${subject} is not in the tree, which ${PRESENTED_ALONE} — ${presentedRemedy('it', layer)}`;

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
