import type { Platform } from './corpus.js';
import type { Call, Outcome } from './differential.js';
import { DRAWN, type TargetTruth } from '../truth/schema.js';

/**
 * The golden mode's spec table (docs/plans/2026-10-15-ground-truth-lab-app.md): for a target whose truth is known,
 * what each verb must answer. Outcomes are judged as classes — tapped or refused, passed or failed, reached or stopped,
 * and the remedy the reply names — never as wording: wording is the OLD/NEW differential's business.
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | open: reached, drawn as itself | `Tapped` | passes on its own colour | visible after 0 swipes |
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there — a pass measured the cover | stops before any swipe, `close it first` (ADR 0018) |
 *
 * A row is added with the cells that need it.
 */

export type Verb = 'tap' | 'colour' | 'scroll_until';

export interface Expectation {
  verb: Verb;
  /** What the verb must answer, in a few words — the report's "expected". */
  says: string;
  call: Call;
  /** undefined: the outcome is what the truth implies; else why it is not. */
  judge(outcome: Outcome): string | undefined;
}

const BUDGET_MS = 1_000;
const passed = (o: Outcome) => o.reply.startsWith('All 1 asserts passed');
const swipes = (o: Outcome) => o.device.filter((c) => / ui swipe | input swipe /.test(` ${c} `)).length;
const first = (o: Outcome) => o.reply.split('\n')[0].slice(0, 200);

export function expectations(platform: Platform, t: TargetTruth): Expectation[] {
  const selector = `id:"${t.id}"`;
  const element = { id: t.id };
  if (t.declared === 'open' && t.reached && t.drawn >= DRAWN) {
    return [
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
        judge: (o) => (passed(o) ? undefined : `failed: ${first(o)}`),
      },
      {
        verb: 'scroll_until',
        says: 'reached with no swipe',
        call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
        judge: (o) => (o.reply.startsWith('ERROR') ? `stopped: ${first(o)}` : swipes(o) > 0 ? `swiped ${swipes(o)}×: ${first(o)}` : undefined),
      },
    ];
  }
  if (t.declared === 'presented-over' && !t.reached) {
    const closeFirst = (o: Outcome) => /close it first/.test(o.reply);
    return [
      {
        verb: 'tap',
        says: 'refused: close it first, nothing tapped',
        call: { tool: 'tap', args: { platform, selector } },
        judge: (o) =>
          o.reply.startsWith('Tapped') ? `tapped a target a presented layer covers: ${first(o)}` : !closeFirst(o) ? `refused without "close it first": ${first(o)}` : undefined,
      },
      {
        verb: 'colour',
        says: `fails, even asked for the colour the screen shows there (${t.seen})`,
        call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.seen }, timeout: BUDGET_MS }] } },
        judge: (o) => (passed(o) ? `passed on ${t.seen}: it measured the layer over the target as the target` : undefined),
      },
      {
        verb: 'scroll_until',
        says: 'stops before any swipe: close it first',
        call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
        judge: (o) => (swipes(o) > 0 ? `swiped ${swipes(o)}× beneath a presented layer: ${first(o)}` : !closeFirst(o) ? `no "close it first": ${first(o)}` : undefined),
      },
    ];
  }
  return [];
}
