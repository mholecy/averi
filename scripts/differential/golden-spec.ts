import type { Platform } from './corpus.js';
import { DRAWN, type CellTruth, type TargetTruth } from '../truth/schema.js';
import { barRows } from './golden-spec/bars.js';
import { openRows } from './golden-spec/base.js';
import { edgeRows } from './golden-spec/edges.js';
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
 * | presented-over: not reached | refused, `close it first`, nothing tapped (ADR 0018) | fails, asked for the colour the screen shows there — a pass measured the cover — naming `close it first`; a fail because the element is not in the tree is no evidence either way | stops before any swipe, `close it first` (ADR 0018) |
 *
 * A row is added with the cells that need it — except phase 3's row types (golden-spec/rows.ts), which B1 (the plan's
 * phase 3) declared ahead of their cells so that the families can be built in parallel: a row type asks nothing until a
 * capture carries the geometry or kind it judges. Every row's judge goes through one classification (classed). A reply
 * that says the target is not in the tree (a tap timing out "waiting for element … to appear", scroll_until's "never
 * appeared in the tree", an assert's "not found within") is judged by its effect first: where the row's own judge
 * rejects it (a tap refused without "close it first", a swipe beneath the presented layer, a touch-down under the
 * keyboard), the mismatch is the judge's own reason, as for any other reply — so the ratchet sees what the reply DID.
 * Only where the judge would accept it (a refusal, a FAIL) is the reply vacuous — no evidence of what the truth implies
 * — and the judge overruled: a mismatch of one class, said first — `not in the tree:`. A row whose truth says the
 * target may be missing from the tree (`absent`: a lazy row not laid out, a row off the screen) accepts such a reply.
 *
 * The form cells (phase 1b) add rows a replayed tree CAN judge — see golden-spec/forms.ts#formExpectations. What it
 * cannot judge (a fill, a clear: typing changes nothing in a recorded tree) is the live golden's
 * (scripts/truth/live.ts).
 *
 * The rows live in scripts/differential/golden-spec/ (one file per cell family of fixtures/apps/cells/), the judges
 * they share in golden-spec/judges.ts, phase 3's row types in golden-spec/rows.ts; this module is what the golden mode
 * and the tests import, and it picks a target's rows (expectations). A coloured target's rows are chosen by its truth —
 * presented-over, else its MEASURED geometry (truth.ts#geometryOf) — never by its cell's family: edges.ts and bars.ts
 * are geometry groups, asked of a target of any family whose capture measured an edge, band or chrome geometry, and
 * base.ts's open rows of any target measured `whole` (or unmeasured). A row not keyed on a target's geometry is wired
 * here too: false-covers' R-dismiss (rows.ts#dismissRow, a cell's row under its `config.ios.keyboardDismiss`) goes
 * through expectations(), as the form rows go through formExpectations. So a B5 (false covers) author edits
 * golden-spec/false-covers.ts (its rows), this module's expectations() (to ask them of the cell), rows.ts only for a
 * new row type — and the family's catalog file, app views and tests/differential/golden/false-covers.known.ts, as every
 * batch does.
 */

export * from './golden-spec/judges.js';
export { formExpectations, pairingOf, type FormExpectation, type PairingRule } from './golden-spec/forms.js';
export * from './golden-spec/rows.js';

/**
 * A coloured target's rows, by its truth: beneath a presented layer (presented.ts); open and `whole` — or with no
 * measured geometry, as every capture before phase 3 — reached and drawn as itself (base.ts); open with a measured
 * geometry at an edge (edges.ts) or in a band or under chrome (bars.ts). `cell`, the target's capture, is what a
 * geometry's rows read the bands and the chrome from; without it no geometry row is asked.
 */
export function expectations(platform: Platform, t: TargetTruth, cell?: CellTruth): Expectation[] {
  if (t.declared === 'presented-over') return t.reached ? [] : presentedOverRows(platform, t);
  if (t.geometry === undefined || t.geometry === 'whole') return t.reached && t.drawn >= DRAWN ? openRows(platform, t) : [];
  return cell === undefined ? [] : [...edgeRows(platform, t, cell), ...barRows(platform, t, cell)];
}
