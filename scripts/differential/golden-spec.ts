import type { Platform, SourceKind } from './corpus.js';
import type { CellTruth, TargetTruth } from '../truth/schema.js';
import { elementOf, nodeFramesIn } from '../truth/truth.js';
import { contractOf } from '../truth/target-contract.js';
import { barRows } from './golden-spec/bars.js';
import { openRows } from './golden-spec/base.js';
import { edgeRows } from './golden-spec/edges.js';
import { dismissRows, ownPartsRows } from './golden-spec/false-covers.js';
import { formRows, type FormExpectation } from './golden-spec/forms.js';
import { presentedOverRows } from './golden-spec/presented.js';
import { textRows } from './golden-spec/text.js';
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
 * The form cells (phase 1b) add rows a replayed tree CAN judge — see golden-spec/forms.ts#formRows. What it
 * cannot judge (a fill, a clear: typing changes nothing in a recorded tree) is the live golden's
 * (scripts/truth/live.ts).
 *
 * WHAT a coloured target is asked, and what its truth implies each verb must answer, is the target contract's
 * (scripts/truth/target-contract.ts) — decided once, and read by the live golden's cases too (live-visibility.ts
 * #visibilityCases): which band is a band (judgedGeometry: iOS's home-indicator band is none), the tap's clause
 * (tapAsk), the stops' (stopAsk, fullyAsked), whether the target may be missing from the tree (unlistedBy). The rows
 * here are the contract's replayed adapter: each turns a clause into a call and a judge over the replayed reply, and
 * stamps the clause it judges (Expectation.asks; tests/truth/target-contract.test.ts holds the two goldens' clauses
 * equal). What a reply says is read by scripts/truth/replies.ts alone.
 *
 * The rows live in scripts/differential/golden-spec/ (one file per cell family of fixtures/apps/cells/), the judges
 * they share in golden-spec/judges.ts, phase 3's row types in golden-spec/rows.ts; this module is what the golden mode
 * and the tests import, and it picks a target's rows (expectations). A coloured target's rows are chosen by its truth —
 * presented-over, else its MEASURED geometry (truth.ts#geometryOf) — never by its cell's family: edges.ts and bars.ts
 * are geometry groups, asked of a target of any family whose capture measured an edge, band or chrome geometry, and
 * base.ts's open rows of any target measured `whole` (or unmeasured). A row not keyed on a target's geometry is wired
 * here too: false-covers' text targets (golden-spec/false-covers.ts#ownPartsRows) through expectations(), and its
 * R-dismiss (rows.ts#dismissRow, a form cell's row under its `config.ios.keyboardDismiss`) through formExpectations,
 * in place of the form's own under-keyboard tap. So a B5 (false covers) author edits golden-spec/false-covers.ts (its
 * rows), this module (to ask them), rows.ts only for a new row type — and the family's catalog file, app views and
 * tests/differential/golden/false-covers.known.ts, as every batch does. A text target (CatalogTarget.text) of any family
 * adds golden-spec/text.ts's rows (phase 4: its string read back from the tree and, `ocr`, by the host's recognizer
 * from the screenshot) to those its geometry asks.
 */

export * from './golden-spec/judges.js';
export { pairingOf, type FormExpectation, type PairingRule } from './golden-spec/forms.js';
export { dismissalOf, dismissRows, ownPartsRows } from './golden-spec/false-covers.js';
export * from './golden-spec/rows.js';

/**
 * A coloured target's rows, by its truth: beneath a presented layer (presented.ts); open and `whole` — or with no
 * measured geometry, as every capture before phase 3 — reached and drawn as itself (base.ts); open with a measured
 * geometry at an edge (edges.ts) or in a band or under chrome (bars.ts). `cell`, the target's capture, is what a
 * geometry's rows read the bands and the chrome from; without it (`undefined`) no geometry row is asked. `source`, the
 * replayed tree's: whether its capture listed the target (TargetTruth.listed) — an edge row accepts a target its tree
 * did not. Both are required, as formExpectations' `source` is, so a caller cannot forget the capture it replays.
 * `tree`, the replayed tree's payload: where it lists the target's node (truth.ts#nodeFramesIn, by the selector the
 * open rows ask — its identifier, or a text target's text), the open tap is held to that node's centre
 * (base.ts#atProbe); without it, to the reach around the probe point. golden.ts hands it every capture's
 * (tests/differential/golden-wiring.test.ts); a unit test of a row's choice may leave it out.
 */
export function expectations(platform: Platform, t: TargetTruth, cell: CellTruth | undefined, source: SourceKind, tree?: string): Expectation[] {
  // The target contract, decided once (target-contract.ts#contractOf); it asks nothing of a target its truth
  // contradicts (no tap clause: a presented-over one reached, an open whole one not reached or not drawn) —
  // consistency reports it broken.
  // A measured geometry is judged on its capture's screen: without it (a unit test of one row) no geometry row is asked.
  if (cell === undefined && t.declared !== 'presented-over' && t.geometry !== undefined && t.geometry !== 'whole') return [];
  const c = contractOf(platform, t, cell);
  if (t.declared === 'presented-over') return c.tap === undefined ? [] : presentedOverRows(platform, t, c.tap);
  const nodes = tree === undefined ? [] : nodeFramesIn(tree, source, elementOf(t));
  // A text target's own rows (golden-spec/text.ts, phase 4: its string from the tree and, by the host's recognizer, from
  // the screenshot) after the rows its geometry asks.
  const text = (rows: Expectation[]) => (t.text === undefined || rows.length === 0 ? rows : [...rows, ...textRows(platform, t, c.geometry, cell, source)]);
  // By the geometry the contract judges (judgedGeometry: iOS's home-indicator band is no band).
  const g = c.geometry;
  if (g === undefined || g === 'whole') return c.tap === undefined ? [] : t.text !== undefined ? text(ownPartsRows(platform, t, c, nodes)) : openRows(platform, t, c, nodes);
  return cell === undefined ? [] : text([...edgeRows(platform, t, cell, source, c), ...barRows(platform, t, cell, source, c)]);
}

/**
 * A form cell's rows (golden-spec/forms.ts#formRows) — and, on a cell whose config taps its title to hide the
 * keyboard, R-dismiss (golden-spec/false-covers.ts#dismissRows) in place of each under-keyboard field's tap row, for
 * the capture's tree `source` (the dismissal acts under WDA only).
 */
export function formExpectations(platform: Platform, truth: CellTruth, source: SourceKind): FormExpectation[] {
  const dismiss = dismissRows(platform, truth, source);
  return [...formRows(platform, truth).filter((e) => !(e.verb === 'tap' && dismiss.replaces.has(e.target))), ...dismiss.rows];
}
