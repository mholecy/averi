import { rectArea, STRUCTURAL_ROLES, type DeviceAdapter, type Point, type Rect, type UiNode } from '../adapters/types.js';
import { coverText, nodeText, outsideScrollViewText, rectText, type Cut } from '../ui-tree/geometry.js';
import type { KeyboardLine } from '../ui-tree/keyboard-position.js';
import { judgedWithOrder, type OrderEyes } from '../ui-tree/eyes.js';
import type { Look, LookReading } from '../ui-tree/look.js';
import type { KeyboardReading } from '../ui-tree/keyboard-cover.js';
import { isInteractive } from '../ui-tree/selectors.js';
import { coverClause } from '../ui-tree/cover.js';
import { outsideItsScrollView, orderRemedyText, presentedRemedy, type Remedy, type Scene, type ScrollableRemedy, type SystemBar, type TapStanding } from '../ui-tree/standing.js';
import { pinnedUnder, underSystemBar } from '../ui-tree/system-bar.js';
import { treeScreen, usableScreen, type UsableScreen } from '../ui-tree/usable-screen.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { describeTarget, type RefusedOnPresentElement, type Target } from './resolve.js';
import type { SeenLook } from './keyboard-model.js';
import { cutByRemedy, cutRemedy, cutSliverText, hideClause, hideKeyboardHow, underKeyboardText, type KeyboardUp } from './target-text.js';

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
 * OUTSIDE ITS SCROLL VIEW — a centre on the screen that its scroll view
 * draws nothing at (ui-tree/standing.ts, the drawn frame: WDA lists a scroll
 * view's content at its laid-out rect past the scroll view's frame) is
 * refused as at the screen's edge, naming the scroll view, with the same
 * remedies (OffScreenRefusal) — but AFTER the guard, by `TapJudge.aim`, with
 * no fresh read of the screen: a scroll view laid out above the keyboard
 * (React Native's keyboard-avoiding view, MyPort's login `ScrollView` ending
 * at the band's top) grows back once the guard hides it, and the target is
 * judged again on the look the guard hands back. Measured: the at-rest SWIFT
 * form's `payee_name_input` `24,801 354x52`, below its form's `0,0
 * 402x780`, was reported tapped at (201,827), 3 pt below CONTINUE on the
 * bare background.
 *
 * CLEAR OF THE APP'S CHROME AND THE KEYBOARD — `TapJudge.aim`, applied LAST,
 * to the look the guard hands back (or the first look, when the guard let
 * the tap through), so neither the on-screen rule's judgement nor the
 * guard's changes: both are of the centre, and the centre is what is tapped
 * unless something is drawn over it. A ClippedRefusal for a target its
 * scroll container cuts to a sliver (`cutAdvice`); its centre, unless a
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
 * dismissal picker asks it too, keyboard-dismissal.ts#configuredStrategy), the
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
 * Or cut by a node drawn AFTER it (geometry.ts#Cut.by: Compose leaves out of
 * a node's bounds what a later node covers): the lab's `note` after `back`,
 * dumped `55,2126 970x14` under Continue, was tapped at y 2133 and reached
 * only because that bar lets touches through — refused naming that node,
 * the remedy `cutByRemedy`'s (target-text.ts).
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md
 */
export class ClippedRefusal extends PresentElementRefusal {}

// ─── The judgement of a look ─────────────────────────────────────────────────

/** One resolved node on one read, with that read's look (ui-tree/look.ts#Look: its scene, its keyboard reading and position) — what the tap judges (`judgeTap`): a SeenLook's two fields, its look's reading only what the judgement asks (`TapReading`), so a table test builds one without the settle loop or an adapter. */
export interface TapLook extends Pick<SeenLook, 'node'> {
  readonly look: Look<TapReading>;
}

/** What the tap's judgement asks of a look's reading: what its keyboard position asks (the reading's line), and the remedy its refusals say. */
export type TapReading = LookReading & Pick<KeyboardReading, 'remedy'>;

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
 * dismissal picker always (keyboard-dismissal.ts#configuredStrategy).
 */
export interface TapStandings {
  readonly first: TapStanding;
  full(): Promise<TapStanding>;
}

/** The tap's two standings of `node` (`TapStandings`) on `screen`, over `look`'s scene, its keyboard line the look's keyboard position's. */
export function tapStandings(look: Pick<Look, 'scene' | 'keyboard'>, node: UiNode, screen: UsableScreen | undefined): TapStandings {
  const { scene, keyboard } = look;
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

/**
 * What the tap's judgement may ask besides the look, and what it is told: `sent` — what the keyboard guard sent before
 * this look (`Hiding.sent`), which fronts every refusal; `eyes` — the eyes' order question (ui-tree/eyes.ts#Eyes.order,
 * the composition root's verify/eyes.ts#eyesOn), asked by `TapJudge.aim` once, only of a centre covered by a control the
 * listing does not order (`orderQuestion`). Without it the listing's untold order stands.
 */
export interface TapAsks {
  readonly sent?: string;
  readonly eyes?: OrderEyes;
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

/**
 * The standings the on-screen rule refuses: a centre off the screen, or under a system bar — not one on the screen but
 * outside what its scroll views draw (`offScreen` with a `scroller`), refused after the guard (`TapJudge.aim`): hiding
 * the keyboard may lay its scroll view out taller (the module's doc).
 */
type OffTheScreen = Extract<TapStanding, { kind: 'offScreen' | 'systemBar' }>;
const offTheScreen = (s: TapStanding): s is OffTheScreen => (s.kind === 'offScreen' || s.kind === 'systemBar') && !outsideItsScrollView(s);

/**
 * THE tap judgement of a look (the module's doc): the on-screen rule now —
 * an OffScreenRefusal, after one fresh read of the screen, for a point off
 * it or under a system bar — and the rest (`TapJudge.aim`) when the caller
 * asks, after the keyboard guard. `look.look` is the read that holds
 * `look.node`: the system-bar remedy looks the node up in its tree; the
 * keyboard's line is its position's, the refusals' remedy its reading's.
 */
export async function judgeTap(adapter: Pick<DeviceAdapter, 'viewport'>, target: Target, { node, look }: TapLook, screen: UsableScreen | undefined, { sent, eyes }: TapAsks = {}): Promise<TapJudge> {
  const { scene } = look;
  const what = describeTarget(target);
  const told: Told = { node, scene, remedy: look.reading.remedy, refusal: (finding: string): string => (sent === undefined ? `${what} is ${finding}; nothing was tapped` : `${what} was not tapped: after ${sent}, it is ${finding}`) };
  const judge = (on: UsableScreen | undefined, standings: TapStandings): TapJudge => ({
    screen: on,
    async aim() {
      // The reading's line only for a covered centre of a target on the screen and not cut.
      const judged = async ({ first, full }: TapStandings): Promise<TapStanding> => (!offTheScreen(first) && first.kind !== 'cut' && first.facts.centreCover !== undefined ? full() : first);
      // Covered by a control the listing does not order: the eyes, once, then judged again on the order they saw (ADR 0024).
      // judgedWithOrder judges `look` itself first — the untold look, whose standings are already built — and then, only
      // if it asked the eyes, a told look of the same tree, whose standings are built here.
      const standing = await judgedWithOrder(look, node, eyes, (onLook) => judged(onLook === look ? standings : tapStandings(onLook, node, on)));
      // A cut by a node drawn after it: whether the soft keyboard is up, which its remedy names (`cutByRemedy`) — the reading's line, asked on that path only.
      const line = standing.kind === 'cut' && standing.cut.by !== undefined ? await look.keyboard.readingLine() : undefined;
      const keyboard: KeyboardUp | undefined = line === undefined ? undefined : { lineY: line.y, remedy: look.reading.remedy };
      return tapOutcome(standing, told, () => ({ judged: on ?? treeScreen(look.tree) }), keyboard);
    },
  });
  const first = tapStandings(look, node, screen);
  const firstStanding = first.first;
  if (!offTheScreen(firstStanding)) return judge(screen, first);
  const again = await usableScreen(adapter, look, { fresh: true });
  const second = tapStandings(look, node, again);
  const secondStanding = second.first;
  if (!offTheScreen(secondStanding)) return judge(again, second);
  // Refused on the screen read again; on the first look's when none could be read again.
  const [judged, refused] = again === undefined && screen !== undefined ? [screen, firstStanding] : [again ?? treeScreen(look.tree), secondStanding];
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
 * type admits it. `keyboard`: the soft keyboard when it is up, asked by
 * `aim` only for a cut by a node drawn after it, whose remedy names it.
 */
function tapOutcome(standing: TapStanding, told: Told, judgedScreen: () => JudgedScreen, keyboard?: KeyboardUp): Aim {
  const { centre } = standing.facts;
  switch (standing.kind) {
    case 'offScreen':
    case 'systemBar':
      throw offScreenRefusal(standing, told, judgedScreen());
    case 'cut': {
      const cut = cutSliverText(standing.cut, told.node.rect, standing.minPiece, keyboard?.lineY);
      const by = standing.cut.by;
      throw new ClippedRefusal(told.refusal(`${cut} — ${advice(standing.remedy, () => (by === undefined ? cutAdvice(standing.cut) : cutByRemedy(by, keyboard, standing.minPiece)))}`));
    }
    case 'reachable': {
      if (standing.moved === undefined) return { point: standing.at };
      const { at: point, moved } = standing;
      const above = moved.aboveKeyboard ? ' above the soft keyboard' : '';
      return {
        point,
        moved: `at (${point.x},${point.y}) — its centre (${centre.x},${centre.y}) is ${coverClause(moved.cover, { of: 'touch' })}; tapped the uncovered part ${moved.piece.width}x${moved.piece.height}${above}`,
      };
    }
    case 'covered': {
      const above = standing.aboveKeyboard ? ' above the soft keyboard' : '';
      const minPiece = standing.facts.minPiece;
      // What shows less what a tap is never aimed at: the controls listed before it in reading order that overlap it.
      const clear = standing.clearOf === undefined ? '' : ` clear of ${standing.clearOf.map((n) => coverText(n)).join(' and ')}, listed before it in reading order`;
      const shows =
        standing.largest === undefined
          ? `nothing of it shows${above}${clear}`
          : `only a ${standing.largest.width}x${standing.largest.height} part of it shows${above}${clear}, under the ${minPiece}x${minPiece} a tap may be moved to`;
      // A scroll, refined for a wrapper that may only position its one child by the tap's own positioner hint — or, under
      // a cover whose order the tree does not tell, or one a screenshot saw drawn over it, no scroll.
      const remedy = advice(standing.remedy, (r) =>
        r.of === 'unordered' || r.of === 'seenOver' ? orderRemedyText(r, 'touch') : (positionerRemedy(standing.cover.node) ?? 'scroll_until it first'),
      );
      throw new CoveredRefusal(told.refusal(`${coverClause(standing.cover, { of: 'touch', centre })}; ${shows} — ${remedy}`));
    }
    case 'underKeyboard':
      // Its presented remedy is unreachable while idb's band — the only line no guard acts on — is found only in a flat
      // list, which holds no presented screen (ui-tree/presentation.ts#presentedOver, the shape adapter's: the holder is the root);
      // the type still lets this kind carry it, and the agreement rows (tests/interact/remedy-agreement.test.ts) pin
      // its rendering.
      throw new CoveredRefusal(
        told.refusal(`${underKeyboardText(centre, standing.line.y)}, where a tap presses the keyboard — ${advice(standing.remedy, () => `scroll_until it first, or ${hideIt(told.remedy)}`)}`),
      );
    default: {
      const unhandled: never = standing;
      return unhandled;
    }
  }
}

/** The most of a wrapper's area its one child may take and still count as SMALL for `positionerRemedy`: a quarter. */
const SMALL_CHILD_FRACTION = 0.25;

/**
 * The remedy for a target under a WRAPPER that may only position its one child: a structural node (`container`,
 * `other`) whose only child is a control (selectors.ts#isInteractive) of some area, at most `SMALL_CHILD_FRACTION` of its own —
 * Android's floating action button host (Clock's `fab_container` 1080x352 holding its 264x264 FAB, 18 % of it). Such a
 * wrapper still counts as drawn over its whole rect (draw-order.ts's `structural` row: the tree cannot tell it from a
 * tab bar's host that swallows touches), so the refusal stands; this says what to do instead of only scrolling. A host
 * of several children — a tab bar's — gets none. Undefined when the cover is no such wrapper.
 * The trade-off as the agent reads it: mcp/tools.ts, the `tap` description.
 */
function positionerRemedy(cover: UiNode): string | undefined {
  if (!STRUCTURAL_ROLES.has(cover.role) || cover.children.length !== 1) return undefined;
  const [child] = cover.children;
  const area = rectArea(child.rect);
  if (!isInteractive(child) || !(area > 0 && area <= rectArea(cover.rect) * SMALL_CHILD_FRACTION)) return undefined;
  return `the wrapper may only position its one child, ${nodeText(child)}: tap that child when it is the target; otherwise scroll_until this element out of the wrapper's band first`;
}

/** The on-screen rule's refusal of a centre off the screen or under a system bar (the module's doc). */
function offScreenRefusal(standing: OffTheScreen, { node, refusal }: Told, { judged, reread = '' }: JudgedScreen): OffScreenRefusal {
  if (standing.kind === 'systemBar') {
    const { edge } = standing.bar;
    return new OffScreenRefusal(refusal(`${underSystemBar(standing.at, standing.bar)} (rect ${rectText(node.rect)}) — ${advice(standing.remedy, (bar) => systemBarRemedy(edge, bar))}`));
  }
  const { at, visible } = standing;
  if (outsideItsScrollView(standing)) {
    // On the screen, but outside what its scroll view draws: that scroll view's edge is the edge.
    const drawn =
      visible > 0
        ? `only ${Math.round(visible * 100)}% of it (rect ${rectText(node.rect)}) is drawn, and a tap goes to its centre — ${advice(standing.remedy, () => 'scroll_until it with fully: true first')}`
        : `nothing of it is drawn (rect ${rectText(node.rect)}) — ${advice(standing.remedy, () => 'scroll_until it first')}`;
    return new OffScreenRefusal(refusal(`${outsideScrollViewText(standing.scroller)} at (${at.x},${at.y}): ${drawn}`));
  }
  const size = `${judged.box.width}x${judged.box.height}`;
  const where = `at (${at.x},${at.y}) on a ${size} screen${judged.boxes.length > 1 ? ' either way up' : ''}${reread}`;
  const part =
    visible > 0
      ? ` — only ${Math.round(visible * 100)}% of it (rect ${rectText(node.rect)}) is on screen, and a tap goes to its centre — ${advice(standing.remedy, () => 'scroll_until it with fully: true first')}`
      : ` (rect ${rectText(node.rect)}) — ${advice(standing.remedy, () => 'scroll_until it first')}`;
  return new OffScreenRefusal(refusal(`off screen ${where}${part}`));
}

/**
 * What to do about a target whose centre lies under a system bar (the bar
 * at `edge`), said as far as the tree knows it — the standing's remedy
 * (ui-tree/standing.ts#Remedy, which asks the tree's scroll ancestry,
 * geometry.ts#Clips.inScroller), rendered: the refusal had said
 * `scroll_until it first` of a button pinned at the top, which no scroll
 * moves. In a scroll view (`scroll`), `scroll_until` moves it out from
 * under the bar; in none (`pinned`), it is pinned there — a layout that
 * does not keep clear of the bar — and no step reaches it; where the tree
 * cannot say (`stuck`: idb's flat list), both. The refusal stays a refusal
 * either way — the safe direction, and terminal in an `optional:` step
 * (flow/engine.ts). Only these three: beneath a presented screen `advice`
 * says that screen's remedy instead.
 */
function systemBarRemedy(edge: SystemBar['edge'], remedy: ScrollableRemedy): string {
  const pinned = `no scroll moves it out: ${pinnedUnder(edge)} — fix the layout, or tap something else`;
  if (remedy.of === 'scroll') return 'it lies in a scroll view — scroll_until it first, to move it out from under the bar';
  if (remedy.of === 'pinned') return `it lies in no scroll view, so ${pinned}`;
  return `if it lies in a scroll view, scroll_until it first, to move it out from under the bar; if not, ${pinned}`;
}

/**
 * The tap's advice for a standing's remedy (ui-tree/standing.ts#Remedy): beneath a presented screen, that screen's
 * (ui-tree/standing.ts#presentedRemedy, naming an alert the tree marks), whatever the kind; else `otherwise`, told the remedy's other case — what each kind words
 * (a scroll, the system bar's three, the keyboard's hiding).
 */
function advice<R extends Exclude<Remedy, { readonly of: 'presented' }>>(remedy: Extract<Remedy, { readonly of: 'presented' }> | R, otherwise: (remedy: R) => string): string {
  return remedy.of === 'presented' ? presentedRemedy('it', remedy.layer) : otherwise(remedy);
}

/** The way past a cut the node's own content evidences, should it only READ cut (geometry.ts#evidentCut's residual). */
const OWN_CUT_WAY_PAST = 'if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates';
/** The way past a cut inherited from what the node lies in (`Cut.within`): the evidence is that ancestor's, so its "whole" case is that ancestor's. */
const INHERITED_CUT_WAY_PAST =
  'if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates';

/**
 * The tap's advice for a node cut to a sliver (`cut`, said after
 * target-text.ts#cutSliverText's sentence of it), its remedy and its way
 * past, when its standing's remedy is the plain `scroll` (beneath a
 * presented screen `advice` says that screen's remedy instead) — the refusal
 * of a node cut to a sliver (ui-tree/standing.ts#Scene.standing's `cut`;
 * what counts as cut is geometry.ts#Clips.cutSliver's at a clipping
 * container's edge and ui-tree/standing.ts#cutByLater's at a node drawn
 * after it, whose refusal says `cutByRemedy`'s instead of this advice; and
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
 * something in THAT clear of the edge. A container's cut needs a clipping
 * ancestor (UiNode.clipsDescendants, Android's); a cut by a later node needs
 * none, only a nested tree of clipped frames (ui-tree/later-edges.ts#laterEdgesIn's
 * `cutsAtLater`) — an iOS tree is neither (WDA's frames are unclipped, idb's
 * list flat), so no cut is refused there.
 */
const cutAdvice = (cut: Cut): string => `${cutRemedy(cut.edge)} (${cut.within === undefined ? OWN_CUT_WAY_PAST : INHERITED_CUT_WAY_PAST})`;

/**
 * How to hide a keyboard a tap refused a centre under: only a line no guard
 * acts on is refused (`underKeyboard`), idb's band, whose adapter has no
 * key that hides it (`KeyboardRemedy.dismissal` is `none`) — so the way is a
 * tap the author adds, worded as every remedy words it
 * (target-text.ts#hideKeyboardHow), and the adapter's `advice`.
 */
const hideIt = (remedy: KeyboardRemedy): string => hideClause(remedy, `hide the keyboard (${hideKeyboardHow(remedy)})`);
