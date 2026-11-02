import { everyNode, type UiNode } from '../adapters/types.js';
import type { Edge } from './geometry.js';
import { presentationOf, type MarkedLayer } from './presentation.js';
import { clips } from './scroll-containers.js';
import { findTarget, hasArea, soleIdOf, type Target } from './selectors.js';
import { clippedOutText, revealText } from './sides.js';
import { presentedLayerName, presentedRemedy } from './standing.js';
import { isBareTreeMemo } from './verdict.js';

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
 *   one-line reply says it in one; the tap's headline keeps `presentedRemedy`'s words. Where the window listed
 *   alone holds a scroll view of its own (`mayLieIn`), the target may as well be a row of that list not laid out yet
 *   — a lazy list composes only what shows (form-picker's country sheet, whose far rows `scroll_until` reaches on the
 *   sheet's own list): the words then say that first, scroll_until it in that list, and close it first only if not —
 *   never "no scroll moves it out", which would send an agent to dismiss the very window it needs. Not where the
 *   reader has already stroked that list (`scrolled`: `scroll_until`'s own stop, ADR 0018 decision 3), nor on idb's
 *   flat list, which lists no scroll view (the remedy stays as it was: ADR 0018, residual 18);
 * - `activeWindow`: the source lists the active window only (`UiNode.activeWindowOnly`, uiautomator) and marks no
 *   presented window — a sheet or a dialog it does not mark (a fully expanded bottom sheet with no scrim, form-picker;
 *   a full-screen dialog; a window against the screen's edge: ADR 0018's residuals 18 and 19) still hides the screen
 *   beneath, and nothing in the dump tells it from no window at all: ACTIVE_WINDOW_HINT, a possibility, never the cause.
 *   Where the window manager typed the window after the read (ui-tree/window-mark.ts, on a miss only), its word is in
 *   the root's marks: a Dialog's window is `presented` (above), and the activity's own window alone (`UiNode
 *   .windowAlone`) is `none` — no hint; with no word (the call failed, the frames disagree) the hint stays;
 * - `noIdListed`: the tree is idb's flat list (its own mark, below), the target named an id ALONE, nothing matched, the
 *   read is not bare (ui-tree/verdict.ts#isBareTreeMemo: a launch-transition read lists nothing of the app's, so its
 *   ids say nothing of the screen), and no element of the read carries an identifier at all — a fact the read states,
 *   so no `id:` selector can match anything in it: the wait is hopeless, not late. Why the read lists none is not in
 *   the read, so the words give the fact and idb's dialect as possibilities (`IDB_UNLISTS`), with the remedies a
 *   read without ids leaves: close what lies over the element, a `text:` or `label:` selector, or WDA. Measured on a
 *   UIKit table whose cells' labels carry ids WDA reads from the same process (docs/bugs/2026-10-16-lab-ios-idb-lists-
 *   uikit-table-rows-without-their-identifier.md) and on an alert whose read is the alert alone (alert-dim);
 * - `idUnlisted`: the same, on a read that lists other identifiers — the tree is idb's flat list (its own mark,
 *   `UiNode.flatList` — the tree's, not averi.yaml's nor the adapter's: the mark is on every tree idb's parser gives,
 *   adapters/ios-tree-source.ts#markIdbDialect, and on no other), the target named an id ALONE (selectors.ts
 *   #soleIdOf), no read held it, and the read is not bare. idb returns the accessibility elements of the top layer
 *   only, so an id can be in no read for any of idb's reasons (`IDB_UNLISTS`): set on a CONTAINER (SwiftUI
 *   `.accessibilityElement(children: .contain)`, a React Native `testID` on a non-interactive host view: measured
 *   2026-10-05, docs/bugs/2026-10-06-wait-timeout-no-hint-for-ids-idb-cannot-see.md), dropped (the UIKit cell), or
 *   on an element beneath the keyboard or a presented sheet, alert or cover (the lab's form-keyboard, sheet-background,
 *   dim-cover, form-picker captures). The miss knows only that the id was in no tree it read, so it names them all —
 *   possibilities, never the cause;
 * - `none`: a tree that lists every window (WDA), or idb's with no presented layer marked and no id-alone target, or
 *   a bare read, and matched nothing.
 *
 * A reader that asks of the tree alone — a table of `scroll_until` rounds — passes no target, and gets no fact of the
 * target: no `zeroArea`, no `noIdListed`, no `idUnlisted`.
 */
export type Miss =
  | { readonly of: 'unread' }
  | { readonly of: 'zeroArea'; readonly clippedOut: readonly Edge[] }
  | { readonly of: 'presented'; readonly layer: MarkedLayer; readonly listed: ListedAs; readonly mayLieIn?: InPresentedWindow }
  | { readonly of: 'activeWindow' }
  | { readonly of: 'noIdListed'; readonly id: string }
  | { readonly of: 'idUnlisted'; readonly id: string }
  | { readonly of: 'none' };

/**
 * A tree source that lists only what a presented layer leaves to accessibility and shows no sign of a layer it does
 * not mark: idb's flat list — a large-detent sheet, an alert, a transparent cover over the screen leave only their own
 * controls listed, or none (ADR 0018, "idb's presented layer", residuals).
 */
export type TopLayerOnlySource = 'idb';

/**
 * The tree's source when it lists only the top layer (`TopLayerOnlySource`), read from the tree: idb's own mark,
 * `UiNode.flatList` — the mark `noIdListed` and `idUnlisted` read, and draw-order.ts#listsAncestry the same mark as the tree's
 * nesting. For the reader that must act before a miss is judged: `scroll_until`'s strokes for a target never seen
 * (interact/scroll-rounds.ts#CallEvidence). Undefined for a tree that lists its presented layers or its scroll views.
 */
export function topLayerOnlySource(tree: UiNode): TopLayerOnlySource | undefined {
  return tree.flatList === true ? 'idb' : undefined;
}

/**
 * THE hint of strokes that moved nothing on a tree whose source lists only the top layer (`TopLayerOnlySource`), as
 * `scroll_until`'s unmoved stop says it (interact/scroll-text.ts#boundText) — a possibility, never the cause, as
 * `ACTIVE_WINDOW_HINT` is.
 */
export const TOP_LAYER_ONLY_HINT: Record<TopLayerOnlySource, string> = {
  idb: 'idb lists only what a presented sheet, alert or cover leaves to accessibility: if the element lies beneath one, close it first',
};

/**
 * What a tree whose source lists only the top layer (`TopLayerOnlySource`) leaves out under the soft keyboard, as the
 * tap's and fill's wait says it beside the keyboard's line (interact/target-text.ts#keyboardMayCoverText, D32 K1).
 */
export const KEYBOARD_UNLISTED: Record<TopLayerOnlySource, string> = { idb: 'idb lists nothing beneath it' };

/** THE hint of a miss on a tree whose source lists the active window only and marks no window presented (`Miss`'s `activeWindow`). */
export const ACTIVE_WINDOW_HINT = 'the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first';

/**
 * What a tree that lists a presented layer ALONE lists it as (`Miss`'s `presented`), which its sentences name: the
 * active `window` (uiautomator's root, `UiNode.activeWindowOnly`), or the `layer` on top (idb's flat list — what a
 * presentation leaves to accessibility).
 */
export type ListedAs = 'window' | 'layer';

/**
 * Where in a presented window listed alone a target missing from the tree may still lie (`Miss`'s `presented`
 * `mayLieIn`): `itsScrollView` — the window holds a scroll view of its own, which the reader has not stroked, so the
 * target may be a row of it not laid out yet.
 */
export type InPresentedWindow = 'itsScrollView';

/** What the tree lists when it lists a presented layer alone, as the tap's headline says it (`presentedAloneHeadline`). */
const PRESENTED_ALONE: Record<ListedAs, string> = {
  window: 'lists only the window presented on top (the tree source lists the active window alone)',
  layer: 'lists only the layer presented on top (the tree source lists nothing beneath a presented layer)',
};

/**
 * THE decision: why `target` is not in the last read of a miss (`Miss`, in its precedence). `tree` is that read, or
 * `readError` the error that stood in for it; `target` what the miss looked for, when the reader has it; `scrolled` —
 * the reader stroked the presented window's own scroll view for it already (`scroll_until`), so no `mayLieIn`. Asked
 * after a miss: of a tree that holds a match with area it says only the tree's own facts (`presented`, `activeWindow`).
 */
export function missOf({ tree, readError, target, scrolled }: { tree?: UiNode; readError?: Error; target?: Target; scrolled?: boolean }): Miss {
  if (readError !== undefined || tree === undefined) return { of: 'unread' };
  const matched = target === undefined ? [] : findTarget(tree, target);
  if (matched.length > 0 && !matched.some(hasArea)) return { of: 'zeroArea', clippedOut: clippedOutOf(matched) };
  // The root-mark tests are a cost guard too: only a tree whose root is marked presented pays the presentation's walk.
  const alone = tree.presentation === undefined ? undefined : presentationOf(tree).alone;
  if (alone !== undefined) {
    const listed: ListedAs = tree.activeWindowOnly === true ? 'window' : 'layer';
    // The window listed alone IS the tree: a scroll view anywhere in it is the window's own. One that scrolls NOW
    // (uiautomator's scrollable="true", scroll-containers.ts#clips): a lazy list with rows not laid out has a range to
    // scroll, while a ScrollView-classed node that fits (an AlertDialog's message) is no list to look in.
    const ownList = listed === 'window' && scrolled !== true && [...everyNode(tree)].some(clips);
    return { of: 'presented', layer: alone, listed, ...(ownList && { mayLieIn: 'itsScrollView' as const }) };
  }
  if (tree.activeWindowOnly === true && tree.windowAlone !== true) return { of: 'activeWindow' };
  const id = tree.flatList === true && target !== undefined && matched.length === 0 ? soleIdOf(target) : undefined;
  if (id === undefined || isBareTreeMemo(tree)) return { of: 'none' };
  return listsNoId(tree) ? { of: 'noIdListed', id } : { of: 'idUnlisted', id };
}

/** No element of the read carries an identifier (`noIdListed`): a walk of idb's flat list that stops at the first one. */
function listsNoId(tree: UiNode): boolean {
  for (const n of everyNode(tree)) if (n.identifier !== null) return false;
  return true;
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

/** THE remedy both of idb's dialect notes end on (`noIdListed`, `idUnlisted`): the tree source that lists identifiers. */
export const TREE_SOURCE_REMEDY = 'set app.ios.treeSource: wda in averi.yaml';

/** THE fact of `noIdListed`'s note, as its words say it — the phrase a judge of the reply reads (scripts/truth/replies.ts). */
export const NO_ID_LISTED = "idb's read lists no id on any element";

/**
 * Why idb may list no element by an id the app sets — every reason measured, none of them the cause (the read cannot
 * tell them apart): both of idb's dialect notes say them, after their fact, as possible reasons. One phrase with no
 * parenthesis inside, since a one-line reply wraps the note in one (`withMissNote`); the container's forms (SwiftUI's
 * `.contain`, a React Native `testID` on a non-interactive view) are the ui_snapshot description's and the
 * troubleshooting reference's, not each reply's. The phrase a judge of the reply reads (scripts/truth/replies.ts).
 */
export const IDB_UNLISTS =
  'idb lists nothing beneath the keyboard or a presented sheet, alert or cover, and drops some ids, ' +
  "any set on a container and a UIKit table cell label's among them";

/**
 * The remedies both notes open with: close what lies over the element; else, if it shows, what each read leaves. The
 * phrase a judge of the reply reads (scripts/truth/replies.ts).
 */
export const COVERED_FIRST = 'If something covers it, close that first; if it is showing,';

/** The note of a read that lists no identifier (`noIdListed`): the fact, idb's reasons, then the remedies — a `text:`/`label:` selector among them. */
const noIdListedNote = (id: string): string =>
  `no tree read contained id:${JSON.stringify(id)}, and ${NO_ID_LISTED}. Possible reasons: ${IDB_UNLISTS}. ` +
  `${COVERED_FIRST} ask for it by text: or label:, or ${TREE_SOURCE_REMEDY}`;

/**
 * The note of an id idb's reads never listed (`idUnlisted`): the fact, idb's reasons, the remedies. Flow-step advice
 * ("wait on an id idb does list") is the flow's, added after it (flow/engine.ts#waitTimeoutHint).
 */
const idUnlistedNote = (id: string): string =>
  `no tree read contained id:${JSON.stringify(id)}. Possible reasons: ${IDB_UNLISTS}. ${COVERED_FIRST} ${TREE_SOURCE_REMEDY}`;

/**
 * Whether the miss's note already says that idb lists nothing beneath a presented layer (`IDB_UNLISTS`): a reply that
 * carries it says `TOP_LAYER_ONLY_HINT` no second time (interact/scroll-rounds.ts, the unmoved stop's `unlisted`).
 */
export const saysTopLayerOnly = (miss: Miss): boolean => miss.of === 'noIdListed' || miss.of === 'idUnlisted';

/** THE words a miss says beneath or after its not-found; undefined for `unread` and `none`, which add nothing. */
export function missNote(miss: Miss): string | undefined {
  switch (miss.of) {
    case 'zeroArea':
      return zeroAreaNote(miss.clippedOut);
    case 'presented': {
      const beneath = `${presentedLayerName(miss.layer)} is presented over it, and the tree lists only that ${miss.listed} — close it first`;
      return miss.mayLieIn === undefined ? beneath : `the tree lists only the window on top: ${scrollFirst(miss.layer)}`;
    }
    case 'activeWindow':
      return ACTIVE_WINDOW_HINT;
    case 'noIdListed':
      return noIdListedNote(miss.id);
    case 'idUnlisted':
      return idUnlistedNote(miss.id);
    case 'unread':
    case 'none':
      return undefined;
  }
}

/**
 * A `presented` miss's remedy where the target may lie in the window's own scroll view (`mayLieIn`): the scroll first,
 * the one way to look there, and the layer's remedy only if it is not there — its one phrase (`presentedLayerName`),
 * without `presentedRemedy`'s "no scroll moves it out", which a row of that very list would belie.
 */
const scrollFirst = (layer: MarkedLayer): string =>
  `scroll_until it in that window's own list first; if it is not there, ${presentedLayerName(layer)} is presented over it — close it first`;

/**
 * The headline of the tap's and fill's wait on a `presented` miss (interact/resolve.ts#notFound), which says the miss
 * in place of "… to appear": `element id:"x" is not in the tree, which lists only the window presented on top (the
 * tree source lists the active window alone) — a dialog is presented over it — close it first`; where the target may
 * lie in that window's own scroll view (`mayLieIn`), the scroll first (`scrollFirst`).
 */
export const presentedAloneHeadline = (subject: string, { layer, listed, mayLieIn }: Extract<Miss, { of: 'presented' }>): string =>
  `${subject} is not in the tree, which ${PRESENTED_ALONE[listed]} — ` +
  (mayLieIn === undefined ? presentedRemedy('it', layer) : scrollFirst(layer));

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
