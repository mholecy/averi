# BUG: on Android `scroll_until … fully: true` reports a list row "fully visible" while a sticky header hides part of it — the row's testTag node is cut at the header, not at the scroll container, so no flush probe fires

> **Status (2026-10-09):** open. Found by the round-6b device check (Android), averi `fix/round-6b` @ `5e5a3d1`. Sibling of
> [2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md](2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md)
> (cut flush with the container — fixed by a probe); here the cut edge is a sticky header's bottom inside the container.

## Summary

mp-native's Account Detail list (Compose LazyColumn with sticky date headers). Scrolled so `transactions.list.row_0` slides under the
pinned `transactions.list.date_header_0` (`0,401 1080x79`), uiautomator reports the row's testTag container CUT at the header's bottom:
`row_0 66,480 948x84` (later `66,480 948x66`) — while the row's own semantics children (`other 'Loan repayment, 17.07.2026, +602.00 EUR'`
and its `button`) report the true rect `66,403 948x143`. `scroll_until { selector: "id:transactions.list.row_0", fully: true }` judges the cut
rect: it lies wholly in the container (`0,401 1080x1753`), not flush with its edge (480 ≠ 401), and nothing is drawn over it — so it answers
`Element id:transactions.list.row_0 fully visible after 0 swipes` with 77 of the row's 143 px hidden under the header (screenshot
`run9-android/img-41-0.png`: the row's rounded top edge is missing under "17.07.2026"). The same call with the row's LABEL selector sees
the true rect under the header and turns: `fully visible after 1 swipe`, `input swipe 540 765 540 982 300`, row after `66,592 948x143`.

A rect assert or a screenshot crop taken after the "fully visible" stop measures 66 px of a 143-px row.

## Repro

1. mp-native Account Detail, scroll the list so the first row's top is under its sticky date header (here: `input swipe 540 1500 540
   1460 2500` from a slightly scrolled list).
2. `ui_snapshot`: `container id=transactions.list.row_0 66,480 948x84`, children `other '…' 66,403 948x143`, `button 66,403 948x143`;
   `date_header_0 0,401 1080x79` listed after the rows.
3. `scroll_until { platform: android, selector: "id:transactions.list.row_0", fully: true }` → `fully visible after 0 swipes`, no stroke
   (20:49:29, 20:50:35, 20:59:06 UTC).
4. `scroll_until { …, selector: 'label:"Loan repayment, 17.07.2026, +602.00 EUR"', fully: true }` → `fully visible after 1 swipe`.

## Evidence

- Session `run9-android/session.log` #38–#45, #93–#96; shim `20:59:12 input swipe 540 765 540 982 300` (label case only).
- A second drag (40 px) left the container's top at 480 and its height 66 — the cut follows the header's bottom, not the content.

## Where

- `src/interact/scroll-rounds.ts:586` (PROBE_REACH) and `:614` (`flushEdges`): only a rect flush with a CLIPPING container's edge is suspected
  of being cut; a rect cut by an overlay sibling is the residual stated there ("Compose also subtracts what an overlay sibling covers … not
  flush with any scroller, so it is not probed").
- `src/adapters/android.ts:1034` (`parseBounds`) takes each node's bounds as given; the row's children carry the uncut rect.

## Suggestion

When a target node's descendants (its own label/button, same x and width) extend past its rect, judge the union (or the largest
descendant) as the element's true extent — the label already is: the row then reads as under `date_header_0`, which is drawn after it,
and the existing cover/turn logic stops it correctly. At least say it: "its children reach past its bounds (66,403 948x143) — it may be cut
by something drawn over it".

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**A1 — Holds (all four parts).** mp-native Account Detail, list container `0,401 1080x1819` (header collapsed), `row_1` staged by slow
drags under the sticky `date_header_1 0,401 1080x79`:

- **A1.1:** `ui_snapshot` → `row_1 66,440 948x143` with `cutBounds` `66,480 948x103` (its label node `other 'Loan repayment, 15.07.2026,
  +573.00 EUR' 66,440 948x143`).
- **A1.2:** 06:19:40 `scroll_until { selector: 'id:"transactions.list.row_1"', fully: true }` → `fully visible after 1 swipe` (7.6 s),
  `input swipe 540 765 540 1311 547` (content down), row ends `66,1052 948x143`. Never "after 0 swipes". The plain call from a 38-px cut
  (06:21:24) → the same 1 stroke.
- **A1.3, thin strip:** `row_1 66,401 948x117 cutBounds=66,480 948x38` → `tap id:row_1` and `tap label:"Loan repayment, 15.07.2026, +573.00
  EUR"` → `… is under container id:transactions.list.date_header_1 (0,401 1080x79) at its centre (540,460), drawn over it; only a 948x38 part
  of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped`, no shim tap.
- **A1.3, ≥ 65 px:** `row_1 66,404 948x143 cutBounds=66,480 948x67` → `Tapped id:"transactions.list.row_1" at (540,514) — its centre
  (540,476) is under container id:transactions.list.date_header_1 (0,401 1080x79), drawn over it; tapped the uncovered part 948x67`, `input
  tap 540 514`, the transaction's detail opened. With the centre already clear (`66,440 … cutBounds 948x103`) → plain `Tapped`, `input tap
  540 512`.
- **A1.4:** Contacts' icon buttons tapped at their centres (see the Compose-button note); Account Detail rows under the floating tab bar as
  in round 6b (pinned-chrome note).
- **Also seen:** the widening restores a row the floating tab bar's host cuts too — `row_3 66,1784 948x143 cutBounds=66,1784 948x56` (cut at
  the host's top, 1840) and `row_4 66,2044 948x143 cutBounds=66,2088 948x99` (cut at its TOP by the host's bottom, 2088). Both judged
  correctly (refused / tapped on the right transaction, `+208.00 EUR 14.06.2026`).

## Device check (2026-10-12 Android, re-run at 0ff6df3)

Measured 2026-10-12 09:49–10:25 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation, Gboard docked), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP daemon on port 47871, cwd mp-native). Strokes and taps from the
`adb` shim (`run11-android/adb-input.log`); stagings by hand with the real `adb` (slow `input swipe` drags). The Mac had rebooted since
round 7: the emulator was cold-booted and mp-native showed the registered Welcome (SIGN IN / RESET). Scratch configs only
(`run11-android/cfg-d3.yaml`); mp-native's `averi.yaml` untouched.

A1 (round-7 checklist re-run) holds on mp-native Account Detail.
- Staged `row_0` under the sticky `date_header_0 0,401 1080x79`: `ui_snapshot` → `transactions.list.row_0 66,434 948x143` with
  `cutBounds 66,480 948x97`.
- `scroll_until { id:"transactions.list.row_0", fully: true }` → `Element id:"transactions.list.row_0" fully visible after 1 swipe`
  (shim `input swipe 540 765 540 1311 547`, content down); after it `row_0 66,1050 948x143`, header `0,952`.
- 14-px strip (`row_0 66,401 948x93 cutBounds 66,480 948x14`): `tap` → `id:"transactions.list.row_0" is under container
  id:transactions.list.date_header_0 (0,401 1080x79) at its centre (540,448), drawn over it; only a 948x14 part of it shows, under the
  65x65 a tap may be moved to — scroll_until it first; nothing was tapped`. No shim line.
- 73-px strip (`row_0 66,410 948x143 cutBounds 66,480 948x73`): `tap` → `Tapped id:"transactions.list.row_0"`, shim `input tap 540
  482` — the row's own centre (481.5), 2 px below the header's bottom edge, so no move was needed and none was reported; the transaction
  detail opened (`transactions.detail.amount +602.00 EUR`). Landed, but 2 px from the cover's edge (observation, not a failure).


## Device check (2026-10-13 Android, re-run at 20307d2)

Measured 2026-10-13 17:10–17:58 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, gesture navigation — `settings get secure
navigation_mode` = 2, `ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true`; Gboard docked unless stated), averi = mobile-verify
`arch/round-12` @ `20307d2` (detached; `dist/` built 17:07 UTC after the commit; stdio via the HTTP daemon on port 47881, cwd mp-native).
Strokes, taps and keys from the `adb` shim (`run12-android/adb-input.log`, times UTC); stagings by hand with the real `adb` (slow `input
swipe` drags, not in the shim log). Every call is in `run12-android/session.log` (`#N` below = call number there; images `img-N-0.png`).
At start mp-native showed the inactivity "Logged out" screen: LOGIN → Welcome → SIGN IN → `run_flow login_pin_android_here` (approved rung,
no `requires:`), done at 17:11. Scratch configs only; mp-native's `averi.yaml` untouched. Round 9's §3–4, round 10's §2–3, round 11's §3
and round 12's §3 were all run at this one hash. **Environment break at 17:33 UTC:** mp-native's backend began answering every GraphQL read
with `{"data":null,"errors":[{"message":"Received empty response body from subgraph \"gds-business\"","extensions":{"code":
"SUBGRAPH_RESPONSE_BODY_EMPTY"}}]}` (HTTP 200, `get_logs` #161, #180) — "Mandatory data not loaded / TRY AGAIN" on every tab, also after a
fresh PIN login (#223, 17:43). Not averi, not the VPN (no 403). The mp-native items not run before 17:33 (SWIFT form: A2, D1.2, smoke 1's
SWIFT field, D7.3) are Not reached on mp-native; on the owner's instruction (17:51) they were re-run on Google Contacts and on Finportal
(`sk.finportal.myport`, Expo dev build on Metro; its `~/dev/finportal/app/averi.yaml` passed as `configPath`; never logged in, nothing
submitted) where an equivalent shape exists — see `## Re-runs on Contacts / Finportal` below. The data also changed since round 8:
Account Detail now lists `row_0`…`row_36` (37 rows, was 31), so the handoffs' `row_29/30` / `row_30` shapes were measured on the rows that
now sit there (`row_35/36`).

Round 9 §3.1 — **Holds.** Back from the transaction detail (#15), Account Detail sat in the run9 shape: `date_header_0 0,401 1080x79`,
`transactions.list.row_0 66,425 948x143` with `cutBounds 66,480 948x88`. #17 `tap id:transactions.list.row_0` → `Tapped`, shim `17:12:51 input
tap 540 497` — the row's centre (496.5), 17 px below the header's bottom edge 480, so no move; the detail opened. #21 `scroll_until … fully:
true` → `fully visible after 1 swipe` (7.6 s), `17:13:11 input swipe 540 765 540 1311 547` — byte-identical to round 8's stroke; after it
`row_0 66,1041 948x143`, header `0,943`.
