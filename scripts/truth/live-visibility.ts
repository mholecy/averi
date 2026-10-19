import { UNMOVED_STROKES_EXHAUST } from '../../src/interact/scroll-rounds.js';
import type { Platform } from '../differential/corpus.js';
import { refusedAfterDismissal, replyKind, screenChangedSaid, screenUnchangedFor, swipesOf, turnsSaid, type ReplyKind } from './replies.js';
import type { CellTruth, Geometry, LabState, ProbeEvent, Rect, Stroke, TargetTruth } from './schema.js';
import { askedUnlistedBy, contractOf, judgedContext, stopHolds, type StopAsk, type TapAsk } from './target-contract.js';
import { axisOf, bandsOf, directionOf, geometryOf, intersect, selectorOf, type Direction, type GeometryContext } from './truth.js';

/**
 * The live golden's visibility cases (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 5; run by live.ts): averi's
 * `tap` and `scroll_until` against the REAL lab app on the coloured-target cells, the app's own log the oracle — its
 * tap log (LabState.events: the target's action fired, nothing else), each scroll view's offset and the strokes it took
 * (LabState.offsets, LabState.strokes), and the targets' frames as the app lays them out after the call. What a
 * replayed tree cannot show: which scroll view a stroke moved and which way, whether a stop's target is where the reply
 * says, the turn back of a stroke that did not bring the target closer (R-direction, golden-spec/rows.ts), and whether a
 * tap fired what it says.
 *
 * The cases come from the static truth (tests/fixtures/truth, one CellTruth per cell and platform), and WHAT each asks
 * from the target contract (target-contract.ts), the one the replayed golden's rows read too: a tap on every target the
 * contract asks one of, expected to fire where its clause is `fire` (tapAsk); a scroll_until toward every target in a
 * scroll view not judged `whole` (judgedGeometry; toward it: truth.ts#directionOf), with `fully: true` too where the
 * contract asks it (fullyAsked); plus the turn-back cases (TURN_BACK), whose direction is the wrong one on purpose. Each
 * case stamps the clause it judges (VisibilityCase.asks; tests/truth/target-contract.test.ts holds it equal to the
 * replayed row's). What a reply says is read by replies.ts alone (replyKind: what kind of reply a verdict rests on,
 * LiveVerdict.kind). Everything here is pure: live.ts runs the calls.
 *
 * Verdicts, as live.ts's: `ok` the app holds what the case asks and the reply agrees; `LOUD` it does not, and averi
 * said so (an error); `MISMATCH` averi claimed what did not happen (`Tapped` with nothing fired or something else
 * fired, "visible" with the target not where the stop needs it, "the last N swipes did not change the screen" with the
 * app logging one of them moving a scroll view), failed what did happen, or the strokes broke the row (another scroll
 * view stroked, a stroke that did not bring the target closer not turned back).
 *
 * The oracle's caveats, stated:
 *  - a stroke is what the app saw from leaving rest to coming to rest: on iOS a second swipe that catches a list still
 *    decelerating (decelerating → interacting, never idle between) merges with the first into one stroke, so a turn
 *    sent mid-fling reads as part of the stroke before it;
 *  - Compose's sticky LazyColumn (scroll-sticky, scroll-sticky-cut) reports an offset derived from its first visible
 *    item's index (Edges.kt: the header item, then rows of a fixed height), exact only while every item is that height;
 *  - sheet-long-list's UITableView reports no offset before its first scroll: the launch offset falls back to 0 — its
 *    real rest at launch (classStrokes' `o0`);
 *  - the stop is judged on the state read right after scroll_until returns (live.ts reads it between the calls), the
 *    tap on the state after the tap. That read has no pause: a stroke the app has not yet written when it is read (its
 *    rest still to come) is missing from it — unchangedClaimBroken then counts fewer strokes than swipes and silently
 *    does not judge, and R-direction judges the strokes written so far.
 */

export type Outcome = 'ok' | 'LOUD' | 'MISMATCH' | 'SKIP';
/**
 * Why a case is not ok, by the judge's rule — what the live KNOWN pins beside the note (live-known.ts), as the static
 * ratchet pins a row's class: a known case failing by another rule is not known. `stop-claim` "visible" where the app
 * does not bear the stop out; `tap-claim` `Tapped` with nothing or something else fired; `tap-refused-fired` a refusal
 * while something fired; `tap-refused` (LOUD) a refusal of a target its probe reached; `unchanged-claim` "the last N
 * swipes did not change the screen" against the app's strokes; `R-direction` the strokes broke it; `failed-holds` a
 * failure where the app shows the stop; `not-reached` (LOUD) an honest failure; `presented-stop`, `presented-fired`,
 * `presented-stroke` a scroll_until beneath a presented layer that stopped, fired or stroked; `presented-changed`
 * (LOUD) one whose stroke changed the screen — the layer dismissed — and that said so, claiming nothing; `presented-pass` a colour
 * assert beneath a presented layer that passed (it measured the layer); `dismissal` the dismissal's judge.
 */
export type VerdictClass =
  | 'stop-claim'
  | 'tap-claim'
  | 'tap-refused-fired'
  | 'tap-refused'
  | 'unchanged-claim'
  | 'R-direction'
  | 'failed-holds'
  | 'not-reached'
  | 'presented-stop'
  | 'presented-fired'
  | 'presented-stroke'
  | 'presented-changed'
  | 'presented-pass'
  | 'dismissal';

export interface LiveVerdict {
  outcome: Outcome;
  why: string;
  /** The rule a verdict not ok was reached by. */
  cls?: VerdictClass;
  /** The app's state behind the verdict (every scroll case's, any other case's not ok): live.ts prints it under the case. */
  app?: string;
  /** What kind of reply the verdict rests on (replies.ts#replyKind, the closed set the static ratchet pins). */
  kind?: ReplyKind;
}

/** What a tap or a stroke made the app log: every event but the touches and focus changes (tap, dismissed, button, tab, select, submit). */
export function firedSince(state: Pick<LabState, 'events'>, launched: Pick<LabState, 'events'>): ProbeEvent[] {
  return state.events.slice(launched.events.length).filter((e) => e.kind !== 'touch' && e.kind !== 'focus').map(({ kind, tag }) => ({ kind, tag }));
}

/** The strokes the app logged since the launch. */
export function strokesSince(state: Pick<LabState, 'strokes'>, launched: Pick<LabState, 'strokes'>): Stroke[] {
  return (state.strokes ?? []).slice((launched.strokes ?? []).length);
}

/** Where each touch since the launch began (the app's `touch` events, `x,y`) — a stroke's touch-down, a tap's point. */
export const touchesSince = (state: Pick<LabState, 'events'>, launched: Pick<LabState, 'events'>): string[] =>
  state.events.slice(launched.events.length).filter((e) => e.kind === 'touch').map((e) => e.tag);
/** Touches as every summary line words them (touchesSince's `x,y`): `(x,y) (x,y) …` — the one formatter. */
export const touchPointsText = (ts: readonly string[]): string => ts.map((t) => `(${t})`).join(' ');
const touchesText = (state: Pick<LabState, 'events'>, launched: Pick<LabState, 'events'>) => {
  const ts = touchesSince(state, launched);
  return ts.length === 0 ? 'none' : touchPointsText(ts);
};
const eventsText = (es: readonly ProbeEvent[]) => (es.length === 0 ? 'nothing' : es.map((e) => `${e.kind} ${e.tag}`).join(', '));
const rectText = (r: Rect | undefined | null) => (r === undefined || r === null ? 'none' : `${round(r.x)},${round(r.y)} ${round(r.width)}x${round(r.height)}`);
const round = (n: number) => Math.round(n * 10) / 10;
export const short = (reply: string) => reply.split('\n')[0].slice(0, 260);

/**
 * What the target's geometry is judged against in the live state: the contract's judged context
 * (target-contract.ts#judgedContext — the one the replay judges a capture in: iOS's home-indicator band is no band), on
 * the app's screen, bands, the target's scroll view's clip and the chrome as it reports them now.
 */
export const liveContext = (state: LabState, platform: Platform, view: string | undefined): GeometryContext => judgedContext(platform, state, view);

/** The target's live geometry, from its frame as the app lays it out now; undefined when the app reported no frame. */
export function liveGeometry(state: LabState, platform: Platform, tag: string, view: string | undefined): Geometry | undefined {
  const f = state.frames[tag];
  return f === undefined ? undefined : geometryOf(f, liveContext(state, platform, view));
}

/** The app's state of a target, for the summary: its frame, its scroll view's clip and offset, its live geometry. */
export function appText(state: LabState, platform: Platform, tag: string, view: string | undefined, launched: LabState): string {
  const strokes = strokesSince(state, launched);
  return [
    `${tag} ${rectText(state.frames[tag])} (${liveGeometry(state, platform, tag, view) ?? 'no frame'})`,
    ...(view === undefined ? [] : [`${view} clip ${rectText(state.scrollViews?.[view])} offset ${state.offsets?.[view] ?? '—'} (launched ${launched.offsets?.[view] ?? '—'})`]),
    `strokes ${strokes.length === 0 ? 'none' : strokes.map((s) => `${s.view} ${round(s.from)}→${round(s.to)}`).join(', ')}`,
    `fired ${eventsText(firedSince(state, launched))}`,
    `touches ${touchesText(state, launched)}`,
  ].join('; ');
}

// --- the tap ---

/**
 * A tap on `tag`, judged by the app's log: `Tapped` must have fired the target's action and nothing else; a refusal
 * must have fired nothing (a dismissed layer is something). A refusal of a target whose tap must fire (`fires`: the
 * contract's clause `fire`, target-contract.ts#tapAsk) is LOUD; a `Tapped` that fired it alone is ok either way — the
 * truth's probe at the centre is not the only tap that reaches it (the live oracle, the contract's header says).
 */
export function judgeTap(tag: string, fires: boolean, reply: string, state: LabState, launched: LabState): LiveVerdict {
  const fired = firedSince(state, launched);
  const own = fired.filter((e) => e.kind === 'tap' && e.tag === tag);
  const others = fired.filter((e) => !(e.kind === 'tap' && e.tag === tag));
  const kind = replyKind(reply);
  if (kind === 'Tapped') {
    if (own.length === 0) return { outcome: 'MISMATCH', cls: 'tap-claim', kind, why: `averi says ${short(reply)} — the app logged ${eventsText(fired)}` };
    if (others.length > 0) return { outcome: 'MISMATCH', cls: 'tap-claim', kind, why: `averi says ${short(reply)} — the app fired ${eventsText(others)} besides ${tag}` };
    return { outcome: 'ok', kind, why: `${short(reply)}${fires ? '' : ' (fired, where the probe at its centre did not reach it)'}` };
  }
  if (fired.length > 0) return { outcome: 'MISMATCH', cls: 'tap-refused-fired', kind, why: `averi refused (${short(reply)}) — yet the app logged ${eventsText(fired)}` };
  return fires ? { outcome: 'LOUD', cls: 'tap-refused', kind, why: `refused a target a tap reaches, nothing fired: ${short(reply)}` } : { outcome: 'ok', kind, why: `refused, nothing fired: ${short(reply)}` };
}

// --- the dismissal (#7, #19) ---

/**
 * A tap on `tag`, a field under the keyboard, with the cell's `keyboardDismiss` configured — judged by the app's form
 * model: nothing typed into any field, no submit; `Tapped` only with the focus on `tag`. A refusal: under idb (the
 * dismissal inert) the documented answer; under WDA honest when the dismissal was tapped (the editing ended — no field
 * focused) and the field then refused for where it lies once the keyboard is gone; else LOUD (not dismissed).
 */
export function judgeDismissal(tag: string, reply: string, source: string, s: LabState, launched: LabState): LiveVerdict {
  const typed = Object.entries(s.fields ?? {}).filter(([k, f]) => f.value !== launched.fields?.[k]?.value);
  const kind = replyKind(reply);
  if (typed.length > 0) return { outcome: 'MISMATCH', cls: 'dismissal', kind, why: `typed into ${typed.map(([k, f]) => `${k} (${JSON.stringify(f.value)})`).join(', ')}: ${short(reply)}` };
  if ((s.submits ?? []).length > 0) return { outcome: 'MISMATCH', cls: 'dismissal', kind, why: `the form was submitted: ${short(reply)}` };
  const tapped = kind === 'Tapped';
  const focus = s.focus ?? 'none';
  if (tapped !== (s.focus === tag)) return { outcome: 'MISMATCH', cls: 'dismissal', kind, why: `averi says ${short(reply)} — the focus is on ${focus}` };
  if (tapped) return { outcome: 'ok', kind, why: short(reply) };
  if (source === 'idb') return { outcome: 'ok', kind, why: `refused (idb: the dismissal inert), focus on ${focus}: ${short(reply)}` };
  if (s.focus == null && launched.focus != null && refusedAfterDismissal(reply)) {
    return { outcome: 'ok', kind, why: `the keyboard dismissed (no field focused), then ${tag} refused: ${short(reply)}` };
  }
  return { outcome: 'LOUD', cls: 'dismissal', kind, why: `not tapped, the focus on ${focus}, though a dismissal is configured: ${short(reply)}` };
}

// --- the strokes (R-direction) ---

/**
 * How far the target lies from showing whole, at a scroll offset `o` of its scroll view: the target's frame at launch
 * (`f0`, the view at offset `o0`) moved by the offset's change along the view's `axis` (`y` down its content, `x`
 * across a horizontal one's — a carousel's, LabState.offsets), against `region` — its scroll view's clip on the screen
 * below the status band, less a full-width chrome at its top or bottom edge (a sticky header, a tab bar, a pinned
 * bar). 0 when it shows whole there.
 */
export function distanceAt(o: number, f0: Rect, o0: number, region: Rect, axis: 'x' | 'y' = 'y'): number {
  const [start, size, from, extent] = axis === 'y' ? [f0.y, f0.height, region.y, region.height] : [f0.x, f0.width, region.x, region.width];
  const lead = start - (o - o0);
  return Math.max(0, from - lead) + Math.max(0, lead + size - (from + extent));
}

/** The region a target of `view` must lie in to show whole (distanceAt), from the launch state; undefined without a clip. */
export function showRegion(state: LabState, platform: Platform, view: string): Rect | undefined {
  const ctx = liveContext(state, platform, view);
  if (ctx.clip === undefined) return undefined;
  let r = intersect(ctx.clip, ctx.screen);
  const status = bandsOf(ctx.screen, ctx.safeArea).status;
  if (r !== null && status !== undefined && r.y < status.y + status.height) r = intersect(r, { ...r, y: status.y + status.height, height: r.y + r.height - (status.y + status.height) });
  for (const c of Object.values(ctx.chrome ?? {})) {
    if (r === null || c.width < r.width / 2) continue;
    const mid = r.y + r.height / 2;
    if (c.y + c.height / 2 >= mid && c.y < r.y + r.height) r = { ...r, height: Math.max(0, c.y - r.y) };
    else if (c.y + c.height / 2 < mid && c.y + c.height > r.y) r = { ...r, y: c.y + c.height, height: Math.max(0, r.y + r.height - (c.y + c.height)) };
  }
  return r ?? undefined;
}

export type StrokeClass = 'closer' | 'away' | 'still';
export interface ClassedStroke extends Stroke {
  /** The target's distanceAt before and after it. */
  d0: number;
  d1: number;
  cls: StrokeClass;
}

/** A unit of slack: a stroke must change the distance by more to count as moving it. */
const MOVE_SLACK = 1;

/**
 * The strokes of the target's own scroll view since the launch, each classed by what it did to the target's distance
 * (along `axis`, the view's: distanceAt).
 */
export function classStrokes(state: LabState, launched: LabState, platform: Platform, tag: string, view: string, axis: 'x' | 'y' = 'y'): ClassedStroke[] | undefined {
  const f0 = launched.frames[tag];
  const region = showRegion(launched, platform, view);
  if (f0 === undefined || region === undefined) return undefined;
  const o0 = launched.offsets?.[view] ?? 0;
  return strokesSince(state, launched)
    .filter((s) => s.view === view)
    .map((s) => {
      const d0 = distanceAt(s.from, f0, o0, region, axis);
      const d1 = distanceAt(s.to, f0, o0, region, axis);
      return { ...s, d0, d1, cls: d1 < d0 - MOVE_SLACK ? 'closer' : d1 > d0 + MOVE_SLACK ? 'away' : 'still' };
    });
}

/**
 * A failure that says its last N swipes did not change the screen, while the app logged a stroke among them that moved a
 * scroll view (any view: the claim is about the screen) — undefined when the claim stands or is not made. Judged only
 * when the app logged at least as many strokes as the reply counts swipes, so the last N strokes are the last N swipes
 * (a swipe that moves nothing at all may log no stroke).
 */
export function unchangedClaimBroken(reply: string, strokes: readonly Stroke[]): string | undefined {
  const n = screenUnchangedFor(reply);
  const swipes = swipesOf(reply);
  if (n === undefined || swipes === undefined || strokes.length < swipes) return undefined;
  const moved = strokes.slice(-n).filter((s) => Math.abs(s.to - s.from) > MOVE_SLACK);
  return moved.length === 0 ? undefined : `averi says the last ${n} swipes did not change the screen — the app logged ${moved.map((s) => `${s.view} ${round(s.from)}→${round(s.to)}`).join(', ')} in them`;
}

/**
 * What the strokes did against R-direction (golden-spec/rows.ts: each stroke brings the target closer, and a stroke that
 * does not turns back) and the stroke's own scroll view: every way they broke it, empty when none.
 *  - a stroke of another scroll view that moved it (the stroke went beside the target's scroll view);
 *  - a stroke that did not bring it closer (away, or moving nothing while it does not show whole) followed by another
 *    that does not: no turn back;
 *  - the last stroke not bringing it closer with the target still not showing whole: the call ended without turning;
 *  - swipes the reply counts (`after N swipes`, N ≥ 2) while no logged stroke brought it closer and it does not show
 *    whole: strokes that moved nothing at all log no stroke on a platform that sees no scroll in them.
 */
export function directionBreaks(strokes: readonly Stroke[], classed: readonly ClassedStroke[], view: string, swipes: number | undefined, endDistance: number): string[] {
  const breaks: string[] = [];
  const beside = strokes.filter((s) => s.view !== view && Math.abs(s.to - s.from) > MOVE_SLACK);
  if (beside.length > 0) breaks.push(`stroked ${beside.map((s) => `${s.view} ${round(s.from)}→${round(s.to)}`).join(', ')}, not its own ${view}`);
  const notCloser = (s: ClassedStroke) => s.cls !== 'closer' && s.d0 > 0;
  for (let i = 0; i + 1 < classed.length; i++) {
    if (notCloser(classed[i]) && notCloser(classed[i + 1])) {
      breaks.push(`no turn back: stroke ${i + 1} (${round(classed[i].from)}→${round(classed[i].to)}, ${classed[i].cls}) and stroke ${i + 2} (${round(classed[i + 1].from)}→${round(classed[i + 1].to)}, ${classed[i + 1].cls}) neither brought it closer`);
      break;
    }
  }
  const last = classed[classed.length - 1];
  if (last !== undefined && notCloser(last) && endDistance > MOVE_SLACK && !breaks.some((b) => b.startsWith('no turn back'))) {
    breaks.push(`ended on a stroke that did not bring it closer (${round(last.from)}→${round(last.to)}, ${last.cls}), ${round(endDistance)} from showing whole, not turned back`);
  }
  if ((swipes ?? 0) >= 2 && !classed.some((s) => s.cls === 'closer') && endDistance > MOVE_SLACK && breaks.length === 0) {
    breaks.push(`${swipes} swipes, none of them brought it closer (${classed.length} stroke(s) logged)`);
  }
  return breaks;
}

/**
 * A scroll_until toward (or, `turnBack`, away from) `tag`, then a tap on it: the stop must hold where the app lays the
 * target out (stopHolds), every stroke on its own scroll view and R-direction kept (directionBreaks); a failure where the
 * app shows it as the stop needs it failed what happened. The tap after a stop must fire it alone (judgeTap). `axis`:
 * the one the target's scroll view scrolls along — `x` for a carousel's card asked `right` or `left` (truth.ts#axisOf).
 */
export function judgeScroll(
  c: { tag: string; view: string; fully: boolean; platform: Platform; unlisted?: boolean; axis?: 'x' | 'y' },
  [scroll, tap]: readonly string[],
  final: LabState,
  launched: LabState,
  atStop: LabState = final,
): LiveVerdict {
  // The stop on the state read when scroll_until returned (`atStop`), the tap on the state after it (`final`).
  const state = atStop;
  const app = appText(final, c.platform, c.tag, c.view, launched);
  const g = liveGeometry(state, c.platform, c.tag, c.view);
  const holds = g !== undefined && stopHolds(g, c.fully);
  const classed = classStrokes(state, launched, c.platform, c.tag, c.view, c.axis) ?? [];
  const f0 = launched.frames[c.tag];
  const region = showRegion(launched, c.platform, c.view);
  const end = f0 === undefined || region === undefined ? 0 : distanceAt(state.offsets?.[c.view] ?? launched.offsets?.[c.view] ?? 0, f0, launched.offsets?.[c.view] ?? 0, region, c.axis);
  const breaks = directionBreaks(strokesSince(state, launched), classed, c.view, swipesOf(scroll), end);
  const stop = c.fully ? 'fully visible' : 'visible';
  const tapped = tap === undefined ? undefined : judgeTap(c.tag, holds, tap, final, launched);
  const unchanged = unchangedClaimBroken(scroll, strokesSince(state, launched));
  const kind = replyKind(scroll);
  const visible = kind === 'visible';
  if (visible && !holds) return { outcome: 'MISMATCH', cls: 'stop-claim', kind, why: `averi says ${short(scroll)} — the app lays it out ${g ?? 'nowhere'}, not ${stop}${tapped?.outcome === 'MISMATCH' ? `; then the tap: ${tapped.why}` : ''}`, app };
  if (tapped?.outcome === 'MISMATCH') return { ...tapped, why: `after ${short(scroll)}, the tap: ${tapped.why}`, app };
  // Whatever the tree listed: a claim about the screen the app's own strokes contradict.
  if (unchanged !== undefined) return { outcome: 'MISMATCH', cls: 'unchanged-claim', kind, why: `${unchanged}: ${short(scroll)}`, app };
  // A target the tree does not list (uiautomator dumps no node not visible to the user): averi cannot tell where it
  // lies, nor which scroll view holds it — what R-stroke exempts too (golden-spec/rows.ts#strokeRow); its strokes are
  // reported, not judged.
  if (breaks.length > 0 && c.unlisted !== true) return { outcome: 'MISMATCH', cls: 'R-direction', kind, why: `R-direction: ${breaks.join('; ')} — averi: ${short(scroll)}`, app };
  if (!visible) {
    const unjudged = breaks.length > 0 ? ` (not in the tree: its strokes unjudged — ${breaks.join('; ')})` : '';
    return holds ? { outcome: 'MISMATCH', cls: 'failed-holds', kind, why: `averi failed (${short(scroll)}) — the app shows it ${g} (${stop} as the stop needs)`, app } : { outcome: 'LOUD', cls: 'not-reached', kind, why: `not reached (${g ?? 'no frame'}), and averi said so${unjudged}: ${short(scroll)}`, app };
  }
  if (tap === undefined || tapped === undefined) return { outcome: 'ok', kind, why: short(scroll), app };
  if (tapped.outcome !== 'ok') return { ...tapped, why: `stopped (${short(scroll)}), then the tap: ${tapped.why}`, app };
  return { outcome: 'ok', kind, why: `${short(scroll)}; then ${short(tap)}`, app };
}

/**
 * An Android turn-back case (TURN_BACK, on uiautomator), judged by ADR 0021's decision of 2026-10-18 (the owner, on
 * round 6's Android device check): NO turn there — unmoved strokes on uiautomator are no proof of an end — and the
 * two-stroke stop kept: the tool reports the direction, the agent turns. So the case is ok when averi, having turned
 * no stroke toward the target (none of its own scroll view's strokes brought it closer), fails loudly naming the
 * direction the target lies (`turnTo`, `direction: "<it>"`) with at most UNMOVED_STROKES_EXHAUST unmoved swipes in
 * the whole call — counted, not located: its swipes less the strokes the app logged moving the target's scroll view (a
 * swipe that moves nothing may log none, so which of them were unmoved is not known, only how many). Else judgeScroll's verdict stands — R-direction's turn on WDA's cases, a claim the strokes contradict, a stop
 * the app does not bear out. Measured: turn:scroll-collapsing.A (lab note #10), 4 swipes down, the last 2 unmoved,
 * `scroll_until it with direction: "up"` (docs/truth/live-android-2026-10-18-visibility.md); turn:scroll-bounded.F
 * names no direction (F unlisted, no side ever read) and stays LOUD, honest.
 */
export function judgeAndroidTurn(
  c: Parameters<typeof judgeScroll>[0] & { turnTo: Direction },
  replies: readonly string[],
  final: LabState,
  launched: LabState,
  atStop: LabState,
): LiveVerdict {
  const v = judgeScroll(c, replies, final, launched, atStop);
  if (v.outcome === 'ok' || (v.cls !== 'R-direction' && v.cls !== 'not-reached')) return v;
  const [scroll] = replies;
  const moved = strokesSince(atStop, launched).filter((s) => s.view === c.view && Math.abs(s.to - s.from) > MOVE_SLACK);
  const turned = (classStrokes(atStop, launched, c.platform, c.tag, c.view, c.axis) ?? []).some((s) => s.cls === 'closer');
  const swipes = swipesOf(scroll) ?? 0;
  const unmoved = swipes - moved.length;
  const named = scroll.includes(`direction: "${c.turnTo}"`);
  if (turned || !named || unmoved > UNMOVED_STROKES_EXHAUST || v.kind === 'visible') return v;
  return { outcome: 'ok', kind: v.kind, why: `no turn on uiautomator (ADR 0021): ${swipes} swipes, the last ${unmoved} unmoved, failed naming direction: "${c.turnTo}" — ${short(scroll)}`, app: v.app };
}

/**
 * A scroll_until for a target beneath a presented layer (`declared: presented-over`): no stop where it lies covered, no
 * stroke on the screen beneath (it would move the host under the layer or drag the layer), the layer not dismissed.
 * A target in no scroll view (alert-dim's, sheet-medium's: the layer over a screen that does not scroll) has nothing a
 * stroke could bring closer: any touch the app logged is a stroke on the layer — on Android it dismissed the dialog or
 * expanded the sheet (docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md, L1),
 * so it is the row's mismatch even where the layer survived it.
 */
export function judgePresentedScroll(c: { tag: string; view: string | undefined; platform: Platform }, [scroll]: readonly string[], state: LabState, launched: LabState): LiveVerdict {
  const app = appText(state, c.platform, c.tag, c.view, launched);
  const fired = firedSince(state, launched);
  const moved = strokesSince(state, launched).filter((s) => Math.abs(s.to - s.from) > MOVE_SLACK);
  const touched = c.view === undefined ? touchesSince(state, launched) : [];
  const kind = replyKind(scroll);
  // A stop claimed after a stroke that dismissed the layer (LW1: a Views sheet's scrim stroked) is said so: the target
  // is visible then, on a screen averi uncovered without being asked.
  if (kind === 'visible') {
    const why = fired.length > 0 ? `the app logged ${eventsText(fired)}: averi closed the presented layer and claimed the stop` : 'the target lies beneath the presented layer';
    return { outcome: 'MISMATCH', cls: 'presented-stop', kind, why: `averi says ${short(scroll)} — ${why}`, app };
  }
  // A stroke that changed the screen, said so — scroll_until's changed stop (idb beneath a layer its list shows no sign
  // of: sheet-background's A and B) — is honest: the layer is gone, which the caller is told, and nothing found after
  // it is claimed. LOUD (the stroke still cost the caller its sheet: ADR 0018 residual 6), not a mismatch; not ok.
  if (screenChangedSaid(scroll)) {
    const what = fired.length > 0 ? `the app logged ${eventsText(fired)}` : 'nothing logged but the touches';
    return { outcome: 'LOUD', cls: 'presented-changed', kind, why: `${what}, and averi said its swipe changed the screen, claiming nothing — ${short(scroll)}`, app };
  }
  if (fired.length > 0) return { outcome: 'MISMATCH', cls: 'presented-fired', kind, why: `the app logged ${eventsText(fired)} — averi: ${short(scroll)}`, app };
  if (moved.length > 0) return { outcome: 'MISMATCH', cls: 'presented-stroke', kind, why: `stroked beneath the presented layer: ${moved.map((s) => `${s.view} ${round(s.from)}→${round(s.to)}`).join(', ')} — averi: ${short(scroll)}`, app };
  if (touched.length > 0) return { outcome: 'MISMATCH', cls: 'presented-stroke', kind, why: `stroked the presented layer over a target in no scroll view: ${touched.length} touch(es) at ${touchPointsText(touched)} — averi: ${short(scroll)}`, app };
  return { outcome: 'ok', kind, why: `refused, nothing moved or fired: ${short(scroll)}`, app };
}

/**
 * A colour assert on a target beneath a presented layer, asked for the target's own colour (the replayed golden's
 * colour row, golden-spec/presented.ts#presentedOverRows): it must not pass — the screen shows the layer there — and
 * nothing may fire or be dismissed (an assert touches nothing). A failure of any wording is ok; its kind (`not found`
 * where the tree lists only the presented window) is the summary's.
 */
export function judgePresentedAssert([assert]: readonly string[], state: LabState, launched: LabState): LiveVerdict {
  const fired = firedSince(state, launched);
  const kind = replyKind(assert);
  if (kind === 'PASS') return { outcome: 'MISMATCH', cls: 'presented-pass', kind, why: `averi says ${short(assert)} — the target lies beneath the presented layer` };
  if (fired.length > 0) return { outcome: 'MISMATCH', cls: 'presented-fired', kind, why: `the app logged ${eventsText(fired)} — averi: ${short(assert)}` };
  return { outcome: 'ok', kind, why: `failed, nothing fired: ${short(assert)}` };
}

/**
 * The colour assert case of a target beneath a presented window the uiautomator parser does not mark (round 7's cells,
 * ADR 0018's residual 19 — live.ts adds it for PRESENTED_WINDOW_CELLS alone, the cells it was asked of).
 */
export function presentedAssertCase(cell: string, t: TargetTruth): VisibilityCase {
  return {
    id: `assert:${cell}.${t.tag}`,
    cell,
    says: `colour assert ${t.tag} (${t.color}) beneath the presented layer: fails, nothing fires`,
    calls: [{ tool: 'assert', args: { asserts: [{ element: { id: t.id }, color: { expected: t.color }, timeout: 3_000 }] } }],
    judge: (s, replies, launched) => judgePresentedAssert(replies, s, launched),
  };
}

/** The cells presentedAssertCase is asked of: round 7's full-screen dialog and Views bottom sheet (Presented.kt). */
export const PRESENTED_WINDOW_CELLS: readonly string[] = ['dialog-fullscreen', 'bottom-sheet-dialog'];

// --- the cases ---

export interface VisibilityCall {
  tool: 'tap' | 'scroll_until' | 'assert';
  args: Record<string, unknown>;
}

/** Where a live case runs: the one declaration of a case's tree sources, live.ts's cases and this module's alike. */
export interface RunsUnder {
  /** The tree sources the case runs under (`--sources`' every one, the platform's, when unset): the carry case is WDA's alone. */
  sources?: readonly string[];
}

export interface VisibilityCase extends RunsUnder {
  id: string;
  cell: string;
  says: string;
  calls: VisibilityCall[];
  /**
   * The target contract's clause the case judges (target-contract.ts): a tap case's TapAsk, a scroll case's StopAsk
   * (the stop toward the target where its capture lays it out) — the replayed golden's row stamps the same
   * (Expectation.asks). Unset on the cases no replayed row asks: the turn-back cases (a wrong direction on purpose) and
   * the scroll beneath a presented layer.
   */
  asks?: TapAsk | StopAsk;
  /**
   * `source`: the tree source the case ran under — a target its static capture's tree of that source did not list
   * (TargetTruth.listed) is not held to R-direction. `after[i]`: the state read right after call i (live.ts reads one
   * between the calls of a visibility case).
   */
  judge(state: LabState, replies: string[], launched: LabState, source: string, after: readonly (LabState | undefined)[]): LiveVerdict;
}

/** The way opposite a turn-back case's direction — the way its target lies. */
const OPPOSITE_WAY = { up: 'down', down: 'up' } as const;

/**
 * The turn-back cases (#17, R-direction): a scroll_until whose direction is the WRONG one — the content at its end that
 * way (a stroke moves nothing), or the target carried further off by the first stroke — must turn back and stop on it.
 */
export const TURN_BACK: readonly { cell: string; tag: string; direction: 'up' | 'down'; fully?: true; says: string }[] = [
  { cell: 'scroll-top-edge-end', tag: 'T', direction: 'down', says: 'the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17)' },
  { cell: 'scroll-top-edge-end', tag: 'T', direction: 'down', fully: true, says: 'as the plain one, fully: turn back up (#17)' },
  { cell: 'scroll-top-edge', tag: 'T', direction: 'down', says: 'T in the status band, more content below: a stroke down carries it off the top — turn back' },
  { cell: 'scroll-bounded', tag: 'F', direction: 'up', says: 'lower at its top, F below: a stroke up moves nothing — turn back down' },
  { cell: 'scroll-collapsing', tag: 'A', direction: 'down', says: 'A scrolled above the list, its uiautomator bounds inverted: a stroke down carries it further — turn back up (#10)' },
];

/**
 * Every case of a cell's truth on its platform, as the target contract asks it (target-contract.ts): a tap per target
 * the contract asks one of (`fires` where its clause is `fire`), a scroll_until per target in a scroll view not judged
 * whole (toward it; `fully` too where fullyAsked), a refusal case per target beneath a presented layer (in a scroll
 * view or not), and the cell's turn-back cases. A tap follows each stop, judged with it.
 */
export function visibilityCases(truth: CellTruth, platform: Platform): VisibilityCase[] {
  const cases: VisibilityCase[] = [];
  for (const t of truth.targets) {
    // The tap's clause (tapAsk): `fire` — reached at its centre, open or cut, iOS's home-indicator band included (no
    // band: the app's, measured) — must fire it. Else — `land-or-refuse` (a system band whose probe fired, a piece) or
    // `refuse` — a refusal is as good, but never a `Tapped` that fired nothing, or something else. A target the
    // contract asks nothing of (its truth contradicts itself: consistency's to report) gets no case.
    const contract = contractOf(platform, t, truth);
    const ask = contract.tap;
    if (ask === undefined) continue;
    const fires = ask.must === 'fire';
    cases.push({
      id: `tap:${truth.cell}.${t.tag}`,
      cell: truth.cell,
      says: `tap ${t.tag} (${contract.geometry ?? t.declared}): ${fires ? 'fires it alone' : 'refused, nothing fires — or fires it alone'}`,
      calls: [{ tool: 'tap', args: { selector: selectorOf(t) } }],
      asks: ask,
      judge: (s, [reply], launched) => judgeTap(t.tag, fires, reply, s, launched),
    });
    if (t.declared === 'presented-over') {
      cases.push({
        id: `scroll:${truth.cell}.${t.tag}`,
        cell: truth.cell,
        says: `scroll_until ${t.tag} beneath the presented layer: refused, nothing stroked, nothing dismissed`,
        calls: [{ tool: 'scroll_until', args: { selector: selectorOf(t), direction: directionOf(t, truth) } }],
        judge: (s, replies, launched, _source, after) => judgePresentedScroll({ tag: t.tag, view: t.scrollView, platform }, replies, after[0] ?? s, launched),
      });
      continue;
    }
    const g = contract.geometry;
    if (t.scrollView === undefined || g === undefined || g === 'whole') continue;
    const view = t.scrollView;
    for (const stop of [contract.stop, ...(contract.fully === undefined ? [] : [contract.fully])]) {
      const direction = directionOf(t, truth);
      cases.push({ ...scrollCase(truth.cell, t, view, direction, stop.fully, platform, `scroll_until ${t.tag} (${g}) ${direction}${stop.fully ? ', fully' : ''}: stops on it as the app lays it out, every stroke on ${view} bringing it closer, then the tap fires it`), asks: stop });
    }
  }
  for (const b of TURN_BACK.filter((x) => x.cell === truth.cell)) {
    const t = truth.targets.find((x) => x.tag === b.tag);
    if (t?.scrollView === undefined) continue;
    // A target its capture's tree of a source does not list: averi cannot see where it lies, so there is nothing to turn
    // back toward — the case is said so, and its strokes are not held to R-direction under that source.
    const unlisted = [...new Set([...Object.keys(t.listed ?? {}), ...Object.keys(t.textListed ?? {})])].filter((src) => askedUnlistedBy(t, src) !== undefined);
    // On Android no turn is asked at all (ADR 0021, the owner's decision of 2026-10-18): judgeAndroidTurn.
    const unlistedSays = `under ${unlisted.join(', ')} ${t.tag} is not in the tree, so no turn is asked there, only an honest reply`;
    const says =
      platform === 'android'
        ? `no turn on uiautomator (ADR 0021): ${b.says} — averi keeps ${b.direction} and fails loudly naming ${OPPOSITE_WAY[b.direction]} after at most ${UNMOVED_STROKES_EXHAUST} unmoved strokes${unlisted.length === 0 ? '' : `; ${unlistedSays}`}`
        : unlisted.length === 0
          ? `turn back: ${b.says}`
          : `the wrong direction: ${b.says} — ${unlistedSays}`;
    const sc = scrollCase(truth.cell, t, t.scrollView, b.direction, b.fully === true, platform, says);
    const view = t.scrollView;
    cases.push({
      ...sc,
      id: `turn:${truth.cell}.${t.tag}${b.fully ? '.fully' : ''}`,
      ...(platform === 'android' && {
        judge: (s: LabState, replies: string[], launched: LabState, source: string, after: readonly (LabState | undefined)[]) =>
          judgeAndroidTurn({ tag: t.tag, view, fully: b.fully === true, platform, unlisted: askedUnlistedBy(t, source) !== undefined, axis: axisOf(b.direction), turnTo: OPPOSITE_WAY[b.direction] }, replies, s, launched, after[0] ?? s),
      }),
    });
  }
  if (platform === 'ios' && truth.cell === CARRY.cell) cases.push(carryCase());
  return cases;
}

/**
 * The long-list carry case (ADR 0021 decision 4, lab note LV5; iOS, WDA alone — idb lists no scroll view, so it has no
 * carry): target L, row 30 of sheet-long-list's UIKit table (56 rows of 64 pt, Presented.swift#LongListController),
 * asked `down` from the top by its own identifier, its frame the app's (rectForRow, reported at every layout). LV5
 * measured the carry model's window on `lower` (180 pt); its final-approach cut on a full-height list is inferred, and
 * the ADR asks the device check to judge that the cut stroke lands the row in its window without an extra stroke or
 * turn. L lies at content y 1920: whole over the offsets 1172–1920 (812 pt shown), past one stroke's carry from the top
 * (≈ 1040 pt under WDA), and wholly before the table's end (offset 2772) — so a full final stroke (≈ 2080 from the
 * top) carries it past its window, and the case fails on a missing cut (the round-7 table; round 6's 40 rows ended at
 * 1748, inside the window of its far row, which no full stroke could then overshoot). The turn and the overshoot are
 * what is judged on top of judgeScroll's stop, and the strokes the app logged (the summary's `app:` line) show where
 * the final one came to rest.
 */
export const CARRY = { cell: 'sheet-long-list', view: 'list', tag: 'L' } as const;

/**
 * The turns of a scroll's strokes over `clip` by the app's touch log: each touch-down's half of the clip — the lower
 * half a stroke `down` (content up), the upper a stroke `up` — and every change from one to the other a turn. The app
 * merges strokes sent while the table still moves into one (the oracle's caveats in this module's doc, the first), so
 * its strokes undercount the turns; its touch-downs do not.
 */
export function touchTurns(state: Pick<LabState, 'events'>, launched: Pick<LabState, 'events'>, clip: Rect): number {
  const mid = clip.y + clip.height / 2;
  const sides = touchesSince(state, launched).map((t) => Number(t.split(',')[1]) >= mid);
  return sides.filter((s, i) => i > 0 && s !== sides[i - 1]).length;
}

/**
 * The carry case's judge: judgeScroll's stop and R-direction on L's frame as the app lays it out, and on top what the
 * ADR asks of the carry — no turn (a stroke of the table back up, a touch-down on the other half of it after one on the
 * first (touchTurns), or averi saying it turned (replies.ts#turnsSaid): the logged strokes alone miss turns merged into
 * a fling), none that carried the row from below its window to above it (the overshoot a full final stroke makes where
 * the window is narrower than its carry).
 */
export function judgeCarry(reply: string, state: LabState, start: LabState): LiveVerdict {
  const verdict = judgeScroll({ tag: CARRY.tag, view: CARRY.view, fully: false, platform: 'ios' }, [reply], state, start);
  const f0 = start.frames[CARRY.tag];
  const region = showRegion(start, 'ios', CARRY.view);
  if (verdict.outcome === 'MISMATCH' || f0 === undefined || region === undefined) return verdict;
  const o0 = start.offsets?.[CARRY.view] ?? 0;
  const top = (o: number) => f0.y - (o - o0);
  const strokes = strokesSince(state, start).filter((s) => s.view === CARRY.view);
  const turned = strokes.filter((s) => s.to < s.from - MOVE_SLACK);
  const past = strokes.filter((s) => top(s.from) + f0.height > region.y + region.height && top(s.to) < region.y);
  const clip = start.scrollViews?.[CARRY.view];
  const touched = clip === undefined ? 0 : touchTurns(state, start, clip);
  const said = turnsSaid(reply);
  const breaks = [
    ...turned.map((s) => `a stroke back up (${round(s.from)}→${round(s.to)}): averi turned`),
    ...(turned.length === 0 && Math.max(touched, said) > 0 ? [`turned ${Math.max(touched, said)}× (touch-downs ${touched}, the reply ${said})`] : []),
    ...past.map((s) => `a stroke carried it past its window (${round(s.from)}→${round(s.to)}: from below to above it)`),
  ];
  return breaks.length === 0 ? verdict : { outcome: 'MISMATCH', cls: 'R-direction', kind: verdict.kind, why: `R-direction (carry): ${breaks.join('; ')} — averi: ${short(reply)}`, app: verdict.app };
}

function carryCase(): VisibilityCase {
  return {
    id: `carry:${CARRY.cell}.${CARRY.tag}`,
    cell: CARRY.cell,
    sources: ['wda'],
    says: `scroll_until ${CARRY.tag} (row 30 of the table, whole over offsets 1172–1920, past one stroke's carry from the top and before the table's end) down: stops on it, every stroke on ${CARRY.view} bringing it closer, none carrying it past its window, no turn (LV5's carry on a long list)`,
    calls: [{ tool: 'scroll_until', args: { selector: `id:"lab.${CARRY.cell}.${CARRY.tag}"`, direction: 'down' } }],
    judge: (s, [reply], launched, _source, after) => judgeCarry(reply, after[0] ?? s, launched),
  };
}

function scrollCase(cell: string, t: TargetTruth, view: string, direction: Direction, fully: boolean, platform: Platform, says: string): VisibilityCase {
  return {
    id: `scroll:${cell}.${t.tag}${fully ? '.fully' : ''}`,
    cell,
    says,
    calls: [
      { tool: 'scroll_until', args: { selector: selectorOf(t), direction, ...(fully && { fully: true }) } },
      { tool: 'tap', args: { selector: selectorOf(t) } },
    ],
    judge: (s, replies, launched, source, after) => judgeScroll({ tag: t.tag, view, fully, platform, unlisted: askedUnlistedBy(t, source) !== undefined, axis: axisOf(direction) }, replies, s, launched, after[0] ?? s),
  };
}
