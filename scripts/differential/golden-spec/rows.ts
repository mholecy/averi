import type { Platform } from '../corpus.js';
import type { Call } from '../differential.js';
import type { CellTruth, Rect, TargetTruth } from '../../truth/schema.js';
import { isOverlap, parseGeometry, regionOverlap, sampleOf } from '../../truth/truth.js';
import { BUDGET_MS, first, landed, notInTree, notTapped, passed, passes, reachedWithNoSwipe, said, scrollAdvice, strokesOff, swipes, tapPoints, touchDowns, within, type Expectation } from './judges.js';

/**
 * Phase 3's row types (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 3 B1): what each verb must answer of an
 * open target whose MEASURED geometry (truth.ts#geometryOf) is not `whole`, and of the dismissal and the stroke's
 * direction. Shared by the families: edges.ts and bars.ts map a geometry to its rows; B2–B5 wire them to their cells. A
 * target carries a geometry only when its capture's state reported the bands, scroll views or chrome — no capture
 * before phase 3 does — so none of them asks anything of the existing corpus.
 *
 * | row | truth | verb | expected | decided by |
 * |---|---|---|---|---|
 * | R-off | off-screen | tap | refused naming scroll_until, nothing tapped | ADR 0005 (off the screen first); docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md |
 * | R-off | off-screen | colour | fails: nothing of it is on the screen to measure | ADR 0010 (amendment: the off-screen case — nothing of what it reads on the screen, judged off the screen first), ADR 0002 (the thin sliver: judged off the screen, never measured) |
 * | R-outside-sv | outside-scroll-view | tap | refused naming scroll_until, nothing tapped | ADR 0005 |
 * | R-outside-sv | outside-scroll-view | colour | fails closed: it would measure the background | docs/bugs/2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes.md |
 * | R-stroke | off what shows (off-screen, outside-scroll-view) | scroll_until toward it | swipes, every touch-down on the screen clear of the system bands and the chrome, and inside the target's own scroll view where the truth names it (not when the tree does not list it) | docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md, docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md |
 * | R-sliver | sliver | tap | refused naming scroll_until, nothing tapped | ADR 0013; docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md |
 * | R-sliver | sliver | scroll_until | not reached where it is — the stop fails, whatever it swiped (the plain stop does not stop on a sliver; a replayed tree never moves) | ADR 0013 |
 * | R-land | partly-centre-in (reached) | tap | `Tapped`, every tap sent inside what shows (`visible`) | ADR 0005; docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md |
 * | R-land | centre-out, under-chrome | tap | refused, nothing sent — or `Tapped` inside its piece where the second probe fired (`reachedAtPiece`) | ADR 0005 (a covered target's tap moved to its piece, or refused) |
 * | R-fully | partly-centre-in, centre-out, sliver (and R-overlap's) | scroll_until `fully: true` | never "visible" where it is, whatever it swiped: it is cut | ADR 0005 (the `fully` stop judges no sliver: a stop flush with a clipping container is the flush probe's to check, scroll-rounds.ts#PROBE_REACH), ADR 0009 (N-a, `fully`); docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md, docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md |
 * | R-band | status-band, nav-band | tap | refused, nothing tapped — where its probe fired (iOS, below the bar's touch area): Tapped inside what shows of it, or refused with nothing sent | ADR 0009 (N-a), ADR 0008; docs/bugs/2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md |
 * | R-band | status-band, nav-band | colour | fails: a system band over what it reads | ADR 0001 |
 * | R-band | status-band, nav-band | scroll_until | not reached where it is (the stop fails) | ADR 0009 (N-a: neither stop stops on a centre in the band) |
 * | R-under-chrome | under-chrome:<name> | tap | R-land on its piece | docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md; ADR 0005 |
 * | R-under-chrome | under-chrome:<name> | colour | fails: the chrome is a pixel cover over what it reads | ADR 0001, ADR 0003 |
 * | R-under-chrome | under-chrome:<name> | scroll_until | not reached where it is (the stop fails) | docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> (whole, centre clear, its edge overlapped past ADR 0002's slack) | tap | `Tapped`, inside what shows (R-land at its centre) | ADR 0009 (N-a: the tap is centre-based) |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> | colour | fails closed when what it samples (the 12 %-inset rect) is overlapped past the slack, else passes on its own colour | ADR 0001, ADR 0002 |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> | scroll_until | reached with no swipe | ADR 0009 (N-a: the plain stop is centre-based) |
 * | R-overlap | band-overlap:<band> (in a scroll view), chrome-overlap:<name> | scroll_until `fully: true` | R-fully: not "visible" where it is | ADR 0009 (N-a, `fully`: the bands as a region); ui-tree/standing.ts#fullyStanding (any cover covers) |
 * | R-dismiss | a field under the keyboard, the cell's `keyboardDismiss` (CellTruth.config) naming an element a bar lies over | tap | the dismissal is tapped (a tap sent inside the element), not refused for the bar | docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md, docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md; ADR 0016 |
 * | R-direction | below / above what shows | scroll_until | each stroke brings it closer (LIVE ONLY: a replayed tree never moves) | docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md |
 */

const tapCall = (platform: Platform, t: Pick<TargetTruth, 'id'>): Call => ({ tool: 'tap', args: { platform, selector: `id:"${t.id}"` } });
const scrollCall = (platform: Platform, t: Pick<TargetTruth, 'id'>, direction: 'up' | 'down', fully = false): Call => ({
  tool: 'scroll_until',
  args: { platform, selector: `id:"${t.id}"`, direction, ...(fully && { fully: true }) },
});

/**
 * Toward the target: `down` when its frame's centre lies at or below the centre of what shows of it (else of the
 * screen), else `up`.
 */
export function directionOf(t: Pick<TargetTruth, 'frame' | 'visible'>, cell: Pick<CellTruth, 'screen'>): 'up' | 'down' {
  const shown = t.visible ?? { x: 0, y: 0, width: cell.screen.width, height: cell.screen.height };
  return t.frame.y + t.frame.height / 2 >= shown.y + shown.height / 2 ? 'down' : 'up';
}

/**
 * R-off, R-outside-sv, R-sliver: the tap refused, its remedy scroll_until, nothing sent. `absent` (why the truth allows
 * the target to be missing from the tree): a tap that waited for it and sent nothing is as good — no node, no remedy
 * to name.
 */
export function refusedTap(platform: Platform, t: TargetTruth, row: string, absent?: string): Expectation {
  return {
    verb: 'tap',
    says: `${row}: refused naming scroll_until, nothing tapped`,
    call: tapCall(platform, t),
    judge: (o) => notTapped(o) ?? (scrollAdvice(o) || (absent !== undefined && notInTree(o)) ? undefined : said(o, 'refused without scroll_until')),
    ...(absent !== undefined && { absent }),
  };
}

/**
 * R-band: the tap refused, nothing sent (its remedy depends on whether a scroll lifts it out: not judged) — where the
 * probe at its centre did not fire it (the bar swallowed it: Android's status bar, the top of iOS's,
 * truth.ts#statusBarMaySwallow). Where it did (iOS, below the bar's own touch area), what fires there is the truth:
 * the tap is not expected refused — `Tapped` inside what shows of it, or refused with nothing sent (averi's own
 * model of iOS's status band, the top safe-area inset, may refuse it; it must not tap elsewhere).
 */
export function bandTap(platform: Platform, t: TargetTruth): Expectation {
  if (t.reached) {
    return { verb: 'tap', says: `R-band: its probe fired (${t.geometry}): Tapped inside what shows of it, or refused with nothing sent`, call: tapCall(platform, t), judge: (o) => landed(o, t.visible ?? t.frame, true, false) };
  }
  return { verb: 'tap', says: `R-band: refused (${t.geometry}), nothing tapped`, call: tapCall(platform, t), judge: notTapped };
}

/**
 * R-off, R-outside-sv, R-band, R-under-chrome: the colour assert fails, asked for the target's own colour — or for
 * `expected`, the colour the screen shows there (TargetTruth.seen), so that a pass means it measured what lies there
 * instead of the target (R-outside-sv: the background beneath its scroll view, calibration.json #29).
 */
export function colourFails(platform: Platform, t: TargetTruth, why: string, opts: { expected?: string; absent?: string } = {}): Expectation {
  const expected = opts.expected ?? t.color;
  return {
    verb: 'colour',
    says: `fails (${why})${expected === t.color ? '' : `, asked for the colour the screen shows there (${expected})`}`,
    call: { tool: 'assert', args: { platform, asserts: [{ element: { id: t.id }, color: { expected }, timeout: BUDGET_MS }] } },
    judge: (o) => (passed(o) ? `passed on ${expected}: ${first(o)}` : undefined),
    ...(opts.absent !== undefined && { absent: opts.absent }),
  };
}

/**
 * R-stroke over a target off what shows: scroll_until toward it swipes, every touch-down strokeable
 * (judges.ts#strokeable) — and, where the truth names the target's scroll view and the capture its clip, inside that
 * scroll view: a stroke that touches down beside it moves nothing it holds (WDA's own refusal names that scroll view).
 * Not where the target is `absent` from the tree: averi cannot know which scroll view holds a node it never saw.
 */
export function strokeRow(platform: Platform, t: TargetTruth, cell: CellTruth, row: string, absent?: string): Expectation {
  const direction = directionOf(t, cell);
  const own = absent === undefined && t.scrollView !== undefined ? cell.scrollViews?.[t.scrollView] : undefined;
  return {
    verb: 'scroll_until',
    says: `${row}, R-stroke: swipes ${direction} for it, every touch-down clear of the bands and the chrome${own === undefined ? '' : ` and inside its scroll view ${t.scrollView}`}`,
    call: scrollCall(platform, t, direction),
    judge: (o) => {
      if (swipes(o) === 0) return said(o, 'no swipe');
      const beside = own === undefined ? [] : touchDowns(o).filter((p) => !within(p, own));
      return strokesOff(o, cell) ?? (beside.length === 0 ? undefined : `touched down outside its scroll view ${t.scrollView} at ${beside.map((p) => `(${p.x},${p.y})`).join(' ')}: ${first(o)}`);
    },
    ...(absent !== undefined && { absent }),
  };
}

/**
 * R-sliver, R-band, R-under-chrome: the plain stop does not call it reached where it is. In a replayed tree no stroke
 * moves it, so a stop after N swipes stopped where it is just the same: the stop must fail (an ERROR), whatever it
 * swiped.
 */
export function notReachedStill(platform: Platform, t: TargetTruth, cell: CellTruth, row: string): Expectation {
  return {
    verb: 'scroll_until',
    says: `${row}: not reached where it is (the stop fails; a replayed tree never moves)`,
    call: scrollCall(platform, t, directionOf(t, cell)),
    judge: (o) => (o.reply.startsWith('ERROR') ? undefined : said(o, `reached where it is ${t.geometry}, after ${swipes(o)} swipe(s) that move nothing`)),
  };
}

/**
 * R-fully: `fully: true` never calls it "visible" where it is — after no swipe, or after swipes that move nothing in a
 * replayed tree.
 */
export function fullyRow(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation {
  return {
    verb: 'fully',
    says: `R-fully: fully: true is not "visible" where it is ${t.geometry}`,
    call: scrollCall(platform, t, directionOf(t, cell), true),
    judge: (o) => (/^Element .* visible after /.test(o.reply) ? said(o, `fully visible where it is ${t.geometry}, after ${swipes(o)} swipe(s) that move nothing`) : undefined),
  };
}

/**
 * R-land: the tap lands on what shows of the target. Reached at its centre (`partly-centre-in`, and a whole target
 * overlapped at its edge, `band-overlap:<band>` / `chrome-overlap:<name>`): `Tapped`, inside `visible`. Else
 * (`centre-out`, `under-chrome:<name>`): refused with nothing sent, or `Tapped` inside its piece where the second probe
 * fired (`reachedAtPiece`).
 */
export function landRow(platform: Platform, t: TargetTruth): Expectation {
  const atCentre = (t.geometry === 'partly-centre-in' || isOverlap(t.geometry)) && t.reached;
  const where = atCentre ? t.visible : t.piece;
  const fired = atCentre || t.reachedAtPiece === true;
  return {
    verb: 'tap',
    says: atCentre ? 'R-land: Tapped, inside what shows of it' : `R-land: ${fired ? 'refused, or Tapped inside its piece' : 'refused, nothing tapped'}`,
    call: tapCall(platform, t),
    judge: (o) => landed(o, where, fired, atCentre),
  };
}

/**
 * R-dismiss (B5 wires it, with a cell whose `config.ios.keyboardDismiss` names `dismissal`): a tap on `control`, under
 * the keyboard, sends the configured dismissal — a tap inside the dismissal element's frame — and is not refused for
 * a bar lying over that element. With the `keyboard`'s frame (a replayed tree, where it never goes): nothing else is
 * tapped — no tap inside the keyboard (it would press a key), and no `Tapped` reply (the control is still under it), as
 * the form's own under-keyboard row it stands in for asks (golden-spec/forms.ts).
 */
export function dismissRow(platform: Platform, control: { tag: string; id: string }, dismissal: { label: string; frame: Rect }, keyboard?: Rect): Expectation & { target: string } {
  return {
    target: control.tag,
    verb: 'tap',
    says: `R-dismiss: the keyboard dismissed by tapping ${dismissal.label}${keyboard === undefined ? '' : ', nothing else tapped'}`,
    call: tapCall(platform, control),
    judge: (o) => {
      if (!tapPoints(o).some((p) => within(p, dismissal.frame))) return said(o, `no tap on the dismissal ${dismissal.label}${/toolbar/i.test(o.reply) ? ' (refused for a toolbar)' : ''}`);
      if (keyboard === undefined) return undefined;
      const under = tapPoints(o).filter((p) => within(p, keyboard));
      if (under.length > 0) return said(o, `tapped under the keyboard at ${under.map((p) => `(${p.x},${p.y})`).join(' ')}`);
      return o.reply.startsWith('Tapped') ? said(o, 'Tapped while the keyboard still covers it') : undefined;
    },
  };
}

/**
 * R-direction: LIVE ONLY — whether each stroke brings the target closer is a dynamic; declared so the table is whole.
 */
export function directionRow(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation {
  const direction = directionOf(t, cell);
  return {
    verb: 'scroll_until',
    says: `R-direction: each stroke ${direction} brings it closer, and a stroke that does not turns back`,
    call: scrollCall(platform, t, direction),
    live: 'a stroke moves nothing in a replayed tree: the scroll offset the lab app reports is the oracle (phase 5)',
    judge: () => undefined,
  };
}

/** R-overlap: the plain stop is centre-based (ADR 0009 N-a), and the centre is clear — reached with no swipe. */
export function reachedAtOnce(platform: Platform, t: TargetTruth, cell: CellTruth, row: string): Expectation {
  return {
    verb: 'scroll_until',
    says: `${row}: reached with no swipe (its centre clear)`,
    call: scrollCall(platform, t, directionOf(t, cell)),
    judge: reachedWithNoSwipe,
  };
}

/**
 * R-overlap's colour: fails closed when what the colour assert SAMPLES (truth.ts#sampleOf, the 12 %-inset rect of what
 * shows) is overlapped by a band or the chrome past the slack (ADR 0001, ADR 0002); else the sample reads the target
 * alone, and the assert passes on its own colour.
 */
export function overlapColour(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation {
  const over = t.visible === null || t.visible === undefined ? undefined : regionOverlap(sampleOf(t.visible), { screen: { x: 0, y: 0, ...cell.screen }, ...(cell.safeArea !== undefined && { safeArea: cell.safeArea }), ...(cell.chrome !== undefined && { chrome: cell.chrome }) });
  if (over !== undefined) return colourFails(platform, t, `R-overlap: ${parseGeometry(over).name} over what it samples`);
  return {
    verb: 'colour',
    says: `R-overlap: passes on its own colour ${t.color} (what it samples is clear)`,
    call: { tool: 'assert', args: { platform, asserts: [{ element: { id: t.id }, color: { expected: t.color }, timeout: BUDGET_MS }] } },
    judge: passes,
  };
}
