import type { Platform } from '../corpus.js';
import type { Call, Outcome } from '../differential.js';
import type { CellTruth, Rect, TargetTruth } from '../../truth/schema.js';
import { axisOf, directionOf, otherAxis, navigationBandTakes, parseGeometry, regionOverlap, sampleOf, selectorOf, type Direction } from '../../truth/truth.js';
import { bandNamed, isBand, judgedContext, type StopAsk, type TapAsk, type TargetContract } from '../../truth/target-contract.js';
import { ASSERTS_FAILED, claimsTap, claimsVisible, dismissalCover, flushProbedSide, isError, notInTree, scrollAdvice } from '../../truth/replies.js';
import { BUDGET_MS, first, landed, notTapped, passed, passes, pointsText, reachedWithNoSwipe, said, strokes, strokesOff, swipes, tapPoints, touchDowns, within, type Expectation } from './judges.js';

/**
 * Phase 3's row types (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 3 B1): what each verb must answer of an
 * open target whose MEASURED geometry (truth.ts#geometryOf) is not `whole`, and of the dismissal and the stroke's
 * direction. Shared by the families: edges.ts and bars.ts map a geometry to its rows; B2–B5 wire them to their cells. A
 * target carries a geometry only when its capture's state reported the bands, scroll views or chrome — no capture
 * before phase 3 does — so none of them asks anything of the existing corpus.
 *
 * WHAT a row asks — the tap must fire, may refuse, must refuse (and with which remedy); a stop holds where the target
 * lies or not; `fully` asked or not; the target allowed missing from the tree — is the target contract's
 * (scripts/truth/target-contract.ts: tapAsk, stopAsk, fullyAsked, unlistedBy), which the live golden's cases read too;
 * each row below turns its clause into a call and a judge over the replayed reply, and stamps the clause
 * (Expectation.asks). Its wording — the row's name, what its mismatch says — is the row's. tapRow and stopRow pick the
 * row that judges a target's clause.
 *
 * | row | truth | verb | expected | decided by |
 * |---|---|---|---|---|
 * | R-off | off-screen | tap | refused naming scroll_until, nothing tapped | ADR 0005 (off the screen first); docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md |
 * | R-off | off-screen | colour | fails: nothing of it is on the screen to measure | ADR 0010 (amendment: the off-screen case — nothing of what it reads on the screen, judged off the screen first), ADR 0002 (the thin sliver: judged off the screen, never measured) |
 * | R-outside-sv | outside-scroll-view | tap | refused naming scroll_until, nothing tapped | ADR 0005 |
 * | R-outside-sv | outside-scroll-view | colour | fails closed: it would measure the background | docs/bugs/2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes.md |
 * | R-stroke | off what shows (off-screen, outside-scroll-view) | scroll_until toward it (truth.ts#directionOf: sideways toward a card beside a carousel's clip) | swipes, every touch-down on the screen clear of the system bands and the chrome, and inside the target's own scroll view where the truth names it (not when the tree does not list it); every swipe along the axis of its direction | docs/bugs/2026-10-09-android-scroll-stroke-touches-down-on-floating-tab-bar.md, docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md; the axis: docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md (its residual: a card of a carousel stroked across its axis) |
 * | R-sliver | sliver | tap | refused naming scroll_until, nothing tapped | ADR 0013; docs/bugs/2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md |
 * | R-sliver | sliver | scroll_until | not reached where it is — the stop fails, whatever it swiped (the plain stop does not stop on a sliver; a replayed tree never moves) | ADR 0013 |
 * | R-land | partly-centre-in (reached) | tap | `Tapped`, every tap sent inside what shows (`visible`) | ADR 0005; docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md |
 * | R-land | centre-out, under-chrome | tap | refused, nothing sent — or `Tapped` inside its piece where the second probe fired (`reachedAtPiece`) | ADR 0005 (a covered target's tap moved to its piece, or refused) |
 * | R-fully | partly-centre-in, centre-out, sliver (and R-overlap's) | scroll_until `fully: true` | never "visible" where it is, whatever it swiped: it is cut — but a rect flush with its scroll container's edge, probed with a swipe toward it, may stop when the replayed probe moves nothing (the probe's answer is the device's: replies.ts#flushProbedSide) | ADR 0005 (the `fully` stop judges no sliver: a stop flush with a clipping container is the flush probe's to check, scroll-rounds.ts#PROBE_REACH), ADR 0009 (N-a, `fully`); docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md, docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md |
 * | R-band | status-band, nav-band (iOS's home-indicator band is no band: target-contract.ts#judgedContext) | tap | refused, nothing tapped — where its probe fired (iOS below the bar's touch area, Android's navigation band under gesture navigation): Tapped inside what shows of it, or refused with nothing sent | ADR 0009 (N-a), ADR 0008; docs/bugs/2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md |
 * | R-band | status-band, nav-band | colour | fails: a system band over what it reads (Android's navigation bar under three buttons: asked for the colour the screen shows there, the bar's, so a pass means it measured the bar — #23) — but in Android's navigation band under gesture navigation, where the band is the app's (truth.ts#navigationBandTakes, measured: bands N reached, seen in its own colour beneath the gesture handle), passes on its own colour or fails closed | ADR 0001; ADR 0020 (the measured truth outranks a hand-written expectation) |
 * | R-band | status-band, nav-band | scroll_until | not reached where it is (the stop fails) | ADR 0009 (N-a: neither stop stops on a centre in the band) |
 * | R-band | status-band, nav-band, in a scroll view | scroll_until `fully: true` | R-fully: not "visible" where it is (target-contract.ts#fullyAsked) | ADR 0009 (N-a, `fully`) |
 * | R-under-chrome | under-chrome:<name> | tap | R-land on its piece | docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md; ADR 0005 |
 * | R-under-chrome | under-chrome:<name> | colour | fails: the chrome is a pixel cover over what it reads | ADR 0001, ADR 0003 |
 * | R-under-chrome | under-chrome:<name> | scroll_until | not reached where it is (the stop fails) | docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> (whole, centre clear, its edge overlapped past ADR 0002's slack) | tap | `Tapped`, inside what shows (R-land at its centre) | ADR 0009 (N-a: the tap is centre-based) |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> | colour | fails closed when what it samples (the 12 %-inset rect) is overlapped past the slack, else passes on its own colour | ADR 0001, ADR 0002 |
 * | R-overlap | band-overlap:<band>, chrome-overlap:<name> | scroll_until | reached with no swipe | ADR 0009 (N-a: the plain stop is centre-based) |
 * | R-overlap | band-overlap:<band> (in a scroll view), chrome-overlap:<name> | scroll_until `fully: true` | R-fully: not "visible" where it is | ADR 0009 (N-a, `fully`: the bands as a region); ui-tree/standing.ts#fullyStanding (any cover covers) |
 * | R-dismiss | a field under the keyboard, the cell's `keyboardDismiss` (CellTruth.config) naming an element a bar lies over — WDA only (the list is inert under idb) | tap | the dismissal is tapped (a tap sent inside the element), not refused for the bar, and nothing else tapped (no tap inside the keyboard, no `Tapped`) | docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md, docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md; ADR 0016 |
 * | R-direction | below / above what shows | scroll_until | each stroke brings it closer (LIVE ONLY: a replayed tree never moves) | docs/bugs/2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md |
 */

/**
 * The tap and the stop ask a target as an agent would, and as the live golden does: by truth.ts#selectorOf — a text
 * target (CatalogTarget.text) by its string, a label target (CatalogTarget.label) by its label, any other by its
 * identifier. A text-asked target is resolved by averi's text match, so where the string's node is not the
 * identifier's (a label inside its button), the row judges the node the agent's call finds.
 */
const tapCall = (platform: Platform, t: Pick<TargetTruth, 'id' | 'text' | 'label'>): Call => ({ tool: 'tap', args: { platform, selector: selectorOf(t) } });
const scrollCall = (platform: Platform, t: Pick<TargetTruth, 'id' | 'text' | 'label'>, direction: Direction, fully = false): Call => ({
  tool: 'scroll_until',
  args: { platform, selector: selectorOf(t), direction, ...(fully && { fully: true }) },
});

/**
 * A text (or label) target as a row asked BY ITS IDENTIFIER sees it (selectorOf then spells `id:"…"`): the second
 * question a text target's identifier keeps open beside the agent's — what averi reads of the node the identifier
 * names, which may be listed where the string is not (text-under-bar's P on Android: its node by the uncovered strip
 * above the pinned button). A row asked so is keyed `<tag>.id` (Expectation.target).
 */
export function byIdentifier(t: TargetTruth): TargetTruth {
  const { text: _text, textListed: _listed, label: _label, ...rest } = t;
  return rest;
}

/**
 * The options of a row type whose truth may allow the target missing from the tree: `absent`, why it may (the caller's,
 * target-contract.ts#askedUnlistedBy for a selector-asked row, #unlistedBy for the colour's identifier) — the row then
 * accepts a reply that never found the target, judged by what it did. One shape for every row that takes it: the tap
 * rows (tapRow), stopRow, strokeRow, and colourFails, which adds its `expected`.
 */
export interface RowOptions {
  absent?: string;
}

/** `e` with the caller's `absent` (RowOptions), when it gave one — the one spelling of it for every row type that takes it. */
const withAbsent = (e: Expectation, { absent }: RowOptions): Expectation => (absent === undefined ? e : { ...e, absent });

/**
 * The tap row that judges `ask`, the target's tap clause (target-contract.ts#contractOf), routed by the clause:
 * `refuse` naming scroll_until — R-off, R-outside-sv, R-sliver (refusedTap); `land-or-refuse` inside what shows — R-band,
 * a band whose probe fired (bandTap); `fire` inside what shows or `land-or-refuse` inside its piece — R-land (landRow);
 * `refuse` with no remedy — the judged geometry says which wording judges it (a system band: bandTap, else landRow):
 * the same clause, two mismatch texts the KNOWN files pin. The open target's tap (`fire` at its node) is base.ts#openRows', a
 * presented one's (`refuse`, close it first) presented.ts'. `c`: the target's contract (its tap clause, its judged geometry); `absent` (askedUnlistedBy: the target as the tap asks it) as every tap row takes it.
 */
export function tapRow(platform: Platform, t: TargetTruth, c: Pick<TargetContract, 'tap' | 'geometry'>, row: string, opts: RowOptions = {}): Expectation {
  const ask = c.tap;
  if (ask === undefined) throw new Error(`${t.id}: the target contract asks no tap of it (${t.geometry ?? t.declared}) — its rows are not asked`);
  switch (ask.must) {
    case 'refuse':
      if (ask.remedy === 'scroll_until') return refusedTap(platform, t, row, ask, opts);
      if (ask.remedy === 'close it first') throw new Error(`${t.id}: a presented target's tap is presented.ts's`);
      return isBand(c.geometry) ? bandTap(platform, t, ask, opts) : landRow(platform, t, ask, opts);
    case 'land-or-refuse':
      return ask.inside === 'visible' ? bandTap(platform, t, ask, opts) : landRow(platform, t, ask, opts);
    case 'fire':
      if (ask.inside === 'node') throw new Error(`${t.id}: an open target's tap is base.ts#openRows'`);
      return landRow(platform, t, ask, opts);
  }
}

/**
 * The plain stop's row that judges `ask`, the stop clause where the capture lays the target out
 * (target-contract.ts#contractOf): reached with no swipe where the stop holds there (R-overlap: its centre clear —
 * reachedAtOnce), else not reached where it is (R-sliver, R-band, R-under-chrome — notReachedStill). `row` names it;
 * `absent` (target-contract.ts#askedUnlistedBy) as refusedTap takes it.
 */
export function stopRow(platform: Platform, t: TargetTruth, cell: CellTruth, row: string, ask: StopAsk, opts: RowOptions = {}): Expectation {
  return withAbsent(ask.holds ? reachedAtOnce(platform, t, cell, row, ask) : notReachedStill(platform, t, cell, row, ask), opts);
}

/**
 * R-off, R-outside-sv, R-sliver (tapAsk: `refuse`, remedy scroll_until): the tap refused, its remedy scroll_until, nothing sent. `absent` (why the truth allows
 * the target to be missing from the tree): a tap that waited for it and sent nothing is as good — no node, no remedy
 * to name.
 */
function refusedTap(platform: Platform, t: TargetTruth, row: string, ask: TapAsk, opts: RowOptions = {}): Expectation {
  const { absent } = opts;
  return withAbsent(
    {
      asks: ask,
      verb: 'tap',
      says: `${row}: refused naming scroll_until, nothing tapped`,
      call: tapCall(platform, t),
      judge: (o) => notTapped(o) ?? (scrollAdvice(o.reply) || (absent !== undefined && notInTree(o.reply)) ? undefined : said(o, 'refused without scroll_until')),
    },
    opts,
  );
}

/**
 * R-band (tapAsk: `refuse`, or `land-or-refuse` inside what shows): the tap refused, nothing sent (its remedy depends
 * on whether a scroll lifts it out: not judged) — where the
 * probe at its centre did not fire it (the bar swallowed it: Android's status bar, the top of iOS's,
 * truth.ts#statusBarMaySwallow; Android's navigation bar under three buttons, truth.ts#navigationBandTakes). Where it
 * did (iOS, below the bar's own touch area; Android's navigation band under gesture navigation), what fires there is
 * the truth: the tap is not expected refused — `Tapped` inside what shows of it, or refused with nothing sent (averi's
 * own model of the band may refuse it, ADR 0009 N-a on Android; it must not tap elsewhere).
 */
function bandTap(platform: Platform, t: TargetTruth, ask: TapAsk, opts: RowOptions = {}): Expectation {
  if (ask.must === 'land-or-refuse') {
    return withAbsent({ asks: ask, verb: 'tap', says: `R-band: its probe fired (${t.geometry}): Tapped inside what shows of it, or refused with nothing sent`, call: tapCall(platform, t), judge: (o) => landed(o, t.visible ?? t.frame, true, false) }, opts);
  }
  return withAbsent({ asks: ask, verb: 'tap', says: `R-band: refused (${t.geometry}), nothing tapped`, call: tapCall(platform, t), judge: notTapped }, opts);
}

/**
 * R-off, R-outside-sv, R-band, R-under-chrome: the colour assert fails, asked for the target's own colour — or for
 * `expected`, the colour the screen shows there (TargetTruth.seen), so that a pass means it measured what lies there
 * instead of the target (R-outside-sv: the background beneath its scroll view, calibration.json #29).
 */
export function colourFails(platform: Platform, t: TargetTruth, why: string, opts: RowOptions & { expected?: string } = {}): Expectation {
  const expected = opts.expected ?? t.color;
  return withAbsent(
    {
      verb: 'colour',
      says: `fails (${why})${expected === t.color ? '' : `, asked for the colour the screen shows there (${expected})`}`,
      call: { tool: 'assert', args: { platform, asserts: [{ element: { id: t.id }, color: { expected }, timeout: BUDGET_MS }] } },
      judge: (o) => (passed(o) ? `passed on ${expected}: ${first(o)}` : undefined),
    },
    opts,
  );
}

/**
 * R-band's colour: fails closed, a system band over what it reads (ADR 0001) — the status bands, and Android's
 * navigation band under three buttons, where the bar takes the tap. Under gesture navigation that band is the app's
 * (truth.ts#navigationBandTakes, by the capture's CellTruth.navigation): measured on the averi_lab AVD, bands' N there
 * is reached, 90 % drawn and seen in its own colour beneath the gesture handle, so a PASS on its own colour is right
 * about what shows (ADR 0020: the measured truth outranks a hand-written expectation) and a FAIL is averi failing
 * closed on the band it models (ADR 0009 N-a): either is accepted, nothing else. With no mode recorded consistency
 * holds the target broken, and no row is asked. Who takes the band is truth.ts#navigationBandTakes' alone (the bar only
 * on Android); iOS's home-indicator band never comes here — the contract judges a target there by what else lies
 * around it (target-contract.ts#judgedContext).
 */
export function bandColour(platform: Platform, t: TargetTruth, cell: CellTruth): Expectation {
  const band = bandNamed(t.geometry);
  const g = band === 'status' ? 'status' : 'navigation';
  const takes = band === 'nav' ? navigationBandTakes(platform, 'nav-band', cell.navigation) : undefined;
  // Android's navigation bar under three buttons is drawn over the target: asked for the colour the screen shows there
  // (the bar's, TargetTruth.seen), so that a pass means it measured the bar (calibration.json #23, as R-outside-sv's
  // colour asks for the background: #29).
  if (takes === 'bar') return colourFails(platform, t, `R-band: the ${g} bar over it`, { expected: t.seen });
  if (takes !== 'app') return colourFails(platform, t, `R-band: the ${g} band over it`);
  return {
    verb: 'colour',
    says: `R-band (the navigation band under ${cell.navigation} navigation, the app's): passes on its own colour ${t.color}, or fails closed`,
    call: { tool: 'assert', args: { platform, asserts: [{ element: { id: t.id }, color: { expected: t.color }, timeout: BUDGET_MS }] } },
    judge: (o) => (passed(o) || ASSERTS_FAILED.test(o.reply) ? undefined : said(o, 'neither passed nor failed')),
  };
}

/**
 * R-stroke over a target off what shows: scroll_until toward it swipes, every touch-down strokeable
 * (judges.ts#strokeable) — and, where the truth names the target's scroll view and the capture its clip, inside that
 * scroll view: a stroke that touches down beside it moves nothing it holds (WDA's own refusal names that scroll view).
 * `absent`, given by the caller where the tree may not list the target (target-contract.ts#unlistedBy: the capture's tree of that
 * source did not — uiautomator dumps only what is visible to the user), lets a "never appeared in the tree" reply be
 * judged by its strokes, the swipes sent looking for it the evidence all the same; the scroll-view check is then not
 * asked: averi cannot know which scroll view holds a node it never saw. Every swipe runs along the axis of its
 * direction (its larger leg on that axis, whichever way — a turn back is a stroke along it too): a scroll view moves
 * along its own axis, and a stroke across a carousel's moves it not (the residual of
 * docs/bugs/2026-10-16-lab-ios-wda-scroll-until-strokes-beside-the-targets-scroll-view.md).
 */
export function strokeRow(platform: Platform, t: TargetTruth, cell: CellTruth, row: string, ask: StopAsk, opts: RowOptions = {}): Expectation {
  const { absent } = opts;
  const direction = directionOf(t, cell);
  const own = absent === undefined && t.scrollView !== undefined ? cell.scrollViews?.[t.scrollView] : undefined;
  return withAbsent(
    {
      verb: 'scroll_until',
      asks: ask,
      says: `${row}, R-stroke: swipes ${direction} for it, every touch-down clear of the bands and the chrome${own === undefined ? '' : ` and inside its scroll view ${t.scrollView}`}`,
      call: scrollCall(platform, t, direction),
      judge: (o) => {
        if (swipes(o) === 0) return said(o, 'no swipe');
        const beside = own === undefined ? [] : touchDowns(o).filter((p) => !within(p, own));
        const axis = axisOf(direction);
        const across = strokes(o).filter(({ from, to }) => Math.abs(to[axis] - from[axis]) <= Math.abs(to[otherAxis(axis)] - from[otherAxis(axis)]));
        return (
          strokesOff(o, cell) ??
          (beside.length === 0 ? undefined : `touched down outside its scroll view ${t.scrollView} at ${pointsText(beside)}: ${first(o)}`) ??
          (across.length === 0 ? undefined : `swiped across the ${axis} axis it scrolls ${direction} along, from ${pointsText(across.map((s) => s.from))}: ${first(o)}`)
        );
      },
    },
    opts,
  );
}

/**
 * R-sliver, R-band, R-under-chrome: the plain stop does not call it reached where it is. In a replayed tree no stroke
 * moves it, so a stop after N swipes stopped where it is just the same: the stop must fail (an ERROR), whatever it
 * swiped.
 */
function notReachedStill(platform: Platform, t: TargetTruth, cell: CellTruth, row: string, ask: StopAsk): Expectation {
  return {
    asks: ask,
    verb: 'scroll_until',
    says: `${row}: not reached where it is (the stop fails; a replayed tree never moves)`,
    call: scrollCall(platform, t, directionOf(t, cell)),
    judge: (o) => (isError(o.reply) ? undefined : said(o, `reached where it is ${t.geometry}, after ${swipes(o)} swipe(s) that move nothing`)),
  };
}

/**
 * R-fully: `fully: true` never calls it "visible" where it is — after no swipe, or after swipes that move nothing in a
 * replayed tree. One stop is the device's to answer, not the tree's: a rect FLUSH with its scroll container's edge,
 * where Android's uiautomator cuts a node's bounds, is checked by a probe swipe toward it (ADR 0005, scroll-rounds.ts
 * #PROBE_REACH; docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md, its fix
 * 9c7885e) — on the device the probe moves a cut row and the stop goes on; in a replayed tree nothing moves. So a stop
 * that says it probed a flush edge (replies.ts#flushProbedSide) is accepted only where the TRUTH bears it out (flushProbe): what shows
 * of the target ends on that side exactly at its own scroll view's edge, and a swipe was sent from inside that scroll
 * view toward that edge. The replay checks only that the probe is sent toward the cut; whether it reveals the row and
 * the stop goes on is live (phase 5). Any other "visible" is red.
 */
export function fullyRow(platform: Platform, t: TargetTruth, cell: CellTruth, ask: StopAsk): Expectation {
  return {
    asks: ask,
    verb: 'fully',
    says: `R-fully: fully: true is not "visible" where it is ${t.geometry} (a flush edge: probed toward it, the probe's answer the device's)`,
    call: scrollCall(platform, t, directionOf(t, cell), true),
    judge: (o) => {
      if (!claimsVisible(o.reply)) return undefined;
      const why = flushProbe(o, t, cell);
      if (why === undefined) return undefined;
      return said(o, `fully visible where it is ${t.geometry}, after ${swipes(o)} swipe(s) that move nothing${why === NOT_PROBED ? '' : ` (${why})`}`);
    },
  };
}

const NOT_PROBED = 'no flush probe said';

/**
 * Why a stop's flush probe does not stand, judged by the truth — undefined when it does: the reply names a side
 * (replies.ts#flushProbedSide); what shows of the target (TargetTruth.visible) ends on that side at its scroll view's edge (within a
 * pixel/point); and a swipe touched down inside that scroll view dragging toward that edge (a bottom edge: the finger
 * moves up, as the content must to bring what lies below it into view).
 */
export function flushProbe(o: Outcome, t: Pick<TargetTruth, 'visible' | 'scrollView'>, cell: Pick<CellTruth, 'scrollViews'>): string | undefined {
  const side = flushProbedSide(o.reply);
  if (side === undefined) return NOT_PROBED;
  const sv = t.scrollView === undefined ? undefined : cell.scrollViews?.[t.scrollView];
  const v = t.visible ?? undefined;
  if (sv === undefined || v === undefined) return `no scroll view or visible part in the truth to bear out its ${side} edge`;
  const edge = (r: Rect) => ({ top: r.y, bottom: r.y + r.height, left: r.x, right: r.x + r.width })[side];
  if (Math.abs(edge(v) - edge(sv)) > 1) return `its ${side} edge is not flush with its scroll view ${t.scrollView} in the truth (${edge(v)} vs ${edge(sv)})`;
  const toward = strokes(o).some(({ from, to }) => {
    const drag = { bottom: to.y < from.y, top: to.y > from.y, right: to.x < from.x, left: to.x > from.x }[side];
    return drag && within(from, sv);
  });
  return toward ? undefined : `no swipe from inside its scroll view ${t.scrollView} toward its ${side} edge`;
}

/**
 * R-land: the tap lands on what shows of the target. Reached at its centre (`partly-centre-in`, and a whole target
 * overlapped at its edge, `band-overlap:<band>` / `chrome-overlap:<name>` — tapAsk `fire` inside what shows):
 * `Tapped`, inside `visible`. Else (`centre-out`, `under-chrome:<name>`): refused with nothing sent, or `Tapped` inside
 * its piece where the second probe fired (`reachedAtPiece` — tapAsk `land-or-refuse` inside its piece).
 */
function landRow(platform: Platform, t: TargetTruth, ask: TapAsk, opts: RowOptions = {}): Expectation {
  const atCentre = ask.must === 'fire';
  const where = 'inside' in ask && ask.inside === 'visible' ? t.visible : t.piece;
  const fired = ask.must !== 'refuse';
  return withAbsent(
    {
      asks: ask,
      verb: 'tap',
      says: atCentre ? 'R-land: Tapped, inside what shows of it' : `R-land: ${fired ? 'refused, or Tapped inside its piece' : 'refused, nothing tapped'}`,
      call: tapCall(platform, t),
      judge: (o) => landed(o, where, fired, atCentre),
    },
    opts,
  );
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
      if (!tapPoints(o).some((p) => within(p, dismissal.frame))) {
        const cover = dismissalCover(o.reply);
        return said(o, `no tap on the dismissal ${dismissal.label}${cover === undefined ? '' : ` (refused for a ${cover})`}`);
      }
      if (keyboard === undefined) return undefined;
      const under = tapPoints(o).filter((p) => within(p, keyboard));
      if (under.length > 0) return said(o, `tapped under the keyboard at ${pointsText(under)}`);
      return claimsTap(o.reply) ? said(o, 'Tapped while the keyboard still covers it') : undefined;
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
function reachedAtOnce(platform: Platform, t: TargetTruth, cell: CellTruth, row: string, ask: StopAsk): Expectation {
  return {
    asks: ask,
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
  // The bands and chrome as the contract judges them (target-contract.ts#judgedContext: iOS's home-indicator band none).
  const over = t.visible === null || t.visible === undefined ? undefined : regionOverlap(sampleOf(t.visible), judgedContext(platform, cell, undefined));
  if (over !== undefined) return colourFails(platform, t, `R-overlap: ${parseGeometry(over).name} over what it samples`);
  return {
    verb: 'colour',
    says: `R-overlap: passes on its own colour ${t.color} (what it samples is clear)`,
    call: { tool: 'assert', args: { platform, asserts: [{ element: { id: t.id }, color: { expected: t.color }, timeout: BUDGET_MS }] } },
    judge: passes,
  };
}
