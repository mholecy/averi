import type { Platform } from './corpus.js';
import { DRAWN, type TargetTruth } from '../truth/schema.js';
import { openRows } from './golden-spec/base.js';
import { presentedOverRows } from './golden-spec/presented.js';
import type { Expectation } from './golden-spec/judges.js';

/**
 * The golden mode's spec table (docs/plans/2026-10-15-ground-truth-lab-app.md): for a target whose truth is known,
 * what each verb must answer. Outcomes are judged as classes — tapped or refused, passed or failed, reached or stopped,
 * and the remedy the reply names — never as wording: wording is the OLD/NEW differential's business.
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | open: reached, drawn as itself | `Tapped` | passes on its own colour | visible after 0 swipes |
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there — a pass measured the cover; a fail because the element is not in the tree is no evidence either way | stops before any swipe, `close it first` (ADR 0018) |
 *
 * A row is added with the cells that need it. Every row's judge goes through one classification (classed). A reply
 * that says the target is not in the tree (a tap timing out "waiting for element … to appear", scroll_until's "never
 * appeared in the tree", an assert's "not found within") is judged by its effect first: where the row's own judge
 * rejects it (a tap refused without "close it first", a swipe beneath the presented layer, a touch-down under the
 * keyboard), the mismatch is the judge's own reason, as for any other reply — so the ratchet sees what the reply DID.
 * Only where the judge would accept it (a refusal, a FAIL) is the reply vacuous — no evidence of what the truth implies
 * — and the judge overruled: a mismatch of one class, said first — `not in the tree:`. A row whose truth says the
 * target may be missing from the tree (`absent`: a lazy row not laid out, a row off the screen) accepts such a reply.
 *
 * The form cells (phase 1b) add rows a replayed tree CAN judge — see formExpectations. What it cannot judge (a fill, a
 * clear: typing changes nothing in a recorded tree) is the live golden's (scripts/truth/live.ts).
 *
 * The rows live per cell family (scripts/differential/golden-spec/<family>.ts, the families of
 * fixtures/apps/cells/), the judges they share in golden-spec/judges.ts; this module is what the golden mode and the
 * tests import, and it picks a target's rows.
 */

export * from './golden-spec/judges.js';
export { formExpectations, pairingOf, type FormExpectation, type PairingRule } from './golden-spec/forms.js';

/** A coloured target's rows, by its truth: open (base.ts) or beneath a presented layer (presented.ts). */
export function expectations(platform: Platform, t: TargetTruth): Expectation[] {
  if (t.declared === 'open' && t.reached && t.drawn >= DRAWN) return openRows(platform, t);
  if (t.declared === 'presented-over' && !t.reached) return presentedOverRows(platform, t);
  return [];
}
