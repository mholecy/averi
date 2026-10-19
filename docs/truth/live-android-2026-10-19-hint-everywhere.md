# The active-window hint on every not-found, run live (round 7, task A3)

ADR 0018 decision 5, refined in round 7: every reply that says a target is not in a uiautomator tree (which lists the
active window only) carries `(the tree lists only the active window: if a sheet or a dialog is open over the screen,
close it first)` once — now the asserts' `not found within …`, a flow's `wait:` on an element and an optional step's
`(not present)` too, beside the tap/fill wait and `scroll_until`'s `element never appeared in the tree` that carried it
since round 6. Belongs beside the 2026-10-18 Android visibility summary (truth branch), whose round-6 section ran the
first half of it.

Run on 2026-10-19 on averi_lab (emulator-5554, booted `-no-snapshot-save -no-window`), src arch/r23-hint-everywhere
9fa59ae through `--side`; the lab app as installed on the AVD at 2026-10-19 00:51 (by the round-7 task before this
one; form-picker's cell is unchanged since round 6).

## form-picker c2–c4 (the live harness)

    node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups forms --cases c2,c3,c4 --side <this checkout> --record <file>

Record docs/truth/live-records/android-hint-everywhere-9fa59ae-c2c4.json: 3 cases, 3 ok, 0 loud, 0 mismatches — the tap
on name, country, submit beneath the fully expanded picker sheet: nothing fired, each reply the wait with the hint
beneath it once, as in round 6 (unchanged by this task).

## Asserts, a flow's wait: and an optional tap under the same sheet (ad hoc)

The live harness has no assert-under-sheet case (to add on truth/round-7: below). A scratch driver built the MCP server
exactly as live.ts does (`loadSide(<this checkout>)`, the lab emulator alone in discovery, `AndroidLab.launch` of
`form-picker` before every call) and asked it seven calls; record
docs/truth/live-records/android-hint-everywhere-9fa59ae-asserts.json (per call: the launch state, the reply, the state
after). No call made the app log an event or take the focus. Replies, verbatim:

- `assert` `{element: {id: lab.form-picker.name}}`: `FAIL element id:"lab.form-picker.name" exists — not found within 3 s (the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first)`
- the same with `text: "Name"`: `… with text "Name" exists — not found within 3 s (the tree lists only the active window: …)`
- the same with `color: {expected: "#FFFFFF"}`: `… fill within dE00 8 of #FFFFFF — not found within 5 s (the tree lists only the active window: …)`
- `absent: true`: `PASS … is absent` (no not-found, no hint — the sheet hides it, as the hint's possibility says)
- a row on the sheet, `country.AL` with text `Albania`: `PASS` (found: no hint)
- `run_flow` of `wait: {element: {id: lab.form-picker.name}, timeout: 3s}`: `Timed out after 3000ms waiting for element id:"lab.form-picker.name"` / `  (the tree lists only the active window: …)` beneath it
- `run_flow` of `optional: [tap: {id: lab.form-picker.name}]` then a wait on `country.AL`: `optional: skipped id:"lab.form-picker.name" (not present) (the tree lists only the active window: …)`, the flow done

Each reply says the hint exactly once.

## Harness case to add (truth/round-7)

A forms case beside c2–c4, say c5–c7: with form-picker's sheet open at launch, `assert` on name (exists), on name with
text, and on name's colour. Judge: the assert FAILS (a PASS is a MISMATCH: the field is beneath the sheet), nothing
fired, and the detail says "close it first" once — the presented remedy or the active-window hint (live-forms.ts
#judgeUnderSheet's two matchers, applied to the assert's detail). A flow `wait:` and an optional tap need a run_flow
call with a flow in the case's averi.yaml; the harness's config writer (live.ts#configFor) writes none today.

# Round 2: one module for every not-found (after review round 1)

The decision moved into ui-tree/miss.ts (`missOf` of the last read: unread, zero-area, a window listed alone, the
active-window hint, none; `missNote` its words), so beneath a window the tree lists alone the asserts and a `wait:`
say the presented remedy the tap says, and an optional `wait:`'s skip carries the note. Run again on 2026-10-19 on
averi_lab (same boot flags, same installed lab app), src e726c77 through `--side`:

- form-picker c2–c4 (live harness): 3 ok, replies unchanged — record
  docs/truth/live-records/android-hint-everywhere-e726c77-c2c4.json.
- The scratch driver, twelve calls, nothing fired on any (no event, no focus) — record
  docs/truth/live-records/android-hint-everywhere-e726c77-asserts.json. Form-picker as in round 1, verbatim, plus an
  optional `wait:` on name: `optional: skipped step (Timed out after 3000ms waiting for element
  id:"lab.form-picker.name" (the tree lists only the active window: if a sheet or a dialog is open over the screen,
  close it first))`. On alert-dim (the dialog listed alone), target A:
  - element assert: `not found within 3 s (the tree lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first)`;
  - color assert: the same after `not found within 5 s`;
  - `wait:` on A: `Timed out after 3000ms waiting for element id:"lab.alert-dim.A"` with that parenthesis beneath;
  - the tap, unchanged: `Timed out after 5000ms: element id:"lab.alert-dim.A" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — a dialog is presented over it — close it first`.
  Each says "close it first" once; no reply on alert-dim carries the generic hint.

**Reworded since (round 2 review, MINOR-B), after these records:** the note on a window listed alone is now one phrase
with no parenthesis inside — `(a dialog is presented over it, and the tree lists only that window — close it first)`,
a sheet `(a sheet or modal is presented over it, and the tree lists only that window — close it first)` — in place of
the `(the tree lists only the window presented on top (the tree source lists the active window alone) — a dialog is
presented over it — close it first)` the alert-dim replies above (and the e726c77 record) quote. The tap's headline,
the form-picker replies and the active-window hint are unchanged; the records predate the rewording and were not
re-run (golden carries the new words: alert-dim and sheet-medium A–D colour).

# 2026-10-19: c5–c7, the harness cases (round 7's code review, truth/r7-cr)

The harness case proposed above, in scripts/truth/live.ts beside c2–c4 (Android only): with form-picker's sheet open
at launch and fully expanded, c5 an element assert on name, c6 a colour assert on it (`#FFFFFF`), c7 `run_flow` of a
flow whose one step is `wait:` on it (the case's own averi.yaml `flows`, which live.ts#configFor now writes). The
judge, scripts/truth/live-forms.ts#judgeMissUnderSheet: the call must FAIL (a pass, or a flow done, is a MISMATCH —
name lies beneath the sheet), the app log nothing (no event, no focus), and the not-found say the sheet's remedy —
the presented remedy or the active-window hint — exactly once; none, or "close it first" twice, is LOUD
(tests/truth/live-forms.test.ts).

    node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups forms --cases c2,c3,c4,c5,c6,c7 --record <file>

Run on averi_lab (emulator-5554, booted `-no-snapshot-save -no-window`), this checkout's src (truth/r7-cr, harness
5c738b36), the lab app as installed on the AVD; record docs/truth/live-records/android-hint-c5c7-r7cr.json: **6 cases,
6 ok, 0 loud, 0 mismatches** — c2–c4 as before; c5 `FAIL  element id:"lab.form-picker.name" exists — not found within
3 s (the tree lists only the active window: …)`, c6 the same after `fill within dE00 8 of #FFFFFF — not found within
5 s`, c7 `ERROR Timed out after 3000ms waiting for element id:"lab.form-picker.name"` with the hint beneath it once.
Nothing fired in any. Pinned in tests/truth/live-rejudge.test.ts.
