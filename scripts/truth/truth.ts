import type { Platform } from '../differential/corpus.js';
import { DRAWN, pct, type CatalogField, type CatalogForm, type ControlTruth, type Geometry, type Insets, type LabState, type NavigationMode, type ProbeEvent, type Rect, type Situation, type TargetTruth } from './schema.js';

/**
 * The truth's arithmetic, free of any device (docs/plans/2026-10-15-ground-truth-lab-app.md): where a form control
 * lies from the app's frames, what a probe tap's events say (reached, delivered, another control fired), and whether a
 * capture's sources tell one story. The capture (capture-run.ts) and the golden mode (scripts/differential/golden.ts)
 * both read it; tests/truth/truth.test.ts pins it.
 */

/**
 * The pinned submit's bar: the submit's frame and the bottom safe-area inset's padding above and below it
 * (Forms.swift). iOS's, in points: Android's forms (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 2b) need the
 * bar in pixels — deferred to phase 2b, where the app should report its bar's frame (e.g. `frames["submit.bar"]`) for
 * situationOf to read instead of this guess (round-2 review, MINOR-4).
 */
export const PINNED_BAR_PADDING = 10;

/** A probe's touch counts as the tap's when it lies this close to the tapped point (the tree's units). */
export const TOUCH_SLACK = 2;

/** Where a probe taps a frame: its centre, rounded as the raw tools take it (`idb ui tap`, `adb shell input tap`). */
export function probePoint(frame: Rect): { x: number; y: number } {
  return { x: Math.round(frame.x + frame.width / 2), y: Math.round(frame.y + frame.height / 2) };
}

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

/**
 * Where a control's frame lies, from the app's frames alone. A control laid in the picker sheet is `own.inSheet`; the
 * pinned submit's bar (its frame and PINNED_BAR_PADDING, full width) covers what is laid under it; a control straddling
 * the keyboard's top, or with its centre under the bar, is `covered` — partly hidden.
 */
export function situationOf(frame: Rect | undefined, s: LabState, form: CatalogForm, own: { tag: string; inSheet: boolean }): Situation {
  if (frame === undefined) return 'not-rendered';
  const cy = frame.y + frame.height / 2;
  if (cy < 0 || cy >= s.screen.height) return 'off-screen';
  const sheet = s.frames.sheet;
  if (!own.inSheet && form.picker?.open === true && sheet !== undefined && cy >= sheet.y) return 'presented-over';
  const k = s.keyboard?.visible === true ? s.keyboard.frame : undefined;
  if (k !== undefined && frame.y >= k.y) return 'under-keyboard';
  if (k !== undefined && frame.y + frame.height > k.y) return 'covered';
  const submit = s.frames[form.submit.tag];
  if (form.submit.pinned === true && own.tag !== form.submit.tag && submit !== undefined && cy >= submit.y - PINNED_BAR_PADDING && cy <= submit.y + submit.height + PINNED_BAR_PADDING) {
    return 'covered';
  }
  return 'open';
}

/**
 * Whether a raw tree's payload (WDA's JSON, idb's JSON list, a uiautomator dump) lists a node identified as `id`: the
 * id between quotes, as each payload writes an identifier (`"lab.x.A"`, `resource-id="lab.x.A"`), so `lab.x.A.box`
 * is not `lab.x.A`.
 */
export function listedIn(payload: string, id: string): boolean {
  return payload.includes(`"${id}"`);
}

/** The events a probe produced: what the app logged after the launch it was tapped on, without the time. */
export function probeEvents(state: LabState | undefined, since: number): ProbeEvent[] {
  return (state?.events ?? []).slice(since).map(({ kind, tag }) => ({ kind, tag }));
}

/** The touches among `events` at `point` (TOUCH_SLACK) — the app's own record that the probe tap reached it. */
export function touchesAt(events: readonly ProbeEvent[], point: { x: number; y: number }): ProbeEvent[] {
  return events.filter((e) => {
    if (e.kind !== 'touch') return false;
    const [x, y] = e.tag.split(',').map(Number);
    return Math.abs(x - point.x) <= TOUCH_SLACK && Math.abs(y - point.y) <= TOUCH_SLACK;
  });
}

/** A coloured target's probe: reached when its action fired; the probe is everything else the tap made the app log. */
export function readTargetProbe(events: readonly ProbeEvent[], tag: string): { reached: boolean; probe: ProbeEvent[] } {
  const hit = (e: ProbeEvent) => e.kind === 'tap' && e.tag === tag;
  return { reached: events.some(hit), probe: events.filter((e) => !hit(e)) };
}

/**
 * A form control's probe: a field is reached when it took the focus (a country field, a button: when its tap fired;
 * a field the cell focuses on appear: when the tap leaves the focus on it), the submit when a submit fired, a picker
 * row when it was chosen.
 */
export function readControlProbe(
  events: readonly ProbeEvent[],
  control: { tag: string; kind: ControlTruth['kind'] },
  field: CatalogField | undefined,
  focusAfter: string | null | undefined,
): { reached: boolean; probe: ProbeEvent[] } {
  const hit = (e: ProbeEvent) =>
    control.kind === 'row' ? e.kind === 'select' && control.tag.endsWith(`.${e.tag}`)
    : control.kind === 'button' ? e.kind === 'submit'
    : field?.kind === 'country' ? e.kind === 'tap' && e.tag === control.tag
    : e.kind === 'focus' && e.tag === control.tag;
  const focusStays = control.kind === 'field' && field?.kind !== 'country' && focusAfter === control.tag;
  return { reached: events.some(hit) || focusStays, probe: events.filter((e) => !hit(e)) };
}

/**
 * A keyboard dismissal's probe (FormTruth.title): reached when the tap ended the editing — a `focus` event with no
 * field — and delivered (its touch logged); the probe is everything else it made the app log.
 */
export function readDismissalProbe(events: readonly ProbeEvent[]): { reached: boolean; probe: ProbeEvent[] } {
  const hit = (e: ProbeEvent) => e.kind === 'focus' && e.tag === '';
  return { reached: events.some(hit) && events.some((e) => e.kind === 'touch'), probe: events.filter((e) => !hit(e)) };
}

/**
 * The controls a probe fired that are NOT the one tapped: a submit, a chosen row, a layer's button, another target's
 * tap. A focus change and a dismissal are not a control firing (the first follows any tap off a field, the second is
 * the presented-over class), and a touch is the positive control.
 */
export function otherControlsFired(probe: readonly ProbeEvent[], tag: string): ProbeEvent[] {
  return probe.filter((e) => e.kind === 'submit' || e.kind === 'select' || e.kind === 'button' || e.kind === 'tab' || (e.kind === 'tap' && e.tag !== tag));
}

/**
 * Whether the point the probe taps (probePoint) lies on the screen — else the capture never taps it (unprobedReason).
 */
export const centreOnScreen = (frame: Rect, screen: { width: number; height: number }) => inside(probePoint(frame), { x: 0, y: 0, width: screen.width, height: screen.height });
const at = (p: { x: number; y: number }) => `(${p.x},${p.y})`;

/**
 * Why the capture never taps a target's centre — the one rule the capture (capture-run.ts: TargetTruth.unprobed) and
 * consistency both read: `off-screen` an off-screen target; `centre-off-screen` its probe point (probePoint) off the
 * `screen`, given — a raw tap there reaches no window of the app, so it would log no touch and say nothing. `says` is
 * the truth's `unprobed`. undefined: the centre is probed — a centre in a system band too (systemBarSwallows,
 * navigationBandTakes: what a tap there does is measured).
 */
export function unprobedReason(
  t: Pick<TargetTruth, 'frame' | 'geometry'>,
  screen: { width: number; height: number } | undefined,
): { why: 'off-screen' | 'centre-off-screen'; says: string } | undefined {
  const offScreen = (why: 'off-screen' | 'centre-off-screen') => ({ why, says: `its centre ${at(probePoint(t.frame))} lies off the ${screen === undefined ? '' : `${screen.width}x${screen.height} `}screen` });
  if (t.geometry === 'off-screen') return offScreen('off-screen');
  if (screen !== undefined && !centreOnScreen(t.frame, screen)) return offScreen('centre-off-screen');
  return undefined;
}

const NOT_DELIVERED = 'the probe tap left no touch in the app (the positive control): it was not delivered, so "not reached" says nothing';

/**
 * Whether a target's sources tell one story: the tap was delivered; an `open` target is reached and drawn; a covered
 * one is not reached; a centre the capture never taps (unprobedReason, the capture's own rule) holds no probe. With a
 * measured geometry (phase 3; `whole` or absent is the rule above): an `off-screen` target is never probed, nor the
 * centre of one cut by the screen's edge with its probe point past it (given the `screen`: centreOnScreen — a raw tap
 * there reaches no window of the app, so it would leave no touch and say nothing); on Android a probe in the status
 * band is swallowed by the status bar — no touch reaches the app, and it must not be reached (systemBarSwallows) — and
 * a probe in the navigation band is the app's — its touch logged, the target reached (on iOS drawn) — on iOS and under
 * Android's gesture navigation, and the bar's — not reached — under three buttons (navigationBandTakes, measured, by
 * the `navigation` mode the capture records); an open target cut with its centre in what shows is reached, and so is
 * one overlapped at its edge by a band or the chrome (its centre clear; what of it is drawn is not held to DRAWN); one
 * whose centre lies outside what shows (`centre-out`, `outside-scroll-view`) is not; a sliver, a centre under chrome
 * and, on iOS, a centre in the status band may be either (what fires there is the truth the rows read) — though iOS's
 * status bar swallows a probe in the top of its band (statusBarMaySwallow: above IOS_STATUS_BAR_SWALLOWS_ABOVE, no
 * touch, then not reached). Unmeasured, a declared-open target whose centre lies off the screen is broken, as the
 * phase-1 rule has it: never probed, it is never reached.
 */
export function consistency(
  t: TargetTruth,
  platform?: Platform,
  screen?: { width: number; height: number },
  navigation?: NavigationMode,
): string | undefined {
  const g = t.geometry ?? 'whole';
  const probed = t.reached || t.probe.length > 0;
  switch (unprobedReason(t, screen)?.why) {
    case 'off-screen':
      return probed || t.reachedAtPiece !== undefined ? 'off-screen, never probed, but the truth holds a probe' : undefined;
    case 'centre-off-screen':
      // Unmeasured (no geometry): the phase-1 rule — an open target must be reached, and one never probed is not.
      if (t.geometry === undefined && t.declared === 'open') return `declared open, but its centre ${at(probePoint(t.frame))} lies off the screen: never probed`;
      return probed ? `its centre ${at(probePoint(t.frame))} off the screen, never probed, but the truth holds a probe` : undefined;
  }
  if (systemBarSwallows(platform, g)) return t.reached ? `${g}, but the probe tap reached it through the system bar` : undefined;
  const takes = navigationBandTakes(platform, g, navigation);
  if (takes === 'unrecorded') return `nav-band on Android under ${navigation ?? 'no recorded'} navigation (CellTruth.navigation): unmeasured, the probe says nothing`;
  if (takes === 'bar') return t.reached ? `nav-band under ${navigation} navigation, whose bar takes the tap, but the probe reached it` : undefined;
  if (touchesAt(t.probe, probePoint(t.frame)).length === 0) {
    if (statusBarMaySwallow(platform, g, probePoint(t.frame))) return t.reached ? `${g}, but the probe tap reached it with no touch logged` : undefined;
    return NOT_DELIVERED;
  }
  if (t.declared === 'presented-over') return t.reached ? 'declared presented-over, but the probe tap reached it' : undefined;
  if (g === 'whole') return t.reached && t.drawn >= DRAWN ? undefined : `declared open, but reached ${t.reached}, drawn ${pct(t.drawn)}`;
  // The band is the app's (navigationBandTakes): reached — and on iOS drawn as itself, as the open rows it is asked
  // need (golden-spec/bars.ts); Android's gesture handle is drawn over its band (bands N: 90 %), and R-band asks no
  // pass.
  if (takes === 'app' && !(t.reached && (platform !== 'ios' || t.drawn >= DRAWN))) return `nav-band, the tap the app's, but reached ${t.reached}${platform === 'ios' ? `, drawn ${pct(t.drawn)}` : ''}`;
  if (g === 'partly-centre-in' && !t.reached) return 'declared open, cut with its centre showing, but the probe tap did not reach it';
  if (isOverlap(g) && !t.reached) return `${g}, its centre clear, but the probe tap did not reach it`;
  if ((g === 'centre-out' || g === 'outside-scroll-view') && t.reached) return `${g}, but the probe tap at its centre reached it`;
  return undefined;
}

/**
 * Android's status bar is the system's window: a raw tap in it never reaches the app (calibration.json #21, the status
 * bar — "the swallowed probe accepted"; measured again by B4 on the averi_lab AVD, 2026-10-16: `adb shell input tap 540
 * 33` on the `bands` cell logged no touch).
 */
export const systemBarSwallows = (platform: Platform | undefined, g: Geometry) => platform === 'android' && g === 'status-band';

/**
 * Where iOS's status bar stops swallowing a raw tap: a probe point above this y (points) may be the bar's. Measured
 * 2026-10-16 on the lab simulator ONLY (averi-lab iPhone 17, iOS 27.0, top inset 62 pt), twice, with raw `idb ui tap`:
 * B3 on the `open` cell — y 2, 12, 30, 40, 50 left no touch in the app, y 55, 58, 61, 62, 64 did (and
 * sheet-medium-edges' G, presented-over, its probe at (201,12), left none); B4 on the `bands` cell
 * (docs/truth/band-probes-2026-10-16.md) — y 10, 31, 50, 52, 53 left no touch, y 54, 55, 58, 61 did. So the bar
 * swallows every tap above 54 and none from 54 on, as both measurements have it; another device or OS may draw its bar
 * taller or shorter — remeasure there.
 */
export const IOS_STATUS_BAR_SWALLOWS_ABOVE = 54;

/**
 * iOS's status bar swallows a tap in the top of its band and passes one below through (IOS_STATUS_BAR_SWALLOWS_ABOVE).
 * So on iOS a status-band probe ABOVE that line that left no touch is the bar's, not a broken cell — and must not have
 * reached the target; one below it with no touch is undelivered (a broken cell), and one that left its touch is judged
 * as any other.
 */
export const statusBarMaySwallow = (platform: Platform | undefined, g: Geometry, at: { y: number }) =>
  platform === 'ios' && g === 'status-band' && at.y < IOS_STATUS_BAR_SWALLOWS_ABOVE;

/**
 * Who takes a raw tap in the navigation band — MEASURED by B4 (bars), 2026-10-16, on the `bands` cell (the raw touch
 * logs: docs/truth/band-probes-2026-10-16.md):
 *  - Android (averi_lab AVD, API 33, 1080x2220), by the navigation mode the capture records (CellTruth.navigation,
 *    `settings get secure navigation_mode`): `gesture` (mode 2, the band [0,2154][1080,2220]) — taps at (540,2187),
 *    (100,2187) and (540,2215) each logged its touch in the app, the two on N fired N: the APP's; `three-button` (mode
 *    0, [0,2088][1080,2220]) — taps at (540,2154), (100,2154) and (270,2154) logged no touch and left the app for the
 *    launcher (Home, Back): the BAR's (the probe's relaunch of the cell undoes it). No mode recorded: `unrecorded`, a
 *    broken target — the probe says nothing without it. `two-button` was not measured: `unrecorded` too.
 *  - iOS's home-indicator band (iPhone 17 simulator, iOS 27.0, 840–874 pt): taps at (201,857) and (60,857) logged the
 *    touch and fired N: the APP's, always.
 * The app's: its touch must be logged (else undelivered) and the target reached — on iOS drawn as itself too, as the
 * open rows it is asked need (Android's gesture handle is drawn over its band: bands N 90 % drawn). The bar's:
 * the target must not be reached. undefined: not the navigation band. averi refuses the tap there on Android either way
 * (ADR 0009 N-a): R-band. The status bands are systemBarSwallows (Android) and statusBarMaySwallow (iOS).
 */
export function navigationBandTakes(platform: Platform | undefined, g: Geometry, navigation: NavigationMode | undefined): 'app' | 'bar' | 'unrecorded' | undefined {
  if (g !== 'nav-band') return undefined;
  if (platform !== 'android') return 'app';
  return navigation === 'gesture' ? 'app' : navigation === 'three-button' ? 'bar' : 'unrecorded';
}

// --- the measured geometry (phase 3) ---

type KindOf<G> = G extends `${infer K}:${string}` ? K : G;
/** A geometry without the band or chrome it names: `under-chrome`, `band-overlap`, `chrome-overlap`, or itself. */
export type GeometryKind = KindOf<Geometry>;
/**
 * A geometry read apart, the one place its spelling is parsed: `under-chrome:fab` is `{kind: 'under-chrome',
 * name: 'fab'}`, `band-overlap:status` `{kind: 'band-overlap', name: 'status'}`, a geometry naming nothing (`sliver`)
 * its kind alone.
 */
export function parseGeometry(g: Geometry): { kind: GeometryKind; name?: string } {
  const i = g.indexOf(':');
  return i < 0 ? { kind: g as GeometryKind } : { kind: g.slice(0, i) as GeometryKind, name: g.slice(i + 1) };
}
/**
 * A whole target overlapped at its edge past the slack (regionOverlap), its centre clear: `band-overlap:<band>`,
 * `chrome-overlap:<name>`.
 */
export type OverlapGeometry = Extract<Geometry, `band-overlap:${string}` | `chrome-overlap:${string}`>;
export function isOverlap(g: Geometry | undefined): g is OverlapGeometry {
  if (g === undefined) return false;
  const { kind } = parseGeometry(g);
  return kind === 'band-overlap' || kind === 'chrome-overlap';
}

export const area = (r: Rect) => Math.max(0, r.width) * Math.max(0, r.height);
/** The overlap of two rects, or null when they share no area. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = { x, y, width: Math.min(a.x + a.width, b.x + b.width) - x, height: Math.min(a.y + a.height, b.y + b.height) - y };
  return r.width > 0 && r.height > 0 ? r : null;
}
/** What of `r` lies outside `cut`: up to four rects (above, below, left, right of it). */
export function subtract(r: Rect, cut: Rect): Rect[] {
  const o = intersect(r, cut);
  if (o === null) return [r];
  const parts: Rect[] = [
    { x: r.x, y: r.y, width: r.width, height: o.y - r.y },
    { x: r.x, y: o.y + o.height, width: r.width, height: r.y + r.height - (o.y + o.height) },
    { x: r.x, y: o.y, width: o.x - r.x, height: o.height },
    { x: o.x + o.width, y: o.y, width: r.x + r.width - (o.x + o.width), height: o.height },
  ];
  return parts.filter((p) => p.width > 0 && p.height > 0);
}

/** What a target's geometry is measured against: the screen, and what the state reported (LabState). */
export interface GeometryContext {
  screen: Rect;
  safeArea?: Insets;
  /** The clip of the target's scroll view, when it lies in one. */
  clip?: Rect;
  chrome?: Record<string, Rect>;
}

/**
 * The system bands as rects — the status band over the top inset, the navigation band over the bottom one; none for a
 * zero inset.
 */
export function bandsOf(screen: Rect, safeArea: Insets | undefined): { status?: Rect; nav?: Rect } {
  if (safeArea === undefined) return {};
  return {
    ...(safeArea.top > 0 && { status: { x: screen.x, y: screen.y, width: screen.width, height: safeArea.top } }),
    ...(safeArea.bottom > 0 && { nav: { x: screen.x, y: screen.y + screen.height - safeArea.bottom, width: screen.width, height: safeArea.bottom } }),
  };
}

/**
 * The tap minimum a piece must reach, in either dimension: 6 % of the screen's shorter side — ADR 0013's sliver
 * (averi's `MIN_TAP_PIECE_FRACTION`, ui-tree/draw-order.ts). Restated here, not imported: the truth does not depend on
 * the code it judges.
 */
export const SLIVER_FRACTION = 0.06;
export const minPiece = (screen: Rect) => Math.round(SLIVER_FRACTION * Math.min(screen.width, screen.height));

/**
 * How thick an overlap may be on its thin side and still hide nothing of a pixel assert's element: 2 tree units — ADR
 * 0002's slack (averi's `PIXEL_OVERLAP_SLACK`, ui-tree/geometry.ts). Restated, as SLIVER_FRACTION is.
 */
export const OVERLAP_SLACK = 2;
/** The two rects share area thicker than OVERLAP_SLACK on its thin side (averi's `overlapsPastSlack`). */
export const overlapsPastSlack = (a: Rect, b: Rect) => {
  const o = intersect(a, b);
  return o !== null && Math.min(o.width, o.height) > OVERLAP_SLACK;
};
/**
 * What a colour assert samples of what shows: the rect inset 12 % of its size on each side (ADR 0001: "the colour
 * sampler's 12 %-inset rect", averi's `colorSampleRect`, clipped to the screen before it is inset). Restated.
 */
export const COLOUR_SAMPLE_INSET = 0.12;
export const sampleOf = (r: Rect): Rect => ({
  x: r.x + r.width * COLOUR_SAMPLE_INSET,
  y: r.y + r.height * COLOUR_SAMPLE_INSET,
  width: r.width * (1 - 2 * COLOUR_SAMPLE_INSET),
  height: r.height * (1 - 2 * COLOUR_SAMPLE_INSET),
});

/**
 * The first band or chrome a region overlaps past the slack (ADR 0002): the status band, then the navigation band, then
 * the chrome by name — `band-overlap:<status|nav>`, `chrome-overlap:<name>`; undefined when none does. Asked of what
 * shows of a whole target by geometryOf (`fully: true` judges the node's region, ADR 0009 N-a), and of its colour
 * sample by the colour row (golden-spec/bars.ts: ADR 0001 fails the assert closed only where what it READS is
 * overlapped).
 */
export function regionOverlap(region: Rect, ctx: Pick<GeometryContext, 'screen' | 'safeArea' | 'chrome'>): OverlapGeometry | undefined {
  const bands = bandsOf(ctx.screen, ctx.safeArea);
  if (bands.status !== undefined && overlapsPastSlack(region, bands.status)) return 'band-overlap:status';
  if (bands.nav !== undefined && overlapsPastSlack(region, bands.nav)) return 'band-overlap:nav';
  const chrome = Object.entries(ctx.chrome ?? {}).sort(([a], [b]) => a.localeCompare(b)).find(([, r]) => overlapsPastSlack(region, r));
  return chrome === undefined ? undefined : `chrome-overlap:${chrome[0]}`;
}

/** The frame clipped by the screen and the scroll view's clip: what of it can be drawn. */
export function visibleOf(frame: Rect, ctx: GeometryContext): Rect | null {
  const on = intersect(frame, ctx.screen);
  return on === null || ctx.clip === undefined ? on : intersect(on, ctx.clip);
}

/**
 * The largest part of what shows clear of the system bands and the app's chrome — where a tap can land on the target.
 */
export function pieceOf(frame: Rect, ctx: GeometryContext): Rect | null {
  const visible = visibleOf(frame, ctx);
  if (visible === null) return null;
  const bands = bandsOf(ctx.screen, ctx.safeArea);
  const covers = [bands.status, bands.nav, ...Object.values(ctx.chrome ?? {})].filter((r): r is Rect => r !== undefined);
  const pieces = covers.reduce<Rect[]>((ps, c) => ps.flatMap((p) => subtract(p, c)), [visible]);
  return pieces.reduce<Rect | null>((best, p) => (best === null || area(p) > area(best) ? p : best), null);
}

/**
 * The edges of `frame` its scroll view's clip cuts — the clip's edge is where what shows of it ends, and the frame runs
 * on past it — each with what shows of the frame ACROSS that edge (`visible.height` at the top or bottom, its width at
 * a side): ADR 0013's sliver is `ui-tree/geometry.ts#Clips.cutSliver`'s, "what shows of the node across that edge"
 * under the minimum, and only at a clipping container's edge (its `scrollersOf` chain). A cut by the screen's edge
 * alone is not one: src judges such a target by its centre (on the screen: tapped; off it: off the screen). On iOS no
 * tree marks a clipping ancestor (`scrollersOf` is empty there), so src refuses no sliver: an iOS cell's R-sliver rows
 * would show that gap (ADR 0013 decides the refusal; it does not say the gap is accepted).
 */
export function clipCuts(frame: Rect, visible: Rect, clip: Rect | undefined): { edge: 'top' | 'bottom' | 'left' | 'right'; depth: number }[] {
  if (clip === undefined) return [];
  const cuts: { edge: 'top' | 'bottom' | 'left' | 'right'; depth: number }[] = [];
  if (frame.y < clip.y && visible.y === clip.y) cuts.push({ edge: 'top', depth: visible.height });
  if (frame.y + frame.height > clip.y + clip.height && visible.y + visible.height === clip.y + clip.height) cuts.push({ edge: 'bottom', depth: visible.height });
  if (frame.x < clip.x && visible.x === clip.x) cuts.push({ edge: 'left', depth: visible.width });
  if (frame.x + frame.width > clip.x + clip.width && visible.x + visible.width === clip.x + clip.width) cuts.push({ edge: 'right', depth: visible.width });
  return cuts;
}

/**
 * Where a target's frame lies (schema.ts#Geometry), in averi's judging order (ADR 0005): off the screen (a frame of no
 * area too, wherever it lies — intersect needs area: nothing of it can be drawn, and it is never probed); outside its
 * scroll view's clip; its centre in the status band, then the navigation band (ADR 0008, ADR 0009 N-a: the tap and the
 * plain stop are centre-based); cut — by the screen's edge or its clip — with what shows across a clip's cut edge under
 * the tap minimum (a sliver, ADR 0013: clipCuts), else with its centre outside what shows; its centre — of a whole
 * target, or of a cut one where it shows — under the app's chrome (the first by name): the probe at the centre lands on
 * the chrome, as averi's tap judges it covered (ADR 0005: cut, then covered); else partly-centre-in; a whole one whose
 * region overlaps a band or the chrome past the slack (regionOverlap: ADR 0002, its centre clear) `band-overlap:<band>`
 * / `chrome-overlap:<name>`; else whole. A target under the minimum whole (a 20-pt icon) cut by its clip by any amount
 * is a sliver: what shows across the cut is under the minimum, as Clips.cutSliver judges it.
 */
export function geometryOf(frame: Rect, ctx: GeometryContext): Geometry {
  if (intersect(frame, ctx.screen) === null) return 'off-screen';
  const visible = visibleOf(frame, ctx);
  if (visible === null) return 'outside-scroll-view';
  // The point the probe taps (probePoint, rounded as the raw tools take it), not the float centre: what lies there is
  // what the probe meets — and averi's tap and plain stop judge the rounded centre too (ui-tree/standing.ts, "its
  // ROUNDED centre lies below the band").
  const c = probePoint(frame);
  const bands = bandsOf(ctx.screen, ctx.safeArea);
  if (bands.status !== undefined && inside(c, bands.status)) return 'status-band';
  if (bands.nav !== undefined && inside(c, bands.nav)) return 'nav-band';
  const chrome = Object.entries(ctx.chrome ?? {}).sort(([a], [b]) => a.localeCompare(b)).find(([, r]) => inside(c, r));
  const underChrome = chrome === undefined ? undefined : (`under-chrome:${chrome[0]}` as const);
  if (area(visible) < area(frame)) {
    if (clipCuts(frame, visible, ctx.clip).some((cut) => cut.depth < minPiece(ctx.screen))) return 'sliver';
    if (!inside(c, visible)) return 'centre-out';
    return underChrome ?? 'partly-centre-in';
  }
  return underChrome ?? regionOverlap(visible, ctx) ?? 'whole';
}

/**
 * Whether a state reports anything a geometry is measured from — else the targets carry none (every capture before
 * phase 3).
 */
export const measuresGeometry = (s: Pick<LabState, 'safeArea' | 'scrollViews' | 'chrome'>) => s.safeArea !== undefined || s.scrollViews !== undefined || s.chrome !== undefined;

/** A target's measured geometry from the state, or nothing when the state reports none of what it is measured from. */
export function measuredGeometry(frame: Rect, s: LabState, scrollView: string | undefined): Pick<TargetTruth, 'geometry' | 'visible' | 'piece'> {
  if (!measuresGeometry(s)) return {};
  const clip = scrollView === undefined ? undefined : s.scrollViews?.[scrollView];
  if (scrollView !== undefined && clip === undefined) throw new Error(`the state reports no scroll view ${scrollView}`);
  const ctx: GeometryContext = { screen: s.screen, ...(s.safeArea !== undefined && { safeArea: s.safeArea }), ...(clip !== undefined && { clip }), ...(s.chrome !== undefined && { chrome: s.chrome }) };
  return { geometry: geometryOf(frame, ctx), visible: visibleOf(frame, ctx), piece: pieceOf(frame, ctx) };
}

/**
 * Where the second probe taps (TargetTruth.reachedAtPiece): the piece's centre, when it is more than TOUCH_SLACK from
 * the frame's.
 */
export function pieceProbePoint(frame: Rect, piece: Rect | null | undefined): { x: number; y: number } | undefined {
  if (piece === null || piece === undefined) return undefined;
  const a = probePoint(frame);
  const b = probePoint(piece);
  return Math.abs(a.x - b.x) <= TOUCH_SLACK && Math.abs(a.y - b.y) <= TOUCH_SLACK ? undefined : b;
}

/**
 * The keyboard whose touches the app cannot log: Android's IME draws in a window of its own process, so a probe tap
 * on it leaves no touch in the app (phase 2b's form cells). iOS's keyboard host window is the app's — its touches are
 * logged (the committed form-keyboard probes of vs, ks, ss and note hold their touch) — so it has none.
 */
export function outOfProcessKeyboard(platform: Platform, keyboard: Rect | undefined): Rect | undefined {
  return platform === 'android' ? keyboard : undefined;
}

/**
 * Whether a control's probe agrees with where its frame puts it: a probed tap was delivered (but on an out-of-process
 * keyboard, outOfProcessKeyboard: the app cannot see that touch), an open control is reached, a hidden one not. A
 * `covered` control is not held to either: partly hidden, its centre may or may not be.
 */
export function controlConsistency(c: ControlTruth, outOfProcess: Rect | undefined): string | undefined {
  const probed = c.frame !== undefined && c.situation !== 'off-screen' && c.situation !== 'not-rendered';
  if (probed) {
    const at = probePoint(c.frame!);
    if (touchesAt(c.probe, at).length === 0 && !(outOfProcess !== undefined && inside(at, outOfProcess))) return NOT_DELIVERED;
  } else if (c.reached || c.probe.length > 0) {
    return `${c.situation}, never probed, but the truth holds a probe`;
  }
  if (c.situation === 'covered') return undefined;
  if (c.situation === 'open' && !c.reached) return 'open, but the probe tap did not reach it';
  if (c.situation !== 'open' && c.reached) return `${c.situation}, but the probe tap reached it`;
  return undefined;
}
