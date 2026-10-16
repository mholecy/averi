import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import { BUDGET_MS, classed, closeFirst, notInTree, notTapped, passed, said, swipes, type Expectation } from './judges.js';

/**
 * The presented family's rows (fixtures/apps/cells/presented.json): a coloured target beneath a presented layer — its
 * probe tap did not reach it.
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there — a pass measured the cover — naming `close it first` (ADR 0018: one remedy for the tap, the pixel asserts and scroll_until, whatever else lies over it — the status bar, the screen's edge); a fail because the element is not in the tree is no evidence either way | stops before any swipe, `close it first` (ADR 0018) |
 *
 * The presented layer comes first whatever else keeps the target from a tap or a look: wholly off the screen, wholly
 * under the status bar, a sliver at the screen's edge beneath the sheet (calibration.json #30, #32, #34 —
 * presented/sheet-medium-edges) are asked these rows, never the edge or band rows their measured geometry would pick
 * for an open target (golden-spec.ts#expectations): the remedy is to close the layer, and scroll advice cannot be
 * followed (scroll_until refuses beneath it).
 */
export function presentedOverRows(platform: Platform, t: TargetTruth): Expectation[] {
  const selector = `id:"${t.id}"`;
  const element = { id: t.id };
  return ([
    {
      verb: 'tap',
      says: 'refused: close it first, nothing tapped',
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => notTapped(o) ?? (closeFirst(o) ? undefined : said(o, 'refused without "close it first"')),
    },
    {
      verb: 'colour',
      says: `fails, even asked for the colour the screen shows there (${t.seen}), with the element in the tree: close it first`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.seen }, timeout: BUDGET_MS }] } },
      judge: (o) =>
        passed(o) ? `passed on ${t.seen}: it measured the layer over the target as the target`
        : notInTree(o) || closeFirst(o) ? undefined
        : said(o, 'failed without "close it first"'),
    },
    {
      verb: 'scroll_until',
      says: 'stops before any swipe: close it first',
      call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
      judge: (o) => (swipes(o) > 0 ? said(o, `swiped ${swipes(o)}× beneath a presented layer`) : !closeFirst(o) ? said(o, 'no "close it first"') : undefined),
    },
  ] satisfies Expectation[]).map(classed);
}
