import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import { BUDGET_MS, classed, first, passes, reachedWithNoSwipe, type Expectation } from './judges.js';

/**
 * The base family's rows (fixtures/apps/cells/base.json): a coloured target open — reached by its probe and drawn as
 * itself — wherever it lies (the `open` cell's four, a presented cell's target inside its layer).
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | open: reached, drawn as itself | `Tapped` | passes on its own colour | visible after 0 swipes |
 */
export function openRows(platform: Platform, t: TargetTruth): Expectation[] {
  const selector = `id:"${t.id}"`;
  const element = { id: t.id };
  return ([
    {
      verb: 'tap',
      says: 'Tapped',
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => (o.reply.startsWith('Tapped') ? undefined : `not tapped: ${first(o)}`),
    },
    {
      verb: 'colour',
      says: `passes on its own colour ${t.color}`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.color }, timeout: BUDGET_MS }] } },
      judge: passes,
    },
    {
      verb: 'scroll_until',
      says: 'reached with no swipe',
      call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
      judge: reachedWithNoSwipe,
    },
  ] satisfies Expectation[]).map(classed);
}
