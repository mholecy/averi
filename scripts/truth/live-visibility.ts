import type { Platform } from '../differential/corpus.js';
import { screenUnchangedFor, swipesOf, VISIBLE_STOP } from './replies.js';
import type { CellTruth, Geometry, LabState, ProbeEvent, Rect, Stroke, TargetTruth } from './schema.js';
import { bandsOf, directionOf, geometryOf, intersect, isOverlap, type GeometryContext } from './truth.js';

/**
 * The live golden's visibility cases (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 5; run by live.ts): averi's
 * `tap` and `scroll_until` against the REAL lab app on the coloured-target cells, the app's own log the oracle — its
 * tap log (LabState.events: the target's action fired, nothing else), each scroll view's offset and the strokes it took
 * (LabState.offsets, LabState.strokes), and the targets' frames as the app lays them out after the call. What a
 * replayed tree cannot show: which scroll view a stroke moved and which way, whether a stop's target is where the reply
 * says, the turn back of a stroke that did not bring the target closer (R-direction, golden-spec/rows.ts), and whether a
 * tap fired what it says.
 *
 * The cases come from the static truth (tests/fixtures/truth, one CellTruth per cell and platform): a tap on every
 * target, expected to fire where its probe fired (`reached`, or `reachedAtPiece`); a scroll_until toward every target
 * not `whole` (toward it: rows.ts#directionOf), with `fully: true` too where it is cut or overlapped; plus the turn-back
 * cases (TURN_BACK), whose direction is the wrong one on purpose. Everything here is pure: live.ts runs the calls.
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
 *    tap on the state after the tap.
 */

export type Outcome = 'ok' | 'LOUD' | 'MISMATCH' | 'SKIP';
export interface Verdict {
  outcome: Outcome;
  why: string;
  /** The app's state behind the verdict (every scroll case's, any other case's not ok): live.ts prints it under the case. */
  app?: string;
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
const touchesText = (state: Pick<LabState, 'events'>, launched: Pick<LabState, 'events'>) => {
  const ts = state.events.slice(launched.events.length).filter((e) => e.kind === 'touch').map((e) => `(${e.tag})`);
  return ts.length === 0 ? 'none' : ts.join(' ');
};
const eventsText = (es: readonly ProbeEvent[]) => (es.length === 0 ? 'nothing' : es.map((e) => `${e.kind} ${e.tag}`).join(', '));
const rectText = (r: Rect | undefined | null) => (r === undefined || r === null ? 'none' : `${round(r.x)},${round(r.y)} ${round(r.width)}x${round(r.height)}`);
const round = (n: number) => Math.round(n * 10) / 10;
export const short = (reply: string) => reply.split('\n')[0].slice(0, 260);
/** The reply claims the tap: `Tapped …`, not an error. */
export const claimsTap = (reply: string) => reply.startsWith('Tapped');
/** The reply claims the stop: `Element … visible after N swipes` (fully or not). */
export const claimsVisible = (reply: string) => VISIBLE_STOP.test(reply);

/**
 * What the target's geometry is judged against in the live state: the screen, the bands (iOS's home-indicator band is
 * no band averi judges — golden-spec/bars.ts — so only its status band), the target's scroll view's clip, the chrome.
 */
export function liveContext(state: LabState, platform: Platform, view: string | undefined): GeometryContext {
  const clip = view === undefined ? undefined : state.scrollViews?.[view];
  return {
    screen: { x: 0, y: 0, width: state.screen.width, height: state.screen.height },
    ...(state.safeArea !== undefined && { safeArea: platform === 'ios' ? { ...state.safeArea, bottom: 0 } : state.safeArea }),
    ...(clip !== undefined && { clip }),
    ...(state.chrome !== undefined && { chrome: state.chrome }),
  };
}

/** Where a stop may leave its target (truth.ts#geometryOf): the plain stop on a centre in what shows, clear of the bands and the chrome (R-overlap's whole target too); `fully` only on a whole one. */
export function stopHolds(g: Geometry, fully: boolean): boolean {
  if (fully) return g === 'whole';
  return g === 'whole' || g === 'partly-centre-in' || isOverlap(g);
}

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
 * must have fired nothing (a dismissed layer is something). A refusal of a target the probe reached is LOUD (`fires`
 * expected); a `Tapped` that fired it alone is ok either way — the truth's probe at the centre is not the only tap
 * that reaches it.
 */
export function judgeTap(tag: string, fires: boolean, reply: string, state: LabState, launched: LabState): Verdict {
  const fired = firedSince(state, launched);
  const own = fired.filter((e) => e.kind === 'tap' && e.tag === tag);
  const others = fired.filter((e) => !(e.kind === 'tap' && e.tag === tag));
  if (claimsTap(reply)) {
    if (own.length === 0) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the app logged ${eventsText(fired)}` };
    if (others.length > 0) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the app fired ${eventsText(others)} besides ${tag}` };
    return { outcome: 'ok', why: `${short(reply)}${fires ? '' : ' (fired, where the probe at its centre did not reach it)'}` };
  }
  if (fired.length > 0) return { outcome: 'MISMATCH', why: `averi refused (${short(reply)}) — yet the app logged ${eventsText(fired)}` };
  return fires ? { outcome: 'LOUD', why: `refused a target a tap reaches, nothing fired: ${short(reply)}` } : { outcome: 'ok', why: `refused, nothing fired: ${short(reply)}` };
}

// --- the dismissal (#7, #19) ---

/**
 * A tap on `tag`, a field under the keyboard, with the cell's `keyboardDismiss` configured — judged by the app's form
 * model: nothing typed into any field, no submit; `Tapped` only with the focus on `tag`. A refusal: under idb (the
 * dismissal inert) the documented answer; under WDA honest when the dismissal was tapped (the editing ended — no field
 * focused) and the field then refused for where it lies once the keyboard is gone; else LOUD (not dismissed).
 */
export function judgeDismissal(tag: string, reply: string, source: string, s: LabState, launched: LabState): Verdict {
  const typed = Object.entries(s.fields ?? {}).filter(([k, f]) => f.value !== launched.fields?.[k]?.value);
  if (typed.length > 0) return { outcome: 'MISMATCH', why: `typed into ${typed.map(([k, f]) => `${k} (${JSON.stringify(f.value)})`).join(', ')}: ${short(reply)}` };
  if ((s.submits ?? []).length > 0) return { outcome: 'MISMATCH', why: `the form was submitted: ${short(reply)}` };
  const tapped = claimsTap(reply);
  const focus = s.focus ?? 'none';
  if (tapped !== (s.focus === tag)) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${focus}` };
  if (tapped) return { outcome: 'ok', why: short(reply) };
  if (source === 'idb') return { outcome: 'ok', why: `refused (idb: the dismissal inert), focus on ${focus}: ${short(reply)}` };
  if (s.focus == null && launched.focus != null && /was not tapped: after .* was tapped .* to hide the soft keyboard/.test(reply)) {
    return { outcome: 'ok', why: `the keyboard dismissed (no field focused), then ${tag} refused: ${short(reply)}` };
  }
  return { outcome: 'LOUD', why: `not tapped, the focus on ${focus}, though a dismissal is configured: ${short(reply)}` };
}

// --- the strokes (R-direction) ---

/**
 * How far the target lies from showing whole, at a scroll offset `o` of its scroll view: the target's frame at launch
 * (`f0`, the view at offset `o0`) moved by the offset's change, against `region` — its scroll view's clip on the screen
 * below the status band, less a full-width chrome at its top or bottom edge (a sticky header, a tab bar, a pinned
 * bar). 0 when it shows whole there.
 */
export function distanceAt(o: number, f0: Rect, o0: number, region: Rect): number {
  const top = f0.y - (o - o0);
  return Math.max(0, region.y - top) + Math.max(0, top + f0.height - (region.y + region.height));
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

/** The strokes of the target's own scroll view since the launch, each classed by what it did to the target's distance. */
export function classStrokes(state: LabState, launched: LabState, platform: Platform, tag: string, view: string): ClassedStroke[] | undefined {
  const f0 = launched.frames[tag];
  const region = showRegion(launched, platform, view);
  if (f0 === undefined || region === undefined) return undefined;
  const o0 = launched.offsets?.[view] ?? 0;
  return strokesSince(state, launched)
    .filter((s) => s.view === view)
    .map((s) => {
      const d0 = distanceAt(s.from, f0, o0, region);
      const d1 = distanceAt(s.to, f0, o0, region);
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
 * app shows it as the stop needs it failed what happened. The tap after a stop must fire it alone (judgeTap).
 */
export function judgeScroll(
  c: { tag: string; view: string; fully: boolean; platform: Platform; unlisted?: boolean },
  [scroll, tap]: readonly string[],
  final: LabState,
  launched: LabState,
  atStop: LabState = final,
): Verdict {
  // The stop on the state read when scroll_until returned (`atStop`), the tap on the state after it (`final`).
  const state = atStop;
  const app = appText(final, c.platform, c.tag, c.view, launched);
  const g = liveGeometry(state, c.platform, c.tag, c.view);
  const holds = g !== undefined && stopHolds(g, c.fully);
  const classed = classStrokes(state, launched, c.platform, c.tag, c.view) ?? [];
  const f0 = launched.frames[c.tag];
  const region = showRegion(launched, c.platform, c.view);
  const end = f0 === undefined || region === undefined ? 0 : distanceAt(state.offsets?.[c.view] ?? launched.offsets?.[c.view] ?? 0, f0, launched.offsets?.[c.view] ?? 0, region);
  const breaks = directionBreaks(strokesSince(state, launched), classed, c.view, swipesOf(scroll), end);
  const stop = c.fully ? 'fully visible' : 'visible';
  const tapped = tap === undefined ? undefined : judgeTap(c.tag, holds, tap, final, launched);
  const unchanged = unchangedClaimBroken(scroll, strokesSince(state, launched));
  if (claimsVisible(scroll) && !holds) return { outcome: 'MISMATCH', why: `averi says ${short(scroll)} — the app lays it out ${g ?? 'nowhere'}, not ${stop}${tapped?.outcome === 'MISMATCH' ? `; then the tap: ${tapped.why}` : ''}`, app };
  if (tapped?.outcome === 'MISMATCH') return { ...tapped, why: `after ${short(scroll)}, the tap: ${tapped.why}`, app };
  // Whatever the tree listed: a claim about the screen the app's own strokes contradict.
  if (unchanged !== undefined) return { outcome: 'MISMATCH', why: `${unchanged}: ${short(scroll)}`, app };
  // A target the tree does not list (uiautomator dumps no node not visible to the user): averi cannot tell where it
  // lies, nor which scroll view holds it — what R-stroke exempts too (golden-spec/rows.ts#strokeRow); its strokes are
  // reported, not judged.
  if (breaks.length > 0 && c.unlisted !== true) return { outcome: 'MISMATCH', why: `R-direction: ${breaks.join('; ')} — averi: ${short(scroll)}`, app };
  if (!claimsVisible(scroll)) {
    const unjudged = breaks.length > 0 ? ` (not in the tree: its strokes unjudged — ${breaks.join('; ')})` : '';
    return holds ? { outcome: 'MISMATCH', why: `averi failed (${short(scroll)}) — the app shows it ${g} (${stop} as the stop needs)`, app } : { outcome: 'LOUD', why: `not reached (${g ?? 'no frame'}), and averi said so${unjudged}: ${short(scroll)}`, app };
  }
  if (tap === undefined || tapped === undefined) return { outcome: 'ok', why: short(scroll), app };
  if (tapped.outcome !== 'ok') return { ...tapped, why: `stopped (${short(scroll)}), then the tap: ${tapped.why}`, app };
  return { outcome: 'ok', why: `${short(scroll)}; then ${short(tap)}`, app };
}

/**
 * A scroll_until for a target beneath a presented layer (`declared: presented-over`): no stop where it lies covered, no
 * stroke on the screen beneath (it would move the host under the layer or drag the layer), the layer not dismissed.
 */
export function judgePresentedScroll(c: { tag: string; view: string | undefined; platform: Platform }, [scroll]: readonly string[], state: LabState, launched: LabState): Verdict {
  const app = appText(state, c.platform, c.tag, c.view, launched);
  const fired = firedSince(state, launched);
  const moved = strokesSince(state, launched).filter((s) => Math.abs(s.to - s.from) > MOVE_SLACK);
  if (claimsVisible(scroll)) return { outcome: 'MISMATCH', why: `averi says ${short(scroll)} — the target lies beneath the presented layer`, app };
  if (fired.length > 0) return { outcome: 'MISMATCH', why: `the app logged ${eventsText(fired)} — averi: ${short(scroll)}`, app };
  if (moved.length > 0) return { outcome: 'MISMATCH', why: `stroked beneath the presented layer: ${moved.map((s) => `${s.view} ${round(s.from)}→${round(s.to)}`).join(', ')} — averi: ${short(scroll)}`, app };
  return { outcome: 'ok', why: `refused, nothing moved or fired: ${short(scroll)}`, app };
}

// --- the cases ---

export interface VisibilityCall {
  tool: 'tap' | 'scroll_until';
  args: Record<string, unknown>;
}

export interface VisibilityCase {
  id: string;
  cell: string;
  says: string;
  calls: VisibilityCall[];
  /**
   * `source`: the tree source the case ran under — a target its static capture's tree of that source did not list
   * (TargetTruth.listed) is not held to R-direction. `after[i]`: the state read right after call i (live.ts reads one
   * between the calls of a visibility case).
   */
  judge(state: LabState, replies: string[], launched: LabState, source: string, after: readonly (LabState | undefined)[]): Verdict;
}

/** The target's static capture's tree of `source` did not list it (TargetTruth.listed): averi cannot know where it lies. */
export const unlistedIn = (t: Pick<TargetTruth, 'listed'>, source: string) => t.listed?.[source as keyof NonNullable<TargetTruth['listed']>] === false;

/** A text target is asked by its text, as the static rows ask it (golden-spec/false-covers.ts#ownPartsRows); else by id. */
export const selector = (t: Pick<TargetTruth, 'id' | 'text'>) => (t.text !== undefined ? `text:"${t.text}"` : `id:"${t.id}"`);
/** A cut or overlapped target: `fully: true` asks more of it than the plain stop (R-fully). */
const CUT: readonly string[] = ['partly-centre-in', 'centre-out', 'sliver'];
const fullyAsked = (g: Geometry | undefined) => g !== undefined && (CUT.includes(g) || isOverlap(g) || g === 'status-band' || g === 'nav-band');

/**
 * The turn-back cases (#17, R-direction): a scroll_until whose direction is the WRONG one — the content at its end that
 * way (a stroke moves nothing), or the target carried further off by the first stroke — must turn back and stop on it.
 */
export const TURN_BACK: readonly { cell: string; tag: string; direction: 'up' | 'down'; fully?: true; says: string }[] = [
  { cell: 'scroll-top-edge-end', tag: 'T', direction: 'down', says: 'the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17)' },
  { cell: 'scroll-top-edge-end', tag: 'T', direction: 'down', fully: true, says: 'as the plain one, fully: turn back up (#17)' },
  { cell: 'scroll-top-edge', tag: 'T', direction: 'down', says: 'T in the status band, more content below: a stroke down carries it off the top — turn back' },
  { cell: 'scroll-bounded', tag: 'F', direction: 'up', says: 'lower at its top, F below: a stroke up moves nothing — turn back down' },
];

/**
 * Every case of a cell's truth on its platform: a tap per target (`fires` where its probe fired), a scroll_until per
 * target not whole (toward it; `fully` too where it is cut or overlapped; a refusal case beneath a presented layer), and
 * the cell's turn-back cases. `withTap`: a tap follows each stop, judged with it.
 */
export function visibilityCases(truth: CellTruth, platform: Platform): VisibilityCase[] {
  const cases: VisibilityCase[] = [];
  for (const t of truth.targets) {
    // Reached at its centre: the tap must fire it. Else — or in a system band, where R-band takes a refusal even where
    // the probe fired (Android's navigation band under gestures) — a refusal is as good (R-land, R-band: refused, or
    // Tapped inside what shows) — but never a `Tapped` that fired nothing, or something else.
    const fires = t.reached && t.geometry !== 'status-band' && t.geometry !== 'nav-band';
    cases.push({
      id: `tap:${truth.cell}.${t.tag}`,
      cell: truth.cell,
      says: `tap ${t.tag} (${t.geometry ?? t.declared}): ${fires ? 'fires it alone' : 'refused, nothing fires — or fires it alone'}`,
      calls: [{ tool: 'tap', args: { selector: selector(t) } }],
      judge: (s, [reply], launched) => judgeTap(t.tag, fires, reply, s, launched),
    });
    if (t.declared === 'presented-over') {
      if (t.scrollView === undefined) continue;
      cases.push({
        id: `scroll:${truth.cell}.${t.tag}`,
        cell: truth.cell,
        says: `scroll_until ${t.tag} beneath the presented layer: refused, nothing stroked, nothing dismissed`,
        calls: [{ tool: 'scroll_until', args: { selector: selector(t), direction: directionOf(t, truth) } }],
        judge: (s, replies, launched, _source, after) => judgePresentedScroll({ tag: t.tag, view: t.scrollView, platform }, replies, after[0] ?? s, launched),
      });
      continue;
    }
    if (t.scrollView === undefined || t.geometry === undefined || t.geometry === 'whole') continue;
    const view = t.scrollView;
    for (const fully of fullyAsked(t.geometry) ? [false, true] : [false]) {
      const direction = directionOf(t, truth);
      cases.push(scrollCase(truth.cell, t, view, direction, fully, platform, `scroll_until ${t.tag} (${t.geometry}) ${direction}${fully ? ', fully' : ''}: stops on it as the app lays it out, every stroke on ${view} bringing it closer, then the tap fires it`));
    }
  }
  for (const b of TURN_BACK.filter((x) => x.cell === truth.cell)) {
    const t = truth.targets.find((x) => x.tag === b.tag);
    if (t?.scrollView === undefined) continue;
    cases.push({ ...scrollCase(truth.cell, t, t.scrollView, b.direction, b.fully === true, platform, `turn back: ${b.says}`), id: `turn:${truth.cell}.${t.tag}${b.fully ? '.fully' : ''}` });
  }
  return cases;
}

function scrollCase(cell: string, t: TargetTruth, view: string, direction: 'up' | 'down', fully: boolean, platform: Platform, says: string): VisibilityCase {
  return {
    id: `scroll:${cell}.${t.tag}${fully ? '.fully' : ''}`,
    cell,
    says,
    calls: [
      { tool: 'scroll_until', args: { selector: selector(t), direction, ...(fully && { fully: true }) } },
      { tool: 'tap', args: { selector: selector(t) } },
    ],
    judge: (s, replies, launched, source, after) => judgeScroll({ tag: t.tag, view, fully, platform, unlisted: unlistedIn(t, source) }, replies, s, launched, after[0] ?? s),
  };
}
