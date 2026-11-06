# 44. A live case declares what it reads; one module runs it

Status: accepted 2026-11-06 (performance backlog row A11, docs/plans/2026-10-30-performance-backlog.md). Harness only.
Device calls, records, printed lines and the exit code are byte-identical to the loop it replaces.

## Context

- The live device loop sat at the top of the CLI (`live.ts`), and no test ran it. D30, D67, D69 and T7a each added a phase
  to it.
- It inferred phases from three `c.group` branches: `logsSwipes`, the reads between calls, and the late read.
- The late-read rule was split between the loop (whether) and `judged` in `live-cases.ts` (how), and the record was built in
  two places, a skip's and a run's.
- T7b adds cases that reach their first screen by a verb the harness does not perform, so a fourth inferred phase was
  coming.

## Decision

**`runCase(case, source, rig)` in `scripts/truth/run-case.ts` runs one case on one source and answers its record and verdict.
What a case reads is `Case.reads`, never its group.**

- `Case.reads` is `{ betweenCalls?: true; swipes?: true; late?: false }`. Unset is the forms' cycle. A group's cases share
  one constant, set where `selectCases` builds them; tests/truth/live-reads.test.ts pins every selectable case of each
  group to what the loop inferred.
- `c.group` selects a case and names it. No read of it remains in the cycle, so a new read is a new field and one line in
  `runCase`.
- `Case.start` takes the place of `lab.launch(cell)` for a case that reaches its first screen otherwise, T7b's. It answers
  the state the calls start from. Nothing uses it yet; a test pins it.
- The late-read rule's one home is `live-cases.ts`: `wantsLateRead` (whether), `judged` (how), `LATE_READ_MS`.
- **`judged` judges a recorded `late` whatever the case declares today.** A record is what was read then. If `judged` also
  asked `reads.late`, a declaration changed later would turn over the verdicts of old records. The committed records hold
  no late read on a visibility or carousel case, so this is the safe reading rather than a live difference.
- `caseRecord` in run-case.ts is the one record builder. A skip and a run differ only in what they hand it.
- The rig is the interface: `lab`, `callTool`, `configFor`, `swipes`, and optionally `keepShot`, `note`, `pause`, `now`.
  The CLI keeps argv, selection, the loops over cases and sources, connect and close, printing, `--record`.
- `note` carries the two lines that must reach the run while the case is still going (a warm-up or a panel read that
  failed); a case can take a minute. The case's outcome line is the CLI's, from the returned verdict: a SKIP's line and a
  run's have the same format, so the CLI prints one.
- `CaseLab` tells the Android lab from the iOS one by `platform`, not by optional methods. A pre-drag and a panel read are
  the Android lab's, and tests/helpers/fake-lab.ts has both shapes.

## Considered

- **A list of phase functions on the case.** Each phase needs the state of the earlier ones (launched, replies, a
  pre-drag's stroke), so the shared context would be the loop's locals under another name. Refused: flags over one cycle
  read in order have more depth for what exists.
- **Printing through the rig for every line.** The outcome line needs nothing the returned run does not hold.
- **The config file written once, before the warm-up.** `configFor` stays called at the same two points, so nothing a
  server reads moves.

## Consequences

- The cycle has a test (tests/truth/run-case.test.ts): order, each read, each SKIP, the screenshot, no real sleep.
- A first verdict that asks for a late read now gets the case's stroke log, as `judged`'s does. The old loop asked without
  it. No case both logs strokes and takes a late read, so nothing changes today.
- run-case.ts joins the mutation run (ADR 0038): every device call sits behind the rig, its tests take milliseconds, and
  its branches are what this ADR protects. T2's runner.ts is the precedent for an orchestrator over a fake seam.
- iOS is unmeasured live here. The cycle has no iOS-only branch beyond a SKIP's words, and a fake of each shape runs it.
