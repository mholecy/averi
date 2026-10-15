import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import { BUDGET_MS, classed, closeFirst, notTapped, passed, said, swipes, type Expectation } from './judges.js';

/**
 * The presented family's rows (fixtures/apps/cells/presented.json): a coloured target beneath a presented layer — its
 * probe tap did not reach it.
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there — a pass measured the cover; a fail because the element is not in the tree is no evidence either way | stops before any swipe, `close it first` (ADR 0018) |
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
      says: `fails, even asked for the colour the screen shows there (${t.seen}), with the element in the tree`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.seen }, timeout: BUDGET_MS }] } },
      judge: (o) => (passed(o) ? `passed on ${t.seen}: it measured the layer over the target as the target` : undefined),
    },
    {
      verb: 'scroll_until',
      says: 'stops before any swipe: close it first',
      call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
      judge: (o) => (swipes(o) > 0 ? said(o, `swiped ${swipes(o)}× beneath a presented layer`) : !closeFirst(o) ? said(o, 'no "close it first"') : undefined),
    },
  ] satisfies Expectation[]).map(classed);
}
