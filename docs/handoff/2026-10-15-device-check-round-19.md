# Handoff: on-device check of round 19 (`arch/round-19` @ `c9ae31c`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 19 is still being reviewed and fixed:
> do not check out, build or test anything. When it reads `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the
> title and the expected replies below are final: start. Any other STATUS value: stop and ask the owner.

Round 19 = `arch/round-18` (`dda435b`) + the fixes from the device check of round 18 (results in round 18's handoff
§5, new notes of 2026-10-15) and the owner's decisions of 2026-10-15:

- **A SwiftUI/UIKit alert covers the whole screen beneath it (iOS WDA).** WDA's `Alert` element is marked by the
  adapter (`"presentation": "alert"` in `ui_snapshot`); anything beneath it is refused/fails closed/stopped with
  `… an alert is presented over it ("<title>") — close it first …`. Only an alert with area on the screen counts
  (a 0x0 or off-screen leftover does not); the keyboard is never beneath it; the alert's own buttons stay tappable.
  `scroll_until` stops before any swipe, also for a selector that is not in the tree (`stopped before any swipe —
  element is not in the tree, and the next swipe would touch down at (x,y) on container "<title>" (… , reaching
  0,0 402x874) — an alert is presented over it ("<title>") — close it first, and a swipe would land on the alert, so
  none was sent`); `optional: true` fails there (not skipped).
- **A cover whose reach differs from its rect is named with `, reaching <rect>`** in tap and scroll_until sentences
  (as the pixel assert already did) — wording only; e.g. idb's pinned "Continue to summary" and the floating tab bar.
- **Android: numeric character references decode** (`&#10;` → newline, `&#9;` → tab, emoji code points), in text,
  content-desc, resource-id and hint; `&amp;#10;` stays a literal `&#10;`.
- **ocr assert forgives what the recognizer cannot see:** `’ ‘ ʼ ′ ‛`↔`'`, `“ ” „ ″`↔`"`, `– — ‒ −`↔`-`, `…`↔`...`,
  Latin diacritics, NFC/NFD. Exact first; equal only under the fold → PASS with `(differs only in ’ vs ' — …)`.
  `match:` too (a pattern with typographic characters is folded safely; an ASCII pattern is also tried on the folded
  reading). Case is never folded; tree asserts (`exists`/`text`, selectors) stay exact, but the not-found hint names a
  node that differs only by such characters.
- **`scroll_until` says when a sheet moved to another detent during the call** (`; the sheet moved from its Half screen
  detent to Expanded`), read from the Sheet Grabber's value; verdicts unchanged.

A tool-level differential over 648 trees (every device tree of rounds 11–18 incl. the run18 raw payloads) against
`dda435b`: the alert tree (518 calls: form targets refused/fail closed/stopped, alert buttons still Tapped), 1,072
reach-clause wording diffs on 170 iOS trees, 60 calls on the 2 raw Android trees holding `&#` (a `&#10;`↔newline swap);
everything else 0; no refused → Tapped, no FAIL → PASS.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.
- The owner logs mp-native in and confirms the backend is up before the run (Android sat on its inactivity "Logged
  out" screen at the end of round 18); do not type credentials yourself.
- Save the raw payload next to every `ui_snapshot` you take, as in rounds 16–18: WDA
  `curl -s 'http://127.0.0.1:<port>/source?format=json'`, idb `idb ui describe-all --json --udid <udid>`, Android
  `adb -s <serial> exec-out uiautomator dump /dev/tty`. Same name as the snapshot. Do not commit them (bank data).
- Do not submit, continue, confirm or certify any payment form. Leave a changed form via Back → Discard.
- Selectors: `role:text label:"…"` where plain `text:` matches a container and its text.

## 1. Build

1. `git checkout arch/round-19` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If not, stop and ask.
3. `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as before: do not push or merge. Put results as `## Device check (<date>, re-run at <hash>)` at the end of the
bug note named in the item; items without a note go in the results table, and failures go into a new bug note. Commit
only notes, and only if the owner asks. Leave `docs/architecture-reviews/` alone.

## 2. Checklist

### A. Alert over the SWIFT form (iOS WDA, `treeSource: wda`)
Bug note `2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done`.

1. SWIFT form, change one harmless field (as round 18: Payee's country), `tap id:BackButton` → "Exit confirmation".
   `ui_snapshot`: the Alert node carries `"presentation": "alert"`. Save the raw WDA payload.
2. `tap id:swift_payment.form.message_for_bank_input` → refused `… under container "Exit confirmation" (41,365
   320x172, reaching 0,0 402x874) … an alert is presented over it ("Exit confirmation") — close it first; nothing was
   tapped`; **no** tap in the shim/idb log; the alert stays up. Same for `id:BackButton` and `id:Toolbar` (if listed).
3. colour assert on that field (expect `#CACACA`, the dimmed grey) → **FAIL** closed naming the alert (before: PASS
   possible). ocr on it → fail closed.
4. `scroll_until id:…message_for_bank_input` → `stopped before any swipe … close it first … so none was sent`; no swipe
   in the log. `scroll_until text:"zzq no such row"` → the absent-target stop (wording above), no swipe. Same with
   `optional: true` → still a failure.
5. `tap role:button label:"Keep editing"` → `Tapped`, alert closes. Repeat Back → `tap role:button label:"Discard"` →
   `Tapped`, form left. Nothing submitted.
6. (Optional) any other app's system alert (e.g. a permission prompt the owner allows to appear, or Settings' "Reset"
   confirmation **cancelled**, never confirmed) → the same refusal beneath it, its buttons Tapped. Record.

### B. Android `&#10;` (Android emulator)
Bug note `2026-10-15-android-numeric-character-references-in-uiautomator-attributes-are-not-decoded`.

1. Google Contacts, Organize tab (as round 18 #23). `ui_snapshot`: the account button's label holds a real newline
   (shown as `\n` in JSON), **no** `&#10;`.
2. `assert` exists with the label written with `\n` → PASS; with `&#10;` → FAIL (not found). Record both.
3. mp-native Welcome/"Logged out" screen if it is up (round 17's welcome1 text with a newline): `tap` it by its text
   with `\n` → `Tapped` (or the usual refusal if covered), never "not found". Do not log in.
4. Emoji labels (mp-native country flags, only if reachable without logging in or changing data): label shows the
   flag emoji, not `&#127482;…`.

### C. OCR apostrophe (iOS, either source)
Bug note `2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-as-straight`.

1. SWIFT form, `payee_name_input` fully drawn: `assert ocr text: "Payee’s name"` (U+2019) → **PASS** with
   `(differs only in ’ vs ' — …)`; with `"Payee's name"` → PASS (exact or with the note). `match: "Payee’s"` and
   `match: "Payee's"` → both PASS. `"Payee’s game"` → FAIL. `"payee’s name"` → FAIL (case).
2. A label with diacritics if one is on screen (any app; e.g. Settings in a Slovak/Czech locale is NOT to be switched —
   only if already present) → PASS with a diacritics note, or record "not reachable".
3. `assert exists text:"Payee's name"` (ASCII) → FAIL, and the hint names the node `Payee’s name` as differing only in
   `’ vs '`.

### D. Sheet detent note (iOS WDA)
1. SWIFT form, open the country sheet at its half detent (as round 18 #56). `scroll_until id:…payee_country_sheet.row_7
   fully: true` → expected `… fully visible after N swipes; the sheet moved from its Half screen detent to Expanded`
   (if the sheet expands as in round 18). Record the reply and the grabber's value before/after. Close the sheet
   without selecting (Back/close), or select the already-chosen country only.
2. A `scroll_until` that does not move the sheet's detent → no such note.

### E. Smoke (unchanged behaviour)
1. iOS Settings: tap a row → `Tapped`; `scroll_until` a row below the fold → swipes and stops; colour/ocr on a fully
   visible row → measured as before.
2. iOS idb (mp-native Transactions, as round 18 B.2): one tap, one colour assert; a cover pinned at the bottom (e.g.
   `row_44` under the tab bar) — the refusal now names the cover with `, reaching …` where its reach differs; record.
3. Android Settings: tap a row, `scroll_until` below the fold, colour on a visible row → as round 18 B.1.
4. Country sheet row past the list's bottom (round 18 A.2) → still `outside its scroll view scrollable (…)` — `scroll_until
   it first`.

## 3. Out of scope
- Round 18 §3; residuals of ADR 0018 not changed by the alert amendment (a sheet's bare dim stays excused; only an
  alert is marked).
- With the keyboard up beneath an alert, the keyboard's refusal comes first (recorded in ADR 0018).
- Strokes over the screen's middle rather than the target's scroll view; ocr on glyphs cut at a scroll view's edge
  (ADR 0010).
- Detent note for stacked sheets where one closes and another opens during one call (documented limit).

## 4. Results table

| item | platform / device | commit | result | evidence |
|---|---|---|---|---|
| A.1–A.5 alert over the SWIFT form | iOS WDA | | | |
| A.6 other alert (optional) | iOS WDA | | | |
| B.1–B.4 Android numeric character references | Android | | | |
| C.1–C.3 OCR apostrophe / diacritics / tree hint | iOS | | | |
| D.1–D.2 sheet detent note | iOS WDA | | | |
| E.1 Settings smoke | iOS WDA | | | |
| E.2 idb smoke + reach wording | iOS idb | | | |
| E.3 Android smoke | Android | | | |
| E.4 country row past the list's bottom | iOS WDA | | | |
| raw payloads saved (list) | iOS + Android | | | |
