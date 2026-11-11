import { rectArea, STRUCTURAL_ROLES, type UiNode } from '../adapters/types.js';
import { nodeText, type Cut } from '../ui-tree/geometry.js';
import { cutPinnedRemedyText, noScrollRemedyText, presentedOr } from '../ui-tree/remedy-text.js';
import { isInteractive } from '../ui-tree/selectors.js';
import { noScrollHelps, type RemedyCase, type TouchRemedied } from '../ui-tree/standing.js';
import { cutRemedy, dismissKeyboardFirstText, hideClause, keyboardUpText, ridingKeyboard, wholeThinWayPast, type KeyboardUp } from './target-text.js';

/**
 * THE TOUCH REMEDY's sentence (A26): what the tap's refusal and `scroll_until`'s stop say to do about a target that
 * stands `cut` or `covered` — one function of the standing (ui-tree/standing.ts#TouchRemedied: its kind, its remedy,
 * its cut's `by` and `within`, its cover) and the soft keyboard when it is up (`KeyboardUp`), so the two touch verbs
 * cannot word one target two ways. Before A26 the tap (tap-judgement.ts#tapOutcome), `scroll_until`'s `overlapped`
 * stop and its sliver failures (scroll-text.ts) each routed (kind, remedy, cut.by, keyboard) to a sentence, and the
 * failure's quote of the tap ("a tap refuses it so cut …") had drifted from it: a container's cut lacked its way past.
 *
 * The cases, the remedy decided by ui-tree/standing.ts#Remedy (THE PRECEDENCE), worded here:
 * - `presented` (any kind): that screen's (ui-tree/remedy-text.ts#presentedOr).
 * - `cut` at a clipping container's edge (`Cut.by` absent), `scroll`: a `scroll_until` toward that edge, and — should
 *   it only READ cut — its way past (`cutWayPast`). docs/adr/0005-cut-before-cover.md, docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md
 * - `cut` by a node drawn after it, `scroll`: scroll the list out from under that node, its way past, and the riding
 *   keyboard first (`cutByRemedy`); `bothPinned`: no scroll (`cutByPinnedRemedy`, the node it is pinned under the
 *   remedy's `under`). docs/adr/0015-flat-list-reading-order-break.md (its D88 amendment)
 * - `covered`, `unordered`, `seenOver` or `bothPinned`: no scroll (ui-tree/remedy-text.ts#noScrollRemedyText);
 *   `scroll`: a scroll, refined for a wrapper that may only position its one child (`positionerRemedy`).
 *
 * The keyboard is the caller's reading (`KeyboardUp`: the tap's reading line, `scroll_until`'s applied cover), named
 * only for a cut by a node drawn after it; whether that node rides on it is target-text.ts#ridingKeyboard's
 * (a geometric judgement kept with the words for now: review 2026-11-11's ST2).
 * Not the other kinds: an off-screen, system-bar or under-keyboard target is refused by the tap in its own words, and
 * `scroll_until` scrolls those (or stops on its own sentence) — the two verbs share no sentence there.
 */
export function touchRemedyText(standing: TouchRemedied, keyboard?: KeyboardUp): string {
  switch (standing.kind) {
    case 'cut': {
      const { cut, minPiece } = standing;
      const { by } = cut;
      return presentedOr(standing.remedy, 'touch', (remedy) =>
        remedy.of === 'bothPinned'
          ? cutByPinnedRemedy(remedy, keyboard, minPiece)
          : by === undefined
            ? `${cutRemedy(cut.edge)} (${cutWayPast(cut)})`
            : cutByRemedy(cut, by, keyboard, minPiece),
      );
    }
    case 'covered':
      // A scroll, refined for a wrapper that may only position its one child by the tap's own positioner hint — or, under
      // a cover whose order the tree does not tell, one a screenshot saw drawn over it, or one where neither lies in a scroll view, no scroll.
      return presentedOr(standing.remedy, 'touch', (remedy) => (noScrollHelps(remedy) ? noScrollRemedyText(remedy, 'touch') : (positionerRemedy(standing.cover.node) ?? 'scroll_until it first')));
    default: {
      const unhandled: never = standing;
      return unhandled;
    }
  }
}

/** The way past a cut the node's own content evidences, should it only READ cut (geometry.ts#evidentCut's residual). */
const OWN_CUT_WAY_PAST = 'if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates';
/** The way past a cut inherited from what the node lies in (`Cut.within`): the evidence is that ancestor's, so its "whole" case is that ancestor's. */
const INHERITED_CUT_WAY_PAST =
  'if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates';

/**
 * THE WAY PAST a cut, should the node only READ cut — what no scroll changes, so what a tap does instead: the clause
 * the touch remedy puts in parentheses after its scroll (`touchRemedyText`), and the one `scroll_until`'s stuck failure
 * quotes of the tap when the content is exhausted and the scroll half is moot (scroll-text.ts#failureText).
 * - At a clipping container's edge (`Cut.by` absent): the node that is whole, its own content running to the edge
 *   (geometry.ts#evidentCut's residual) — a child that lies CLEAR of that edge, or a coordinate tap: a child flush
 *   with it inside a sliver cut there is refused too (geometry.ts#Clips.cutSliver's inherited cut, `Cut.within`;
 *   measured: the toggle's leaf label "Payment details", tapped as a child, did nothing) — whose own way past names
 *   what it lies in: something in THAT clear of the edge. A container's cut needs a clipping ancestor
 *   (UiNode.clipsDescendants, Android's); an iOS tree is none (WDA's frames are unclipped, idb's list flat), so no
 *   cut is refused there.
 * - By a node drawn after it (`Cut.by`): a whole control that thin laid flush against that node (target-text.ts#wholeThinWayPast).
 */
export const cutWayPast = (cut: Cut): string =>
  cut.by !== undefined ? wholeThinWayPast(cut.by) : cut.within === undefined ? OWN_CUT_WAY_PAST : INHERITED_CUT_WAY_PAST;

/**
 * The remedy for a node cut (`cut`) by a node drawn after it (`Cut.by`, here `by`) whose standing's remedy is `scroll`
 * (ui-tree/standing.ts#Remedy): with the soft keyboard up and that node riding on it (target-text.ts#ridingKeyboard),
 * dismiss it first, or scroll the list (target-text.ts#dismissKeyboardFirstText); else scroll the list — `scroll_until
 * it out from under that container first`, with the cut's way past (`cutWayPast`). Not target-text.ts#cutRemedy's
 * scroll toward the edge: the rest lies under the node, not past the edge of anything that scrolls.
 */
function cutByRemedy(cut: Cut, by: UiNode, up: KeyboardUp | undefined, minPiece: number): string {
  const way = `scroll_until it out from under that ${by.role} first (${cutWayPast(cut)})`;
  return ridingFirst(by, up, minPiece, (dismiss) => `${dismiss} — or ${way}`, way);
}

/**
 * `cutByRemedy`'s for a remedy `bothPinned` (D88: neither lies in a scroll view; `by`, the remedy's `under`): no
 * scroll — THE clause every verb quotes for it (ui-tree/remedy-text.ts#noScrollRemedyText, with the cut's way past).
 * With the soft keyboard up and that node riding on it, dismiss it first all the same: a bar riding on it goes down
 * with it, scroll view or none. With the keyboard up and that node NOT read as riding but possibly stacked in a bar
 * that does (`stackedOnKeyboard`: buttons stacked in a riding bar, the cut one on top), hiding it is named as a way
 * that MAY move that node (`keyboardMayMoveText`): with no scroll to fall back on, saying nothing of the keyboard
 * would mislead where it does — the safe direction, as `cutByRemedy`'s scroll is there. A node far above the line (a
 * top bar) gets the clause alone.
 */
function cutByPinnedRemedy(remedy: RemedyCase<'bothPinned'>, up: KeyboardUp | undefined, minPiece: number): string {
  const by = remedy.under;
  const way = cutPinnedRemedyText(remedy);
  if (ridingKeyboard(by, up, minPiece) === undefined && up !== undefined && stackedOnKeyboard(by, up)) return `${keyboardMayMoveText(up, by)} — else ${way}`;
  return ridingFirst(by, up, minPiece, (dismiss) => `${dismiss} — else ${way}`, way);
}

/**
 * Whether `by` MAY be stacked in a bar riding on the keyboard though not read as riding (target-text.ts#ridingKeyboard):
 * it ends at or above the keyboard's line, no further above it than its own height — room for one more such node
 * beneath it (the lab's Continue is 132 tall, stacked on another, 66 above the line). Not the cut's edge: a riding bar
 * cuts a field it has scrolled under at the field's TOP (the lab's phone, 1370..1412 under a bar ending at 1370), as a
 * top bar does.
 */
function stackedOnKeyboard(by: UiNode, { lineY }: KeyboardUp): boolean {
  const gap = lineY - (by.rect.y + by.rect.height);
  return gap >= 0 && gap <= by.rect.height;
}

/** `the soft keyboard is up (its top edge at y 1398): hiding it may move that button (press_key back …)` — `cutByPinnedRemedy`'s for a node not read as riding on it. */
const keyboardMayMoveText = ({ lineY, remedy }: KeyboardUp, by: UiNode): string => `${keyboardUpText(lineY)}: hiding it may move that ${by.role} (${hideClause(remedy)})`;

/**
 * THE riding-keyboard choice of every cut-by sentence: `riding`, told "dismiss it first" (target-text.ts#dismissKeyboardFirstText),
 * when `by` rides on the soft keyboard (target-text.ts#ridingKeyboard); else `not`. The tap's remedy and the stuck
 * failure's (`stuckCutText`) word the two cases around it.
 */
function ridingFirst(by: UiNode, up: KeyboardUp | undefined, minPiece: number, riding: (dismiss: string) => string, not: string): string {
  const keyboard = ridingKeyboard(by, up, minPiece);
  return keyboard === undefined ? not : riding(dismissKeyboardFirstText(keyboard));
}

/**
 * `scroll_until`'s STUCK failure of a target cut to a sliver, the content exhausted — the whole of it after "no longer
 * moves it", which scroll-text.ts#failureText only frames:
 * - what keeps the rest from showing: past its container's edge (`Cut.by` absent) — a layout defect, or its own
 *   content runs to its edge and reads as cut; or under the node drawn after it — with the soft keyboard up and that
 *   node riding on it, dismiss it first and scroll again (`ridingFirst`, the tap's own choice), else a layout defect
 *   (no clearance for a pinned bar), or it is only that thin;
 * - then the tap's refusal, quoted by its way past (`cutWayPast`: the scroll half of the tap's remedy is moot once the
 *   content is exhausted) — or, beneath a presented screen, that screen's remedy, as the tap says it (`presentedOr`).
 * The quote keeps its parentheses, "a tap refuses it so cut (…)", unlike the bound's colon (scroll-text.ts#shortText):
 * the corpus's stuck rows already say it so (ADR 0015's A26 amendment).
 */
export function stuckCutText(standing: Extract<TouchRemedied, { kind: 'cut' }>, keyboard?: KeyboardUp): string {
  const { cut, minPiece } = standing;
  const quote = presentedOr(standing.remedy, 'touch', () => cutWayPast(cut));
  const rest =
    cut.by === undefined
      ? "The rest of it stays past its container's edge at the end of the content — a layout defect (no room beyond it?), or its own content runs to its edge, which reads as cut"
      : `The rest of it may stay under that ${cut.by.role} at the end of the content — ${ridingFirst(cut.by, keyboard, minPiece, (dismiss) => `${dismiss}, and scroll again`, 'a layout defect (no clearance for a pinned bar?)')} — or it is only that thin, laid flush against it`;
  return `${rest}; a tap refuses it so cut (${quote})`;
}

/** The most of a wrapper's area its one child may take and still count as SMALL for `positionerRemedy`: a quarter. */
const SMALL_CHILD_FRACTION = 0.25;

/**
 * The remedy for a target under a WRAPPER that may only position its one child: a structural node (`container`,
 * `other`) whose only child is a control (selectors.ts#isInteractive) of some area, at most `SMALL_CHILD_FRACTION` of its own —
 * Android's floating action button host (Clock's `fab_container` 1080x352 holding its 264x264 FAB, 18 % of it). Such a
 * wrapper still counts as drawn over its whole rect (draw-order.ts's `structural` row: the tree cannot tell it from a
 * tab bar's host that swallows touches), so the refusal stands; this says what to do instead of only scrolling. A host
 * of several children — a tab bar's — gets none. Undefined when the cover is no such wrapper. Said by the tap only
 * today: `scroll_until` scrolls a target its cover's `scroll` remedy may free.
 * The trade-off as the agent reads it: skill/references/tools.md, the `tap` section.
 */
function positionerRemedy(cover: UiNode): string | undefined {
  if (!STRUCTURAL_ROLES.has(cover.role) || cover.children.length !== 1) return undefined;
  const [child] = cover.children;
  const area = rectArea(child.rect);
  if (!isInteractive(child) || !(area > 0 && area <= rectArea(cover.rect) * SMALL_CHILD_FRACTION)) return undefined;
  return `the wrapper may only position its one child, ${nodeText(child)}: tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first`;
}
