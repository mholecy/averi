# Handoff: on-device check of round 10 (`arch/round-10` @ `1dc6ccc`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 10 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. Round 10 = branch `arch/round-10` = round 9 (`arch/round-9` @ `3492318`) +
**Spec B, "standing"**: one verdict on where a target stands, shared by `tap`, `scroll_until` and the pixel asserts. It
is mostly a refactor (six slices, each proven behaviour-neutral by a differential harness), with these deliberate
behaviour changes, each an owner decision recorded as an ADR under `docs/adr/`:

| id | change | ADR |
|---|---|---|
| D1 | cut before cover for every verb: `scroll_until`'s stuck/bound text on a covered sliver names the cut edge | 0005 |
| D2 | iOS idb: the keyboard band is a keyboard line for `tap`, `scroll_until` and the pixel asserts; a target whose centre lies under it is **refused** (no move to a piece above it) | 0006, 0007 |
| D3 | `scroll_until`'s exposure box is cut below the status band | 0008 |
| D7 | Android **navigation bar** (the bottom system band) is read and judged: tap and stops refuse a point in it; a pixel assert overlapping it fails closed; an OCR text flush with it fails closed | 0009 |
| P1 | a `fully: true` stop judges both system bands as a REGION (the element must clear them, not only its centre); pinned surfaces (full-bleed header/footer, screen-sized node, in no scroll view) are exempt and stop as before | 0009, 0001 |

**Order:** round 9's check (handoff `docs/handoff/2026-10-12-device-check-round-9.md`) was never run. Run its sections 3
and 4 first **at this round's hash** (`1dc6ccc`), recording results in round 9's table with this hash; then section 3
and 4 below.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. Build

1. `git checkout arch/round-10` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as in rounds 3–9: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)` at the
end of the bug note named in its item (items without a bug note go into the results table; anything that fails goes into
a new bug note); commit only notes, and only if the owner asks; leave `docs/architecture-reviews/` alone.

## 2. Regression

1. Round 9's sections 3 and 4 (see Order).
2. Smoke on each source (Android, iOS idb, iOS WDA): one `tap`, one `scroll_until`, one `assert_color` — same replies as
   at round 9 apart from the changes in this handoff.

## 3. Round 10 checklist

### D7 — Android navigation bar (`docs/bugs/2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md`)
1. mp-native Account Detail at the top: `tap id:"transactions.list.row_4"` (its centre near (540,2186), inside the bar)
   → **refused** "… under the navigation bar … scroll_until it first"; then `scroll_until` it; then the tap lands on it.
2. **3-button navigation** (if the device can switch: `cmd overlay enable com.android.internal.systemui.navbar.threebutton`
   — ask the owner first, it changes device settings): record the bar's frame height from `ui_snapshot`/dumpsys and
   confirm no averi tap ever lands on Back/Home/Recents.
3. Gesture navigation: record whether a raw tap at y ~2186 reaches the app (for the record only).
4. Settings, a title flush with the bar top at 2154 (e.g. "Sound & vibration"): `assert_text`/OCR → **fails closed**
   naming the navigation bar ("… may be cut at the navigation bar — scroll it up …"); `assert_color` on it still measures;
   `scroll_until … fully: true` → 1 short stroke, then OCR passes.
5. mp-native Account Detail rows lying in 2154–2220: a pixel assert → **fails closed** "the navigation bar is drawn over
   the element …".
6. Google Contacts, Create contact, "Add fields" flush at 2154: record the OCR reply (expected: fails closed as in 4).
7. A non-edge-to-edge app whose pinned bottom bar ends at 2154: a pixel assert on that bar **still measures**.
8. An immersive app (navigation bar hidden): no band — taps near the bottom behave as before.

### P1 — `fully: true` clears both bars
1. mp-native Account Detail `row_30` (`66,2088 948x99`, its bottom under the bar): `scroll_until … fully: true` →
   strokes until the row clears the bar, then a pixel assert on it passes (it used to stop at once and the assert then
   failed closed, advising the same scroll in a loop).
2. A plain `scroll_until` (no `fully`) on the same row → stops as before (centre rule).
3. A pinned full-width surface: a full-bleed top app bar (Android 15+ edge-to-edge) or an iOS hero image at the top,
   and an Android bottom sheet reaching the screen's bottom → `scroll_until … fully: true` **stops at once, no strokes**
   (no stroke over a modal sheet). A pixel assert on it fails closed with "assert something in it clear of the bar
   (its title / its content above the bar, say)".

### D2 — iOS idb keyboard band (ADR 0006, 0007)
1. SWIFT form, number pad up: the strip 589–596 under CONTINUE; a row whose centre lies under the band but with a large
   part above it → `tap` **refused** "… is under the soft keyboard … hide the keyboard first" (owner decision: refuse,
   no move to the visible part).
2. A text field + its placeholder lying under the band (fill into the next field) → refused, never tapped on the keys.
3. A real key (`Q`, space, return on QWERTY; a digit on the number pad) → still sent.
4. A lone QuickType suggestion inside the band (e.g. "Passwords"), if one shows → now **refused** (residual: a key alone
   on its row reads as content). Record the reply.
5. idb Contacts: a `scroll_until` stroke starts above the band (from about y 699 or higher, never on the keys).
6. A pixel assert on an element under the idb keyboard → "the soft keyboard covers the element …" (never "covered by
   key …").
7. WDA login keyboard band and the Android floating Gboard panel: unchanged replies (regression).

### D1 / slices — scroll_until and tap
1. SWIFT form `priority_select` under CONTINUE (idb and WDA): `scroll_until` and `tap` give the same verdicts as in
   round 9 (moved tap or refusal; record).
2. Android SWIFT sliver toggle `66,1924 948x55` and its leaf label: `tap` → refused as cut; a stuck `scroll_until` on a
   covered sliver now names the edge ("cut at its scroll container's bottom edge …") instead of the cover.
3. iOS status bar (201,6) and Google Contacts app bar (256,3): taps refused as before.
4. A status-band fling to `24,-20`: same reply as round 9.

### Record (no expected reply — capture for the owner)
- **F1** (`fill` "screen changed while typing", idb SWIFT form, no keyboard): run
  `fill value:"Jan Novak" "Petr Svoboda" clear` and record the reply; during it, poll `ui_snapshot` (or
  `idb ui describe-all`) before, while and after typing and attach the paths — the suspected cause is the field's clear
  button appearing/disappearing. Not fixed in this round.

## 4. Out of scope: do not report these as regressions
- iOS `scroll_until` never reading a bouncing list end as exhausted, and the B1 "if it lies above" hint
  (`docs/bugs/2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md`) — deferred by the owner.
- `back_to_tab_host` failing on iOS payment screens: the screens use id `BackButton`; fix belongs to mp-native or its
  `averi.yaml`, not averi.
- Navigation band: portrait only; no band on a natural-landscape tablet, a turned display (r≠0) or a dump listing a
  second display of another size (ADR 0009 residuals).
- idb: two app nodes side by side (not overlapping) behind the keyboard read as keys; a key alone on its row reads as
  content (ADR 0007).
- `fully: true` on screen-sized scroll content taller than the room between the bars stops as before (exempt).
- Everything in section 5 of the round-9 handoff.

## 5. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round 9 §3–4 at this hash | Android / iOS | | | |
| smoke (§2.2) | Android / idb / WDA | | | |
| D7.1 row_4 refused → scroll → tap | Android | | | |
| D7.2 3-button nav | Android | | | |
| D7.3 gesture tap at 2186 | Android | | | |
| D7.4 Settings flush OCR / colour / fully | Android | | | |
| D7.5 Account Detail rows in the bar | Android | | | |
| D7.6 Contacts "Add fields" | Android | | | |
| D7.7 pinned bottom bar still measured | Android | | | |
| D7.8 immersive app | Android | | | |
| P1.1 row_30 fully then pixel passes | Android | | | |
| P1.2 plain stop unchanged | Android | | | |
| P1.3 pinned surfaces stop at once | Android / iOS | | | |
| D2.1–D2.6 idb keyboard band | iOS idb | | | |
| D2.7 WDA / Gboard unchanged | iOS WDA / Android | | | |
| D1 / slices 1–4 | iOS idb / WDA / Android | | | |
| F1 capture | iOS idb | | | |


## Device check (2026-10-13)

Round 10's checklist was run at `20307d2` together with round 12, as its Order section asks. Results: `docs/handoff/2026-10-13-device-check-round-12.md` section 6 (one table per platform, rows by round and item) and the `## Device check (2026-10-13 …, re-run at 20307d2)` sections at the end of each bug note named in the items.
