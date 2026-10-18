import { everyNode, rectArea, rectIntersection, STRUCTURAL_ROLES, type DeviceAdapter, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { outsideScrollViewText, screenOf } from '../ui-tree/geometry.js';
import type { Look } from '../ui-tree/look.js';
import { scrollAxis, scrolls } from '../ui-tree/scroll-containers.js';
import { isInteractive, tapPoint } from '../ui-tree/selectors.js';
import { accessoryDismissButton } from '../ui-tree/soft-keyboard.js';
import { outsideItsScrollView, presentedRemedy, type TapStanding } from '../ui-tree/standing.js';
import type { UsableScreen } from '../ui-tree/usable-screen.js';
import type { KeyboardDismissal } from './keyboard-model.js';
import { describeTarget, findTarget, type Ambiguity } from './resolve.js';
import { tapStandings } from './tap-judgement.js';
import { coverName, cutSliverText } from './target-text.js';

/**
 * HOW the in-tree model hides a soft keyboard: an ORDERED LIST OF NAMED STRATEGIES, each judged on one look and either
 * choosing ONE move — a tap at a point, or a drag — or saying why it passes. The in-tree model
 * (interact/keyboard-in-tree.ts) walks the list: the first strategy that chooses a move is performed, the keyboard read
 * again, and only when it is still up is the next strategy judged — on the look that found it still up, never the
 * one before the move. What the list holds, in its order (`dismissalStrategies`):
 *
 * 1. THE CONFIGURED ones (`app.ios.keyboardDismiss`, flow/config.ts), in the config's order: a `tap` on an app element
 *    the author named as neutral (a title), and the input-accessory toolbar's trailing button (`accessory`). Judged as
 *    the picker judged them since stage B (ADR 0016: the tap's standing, the explicit refusal), each its own entry —
 *    so a second configured dismissal is tried when the first, tapped, left the keyboard up.
 * 2. AVERI'S OWN FALLBACKS (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md), only
 *    after the configured ones and only where some are configured (the author's opt-in that averi may touch the
 *    screen to hide the keyboard on this app; with none, the guard refuses and touches nothing, as before), and only
 *    for the guard, which has a target to anchor them: the post-fill dismissal has none, and tries the configured
 *    ones alone.
 *    - `a blank point`: a tap on a point of the target's own scroll view, above the keyboard, where the tree lists
 *      nothing but bare wrappers in a square around it (`blankPoint`) — an app that ends the editing on a tap outside
 *      the field (the common `hideKeyboardWhenTappedAround`) hides it there; one that does not is left as it was.
 *    - `a drag`: the target's scroll view dragged UP by DRAG_LENGTH, from the blank point nearest the keyboard
 *      (`BLANK_DRAG`) — a scroll view whose `keyboardDismissMode` is `onDrag`/`interactive` (SwiftUI's
 *      `scrollDismissesKeyboard`) hides the keyboard on it: measured on the Contacts "New Contact" sheet, 3 of 3
 *      (docs/truth/live-ios-2026-10-18-keyboard-fallbacks.md); one that does not is scrolled toward its end by up to
 *      the drag's length, or does not move. Never DOWN: at the top of a sheet's scroll view a downward drag pulls the
 *      sheet itself down — a swipe that dismisses it.
 *
 * What is NOT on the list, and why — the decision's evidence:
 * - the keyboard's own return key (labelled `return`, `done`, `go`, …): measured to SUBMIT the finportal login from
 *   the password field, the key labelled `done` (K5d, docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md). Its
 *   label does not say what the app does on it, so no single-line field makes it safe; never pressed.
 * - WebDriverAgent's `/wda/keyboard/dismiss`: measured to fail ("Did not know how to dismiss the keyboard", K5a).
 * - a tap on any node that is not bare: a control would be pressed (ADR 0016's explicit refusal), and a text or an
 *   image may carry a gesture the tree does not show.
 *
 * Every move is irreversible and none is repeated; what the looks after a move find, and what the reply says, is the
 * in-tree model's. Nothing here asks the device.
 */

/** Where a strategy is judged: one look, the screen the guard judges on, the ambiguity policy, and the target the guard protects (absent on the post-fill dismissal). */
export interface DismissalGround {
  readonly look: Look;
  readonly screen: UsableScreen | undefined;
  readonly ambiguous: Ambiguity;
  readonly target?: UiNode;
}

/**
 * The one side effect a strategy chose. `what` is the thing moved, as every sentence names it: `id:"login_title"` (with
 * `(N matches, the first)` under `first` mode when several matched), `the accessory toolbar's "Done"`, `a blank point
 * of the target's scroll view`, `the target's scroll view`.
 */
export type DismissalMove =
  | { readonly kind: 'tap'; readonly what: string; readonly at: Point }
  | { readonly kind: 'drag'; readonly what: string; readonly from: Point; readonly to: Point };

/**
 * One named way to hide the keyboard: `name` is how a skip line names it (`tap id:"login_title"`, `accessory`, `a
 * blank point`, `a drag`); `origin` whether the author configured it or it is averi's own fallback.
 */
export interface DismissalStrategy {
  readonly name: string;
  readonly origin: 'configured' | 'fallback';
  choose(ground: DismissalGround): Promise<DismissalMove | { readonly skipped: string }>;
}

/** The list for a configured dismissal list: the configured strategies in order, then — `fallbacks`, and only when some are configured — averi's own two. */
export function dismissalStrategies(configured: readonly KeyboardDismissal[], { fallbacks }: { readonly fallbacks: boolean }): readonly DismissalStrategy[] {
  const own = configured.map(configuredStrategy);
  return fallbacks && own.length > 0 ? [...own, BLANK_TAP, BLANK_DRAG] : own;
}

/** A strategy passed over: its skip line, `<name>: <why>`, and whose strategy it was. */
export interface Skip {
  readonly line: string;
  readonly origin: DismissalStrategy['origin'];
}

/** What walking a list on one ground found: the first move and the strategies after its own, or none; and one skip per strategy passed over on the way. */
export type NextMove = { readonly move?: { readonly move: DismissalMove; readonly rest: readonly DismissalStrategy[] }; readonly skipped: readonly Skip[] };

/** The first strategy of `strategies` that chooses a move on `ground`, and why each one before it passed. */
export async function nextMove(strategies: readonly DismissalStrategy[], ground: DismissalGround): Promise<NextMove> {
  const skipped: Skip[] = [];
  for (const [i, strategy] of strategies.entries()) {
    const chosen = await strategy.choose(ground);
    if ('skipped' in chosen) {
      skipped.push({ line: `${strategy.name}: ${chosen.skipped}`, origin: strategy.origin });
      continue;
    }
    return { move: { move: chosen, rest: strategies.slice(i + 1) }, skipped };
  }
  return { skipped };
}

/** The move, sent: one tap, or one drag of DRAG_MS. */
export function perform(adapter: Pick<DeviceAdapter, 'tap' | 'swipe'>, move: DismissalMove): Promise<void> {
  return move.kind === 'tap' ? adapter.tap(move.at.x, move.at.y) : adapter.swipe(move.from, move.to, DRAG_MS);
}

/** `tapping id:"login_title"`, `dragging the target's scroll view up` — the fragment after `hidden by `. */
export const moving = (m: DismissalMove): string => (m.kind === 'tap' ? `tapping ${m.what}` : `dragging ${m.what} ${direction(m)}`);

/** `tapped id:"login_title"`, `dragged the target's scroll view up`. */
export const moved = (m: DismissalMove): string => (m.kind === 'tap' ? `tapped ${m.what}` : `dragged ${m.what} ${direction(m)}`);

/** `at (201,303)`, `from (201,502) to (201,382)`. */
export const movedAt = (m: DismissalMove): string => (m.kind === 'tap' ? `at ${pointText(m.at)}` : `from ${pointText(m.from)} to ${pointText(m.to)}`);

/** `id:"login_title" was tapped at (201,303)`, `the target's scroll view was dragged up from (201,502) to (201,382)`. */
export const movedPassive = (m: DismissalMove): string => (m.kind === 'tap' ? `${m.what} was tapped ${movedAt(m)}` : `${m.what} was dragged ${direction(m)} ${movedAt(m)}`);

const pointText = ({ x, y }: Point): string => `(${x},${y})`;
const direction = (m: Extract<DismissalMove, { kind: 'drag' }>): string => (m.to.y >= m.from.y ? 'down' : 'up');

// ─── The configured strategies ────────────────────────────────────────────────

/** A dismissal as a skip line names it: `tap id:"login_title"`, `accessory`. */
const describeDismissal = (d: KeyboardDismissal): string => (d.kind === 'tap' ? `tap ${describeTarget(d.target)}` : 'accessory');

/**
 * A configured dismissal as a strategy, judged on the ground's ONE tree — no device read is spent on the choice, and
 * no wait: a dismissal that is not there now is not there.
 *
 * A `tap` is usable when its target matches a NON-INTERACTIVE node with area (the resolution policy prefers the sole
 * interactive match, so `tap: { text: "Sign in" }` on a screen with a title and a button so labelled would have tapped
 * the BUTTON — the one thing a dismissal must never do; interactive matches are dropped here before any choice, and a
 * spec that matches only controls is reported as such), is unambiguous under the caller's `refuse` mode (the guard
 * must not pick one of two titles; under `first` the first is taken, as a flow step would, and the choice is said in
 * `what`), is not the keyboard's own UI (the reading's `ofKeyboard`: a tap on a key or on Done is what `accessory` is
 * for), has its centre clear of the band (a configured element under the keyboard would be the very tap this guard
 * refuses), and a tap on it would land on its centre, unmoved — THE TAP'S STANDING (ui-tree/standing.ts#Scene,
 * `{ of: 'tap' }`) over the ground's screen, over the look's scene and keyboard position (ui-tree/look.ts#Look), its
 * keyboard line the tap's — the standing with the reading's line merged in (tap-judgement.ts#tapStandings' `full`, the
 * tap's own expression) — under WDA a witnessed line, which refuses nothing the band check above has not:
 * - `reachable` at the centre, with no interactive node there it would press — usable;
 * - off the screen or in a system band — `off screen at (x,y)`: a title scrolled above the viewport is still in the
 *   tree, WDA keeps off-screen nodes;
 * - drawn over (an alert, a sheet, a navigation bar's label) — `covered by <role> "<label>"`, naming the cover; so is
 *   a centre covered with a piece of it free, where a tap would MOVE: the configured element's centre is what was
 *   configured, so the dismissal is never aimed off it;
 * - cut to a sliver at its scroll container's edge — the tap's own clause (target-text.ts#cutSliverText); under a line
 *   no guard acts on (idb's band) — `under the keyboard`. Neither is reached on a WDA tree: iOS has no clipping
 *   container and no idb band.
 * What `tap` counts as a cover is a cover here: a title's own content listed beside it, its own unlabelled control, a
 * node of its frame, content of a scroll view it is not in and a keyboard-owned node outside the band are not; a
 * structural wrapper partly over it is. One more refusal is the picker's own: a centre an excused node listed after
 * the title holds, when that node is INTERACTIVE — `covered by <role> "<label>"`, naming it (`whyNotTapped`). The
 * excuses above say where a touch lands on the title, not what else it presses: a `button "Delete account"` of exactly
 * the title's rect reads as the title listed again, an interactive row of a scroll view the title is not in is
 * excused whether or not the title lies in a bar, a text field is no cover of its own label — and a tap at the centre
 * would press each. On the post-fill `dismiss()` path that would be reported as `hiddenBy: tapping <title>`, a wrong
 * action said as the dismissal; a silently pressed control is worse than a skipped title. Which node holds the centre
 * is read off the standing's facts (`StandingFacts.centreExcused`), judged in the same draw-order pass as the covers.
 * docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md
 * An `accessory` is usable when `accessoryDismissButton` answers; that answer is under an `ofKeyboard` root by
 * construction, so no keyboard check is repeated here. The reading is the look's, OF `look.tree`: its band and its
 * `ofKeyboard` set are that tree's, and a node of another tree is never the keyboard's by identity.
 */
function configuredStrategy(d: KeyboardDismissal): DismissalStrategy {
  return {
    name: describeDismissal(d),
    origin: 'configured',
    async choose({ look, screen, ambiguous }) {
      const { tree, reading: keyboard } = look;
      if (d.kind === 'accessory') {
        const button = accessoryDismissButton(tree);
        if (button === undefined) return { skipped: 'no accessory toolbar on screen' };
        return { kind: 'tap', what: `the accessory toolbar's ${button.label === null ? 'button' : JSON.stringify(button.label)}`, at: tapPoint(button) };
      }
      const matches = findTarget(tree, d.target).filter((n) => rectArea(n.rect) > 0);
      const neutral = matches.filter((n) => !isInteractive(n));
      if (neutral.length === 0) {
        return {
          skipped:
            matches.length === 0
              ? 'not found'
              : `only interactive ${matches.length === 1 ? 'match' : 'matches'} (${matches.map((n) => n.role).join(', ')}) — a dismissal must be a non-interactive element`,
        };
      }
      if (neutral.length > 1 && ambiguous === 'refuse') return { skipped: `${neutral.length} matches` };
      const node = neutral[0];
      if (keyboard.ofKeyboard(node)) return { skipped: "the keyboard's own control" };
      if ((await keyboard.frameOver(tapPoint(node))).kind === 'covered') return { skipped: 'under the keyboard' };
      const unusable = whyNotTapped(await tapStandings(look, node, screen).full(), node);
      if (unusable !== undefined) return { skipped: unusable };
      return { kind: 'tap', what: neutral.length > 1 ? `${describeTarget(d.target)} (${neutral.length} matches, the first)` : describeTarget(d.target), at: tapPoint(node) };
    },
  };
}

/**
 * Why a tap standing rules a dismissal out, as its skip line says it, or undefined when it lands on the dismissal's
 * centre, unmoved, with nothing there it would press. A tap that would move to an uncovered piece is no dismissal:
 * the configured element's centre is what was configured, so it is skipped naming the cover over the centre. A centre
 * the tap reaches but an INTERACTIVE node listed after the candidate holds — one the `target` column excused as no
 * cover (`StandingFacts.centreExcused`: a labelled control of exactly its frame, its own unlabelled control or a field
 * over its label, a row of a scroll view it is not in, a keyboard-owned control outside the band) — is skipped naming
 * that node, the last such (drawn on top): the tap would press it, and on the post-fill `dismiss()` path a pressed
 * control would be reported as the dismissal. A silently pressed control is worse than a skipped title (ADR 0016). A
 * candidate beneath a presented layer the tree marks (an alert) is skipped in the tap's words for it
 * (ui-tree/standing.ts#presentedRemedy: the alert named, close it first), whatever else keeps it from a tap.
 */
function whyNotTapped(standing: TapStanding, node: UiNode): string | undefined {
  // Beneath a presented layer the tree marks (an alert), whatever the kind: the alert's words, as the tap refuses it.
  if (standing.kind !== 'reachable' && standing.remedy.of === 'presented' && standing.remedy.layer !== undefined) return presentedRemedy('it', standing.remedy.layer);
  switch (standing.kind) {
    case 'reachable': {
      if (standing.moved !== undefined) return `covered by ${coverName(standing.moved.cover)}`;
      const presses = standing.facts.centreExcused.filter(isInteractive).at(-1);
      return presses === undefined ? undefined : `covered by ${coverName(presses)}`;
    }
    case 'offScreen':
      if (outsideItsScrollView(standing)) return `${outsideScrollViewText(standing.scroller)} at (${standing.at.x},${standing.at.y})`;
      return `off screen at (${standing.at.x},${standing.at.y})`;
    case 'systemBar':
      return `off screen at (${standing.at.x},${standing.at.y})`;
    case 'covered':
      return `covered by ${coverName(standing.cover)}`;
    case 'cut':
      return cutSliverText(standing.cut, node.rect, standing.minPiece);
    case 'underKeyboard':
      return 'under the keyboard';
    default: {
      // A kind added to the tap's standing must be worded here: falling
      // through would read as "nothing in the way", and the picker would tap.
      const unworded: never = standing;
      return unworded;
    }
  }
}

// ─── Averi's own fallbacks ────────────────────────────────────────────────────

/**
 * Half the side of the square around a blank point that must hold nothing but bare wrappers: 8 pt — a tap is exact
 * on the simulator, so the margin is against a frame's rounding and a control's touch padding, not a finger; and the
 * step between the points tried, so no gap wider than the square is missed.
 */
export const BLANK_MARGIN = 8;

/** How far from the screen's left and right edges a blank point keeps: 24 pt, clear of where iOS starts its edge gestures (the back swipe) — a drag that began there could be read as one. */
export const SCREEN_EDGE = 24;

/** How long the fallback's drag takes: slow enough not to fling (interact/scroll-rounds.ts measured a 300-ms stroke flinging a SwiftUI form 729–970 pt), the drag's length read as a scroll. */
export const DRAG_MS = 500;

/** How far the fallback's drag moves, in points: the 120-pt drag measured to hide the keyboard on the Contacts form (ADR 0022), far past a tap's slop and a fraction of a screen of scroll. */
export const DRAG_LENGTH = 120;

/** A tap on a blank point of the target's scroll view (`blankPoint`). */
const BLANK_TAP: DismissalStrategy = {
  name: 'a blank point',
  origin: 'fallback',
  async choose(ground) {
    const found = await blankPoint(ground, 'top');
    return 'skipped' in found ? found : { kind: 'tap', what: "a blank point of the target's scroll view", at: found.at };
  },
};

/** The target's scroll view dragged up DRAG_LENGTH from its blank point nearest the keyboard, kept inside the area the point was sought in (never past the status band). */
const BLANK_DRAG: DismissalStrategy = {
  name: 'a drag',
  origin: 'fallback',
  async choose(ground) {
    const found = await blankPoint(ground, 'bottom');
    if ('skipped' in found) return { skipped: 'no blank point to drag from' };
    if (scrollAxis(found.scroller, ground.look.tree.unclippedFrames === true) === 'horizontal') return { skipped: 'the target\'s scroll view scrolls sideways' };
    const to = { x: found.at.x, y: Math.max(found.at.y - DRAG_LENGTH, found.top) };
    if (found.at.y - to.y < 2 * BLANK_MARGIN) return { skipped: 'no room to drag above the keyboard' };
    return { kind: 'drag', what: "the target's scroll view", from: found.at, to };
  },
};

/** A blank point found: where, in which scroll view, and the top of the area it was sought in (the status band's bottom, or the scroll view's top below it). */
interface BlankPoint {
  readonly at: Point;
  readonly scroller: UiNode;
  readonly top: number;
}

/**
 * THE BLANK POINT: a point of the guarded target's nearest scroll view — the surface the target lies on, so on the
 * target's own layer: never a scrim, a sheet's backdrop or a bar, whose taps do things — where nothing but bare
 * wrappers lie in the BLANK_MARGIN square around it. Sought only when the target's own tap standing is `reachable`
 * (nothing but the keyboard over it: under WDA the band's line is witnessed, and the standing refuses nothing for it),
 * in the part of the scroll view on the screen, below the status band, above the keyboard's top and SCREEN_EDGE in from
 * its sides, row by row from the
 * top (the tap's: far from the field being edited) or from the bottom (the drag's: room above it), and, in a row, from
 * the middle outward.
 *
 * A node in the square lets the point be when it is the scroll view or one of its ancestors (they hold the point), a
 * hidden subtree's (WDA's `isVisible="0"` subtree, drawn nowhere: adapters/types.ts#UiNode.hidden), the keyboard's own
 * (its Windows are screen-sized; the band is below the area anyway), or a BARE wrapper — a structural role
 * (`STRUCTURAL_ROLES`) with no label, identifier or value — that has children (what it carries is judged by itself) or
 * lies inside the scroll view (a spacer of its content). Anything else stops it: a control, a text, an image, a nested
 * scroll view, a scroll indicator (labelled), an identified view (an RN `testID`, a navigation bar), and a bare LEAF
 * outside the scroll view — a dimming view or a decoration drawn over it.
 *
 * What it cannot see: a gesture recogniser on a bare wrapper (ADR 0016's residual for the picker, the same here). The
 * tap is still no press of anything the tree lists, and the reply names the point.
 */
async function blankPoint({ look, screen, target }: DismissalGround, from: 'top' | 'bottom'): Promise<BlankPoint | { readonly skipped: string }> {
  if (target === undefined) return { skipped: 'no target to find it by' };
  const path = pathTo(look.tree, target);
  let at = -1;
  path?.forEach((n, i) => {
    if (n !== target && scrolls(n)) at = i;
  });
  if (path === undefined || at < 0) return { skipped: 'no scroll view holds the target' };
  const scroller = path[at];
  const standing = await tapStandings(look, target, screen).full();
  if (standing.kind !== 'reachable') return { skipped: `the target cannot be tapped where it stands (${whyNotTapped(standing, target) ?? standing.kind})` };
  const box = screen?.box ?? screenOf(look.tree);
  const top = Math.max(box.y, screen?.statusBand ?? box.y);
  const cover = await look.reading.cover();
  const area = rectIntersection(scroller.rect, {
    x: box.x + SCREEN_EDGE,
    y: top,
    width: box.width - 2 * SCREEN_EDGE,
    height: Math.min(box.y + box.height, cover?.top.y ?? Infinity) - top,
  });
  if (area === undefined) return { skipped: 'none of the target\'s scroll view lies above the keyboard' };
  const holds = new Set(path.slice(0, at + 1));
  const inside = new Set(everyNode(scroller));
  const blockers: Rect[] = [];
  const walk = (n: UiNode): void => {
    if (n.hidden === true || look.reading.ofKeyboard(n)) return;
    const bare = STRUCTURAL_ROLES.has(n.role) && !n.label && !n.identifier && !n.value;
    if (!holds.has(n) && rectArea(n.rect) > 0 && !(bare && (n.children.length > 0 || inside.has(n)))) blockers.push(n.rect);
    for (const c of n.children) walk(c);
  };
  walk(look.tree);
  const clear = (p: Point): boolean => {
    const square = { x: p.x - BLANK_MARGIN, y: p.y - BLANK_MARGIN, width: 2 * BLANK_MARGIN, height: 2 * BLANK_MARGIN };
    return blockers.every((r) => rectIntersection(r, square) === undefined);
  };
  const bottom = area.y + area.height;
  const middle = Math.round(area.x + area.width / 2);
  const columns: number[] = [middle];
  for (let d = BLANK_MARGIN; middle - d >= area.x + BLANK_MARGIN || middle + d <= area.x + area.width - BLANK_MARGIN; d += BLANK_MARGIN) {
    if (middle - d >= area.x + BLANK_MARGIN) columns.push(middle - d);
    if (middle + d <= area.x + area.width - BLANK_MARGIN) columns.push(middle + d);
  }
  const rows: number[] = [];
  for (let y = area.y + BLANK_MARGIN; y <= bottom - BLANK_MARGIN; y += BLANK_MARGIN) rows.push(y);
  if (from === 'bottom') rows.reverse();
  for (const y of rows) for (const x of columns) if (clear({ x, y })) return { at: { x, y }, scroller, top: area.y };
  return { skipped: 'none in the target\'s scroll view above the keyboard' };
}

/** The nodes from `root` down to `node`, both included, by identity; undefined when `node` is not in the tree. */
function pathTo(root: UiNode, node: UiNode): UiNode[] | undefined {
  if (root === node) return [root];
  for (const c of root.children) {
    const below = pathTo(c, node);
    if (below !== undefined) return [root, ...below];
  }
  return undefined;
}
