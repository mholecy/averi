import type { Platform, SourceKind } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import { notInTree, presentedRemedySaid } from '../../truth/replies.js';
import type { TapAsk } from '../../truth/target-contract.js';
import { BUDGET_MS, classed, IDB_PRESENTED, judgedUnlisted, notTapped, passed, presentedRemedyMissing, PRESENTED_REMEDY, said, swipes, type Expectation, type WayOut } from './judges.js';

/**
 * The presented family's rows (fixtures/apps/cells/presented.json): a coloured target beneath a presented layer — its
 * probe tap did not reach it.
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there (for a target measured wholly off the screen, its own) — a pass measured the cover — naming `close it first` (ADR 0018: one remedy for the tap, the pixel asserts and scroll_until, whatever else lies over it — the status bar, the screen's edge); a fail because the element is not in the tree is no evidence either way — unless the replayed tree lists no node of it: then it must name the presented remedy (under idb, or idb's reasons) | stops before any swipe, `close it first` (ADR 0018) |
 *
 * The presented layer comes first whatever else keeps the target from a tap or a look: wholly off the screen, wholly
 * under the status bar, a sliver at the screen's edge beneath the sheet (calibration.json #30, #32, #34 —
 * presented/sheet-medium-edges) are asked these rows, never the edge or band rows their measured geometry would pick
 * for an open target (golden-spec.ts#expectations): the remedy is to close the layer, and scroll advice cannot be
 * followed (scroll_until refuses beneath it).
 *
 * `absent` (golden-spec.ts#unlistedIn): the replayed tree of `source` lists no node of the target — uiautomator's
 * dump of the active window, idb's list of the presented layer alone. The colour assert's "not found" is then the
 * honest answer, judged (judges.ts#judgedUnlisted) by the way out of its tree source (presentedWayOut). A bare one, or
 * one naming another remedy, is a mismatch. Unset (the tree lists it, or no payload was given), such a "not found" is
 * no evidence either way: vacuous (judges.ts#classed).
 */
export function presentedOverRows(platform: Platform, t: TargetTruth, ask: TapAsk, source: SourceKind, absent?: string): Expectation[] {
  const selector = `id:"${t.id}"`;
  const element = { id: t.id };
  // A target measured wholly off the screen shows nothing there to ask for (its `seen` is no pixel's): it is asked for
  // its own colour.
  const offScreen = t.geometry === 'off-screen';
  const asked = offScreen ? t.color : t.seen;
  return ([
    {
      asks: ask,
      verb: 'tap',
      says: 'refused: close it first, nothing tapped',
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => notTapped(o) ?? presentedRemedyMissing(o, 'refused without "close it first"'),
    },
    judgedUnlisted({
      verb: 'colour',
      says: offScreen
        ? `fails (nothing of it is on the screen), asked for its own colour (${asked}), with the element in the tree: close it first`
        : `fails, even asked for the colour the screen shows there (${asked}), with the element in the tree: close it first`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: asked }, timeout: BUDGET_MS }] } },
      // Lenient on purpose: it accepts any "not found" (no evidence either way, classed calls it vacuous); where the
      // tree does not list the target, judgedUnlisted adds the way out the reply must name.
      judge: (o) =>
        passed(o) ? `passed on ${asked}: it measured ${offScreen ? 'what is not on the screen' : 'the layer over the target as the target'}`
        : notInTree(o.reply) || presentedRemedySaid(o.reply) ? undefined
        : said(o, 'failed without "close it first"'),
    } satisfies Expectation, absent, presentedWayOut(source)),
    {
      verb: 'scroll_until',
      says: 'stops before any swipe: close it first',
      call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
      judge: (o) => (swipes(o) > 0 ? said(o, `swiped ${swipes(o)}× beneath a presented layer`) : presentedRemedyMissing(o, 'no "close it first"')),
    },
  ] satisfies Expectation[]).map(classed);
}

/**
 * The way out a presented colour row's "not found" must name where its tree does not list the target
 * (judges.ts#judgedUnlisted), by its tree source: under idb — whose list shows no sign of some layers — the presented
 * remedy or idb's reasons (IDB_PRESENTED); under a source that marks its presented window (uiautomator), the presented
 * remedy alone (PRESENTED_REMEDY) — as the tap row, never the active-window hint.
 */
const presentedWayOut = (source: SourceKind): WayOut => (source === 'idb' ? IDB_PRESENTED : PRESENTED_REMEDY);
