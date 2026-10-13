import type { DeviceAdapter, Point, Rect, UiNode } from '../adapters/types.js';
import { drawnOverText, rectText, type Cut } from '../ui-tree/geometry.js';
import type { KeyboardLine, KeyboardPosition } from '../ui-tree/keyboard-position.js';
import type { Scene, SystemBar, TapStanding } from '../ui-tree/standing.js';
import { pinnedUnder, underSystemBar } from '../ui-tree/system-bar.js';
import { treeScreen, usableScreen, type UsableScreen } from '../ui-tree/usable-screen.js';
import { cannotHide, type KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { describeTarget, type RefusedOnPresentElement, type Target } from './resolve.js';
import { cutRemedy, cutSliverText } from './target-text.js';

/**
 * THE tap judgement of a resolved node — the rule every tap on one shares,
 * applied by keyboard.ts#resolveClearOfKeyboard (behind `tapElement`, the
 * flow `tap:` step and the MCP `tap` tool, and `fillField`'s focus tap), one
 * `judgeTap` per look: where the node stands for a tap is the scene's
 * (ui-tree/standing.ts#Scene.standing, `{ of: 'tap' }`), and what the tap
 * does about each kind of standing is ONE switch (`tapOutcome`): on the
 * screen, then cut, cover, keyboard.
 *
 * ON THE SCREEN — applied at once, by `judgeTap`, before the keyboard guard
 * acts (so a target below the fold costs no `back` and no dismissal tap),
 * and again of the node a guard that acted hands back. A point off the
 * screen or under a system bar is refused (OffScreenRefusal). Judged on the
 * tap POINT, not the rect: a node whose centre is on screen passes, however
 * much of it is clipped — by THIS rule: one cut to a sliver by its scroll
 * container is refused after the guard (`cut`, below). A node partly on
 * screen with its centre off is REFUSED, not tapped at the centre of its
 * visible part: the smallest change that makes the reply true. Moving the
 * point would change what the keyboard guard judged (it tests the centre),
 * and the visible part of such a node is a sliver at a screen edge — on iOS
 * the bottom one is the home indicator's gesture zone, the top the status
 * bar — where a tap is least likely to reach the element. Its remedy is
 * `scroll_until … fully: true`; a plain `scroll_until` stops only with the
 * centre on the screen too (the standing's one rule), so either agrees with
 * this rule.
 * Before refusing, the device's screen is read AGAIN (`usableScreen`'s
 * `fresh`, once, on this path only — the clear path costs nothing new): the
 * adapter memoizes the size for the session, and a fold, an unfold or a `wm
 * size` change would otherwise refuse taps for the server's life (the same
 * re-read verify/capture.ts makes before refusing a window as wider than the
 * screen). The refusal names the size read again when it differs from the
 * first. A point on the screen but inside a system band is refused in that
 * bar's own words (`underSystemBar`, and `systemBarRemedy`: scroll it out
 * only where it can be) — "off screen" would contradict a rect the reader
 * sees on it.
 *
 * CLEAR OF THE APP'S CHROME AND THE KEYBOARD — `TapJudge.aim`, applied LAST,
 * to the look the guard hands back (or the first look, when the guard let
 * the tap through), so neither the on-screen rule's judgement nor the
 * guard's changes: both are of the centre, and the centre is what is tapped
 * unless something is drawn over it. A ClippedRefusal for a target its
 * scroll container cuts to a sliver (`cutFinding`); its centre, unless a
 * node of the tree is drawn over it there — then the centre of the largest
 * piece of it nothing is drawn over, when both its sides reach the minimum
 * (ui-tree/draw-order.ts#exposure, its rows and MIN_TAP_PIECE_FRACTION),
 * said in `moved`; else a CoveredRefusal naming the cover. Judged in the
 * screen box that holds the centre, less the system bands, so a moved tap
 * never lands on the status bar or the navigation bar (the tree's root rect,
 * or the node's own, when there is no screen — fail open, as there).
 * The keyboard line comes in two parts (`tapStandings`, over the look's
 * ui-tree/keyboard-position.ts#KeyboardPosition, which merges them):
 * - the tree's own — idb's band — free, so the on-screen rule already asked
 *   with it; a centre under it is `underKeyboard`, refused with the
 *   keyboard's remedy (the reading's) —
 *   docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 * - a reading's (the top of a cover the input method stands by, or WDA's
 *   band) — the soft keyboard is no cover node (Android lists none, and a
 *   band is believed only with its input method's word), so it is asked for
 *   ONLY when the centre is covered and the target is not cut, and the
 *   standing asked again with the merged line: a piece under the keyboard is
 *   never aimed at. Its cost is the reading's, on that path only (on Android
 *   the touchable region and the witness, with the keyboard shown; nothing
 *   more with it hidden — the guard's reading of the look is reused).
 * A key of idb's band is the keyboard's own UI and under no band line; a
 * WDA key is exempt from the reading's questions, not from its line
 * (ui-tree/keyboard-position.ts's residual).
 * docs/adr/0007-idb-keyboard-key-row-tiling.md
 * Only nodes of the tree cover: a top bar the tree lists before the form —
 * WDA's, idb's (only its button and title) — is not inferred, so a row
 * scrolled up under it is tapped at its centre (the status bar is off the
 * screen, above). The other way round — BackButton and the title under
 * idb's flat list — is chrome before content (ui-tree/draw-order.ts's
 * `flatListChrome` row).
 * docs/adr/0004-flat-list-chrome-before-content.md
 *
 * `sent`, when the keyboard guard acted before this look — `back was
 * pressed …`, `id:"login_title" was tapped …` (`Hiding.sent`) — fronts every
 * refusal's headline: the target was not tapped, but something was.
 *
 * Its interface: `judgeTap` (and its `TapJudge`), `tapStandings` (the
 * dismissal picker asks it too, keyboard-in-tree.ts#pickDismissal), the
 * three refusals, `Aim` and `movedTapText`. What it judges is found and
 * settled by resolve.ts; the cut and side phrases it shares with
 * `scroll_until` and the picker are target-text.ts's.
 */

// ─── The refusals ────────────────────────────────────────────────────────────

/** The base of the tap rules' refusals on a resolved node — each carries the marker (RefusedOnPresentElement). */
class PresentElementRefusal extends Error implements RefusedOnPresentElement {
  readonly refusedOnPresentElement = true;
}

/**
 * The target resolved and settled, but the point a tap on it would press —
 * its centre, `tapPoint` — lies outside the screen. Measured on
 * iOS 27 (idb, 402×874 pt): the tree lists a scroll view's content below the
 * fold with its real rects (y 885, y 1157), the tap went to (94,895), landed
 * nowhere, and the reply said "Tapped" — the next `type_text` typed into the
 * field that still had focus. The target itself is never tapped.
 * docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md
 *
 * A class of its own, like AmbiguityRefusal, because it is neither of the
 * wait's failures: the element WAS found (never ElementNotFoundError — an
 * `optional:` tap of it is not skipped: it fails the flow,
 * see PresentElementRefusal), and nothing is moving. The remedy is in the
 * message: scroll it in first. When the keyboard guard had already sent
 * something (a `back`, a dismissal tap), the HEADLINE says what — the one
 * line the step's ✗ quotes.
 */
export class OffScreenRefusal extends PresentElementRefusal {}

/**
 * The target resolved, settled, lies on screen and clear of the soft
 * keyboard, but the point a tap on it would press — its centre — lies under
 * a node drawn over it, and no piece of it large enough to aim at shows.
 * Measured on mp-native's SWIFT form, both iOS tree sources:
 * `priority_select` at `24,771 354x52`, its centre (201,797) on the pinned
 * CONTINUE bar `24,780 354x44`; "Tapped" pressed the (disabled) bar, and an
 * enabled one would have submitted the payment form. Nothing is tapped.
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md
 *
 * A class of its own, like OffScreenRefusal and for its reasons: the element
 * WAS found (an `optional:` tap of it fails the flow, never skipped — see
 * PresentElementRefusal), nothing is moving, and the remedy is in the message —
 * `scroll_until` it, which keeps scrolling until the centre is clear
 * (ui-tree/standing.ts#Scene.standing). When the keyboard guard
 * had already sent something, the HEADLINE says what.
 */
export class CoveredRefusal extends PresentElementRefusal {}

/**
 * The target resolved, settled, lies on screen, but it is CUT to a sliver by
 * its scroll container's edge: refused (ADR 0013). Measured on
 * mp-native's SWIFT form (Android): the "Payment details" toggle, 132 px
 * tall, read `66,1924 948x55` at the form's bottom edge (1978); the tap went to (540,1952), "Tapped" was reported, and
 * the section did not expand — nor for hand taps on the strip. Nothing is
 * tapped. The covered sliver's sibling (CoveredRefusal): what shows is cut
 * by a clip, not by a node drawn over it, and refused by the same minimum.
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md
 */
export class ClippedRefusal extends PresentElementRefusal {}

// ─── The judgement of a look ─────────────────────────────────────────────────

/** One resolved node on one read, with that read's scene — the look the tap judges (`judgeTap`). */
export interface TapLook {
  readonly node: UiNode;
  readonly tree: UiNode;
  readonly scene: Scene;
}

/**
 * The tap's two standings of a node on one screen (ui-tree/standing.ts
 * #Scene.standing, `{ of: 'tap' }`):
 * - `first`, judged with the tree's own keyboard line (idb's band,
 *   `KeyboardPosition.line` with no reading) — free, no device asked;
 *   derived on first use;
 * - `full()`, judged with the reading's line merged in
 *   (`KeyboardPosition.readingLine`, asked once per position) — `first`
 *   itself when the merge changes no line (the same `y` and `witnessed`).
 * The one expression of "the tap's standing with the reading's line": the
 * tap asks `full()` only when its centre is covered (`judgeTap`), the
 * dismissal picker always (keyboard-in-tree.ts#pickDismissal).
 */
export interface TapStandings {
  readonly first: TapStanding;
  full(): Promise<TapStanding>;
}

/** The tap's two standings of `node` (`TapStandings`) on `screen`, its keyboard line `keyboard`'s. */
export function tapStandings(scene: Scene, node: UiNode, screen: UsableScreen | undefined, keyboard: KeyboardPosition): TapStandings {
  const own = keyboard.line(node);
  const judged = (line: KeyboardLine | undefined): TapStanding => scene.standing(node, screen, { of: 'tap', ...(line !== undefined && { keyboardTop: line }) });
  let first: TapStanding | undefined;
  const firstOf = (): TapStanding => (first ??= judged(own));
  return {
    get first() {
      return firstOf();
    },
    async full() {
      const line = keyboard.line(node, await keyboard.readingLine());
      return line?.y === own?.y && line?.witnessed === own?.witnessed ? firstOf() : judged(line);
    },
  };
}

/** A look the on-screen rule let through: the screen it was judged on (the first look's, or the one read again), and the rest of the judgement. */
export interface TapJudge {
  readonly screen: UsableScreen | undefined;
  /** Where the tap goes (`Aim`), or a ClippedRefusal / CoveredRefusal; asks the reading's line only for a covered centre of a target not cut. */
  aim(): Promise<Aim>;
}

/** Where a tap on a resolved node goes: its centre, or — `moved`, the sentence saying why — the centre of an uncovered piece of it. */
export interface Aim {
  point: Point;
  /** `at (201,767) — its centre (201,780) is under button "Continue to summary" (24,780 354x44), drawn over it; tapped the uncovered part 354x26`. */
  moved?: string;
}

/**
 * The flow trace's line for a tap that `Aim.moved`: `<what> tapped at
 * (201,767) — its centre …` — beside the clause it completes, so the clause
 * and its subject are worded in one place (the fill's
 * focus tap says it as `focus tap …`, interact/fill-text.ts#focusTapNote,
 * and the MCP reply as `Tapped <selector> …`, mcp/tool-text.ts#tapText).
 */
export const movedTapText = (what: string, moved: string): string => `${what} tapped ${moved}`;

/** The standings the on-screen rule refuses: a centre off the screen, or under a system bar. */
type OffTheScreen = Extract<TapStanding, { kind: 'offScreen' | 'systemBar' }>;
const offTheScreen = (s: TapStanding): s is OffTheScreen => s.kind === 'offScreen' || s.kind === 'systemBar';

/**
 * THE tap judgement of a look (the module's doc): the on-screen rule now —
 * an OffScreenRefusal, after one fresh read of the screen, for a point off
 * it or under a system bar — and the rest (`TapJudge.aim`) when the caller
 * asks, after the keyboard guard. `look.tree` is the read that holds
 * `look.node`: the system-bar remedy looks the node up in it.
 */
export async function judgeTap(
  adapter: Pick<DeviceAdapter, 'viewport'>,
  target: Target,
  look: TapLook,
  screen: UsableScreen | undefined,
  keyboard: { readonly position: KeyboardPosition; readonly remedy: KeyboardRemedy },
  sent?: string,
): Promise<TapJudge> {
  const { node, tree, scene } = look;
  const what = describeTarget(target);
  const told: Told = { node, scene, remedy: keyboard.remedy, refusal: (finding: string): string => (sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`) };
  const judge = (on: UsableScreen | undefined, standings: TapStandings): TapJudge => ({
    screen: on,
    async aim() {
      const { first } = standings;
      // The reading's line only for a covered centre of a target on the screen and not cut.
      const standing = !offTheScreen(first) && first.kind !== 'cut' && first.facts.centreCover !== undefined ? await standings.full() : first;
      return tapOutcome(standing, told, () => ({ judged: on ?? treeScreen(tree) }));
    },
  });
  const first = tapStandings(scene, node, screen, keyboard.position);
  const firstStanding = first.first;
  if (!offTheScreen(firstStanding)) return judge(screen, first);
  const again = await usableScreen(adapter, { tree }, { fresh: true });
  const second = tapStandings(scene, node, again, keyboard.position);
  const secondStanding = second.first;
  if (!offTheScreen(secondStanding)) return judge(again, second);
  // Refused on the screen read again; on the first look's when none could be read again.
  const [judged, refused] = again === undefined && screen !== undefined ? [screen, firstStanding] : [again ?? treeScreen(tree), secondStanding];
  const reread =
    again !== undefined && screen !== undefined && (again.box.width !== screen.box.width || again.box.height !== screen.box.height)
      ? ` (read again before refusing; it was ${screen.box.width}x${screen.box.height})`
      : '';
  throw offScreenRefusal(refused, told, { judged, reread });
}

// ─── The outcome of a standing ───────────────────────────────────────────────

/** What every outcome of a tap is told of the look: the node and its scene, the keyboard's remedy, and the refusal's headline (with `sent`). */
interface Told {
  readonly node: UiNode;
  readonly scene: Scene;
  readonly remedy: KeyboardRemedy;
  readonly refusal: (finding: string) => string;
}

/** What only an off-screen refusal is told: the screen it was judged on, and — `reread` — the clause saying that screen was read again before refusing and differed. */
interface JudgedScreen {
  readonly judged: UsableScreen;
  readonly reread?: string;
}

/**
 * THE switch — what a tap does on each kind of standing (the module's
 * doc): the point it goes to (`Aim`), or the refusal it throws. One
 * exhaustive switch over `TapStanding`: a new kind fails to compile here.
 * `judgeTap` acts on the first row itself, before the guard; every other
 * row is `TapJudge.aim`'s, after it. `judgedScreen` is asked on the first
 * row only — which `aim` never reaches at runtime — its standing passed the
 * on-screen rule, and `full()` changes only the keyboard line — only the
 * type admits it.
 */
function tapOutcome(standing: TapStanding, told: Told, judgedScreen: () => JudgedScreen): Aim {
  const { centre } = standing.facts;
  switch (standing.kind) {
    case 'offScreen':
    case 'systemBar':
      throw offScreenRefusal(standing, told, judgedScreen());
    case 'cut':
      throw new ClippedRefusal(told.refusal(cutFinding(standing.cut, told.node.rect, standing.minPiece)));
    case 'reachable': {
      if (standing.moved === undefined) return { point: standing.at };
      const { at: point, moved } = standing;
      const above = moved.aboveKeyboard ? ' above the soft keyboard' : '';
      return {
        point,
        moved: `at (${point.x},${point.y}) — its centre (${centre.x},${centre.y}) is ${drawnOverText(moved.cover)}; tapped the uncovered part ${moved.piece.width}x${moved.piece.height}${above}`,
      };
    }
    case 'covered': {
      const above = standing.aboveKeyboard ? ' above the soft keyboard' : '';
      const minPiece = standing.facts.minPiece;
      const shows =
        standing.largest === undefined
          ? `nothing of it shows${above}`
          : `only a ${standing.largest.width}x${standing.largest.height} part of it shows${above}, under the ${minPiece}x${minPiece} a tap may be moved to`;
      throw new CoveredRefusal(told.refusal(`${drawnOverText(standing.cover, centre)}; ${shows} — scroll_until it first`));
    }
    case 'underKeyboard':
      throw new CoveredRefusal(
        told.refusal(
          `under the soft keyboard: its centre (${centre.x},${centre.y}) lies below the keyboard's top edge at y ${standing.line.y}, where a tap presses the keyboard — ` +
            `scroll_until it first, or ${hideIt(told.remedy)}`,
        ),
      );
    default: {
      const unhandled: never = standing;
      return unhandled;
    }
  }
}

/** The on-screen rule's refusal of a centre off the screen or under a system bar (the module's doc). */
function offScreenRefusal(standing: OffTheScreen, { node, scene, refusal }: Told, { judged, reread = '' }: JudgedScreen): OffScreenRefusal {
  if (standing.kind === 'systemBar') {
    return new OffScreenRefusal(refusal(`${underSystemBar(standing.at, standing.bar)} (rect ${rectText(node.rect)}) — ${systemBarRemedy(standing.bar.edge, scene.clips.inScroller(node))}`));
  }
  const { at, visible } = standing;
  const size = `${judged.box.width}x${judged.box.height}`;
  const where = `at (${at.x},${at.y}) on a ${size} screen${judged.boxes.length > 1 ? ' either way up' : ''}${reread}`;
  const part =
    visible > 0
      ? ` — only ${Math.round(visible * 100)}% of it (rect ${rectText(node.rect)}) is on screen, and a tap goes to its centre — scroll_until it with fully: true first`
      : ` (rect ${rectText(node.rect)}) — scroll_until it first`;
  return new OffScreenRefusal(refusal(`off screen ${where}${part}`));
}

/**
 * What to do about a target whose centre lies under a system bar (the bar
 * at `edge`), said as far as the tree knows it: the refusal had said
 * `scroll_until it first` of a button pinned at the top, which no scroll
 * moves. In a scroll view (`scrolls`, ui-tree/geometry.ts#Clips.inScroller),
 * `scroll_until` moves it out from under the bar; in none, it is pinned
 * there — a layout that does not keep clear of the bar — and no step
 * reaches it; where the tree cannot say (idb's flat list), both. The
 * refusal stays a refusal either way — the safe direction, and terminal in
 * an `optional:` step (flow/engine.ts). Cost, on the refusal path only:
 * `Clips.inScroller`'s one walk of the tree (ui-tree/geometry.ts#clipsOf's
 * own walk is every tap's: its standing asks the cut first).
 */
function systemBarRemedy(edge: SystemBar['edge'], scrolls: boolean | undefined): string {
  const pinned = `no scroll moves it out: ${pinnedUnder(edge)} — fix the layout, or tap something else`;
  if (scrolls === true) return 'it lies in a scroll view — scroll_until it first, to move it out from under the bar';
  if (scrolls === false) return `it lies in no scroll view, so ${pinned}`;
  return `if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, ${pinned}`;
}

/** The way past a cut the node's own content evidences, should it only READ cut (geometry.ts#evidentCut's residual). */
const OWN_CUT_WAY_PAST = 'if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates';
/** The way past a cut inherited from what the node lies in (`Cut.within`): the evidence is that ancestor's, so its "whole" case is that ancestor's. */
const INHERITED_CUT_WAY_PAST =
  'if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates';

/**
 * The tap's finding for a node cut to a sliver (`cut`, of a node whose rect
 * is `shown`, under `minPiece`), its remedy and its way past — the refusal
 * of a node cut to a sliver (ui-tree/standing.ts#Scene.standing's `cut`;
 * geometry.ts#Clips.cutSliver owns what counts as cut, and
 * draw-order.ts#MIN_TAP_PIECE_FRACTION the minimum). A sliver also
 * covered is refused for its cut, whose remedy names the edge.
 * docs/adr/0005-cut-before-cover.md
 *
 * The remedy is a plain `scroll_until` toward that edge (`cutRemedy`): its
 * plain stop does not stop on such a sliver either, and its default
 * direction is down, so a cut at the bottom needs no direction and the
 * others name theirs — and, for the node that only READS cut
 * (geometry.ts#evidentCut's residual: whole, its own content running to the
 * edge), the way past it: a child, or a coordinate tap — a child that lies
 * CLEAR of that edge: one flush with it inside a sliver cut there is refused
 * too (geometry.ts#Clips.cutSliver's inherited cut, `Cut.within`; measured:
 * the toggle's leaf label "Payment details", tapped as a child, did
 * nothing) — whose own way past names what it lies in:
 * something in THAT clear of the edge. Only nodes under a clipping ancestor
 * (UiNode.clipsDescendants, Android's) are cut: an iOS tree has none, so
 * this never refuses there.
 */
const cutFinding = (cut: Cut, shown: Rect, minPiece: number): string =>
  `${cutSliverText(cut, shown, minPiece)} — ${cutRemedy(cut.edge)} (${cut.within === undefined ? OWN_CUT_WAY_PAST : INHERITED_CUT_WAY_PAST})`;

/**
 * How to hide a keyboard a tap refused a centre under: only a line no guard
 * acts on is refused (`underKeyboard`), idb's band, whose adapter has no
 * key that hides it (`KeyboardRemedy.dismissal` is `none`) — so the way is a
 * tap the author adds, and the adapter's `advice`.
 */
const hideIt = ({ advice }: KeyboardRemedy): string => `hide the keyboard (tap a neutral element such as the screen title — a tap: step in a flow); ${cannotHide(advice)}`;
