# Handoff: on-device check of round 11 (`arch/round-11` @ `896b275`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 11 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 11 = `arch/round-10` (`1dc6ccc`) + **Spec C**, the architecture review's C1/C6/C7 (scroll_until's per-read
judgement in its own module, `fully` as a purpose of the standing, one "no device screen") and C2 (the in-tree keyboard
dismissal picker asks the tap's standing). C1/C6/C7 are refactors proven byte-identical by a differential harness. C2 is a
deliberate behaviour change, owner-approved (ADR 0016).

**Order:** rounds 9 and 10 were never device-checked. Run round 9's §3–4 and round 10's §2–3 first **at this round's
hash**, then section 3 below.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. Build

1. `git checkout arch/round-11` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge; results as `## Device check (<date>, re-run at <hash>)` at the end of the bug
note named in the item (items without a note go in the results table; failures go into a new bug note); commit only
notes, and only if the owner asks; leave `docs/architecture-reviews/` alone.

## 2. What changed

| id | change | where it shows |
|---|---|---|
| C1/C6/C7 | refactor only (scroll_until's read judgement, `fully` purpose, far-edge frames, no-screen fallback) | nothing: every `scroll_until`, `tap` and pixel-assert reply must be as at round 10 |
| C2 | WDA keyboard dismissal picker (`dismissals: [tap …]`) judges a candidate as `tap` would, and **refuses** a candidate whose centre an interactive node listed after it holds | which configured dismissal title is picked and the skip reasons in the reply |

## 3. Round 11 checklist

### Smoke (C1/C6/C7, must be unchanged)
1. Android mp-native Account Detail `row_30`: `scroll_until … fully: true` → strokes until the row clears the navigation
   bar, then stops; plain `scroll_until` on it stops as before.
2. iOS idb SWIFT form `priority_select` under CONTINUE: `scroll_until` and `tap` give round 10's replies.
3. iOS WDA: a row under the keyboard band — `scroll_until` asks the witness and replies as round 10.
4. One `assert_color` per platform; one tap refused off screen.

### C2 — dismissal picker (iOS WDA, ADR 0016)
1. WDA login with `dismissals: [tap id:login_title]`: picked, keyboard hidden.
2. The SWIFT form title with and without the toolbar host: picked as at round 10.
3. Contacts "New Contact" title as a dismissal: picked.
4. A dismissal title over content scrolled under the top bar: picked.
5. A text label configured as a dismissal next to its own field or button (e.g. "Payee's name"): **refused**
   "covered by textfield/button …" — the dismissal tap never presses a control.
6. If a screen shows a title whose rect a labelled button shares: **refused** naming the button.
7. The login/2FA field wrappers (if configured as dismissals): now skipped "covered by container …".

## 4. Out of scope
- Everything in section 4 of round 10's handoff and section 5 of round 9's.
- C2's picker on idb or Android: unreachable (idb's reading is unknown; Android dismisses with Back).

## 5. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| round 9 §3–4 at this hash | Android / iOS | | | |
| round 10 §2–3 at this hash | Android / idb / WDA | | | |
| smoke 1–4 | Android / idb / WDA | | | |
| C2.1–C2.4 picked | iOS WDA | | | |
| C2.5–C2.7 refused/skipped | iOS WDA | | | |


## Device check (2026-10-13)

Round 11's checklist was run at `20307d2` together with round 12, as its Order section asks. Results: `docs/handoff/2026-10-13-device-check-round-12.md` section 6 (one table per platform, rows by round and item) and the `## Device check (2026-10-13 …, re-run at 20307d2)` sections at the end of each bug note named in the items.
