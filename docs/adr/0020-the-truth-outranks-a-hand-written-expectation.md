# 20. The truth outranks a hand-written expectation

Status: proposed, 2026-10-15 (phase 0 of docs/plans/2026-10-15-ground-truth-lab-app.md: "Q3 in code, principle in an
ADR"; written on review round 1 of the lab branch, for the owner to accept).

## Context

Until the lab apps, every expectation averi was tested against was written by hand: a unit test's fixture and its
asserted reply, a device check's note of what the screen showed, the OLD/NEW differential's "no change". Each is only as
good as the person's reading of the screen, and the differential cannot see an answer both sides get wrong. Round 18's
alert dim (`Tapped` on a target the alert covered) passed every one of them.

The lab apps (fixtures/apps/) build screens whose truth is measured, not read: the app reports its own frames, a raw
tap at a target's centre says whether its action fired (and, its positive control, whether the tap reached the app at
all), and the screenshot says how much of the target is drawn as itself. The golden mode
(scripts/differential/golden.ts) judges averi's answers against that truth.

## Decision

1. **The measured truth outranks a hand-written expectation.** Where the lab's truth and a test, a fixture or a note
   disagree about what a screen shows, the truth wins and the other is corrected. A disagreement between the app's
   frame and a tree's rect is a finding about the tree, not about the truth.
2. **Golden judges classes, not wording.** Tapped or refused and the remedy named; passed or failed; reached or stopped;
   a tap or a stroke sent or not. What a target is asked and what its truth implies each verb must answer — which band
   is a band, the tap's clause (fire, land or refuse, refuse and with which remedy), where a stop holds, whether
   `fully` is asked, whether the target may be missing from the tree — is decided in ONE module, the target contract
   (scripts/truth/target-contract.ts). The replayed golden and the live golden are both its consumers, never its
   authors: the replayed rows (scripts/differential/golden-spec/*.ts — per cell family and phase 3's row types, behind
   the façade golden-spec.ts, each row citing the rule or ADR that decides it) turn a clause into a call and a judge over
   a replayed reply, the live cases (scripts/truth/live-visibility.ts) into calls on the lab app judged by its own log,
   its geometry read in the same judged context. Each records the clause that chose it. For every committed truth target
   both ask, tests/truth/target-contract.test.ts holds the recorded clauses equal and feeds both judges the same
   synthetic answers — a refusal that sent and fired nothing, a `Tapped` that fired the target alone where the clause
   lands it, a stop with no swipe where the capture lays the target out — requiring them to agree as the clause says.
   Their oracles differ, not their contract: the replay knows the capture's probe and the tree, the live golden the
   app's tap log (so a `Tapped` that fired the target alone is true live even where the replay requires a refusal).
   How a target is addressed is one rule both share, `selectorOf` (scripts/truth/truth.ts): a text target by its string,
   as an agent would ask it, any other by its identifier; and whether the target may be missing from a tree AS ASKED is
   the contract's (`askedUnlistedBy`, scripts/truth/target-contract.ts: a text target's string, else its node). Where a
   text target's identifier keeps a second question open (the node it names read whole where the string is not listed),
   the replay asks that too, as a row keyed apart (`<tag>.id`, golden-spec/bars.ts).
   averi's replies are read by one module too (scripts/truth/replies.ts: a reply's kind, its claims, its numbers, an ocr
   reading), for both. A reply saying the target is not in the tree is judged by its effect first: where the row rejects
   it (a tap refused without its remedy, a stroke beneath the presented layer), the mismatch is the row's own reason;
   where the row would accept it, it is no evidence either way — the "not in the tree" mismatch, never a pass — unless
   the row's truth allows the target to be absent (a lazy row not laid out). Wording stays the OLD/NEW differential's
   business.
3. **A broken cell is reported, not judged.** When a capture's sources disagree with each other — declared open but not
   reached, a probe tap that left no touch in the app, an open control the probe did not reach (the consistency checks
   of scripts/truth/truth.ts) — it says nothing about averi: it is listed broken and the run fails until the cell is
   fixed or recaptured. What is not asked: on a coloured-target cell, the broken target's rows (its other targets are
   still judged); on a form cell, every row of the cell, once any control is broken.
4. **Known mismatches are a ratchet.** tests/differential/golden.test.ts lists each known mismatch — filed per cell
   family in tests/differential/golden/<family>.known.ts and aggregated there — by `<run>/<file> <target> <verb>` with
   its class (what its mismatch says first), its reply's kind (one of a closed set: not found, Tapped, visible, PASS,
   FAIL, refused, other — `replyKind` in scripts/truth/replies.ts), the taps and swipes it sent, and
   its note (the bug note, or why). A listed mismatch that stops occurring fails the test until it is struck off; a new
   one fails it until it is fixed or listed with its note; a listed one whose class, reply kind or device calls change
   fails it too — it still mismatches, but differently (a timeout turned into a refusal with the wrong remedy keeps its
   class and its calls, but not its kind). The checks per capture are pinned, so a row that silently stops being asked
   fails.
   The notes are held to docs/bugs and to the calibration table (scripts/truth/calibration.json), with no third file
   between them (tests/truth/lab-notes.test.ts, round 5): a row filed as a bug (`as: bug:<file>`) names an existing
   note, one filed as a residual names a decision recorded (a calibration.json residual, an ADR's numbered residual);
   every note the calibration expects OPEN-RED has its rows here, each filed as it; and every note a row is filed as is
   an open note of the calibration, but the live-only notes that test lists, each with its reason, and the notes
   calibrated on the replay whose live entries await a live record at their fix (listed there too, each with its
   reason, and held to have no static row).

## Consequences

- A fix is checked against the whole lab corpus at once, without a device; a device round confirms, it does not
  discover.
- The truth is only as wide as the cells: a situation no cell builds is judged by nothing here. New rows come with the
  cells that need them — except phase 3's row types (scripts/differential/golden-spec/rows.ts), which B1 (the plan's
  phase 3) declared ahead of their cells so that the cell families can be built in parallel. A row type asks nothing
  until a capture carries the geometry or kind it judges.
- Recapture after an Xcode, OS or app change is one script run (scripts/truth/capture.ts, capture-android.ts); a cell
  that breaks on recapture is fixed in the lab app, not in the spec.

## Residuals accepted

- The golden mode replays a static tree: what changes the screen (typing, a dismissal, a stroke's effect) is the live
  golden's (scripts/truth/live.ts), which needs the lab device and is not a vitest test. Its KNOWN
  (scripts/truth/live-known.ts) is keyed by case, with its verdict class and its reply's kind (round 5: the committed
  records showed no known case whose kind moves — LV2's flush cases, the only ones with several records, read
  `visible` in all six runs, ok or not) — but not its strokes, a device's timing moves how many are sent — and an entry
  marked `intermittent` may come out ok without failing the run; a known case not intermittent that comes out ok fails
  it, as §4 asks. Its notes are held as the static rows' are (§4). What a run read is recorded (docs/truth/live-records/) and
  judged again in vitest without a device (tests/truth/live-rejudge.test.ts, through `live.ts --rejudge`).
- OCR is judged on the real pixels — the host's own recognizer on the captured screenshot (phase 4) — but only where
  the host has one: inside a sandbox (or off macOS) the `ocr` rows are skipped and counted, never red;
  `GOLDEN_OCR=require` makes a skip an error. The covering layer is not named per target.

## Bug note

None: a principle. Findings it produced are in docs/bugs/2026-10-15-lab-*.md.
