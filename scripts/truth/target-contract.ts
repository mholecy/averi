import type { Platform, SourceKind } from '../differential/corpus.js';
import { DRAWN, type Geometry, type Insets, type TargetTruth } from './schema.js';
import { isOverlap, parseGeometry } from './truth.js';

/**
 * The target contract: what a coloured target is ASKED and what its truth implies each verb must answer — decided once,
 * from the target's TargetTruth (declared, reached, drawn, the measured geometry, listed, its scroll view), its platform
 * and the tree source replayed or run. Both goldens are its consumers, never its authors:
 *  - the replayed golden (scripts/differential/golden-spec.ts, its façade, and the rows of golden-spec/: base, edges,
 *    bars, text, presented) turns a clause into a row — a call, a judge over the replayed tree's reply and the fake
 *    device's log — and stamps the clause on it (Expectation.asks);
 *  - the live golden (live-visibility.ts#visibilityCases) turns it into a case — calls on the real lab app, a judge over
 *    the app's own log — and stamps it too (VisibilityCase.asks).
 * tests/truth/target-contract.test.ts holds them to it: for every committed truth target both ask, the stamped clauses
 * are equal, and the two judges agree on a refusal (static ↔ live parity). A rule about which band is a band, whether a
 * target may be missing from the tree, or what its tap and stops must do is written here and nowhere else.
 *
 * What the two judges read differently is their ORACLE, not the contract: the replay knows only the capture's probe (a
 * raw tap at the centre fired the target or not) and the tree; the live golden reads the app's tap log. So a clause
 * `refuse` or `land-or-refuse` is judged live as "nothing fired, or the target alone" — a `Tapped` that fired the
 * target alone is true of the app whatever the probe at its centre said (live-visibility.ts#judgeTap) — and live judges
 * no remedy's wording (the replay does: `scroll_until`, `close it first`). `fire` is the same in both: a refusal is
 * wrong.
 */

// --- which bands are bands ---

/**
 * iOS's home-indicator band (the safe area's bottom inset on iOS) is no band averi judges — ADR 0009's navigation band
 * is Android's, ADR 0008 is iOS's status band — and none the truth makes one: measured by B4 (truth.ts
 * #navigationBandTakes, docs/truth/band-probes-2026-10-16.md), raw taps there at (201,857) and (60,857) logged their
 * touch and fired N, the APP's, always; and consistency holds a target centred there reached and drawn as itself. So
 * the contract judges such a target as what it is to the app: `whole` (judgedGeometry), asked what an open target is —
 * the tap fires it, its colour passes, reached at once (ADR 0020: the truth outranks a hand-written expectation). The
 * one rule both goldens read — the replayed rows' choice by geometry (golden-spec.ts#expectations, golden-spec/text.ts)
 * and the live judge's geometry (live-visibility.ts#liveContext, through judgedSafeArea).
 */
export const homeIndicatorBand = (platform: Platform, g: Geometry | undefined) => platform === 'ios' && g === 'nav-band';

/** The geometry the contract judges a target by: its measured one, iOS's home-indicator band read as `whole` (homeIndicatorBand). */
export function judgedGeometry(platform: Platform, g: Geometry | undefined): Geometry | undefined {
  return homeIndicatorBand(platform, g) ? 'whole' : g;
}

/**
 * The system bands a geometry is judged against on a live screen (truth.ts#geometryOf's safe area): on iOS its status
 * band only — the home-indicator band is no band (homeIndicatorBand) — so a live geometry never says `nav-band` there.
 */
export function judgedSafeArea(platform: Platform, safeArea: Insets): Insets {
  return platform === 'ios' ? { ...safeArea, bottom: 0 } : safeArea;
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
 * A target's tap clause, from its truth; undefined for a target the truth contradicts itself on (consistency breaks it:
 * an open whole target not reached or not drawn, a presented-over one reached) — neither golden asks it. The rows
 * that cite each rule: golden-spec/rows.ts's table (R-off, R-outside-sv, R-sliver, R-land, R-band), presented.ts,
 * base.ts.
 */
export function tapAsk(platform: Platform, t: TargetTruth): TapAsk | undefined {
  if (t.declared === 'presented-over') return t.reached ? undefined : { must: 'refuse', remedy: 'close it first' };
  const g = judgedGeometry(platform, t.geometry) ?? 'whole';
  if (g === 'whole') return t.reached && t.drawn >= DRAWN ? { must: 'fire', inside: 'node' } : undefined;
  if (g === 'off-screen' || g === 'outside-scroll-view' || g === 'sliver') return { must: 'refuse', remedy: 'scroll_until' };
  if (g === 'status-band' || g === 'nav-band') return t.reached ? { must: 'land-or-refuse', inside: 'visible' } : { must: 'refuse' };
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
export function stopAsk(platform: Platform, t: Pick<TargetTruth, 'geometry'>, fully: boolean): StopAsk {
  return { fully, holds: stopHolds(judgedGeometry(platform, t.geometry) ?? 'whole', fully) };
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
 * geometry (judgedGeometry): iOS's home-indicator band is no band.
 */
export function fullyAsked(platform: Platform, t: Pick<TargetTruth, 'geometry' | 'scrollView'>): boolean {
  const g = judgedGeometry(platform, t.geometry);
  if (g === undefined) return false;
  const { kind } = parseGeometry(g);
  if (CUT.includes(g) || kind === 'chrome-overlap') return true;
  return (g === 'status-band' || g === 'nav-band' || kind === 'band-overlap') && t.scrollView !== undefined;
}
