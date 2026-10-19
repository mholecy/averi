# BUG: on Android `scroll_until … fully: true` on form-keyboard's phone, once `back` has hidden the IME, never stops — its 132-px touch target overlaps the "Variable symbol" title below it by 6 px, a cover the tree lists, though the field it draws is whole

> **Status (2026-10-19):** open, a residual. Found by round 7's A6 (arch/r23-eyes) while driving k7's `fully: true`
> by hand; not the eyes' (no screenshot is taken: the stop is refused by the tree before any claim). No golden row asks
> it (the replay's verbs ask no `fully: true` of form-keyboard's phone), no live.ts case either: calibration.json lists
> it excluded until a case does.

Found **2026-10-19** on averi_lab (emulator-5554, API 33), the lab app as installed for round 7, averi =
arch/r23-eyes (from arch/round-23 `bd43fc66`), driven directly over MCP — the record is
docs/truth/live-records/android-k7-fully-eyes-direct.jsonl (two calls, one line each: the reply, the screenshots taken,
the wall time).

## Observed (measured)

form-keyboard, phone focused, the IME up and the submit bar riding on it (k7's launch).

1. `scroll_until id:"lab.form-keyboard.phone" fully: true` with the IME up: one screenshot, three strokes, and
   `failed after 3 swipes — element is in the viewport but its bottom 28 px show #F2F2F7, the colour beside container
   id:lab.form-keyboard.submit (55,1238 970x132) drawn after it … — and the content is exhausted … if the soft keyboard
   is still up (… y 1398 …), dismiss it first (press_key back …) … and scroll again` (13.8 s). Right: the eyes' band,
   the remedy named.
2. After `press_key back` (the IME and the bar gone), the same call: five swipes, turned round twice, and
   `failed after 17290ms (timeout 15000ms; 5 swipes sent; 6 tree reads took 11628ms, the last 1927ms) — element reached
   the viewport but stayed under text "Variable symbol" (55,1239 258x56), drawn over it — 99% of it shows (last rect
   {"x":55,"y":1113,"width":970,"height":132})`.

The dump's phone is its EditText's touch target, 132 px tall (`1113–1245` at the stop; `[55,1280][1025,1412]` in
tests/fixtures/truth/android-averi_lab-api33/form-keyboard.after-back.xml), while the field the app draws is 99 px
(the lab model's frame, `55,1129 970x99` at k7's stop). The next field's title, `lab.form-keyboard.vs.title`
("Variable symbol", `55,1239 258x56`; `[55,1406][313,1462]` in the capture), is listed after phone and overlaps that
target's bottom by 6 px: a cover the tree lists, so `fully: true` is never met wherever the form is scrolled — the
title moves with it — and the scroll spends its timeout turning.

## Why it matters

A `fully: true` on a Compose text field whose dumped bounds reach past what it draws into the next node listed after
it (here the next field's title) is refused for a cover that covers nothing it draws: the caller gets a timeout and a
"stayed under" for a field it can see whole. Loud (no false claim), but a wrong refusal, and 17 s spent.

## Not fixed here

What would close it: judge a text input's cover against the field it draws rather than its dumped bounds (the
dump has no fact for the drawn part: the 99 px here are the lab model's), or excuse a later title overlapping it by
less than the slack. Either is a src decision for ADR 0013/0014's refinement, not this note's.
