import type { Platform, SourceKind } from '../differential/corpus.js';
import { DRAWN, type Geometry, type Insets, type Rect, type TargetTruth } from './schema.js';
import { geometryOf, isOverlap, parseGeometry, type GeometryContext } from './truth.js';

/**
 * The target contract: what a coloured target is ASKED and what its truth implies each verb must answer — decided once,
 * from the target's TargetTruth (declared, reached, drawn, its frame and measured geometry, listed, its scroll view),
 * its capture's screen, its platform and the tree source replayed or run (contractOf; unlistedBy, stringUnlistedBy per
 * source). Both goldens are its consumers, never its authors:
 *  - the replayed golden (scripts/differential/golden-spec.ts, its façade, and the rows of golden-spec/: base, edges,
 *    bars, text, presented) hands each clause to the row that judges it — a call, a judge over the replayed tree's reply
 *    and the fake device's log — the row recording the clause that chose it (Expectation.asks);
 *  - the live golden (live-visibility.ts#visibilityCases) turns it into a case — calls on the real lab app, a judge over
 *    the app's own log — recording it too (VisibilityCase.asks); it judges the app's state at the stop in the same
 *    judged context (judgedContext).
 * tests/truth/target-contract.test.ts holds them to it for every committed truth target both ask (static ↔ live
 * parity): the recorded clauses are equal; and the two JUDGES agree, fed the same synthetic answers — a refusal that
 * sent and fired nothing (both accept it unless the clause is `fire`), a `Tapped` that fired the target alone where the
 * clause lands it (the replay accepts it unless the clause is `refuse`; the live oracle always, below), a stop with no
 * swipe on the target where its capture lays it out (both accept it exactly where the clause `holds`). A rule about
 * which band is a band (judgedContext, and the two predicates every reader branches on: isBand, bandNamed), whether a
 * target may be missing from the tree, or what its tap and stops must do is written here and nowhere else. Who TAKES a
 * raw tap in a band is no rule of the contract but a measurement of the capture's (truth.ts#systemBarSwallows,
 * #statusBarMaySwallow, #navigationBandTakes): consistency holds the probe to it, and the rows whose answer the
 * measurement decides — R-band's colour (golden-spec/rows.ts#bandColour) and the ocr row in Android's navigation band
 * (golden-spec/text.ts#textRows) — read it there; the tap's clause reads only what the probe did (`reached`).
 *
 * What the two judges read differently is their ORACLE, not the contract: the replay knows only the capture's probe (a
 * raw tap at the centre fired the target or not) and the tree; the live golden reads the app's tap log. So a clause
 * `refuse` or `land-or-refuse` is judged live as "nothing fired, or the target alone" — a `Tapped` that fired the
 * target alone is true of the app whatever the probe at its centre said (live-visibility.ts#judgeTap) — and live judges
 * no remedy's wording (the replay does: `scroll_until`, `close it first`). `fire` is the same in both: a refusal is
 * wrong.
 *
 * How a target is ADDRESSED is one rule both goldens share, truth.ts#selectorOf: a text target (CatalogTarget.text) by
 * its string, as an agent would ask it, any other by its identifier — every tap and scroll_until of the replayed rows
 * (golden-spec/base.ts, golden-spec/rows.ts) and of the live cases. So whether the target AS ASKED may be missing from a
 * tree is the string's for a text target (askedUnlistedBy): text-under-bar's P on Android, its node listed by the
 * uncovered strip above the pinned button, its string by no node, is not found by `text:"…"` — an honest answer. The
 * colour assert still names its element by the identifier (its rows read unlistedBy).
 */

// --- which bands are bands: the geometry the contract judges by ---

/** A system band a geometry names: the status band, or Android's navigation band (never iOS's, judgedContext). */
export type Band = 'status' | 'nav';

/** Whether the target's centre lies in a system band (`status-band`, `nav-band`): R-band's targets. */
export const isBand = (g: Geometry | undefined): g is 'status-band' | 'nav-band' => g === 'status-band' || g === 'nav-band';

/**
 * The system band a geometry places the target in — its centre there (isBand) or a whole target's edge overlapping it
 * past the slack (`band-overlap:<band>`) — or undefined: it names none.
 */
export function bandNamed(g: Geometry | undefined): Band | undefined {
  if (g === 'status-band') return 'status';
  if (g === 'nav-band') return 'nav';
  if (g === 'band-overlap:status') return 'status';
  if (g === 'band-overlap:nav') return 'nav';
  return undefined;
}

/**
 * The screen a geometry is judged on: the capture's (CellTruth) for the replayed golden, the app's state at the stop
 * (LabState) for the live one — the same fields, read by one function (judgedContext).
 */
export interface JudgedScreen {
  screen: { width: number; height: number };
  safeArea?: Insets;
  scrollViews?: Record<string, Rect>;
  chrome?: Record<string, Rect>;
}

/**
 * The system bands the contract judges a geometry against — on iOS its status band only. iOS's home-indicator band (the
 * safe area's bottom inset) is no band averi judges — ADR 0009's navigation band is Android's, ADR 0008 is iOS's status
 * band — and none the truth makes one, for any verb:
 *  - a tap there is the app's: measured by B4 (truth.ts#navigationBandTakes, docs/truth/band-probes-2026-10-16.md), raw
 *    taps at (201,857) and (60,857) logged their touch and fired N, always;
 *  - what is drawn there is the target: consistency holds a target centred there drawn as itself (bands' N, iOS: 100 %
 *    of its own colour, the indicator over it taking no measurable share) — so a sample or a reading of it measures the
 *    target, as of one in the open;
 *  - a stop there stops on the target: nothing averi models covers it (ADR 0018's amendment: inventing a 34-pt
 *    home-indicator band would refuse real taps elsewhere).
 * So a target whose centre lies in that band, or whose edge overlaps it, is judged by what else lies around it, as if
 * the inset were not there — `whole` when nothing else does (ADR 0020: the truth outranks a hand-written expectation).
 * The one context both goldens judge a geometry in (judgedGeometry for the replay, live-visibility.ts#liveGeometry for
 * the live golden). Android's navigation band is a band: who takes it is the navigation mode's (navigationBandTakes).
 * Where a swipe may touch down is another question (golden-spec/judges.ts#strokeable): a stroke from the home-indicator
 * band is the system's go-home gesture, and stays off it.
 */
export function judgedContext(platform: Platform, s: JudgedScreen, view: string | undefined): GeometryContext {
  const clip = view === undefined ? undefined : s.scrollViews?.[view];
  return {
    screen: { x: 0, y: 0, width: s.screen.width, height: s.screen.height },
    ...(s.safeArea !== undefined && { safeArea: platform === 'ios' ? { ...s.safeArea, bottom: 0 } : s.safeArea }),
    ...(clip !== undefined && { clip }),
    ...(s.chrome !== undefined && { chrome: s.chrome }),
  };
}

/**
 * The geometry the contract judges a target by: truth.ts#geometryOf over its frame in the judged context
 * (judgedContext) of its capture's screen — the live golden judges the app's state in that same context
 * (live-visibility.ts#liveGeometry). The capture measured its geometry in the full context (every band); the judged one
 * drops only iOS's home-indicator band, and geometryOf reads that band only where it names it (`nav-band` for a centre
 * in it, `band-overlap:nav` from regionOverlap, which tries the status band first and the chrome after): so a measured
 * geometry naming no navigation band is the judged one as measured, and one naming it on iOS is measured again in the
 * judged context. tests/truth/target-contract.test.ts holds this over the committed truth (every target's geometry in
 * the judged context equals this; it differs from the measured one for bands' N and Q on iOS only). A target measured
 * nothing (`geometry` undefined, every capture before phase 3) has none to judge.
 */
export function judgedGeometry(platform: Platform, t: Pick<TargetTruth, 'geometry' | 'frame' | 'scrollView'>, cell: JudgedScreen): Geometry | undefined {
  if (t.geometry === undefined) return undefined;
  const dropsTheNavigationBand = platform === 'ios' && (cell.safeArea?.bottom ?? 0) > 0;
  return dropsTheNavigationBand && bandNamed(t.geometry) === 'nav' ? geometryOf(t.frame, judgedContext(platform, cell, t.scrollView)) : t.geometry;
}

// --- the tree ---

/**
 * Why the target may be missing from the tree of `source`: the capture's tree of that source did not list it
 * (TargetTruth.listed, truth.ts#listedIn) — uiautomator dumps no node not visible to the user, so scroll-bounded's O and
 * F and scroll-top-edge's A are not in the Android dump (docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md, its
 * Android part). undefined: the tree lists it, or the capture did not record it — held to be in the tree. The replayed
 * rows of a target off what shows accept a reply that never found it (golden-spec/edges.ts: its `absent`), and R-stroke
 * asks no scroll view of its strokes (golden-spec/rows.ts#strokeRow); the live case holds its strokes to no
 * R-direction (live-visibility.ts#judgeScroll): averi cannot know where a node it never saw lies, nor which scroll view
 * holds it.
 */
export function unlistedBy(t: Pick<TargetTruth, 'listed'>, source: string): string | undefined {
  return t.listed?.[source as SourceKind] === false ? `the capture's ${source} tree does not list it` : undefined;
}

/**
 * Why a text target's STRING may be missing from the tree of `source` — the string's own rule beside unlistedBy (the
 * target's node): its capture's tree of that source lists no node carrying it (TargetTruth.textListed, measured from
 * the tree: uiautomator dumps no node the user cannot see — text-under-bar's P, its box listed by its uncovered strip
 * above the button, its string not at all). Only then is a covered `ocr` row's "not found" right (golden-spec/text.ts);
 * where the tree lists the string (S in the status band) it is no evidence, as everywhere. No live case asks a string
 * yet (the live golden's visibility cases tap and scroll; it reads no text).
 */
export function stringUnlistedBy(t: Pick<TargetTruth, 'textListed'>, source: string): string | undefined {
  return t.textListed?.[source as SourceKind] === false ? `the ${source} capture lists no node carrying the string (TargetTruth.textListed): it is wholly under what is drawn over it` : undefined;
}

/**
 * Why the target may be missing from the tree of `source` AS A TAP OR A STOP ASKS IT (truth.ts#selectorOf): a text
 * target by its string (stringUnlistedBy), any other — or a text target whose capture recorded no string listing — by
 * its node (unlistedBy). What the replayed rows' `absent` and the live stops' `unlisted` read for a selector-asked call.
 */
export function askedUnlistedBy(t: Pick<TargetTruth, 'text' | 'listed' | 'textListed'>, source: string): string | undefined {
  if (t.text !== undefined && t.textListed?.[source as SourceKind] !== undefined) return stringUnlistedBy(t, source);
  return unlistedBy(t, source);
}

// --- the tap ---

/**
 * What a tap on the target must do:
 *  - `fire`: `Tapped`, a refusal is wrong — `inside: 'node'` an open target (at its node's centre, golden-spec/base.ts
 *    #atProbe), `inside: 'visible'` a cut or edge-overlapped one reached at its centre (inside what shows, R-land);
 *  - `land-or-refuse`: a probe fired it, but averi's model may refuse it — `Tapped` inside what shows (`visible`: in a
 *    system band whose probe fired, R-band) or inside its piece (`piece`: a covered centre whose second probe fired,
 *    R-land), or refused with nothing sent;
 *  - `refuse`: nothing tapped, naming `remedy` where the rule decides one (ADR 0005, ADR 0013: scroll_until first;
 *    ADR 0018: close it first).
 */
export type TapAsk =
  | { must: 'fire'; inside: 'node' | 'visible' }
  | { must: 'land-or-refuse'; inside: 'visible' | 'piece' }
  | { must: 'refuse'; remedy?: 'scroll_until' | 'close it first' };

/**
 * A target's tap clause, from its truth and its judged geometry (judgedGeometry); undefined for a target the truth contradicts itself on (consistency breaks it:
 * an open whole target not reached or not drawn, a presented-over one reached) — neither golden asks it. The rows
 * that cite each rule: golden-spec/rows.ts's table (R-off, R-outside-sv, R-sliver, R-land, R-band), presented.ts,
 * base.ts.
 */
export function tapAsk(t: TargetTruth, judged: Geometry | undefined): TapAsk | undefined {
  if (t.declared === 'presented-over') return t.reached ? undefined : { must: 'refuse', remedy: 'close it first' };
  const g = judged ?? 'whole';
  if (g === 'whole') return t.reached && t.drawn >= DRAWN ? { must: 'fire', inside: 'node' } : undefined;
  if (g === 'off-screen' || g === 'outside-scroll-view' || g === 'sliver') return { must: 'refuse', remedy: 'scroll_until' };
  if (isBand(g)) return t.reached ? { must: 'land-or-refuse', inside: 'visible' } : { must: 'refuse' };
  // R-land: reached at its centre — cut with its centre in what shows, or a whole one overlapped at its edge.
  if ((g === 'partly-centre-in' || isOverlap(g)) && t.reached) return { must: 'fire', inside: 'visible' };
  // Its centre covered or cut away (centre-out, under-chrome): its piece, where the second probe fired there.
  return t.reachedAtPiece === true ? { must: 'land-or-refuse', inside: 'piece' } : { must: 'refuse' };
}

// --- the stops ---

/**
 * What a scroll_until (`fully` or not) is asked of the target where its capture lays it out: `holds`, a stop there is
 * right (stopHolds) — the replay asks it reached with no swipe; else not stopped on where it is (the replay: the stop
 * fails, or swipes toward it off what shows; live: it must stop only once the app lays it out where the stop holds).
 */
export interface StopAsk {
  fully: boolean;
  holds: boolean;
}

/** The stop clause of `fully` or the plain stop on a target where its capture lays it out (stopHolds on its judged geometry). */
export function stopAsk(judged: Geometry | undefined, fully: boolean): StopAsk {
  return { fully, holds: stopHolds(judged ?? 'whole', fully) };
}

/** Cut by its scroll view or the screen: the `fully` stop asks more of it than the plain one (R-fully). */
const CUT: readonly Geometry[] = ['partly-centre-in', 'centre-out', 'sliver'];

/**
 * Where a stop may leave its target (truth.ts#geometryOf): the plain stop on a centre in what shows, clear of the bands
 * and the chrome (ADR 0009 N-a: centre-based — R-overlap's whole target too); `fully` only on a whole one. The replay
 * reads it at the capture (golden-spec/rows.ts#stopRow: reached at once where it holds, else not reached where it is);
 * the live golden at the stop, on the app's own layout (live-visibility.ts#judgeScroll).
 */
export function stopHolds(g: Geometry, fully: boolean): boolean {
  if (fully) return g === 'whole';
  return g === 'whole' || g === 'partly-centre-in' || isOverlap(g);
}

/**
 * Whether `fully: true` is asked of the target beside the plain stop (R-fully): a cut target (CUT); one whose edge the
 * chrome overlaps; and, in a scroll view only, one in a system band or overlapped at its edge by one — a target in no
 * scroll view there may be a pinned surface the `fully` stop stops on at once (ADR 0009 (b), (c)). On the judged
 * geometry (judgedGeometry).
 */
export function fullyAsked(g: Geometry | undefined, scrollView: string | undefined): boolean {
  if (g === undefined) return false;
  if (CUT.includes(g) || parseGeometry(g).kind === 'chrome-overlap') return true;
  return bandNamed(g) !== undefined && scrollView !== undefined;
}

// --- the whole contract of a target ---

/**
 * The geometry contractOf decides by. A presented-over target's is not judged — no clause reads it: the presented layer
 * comes first whatever else lies there (ADR 0018, golden-spec/presented.ts). An unmeasured or `whole` one needs no
 * screen: the judged context only drops a band, so a target whole among every band is whole among fewer. Any other
 * needs its capture's screen (judgedGeometry): without it, an error — the replay asks no geometry row of a capture it
 * has not got (golden-spec.ts#expectations returns none before asking the contract).
 */
function contractGeometry(platform: Platform, t: TargetTruth, cell: JudgedScreen | undefined): Geometry | undefined {
  if (t.declared === 'presented-over' || t.geometry === undefined || t.geometry === 'whole') return t.geometry;
  if (cell === undefined) throw new Error(`${t.id}: its measured geometry ${t.geometry} is judged on its capture's screen, and none was given`);
  return judgedGeometry(platform, t, cell);
}

/**
 * What a target is asked, decided once — what both goldens read: its judged geometry, its tap clause, the plain stop's
 * clause where its capture lays it out, and `fully`'s where it is asked (undefined: not asked). The replay hands each
 * clause to the row that judges it (the row records the clause that chose it: Expectation.asks); the live golden to its
 * case (VisibilityCase.asks). Whether the target may be missing from a tree is per source: unlistedBy.
 */
export interface TargetContract {
  geometry: Geometry | undefined;
  tap: TapAsk | undefined;
  stop: StopAsk;
  fully: StopAsk | undefined;
}

export function contractOf(platform: Platform, t: TargetTruth, cell: JudgedScreen | undefined): TargetContract {
  const geometry = contractGeometry(platform, t, cell);
  return { geometry, tap: tapAsk(t, geometry), stop: stopAsk(geometry, false), fully: fullyAsked(geometry, t.scrollView) ? stopAsk(geometry, true) : undefined };
}
