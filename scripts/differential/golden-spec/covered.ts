import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import type { TapAsk } from '../../truth/target-contract.js';
import { BUDGET_MS, classed, notTapped, passed, type Expectation } from './judges.js';

/**
 * The covered target's rows (schema.ts#Declared `covered`; the react-native family's rn-banner, lab note LR3): a
 * coloured target the cell draws a sibling over, in its own screen, its centre under it — its probe tap did not reach it.
 *
 * | truth | tap | colour assert |
 * |---|---|---|
 * | covered: not reached | refused, nothing tapped — a `Tapped` pressed the cover, or nothing | fails, asked for the colour the screen shows there (the cover's) — a pass measured the cover as the target; a fail because the element is not in the tree is no evidence either way |
 *
 * No remedy is asked: what the reply should advise depends on the cover (a toast goes, a banner may not), and the
 * truth says only that the target lies under it (averi's reply for C, the cover listed after it, says "scroll_until it
 * first" — no scroll moves a cover of its own screen, a wording the rows do not judge). No scroll_until row: the cell's
 * targets lie in no scroll view, and the note asks the tap and the colour; a `fully` stop over a banner is the next
 * cell's to ask, in a list.
 * docs/bugs/2026-10-19-lab-ios-wda-lists-react-native-views-by-their-frames-top-not-in-draw-order.md
 */
export function coveredRows(platform: Platform, t: TargetTruth, ask: TapAsk): Expectation[] {
  const selector = `id:"${t.id}"`;
  const element = { id: t.id };
  return ([
    {
      asks: ask,
      verb: 'tap',
      says: 'refused, nothing tapped',
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => notTapped(o),
    },
    {
      verb: 'colour',
      says: `fails, even asked for the colour the screen shows there (${t.seen}): the cover's, not the target's`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.seen }, timeout: BUDGET_MS }] } },
      judge: (o) => (passed(o) ? `passed on ${t.seen}: it measured the cover over the target as the target` : undefined),
    },
  ] satisfies Expectation[]).map(classed);
}
