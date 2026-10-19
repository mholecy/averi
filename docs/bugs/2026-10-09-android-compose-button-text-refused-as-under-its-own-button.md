# BUG: on Android a Compose button's own text reads as "under" the button — `tap text:"LOGIN"` is refused, `scroll_until` calls it a layout defect, and an `optional:` tap skips silently

**Measured 2026-10-09 15:35–16:01 UTC**, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked), averi = mobile-verify
`arch/round-5` @ `dd50327` (`dist/` built 17:33 local, stdio via the HTTP daemon on port 47831, cwd mp-native). Strokes and taps from
the `adb` shim. Apps: mp-native (`com.finshape.skeleton.dev`) inactivity "Logged out" screen, Welcome, the SWIFT form's exit dialog,
Account Detail; Google Contacts (`com.google.android.contacts`) sync promo and "Create contact". Found by the round-5 device check
(items C3-4, C3-5, the re-login before round-4 item 1.1). **A regression of round 5 (C3):** the same calls at `86eb42d` (12:50 UTC)
and `347e70d` (11:22 UTC) returned `Tapped text:"LOGIN"` / `Tapped text:"SIGN IN"` (run6/run5 session logs).

## Observed (measured)

A Compose `Button` reaches uiautomator as a wrapper holding its label text and, AFTER it, an unlabelled clickable `button` of
(almost) the wrapper's rect. mp-native "Logged out":

```
container 44,1397 992x132
  text 'LOGIN' 481,1438 118x49
  button (no label) 44,1402 992x121
```

The same shape: Welcome `SIGN IN` (`text 469,1844 143x49` + `button 44,1808 992x121`) and `RESET`; SWIFT exit dialog `KEEP EDITING` /
`DISCARD` (inside `swift_payment.form.discard_button 638,1187 276x132`: `text 688,1228 176x49` + `button 638,1192 276x121`); Account
Detail `PAY ME` / `PAY` / `SCAN QR`; Google Contacts' own "No thanks", "Sync device and SIM contacts", "Dismiss", "Go back", "All
contacts" — a Google Compose app, so this is Compose's shape, not mp-native's.

1. `tap` by the text — refused, nothing sent (shim empty):
   ```
   15:35:5x tap { platform: android, selector: 'text:"LOGIN"' }
   → text:"LOGIN" is under button (44,1402 992x121) at its centre (540,1463), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
   15:36:12 tap { selector: 'text:"SIGN IN"' }
   → text:"SIGN IN" is under button (44,1808 992x121) at its centre (541,1869), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
   15:51:36 tap { selector: 'text:"DISCARD"' }
   → text:"DISCARD" is under button (638,1192 276x121) at its centre (776,1253), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
   15:54:33 (Google Contacts) tap { selector: 'text:"No thanks"' }
   → text:"No thanks" is under button (44,1967 992x110) at its centre (541,2023), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
   ```
   The same `tap` by the wrapper's id works: `tap id:swift_payment.form.discard_button` → `Tapped …`, `input tap 776 1253`. A tap at
   the text's centre presses the button — the "cover" IS the control the caller means.
2. `scroll_until` on the text — the S1 sentence, wrong on a screen that does not scroll:
   ```
   15:36:23 scroll_until { selector: 'text:"SIGN IN"' }
   → scroll_until text:"SIGN IN" failed after 2 swipes — element is in the viewport but under button (44,1808 992x121) at its centre (541,1869), drawn over it — 0% of it shows — and the content is exhausted: swiping down no longer moves it. The app draws that over it at the end of the content — a layout defect (no clearance for a pinned bar?), not a scroll that needs more swipes. Last rect {"x":469,"y":1844,"width":143,"height":49} in a 1080x2220 viewport
   ```
   (two strokes `540 1776 540 444 1334` spent). Google Contacts "Create contact", IME up, 15:57:41
   `scroll_until { selector: 'text~"[Ff]ields"', fully: true }` → `failed after 3 swipes — element is in the viewport but under button
   (132,944 312x110) … a layout defect …` (3 strokes); at `86eb42d` the same call returned `fully visible after 0 swipes`.
3. **An `optional:` tap skips it silently and the flow goes on.** Scratch config (only `app.android.package` + one flow), Account
   Detail, 16:00:52:
   ```
   flow optional_text_tap: start
   optional: skipped text:"PAY" (text:"PAY" is under button (381,655 319x121) at its centre (541,716), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped)
   ✗ wait id:"accounts.detail.payment_type_sheet.row_swift": failed — Timed out after 5000ms …
   ```
4. A row's own nested decoration reads as a cover of the row's label node (the same rule, a wrapper one level down). Account Detail,
   a row's subtree is `container row_N` → `other 'Loan repayment, 17.12.2025, +493.00 EUR' 66,y 948x143`, `container 116,… 88x88` →
   `text 'LR'` (the avatar), the amount texts, `button` (same rect as the `other`). With `label:"Loan repayment, 17.12.2025, +493.00 EUR"`:
   - plain `scroll_until` (15:43:16) → `visible after 1 swipe — PARTLY UNDER text "LR" (136,999 48x49), drawn over it — 98% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too`;
   - `fully: true` (15:43:39), the row wholly on screen at `66,951 948x143`, far from any bar → never stops: `failed after 15000ms
     (timeout) — element was in the viewport after swipe 2 but did not stay … It was turned round 3 times …`, shim `540 1804 540 752
     1054`, `540 752 540 1278 527`, `540 1553 540 1337 300`, `540 765 540 902 300` — four strokes spent moving a fully visible row
     away and back.

## Why (read from the source at dd50327)

- `src/ui-tree/draw-order.ts:671–678` `exposure`: a cover is any node after the target's subtree whose rect meets the target and that no
  `NOT_DRAWN` row excuses for the `target` question (`drawsOverTarget`). Used by `tap`'s focus/guard (`src/interact/resolve.ts:583/588`)
  and `scroll_until`'s stop (`src/interact/scroll-rounds.ts:855`).
- None of the rows excuses the Compose button node:
  - `onTarget` (l. 497–505) requires `!isInteractive(node)` — the clickable `button` is interactive — and `width < target width`;
  - `sameFrame` (l. 538) needs an identical rect — `44,1402 992x121` vs the text `481,1438 118x49`;
  - `structural` (l. 292–296) covers only `container`/`other`.
  In case 4, `onTarget` requires `parent === target.parent`: the avatar `LR` has the avatar wrapper for its parent, so it is a cover
  though it lies wholly inside the row.
- The rule as written has no notion of "the target's own control": a node that HOLDS the target, in the target's parent, and is the
  clickable the tap would reach anyway.

## Why it matters

- **A registration can be spent.** `averi.yaml`'s `login_registered` (mp-native l. 547–553) is the non-destructive rung for the Android
  inactivity logout: `optional: android: tap: { text: "LOGIN" }` then `optional: tap: { text: "SIGN IN" }`. Both are now refused, the
  `optional`s skip (measured shape, item 3), `wait: pin_login` fails, and the ladder proceeds to `login`, the rung that registers the
  device — the 2026-09-11 incident's exact path, which REV 6 had closed. Not run (it would burn a registration); inferred from items 1
  and 3. The same holds for every `tap: { text: "SKIP" }` / `"MAYBE LATER"` / `"CONTINUE"` / `"REGISTER"` / `"LOG IN"` /
  `"CLOSE"` on Android in that file, where the button is a Compose `Button`.
- `tap text:"…"` is the documented preferred selector for a button (`tap`'s description: `'text:"Continue"'`), and on Compose it now
  fails on every button. The advice — "scroll_until it first" — and the S1 "layout defect" sentence send the author the wrong way.
- `fully: true` on a list row's label node never stops (item 4) and spends strokes.

## Possible fix directions (owner's choice)

- Excuse, for the `target` question, an INTERACTIVE node that holds the target's rect whole and shares the target's parent (or is the
  target's parent's only interactive child): the target's own control. A tap at the target's centre lands on it — which is the intent.
- Or excuse a node whose nearest wrapper also holds the target (the button's container `44,1397 992x132` holds both) when that wrapper
  is the target's parent — "covers drawn inside the target's own parent, holding it" are the target's own surface.
- For item 4: judge `onTarget` against the target's subtree's ancestors up to the row, or excuse descendants of a target sibling that
  lie wholly inside the target.
- At minimum, a flow `optional:` should not swallow a cover refusal silently on a step the author marked as a hop (the log line is there,
  but the flow goes on).

## Repro

1. Android, any Compose screen with a `Button` (mp-native Welcome, or Google Contacts' sync promo).
2. `tap { platform: android, selector: 'text:"SIGN IN"' }` → `… is under button (…) … nothing was tapped`; the adb shim shows no `input
   tap`. At `86eb42d`: `Tapped text:"SIGN IN"`.
3. `scroll_until { selector: 'text:"SIGN IN"' }` → `failed after 2 swipes — … a layout defect …`.

## Re-confirmed (2026-10-09 16:26 UTC, same server, `dd50327`)

After the round-5 run, mp-native showed the inactivity "Logged out" screen again. `tap { platform: android, selector: 'text:"LOGIN"' }`
(16:26:53) → `text:"LOGIN" is under button (44,1402 992x121) at its centre (540,1463), drawn over it; nothing of it shows — scroll_until
it first; nothing was tapped` (4.4 s), verbatim as at 15:35. `tap { selector: "role:button" }` (the clickable itself, the only button on
that screen) → `Tapped role:button`, and Welcome opened. The re-login therefore needed the button node and a raw `input tap 540 1868` for SIGN IN
instead of the text selectors that `login_registered` uses.

## Device check (2026-10-09 Android, re-run at 2f98900)

Measured 2026-10-09 18:09–18:33 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47841, cwd mp-native). Strokes and taps from the
`adb` shim; placement and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's `averi.yaml` untouched.

**B (text buttons) — Holds. O — Holds. Compose ICON buttons — Fail (not covered by B's rule).**

Every Compose text button, tapped by its text, at the text's centre (wrapper → clickable, from `ui_snapshot`):

| button | screen | wrapper | clickable | reply | shim |
|---|---|---|---|---|---|
| LOGIN | mp-native "Logged out" | `44,1397 992x132` | `44,1402 992x121` | `Tapped text:"LOGIN"` (18:10:05), Welcome opened | `input tap 540 1463` |
| SIGN IN | Welcome | `44,1803 992x132` (`login.welcome.login_button`) | `44,1808 992x121` | `Tapped text:"SIGN IN"` (18:10:22), PIN keypad | `input tap 541 1869` |
| RESET | Welcome (not tapped) | `44,1979 992x132` | `44,1988 992x113` | — | — |
| KEEP EDITING | SWIFT exit dialog | `255,1187 361x132` | `255,1192 361x121` | `Tapped text:"KEEP EDITING"` (18:14:15), dialog closed, form kept | `input tap 436 1253` |
| DISCARD | SWIFT exit dialog | `638,1187 276x132` | `638,1192 276x121` | `Tapped text:"DISCARD"` (18:17:46), Account Detail | `input tap 776 1253` |
| PAY ME | Account Detail | `103,650 242x132` | `103,659 242x113` | `Tapped text:"PAY ME"` (18:11:30) — the app does nothing on it (screenshot unchanged) | `input tap 224 716` |
| PAY | Account Detail | `381,650 319x132` | `381,655 319x121` | `Tapped text:"PAY"` (18:12:52), `payment_type_sheet` opened, closed by back | `input tap 541 716` |
| SCAN QR | Account Detail | `736,650 242x132` | `736,659 242x113` | `Tapped text:"SCAN QR"` (18:13:09) — no action in the app | `input tap 857 716` |
| All contacts | Google Contacts list | `44,264 423x132` | `44,264 423x132` | `Tapped text:"All contacts"` (18:22:35), account sheet opened | `input tap 256 331` |
| Device & Google | Contacts "Choose where to save" | row `22,1805 1036x161` (no sibling clickable) | — | `Tapped text:"Device & Google"` (18:23:09) | `input tap 337 1861` |
| Add phone | "Create contact" | `105,1703 261x132` | `105,1714 261x110` | `Tapped text:"Add phone"` (18:23:28), a 2nd phone field | `input tap 236 1770` |
| Save (nothing entered) | "Create contact" | `719,88 218x132` | `719,99 218x110` | `Tapped text:"Save"` (18:24:58), editor closed, no contact created (list still Abdulla, Sherzod) | `input tap 828 155` |
| Add email / Add birthday (not tapped) | "Create contact" | `132,1879 816x132` / `132,2055 816x132` | `132,1879 816x132` / `132,2055 816x99` | — | — |
| Add fields | "Create contact", IME up | `132,1229 312x132` | `132,1240 312x110` | see B-1.5 | — |

- **B-1.5 `fields`:** 18:23:42 `scroll_until { selector: 'text~"[Ff]ields"', fully: true }` → `Element text~"[Ff]ields" fully visible after
  1 swipe` (7.7 s), `input swipe 540 1167 540 473 695` (above the IME). At dd50327: `failed after 3 swipes … a layout defect`. **Holds.**
- **B-1.5 sync promo — Not reached:** after the wipes (L-1) Contacts showed the notification-permission dialog and then the list; the
  "No thanks" / "Sync device and SIM contacts" promo did not appear.
- **B-1.6:** 18:10:18 `scroll_until { selector: 'text:"SIGN IN"' }` → `Element text:"SIGN IN" fully visible after 0 swipes` (2.0 s), the
  same with `fully: true`; no stroke in the shim. **Holds.**
- **B-1.7 — FAIL: Compose ICON buttons are still refused.** An `IconButton` reaches uiautomator as a 132-px wrapper holding the
  icon (an `other` carrying the content description) and, after it, an unlabelled clickable inset on ALL sides (the 48-dp touch
  target, 110 px) — so `ownControl`'s "the parent's x and width exactly" (`src/ui-tree/draw-order.ts:641–653`) does not match, and
  the icon's own button covers it:
  ```
  18:27:5x tap { selector: 'label:"Cancel"' }   ("Create contact": wrapper container 11,88 132x132 → other 'Cancel' 44,121 66x66, button 22,99 110x110)
  → label:"Cancel" is under button (22,99 110x110) at its centre (77,154), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
  18:28:04 tap { selector: 'text:"Cancel"' }  → the same refusal
  18:28:28 tap { selector: 'label:"Show list filters"' }   (contacts list: wrapper 904,264 132x132 → other 937,297 66x66, checkbox 915,275 110x110)
  → label:"Show list filters" is under checkbox (915,275 110x110) at its centre (970,330), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
  ```
  The same shape, not tapped: `More options` (wrapper `937,88 132x132`, `button 948,99 110x110`), the phone row's `Delete` (`948,301` /
  `959,312 110x110`), `View labels` (`772,264` / `button 783,275 110x110`). No shim tap for any refusal. A tap at the icon's centre
  lands on its button — the caller's intent, as for the text buttons. The round-5 Observed list ("Dismiss", "Go back") likely named
  icon buttons of this shape; the round-6 rule, written from text buttons' measurements ("only the width was measured; … a tall narrow
  one is not excused"), leaves them out. mp-native's own icon (`other 'Filter transactions' 922,884 55x55` in `container 884,846 132x132`)
  has no sibling clickable, so mp-native is not affected on the screens measured. Suggested: also excuse a control inset equally on
  all four sides within its wrapper (centred), holding the label whole — or the wrapper's centre lying inside the control.
- **O-1 — Holds.** Scratch `cfg-opt-contacts`, 18:29:22 `run_flow o1_absent` → `optional: skipped text:"NO SUCH BUTTON" (not present)` /
  `wait: element text:"All contacts"` / `flow o1_absent: done`.
- **O-2 — Holds (the ✗ line, not "state reached anyway").** 18:29:27 `run_flow o2_refused` (optional `tap { label: "Show list filters" }`,
  then a `wait`) → `optional step not skipped: its element is present, but the tap was refused — label:"Show list filters" is under
  checkbox (915,275 110x110) …; nothing was tapped` with the trace `✗ tap label:"Show list filters": failed — optional step not skipped: …`;
  the `wait` did not run. mp-native (scratch `cfg-opt-bank`), row label staged at `66,1785 948x143` under the host, 18:30:21 →
  `optional step not skipped: its element is present, but the tap was refused — label:"Loan repayment, 25.06.2026, +162.00 EUR" is under
  container (66,1840 948x248) at its centre (540,1857), drawn over it; only a 948x55 part of it shows …`, next step not run.
- **O-2 ladder — Holds.** Scratch state `o_never` (detect never true), `reach: [rung_refused, rung_harmless]`; 18:29:41
  `ensure_state o_never` → fails at rung 1 with the same `optional step not skipped …` text; "Steps that ran" list only `flow rung_refused`
  — `rung_harmless` never ran. mp-native's `login_registered` / `login` were not used.
- **Round-5 item 3 shape — fixed.** 18:30:39 `run_flow optional_text_tap` (`cfg-optional`: optional `tap text:"PAY"`, then `wait
  row_swift`) → `tap: text:"PAY"` / `wait: element id:"accounts.detail.payment_type_sheet.row_swift"` / `done`, `input tap 541 609`.
- **Item 4 — Holds (row content no longer covers):** see the pinned-chrome note (C3-4.2/4.3).
- **R-2 — Holds.** Re-login after B-1.2, 18:10:37 `run_flow login_pin_android_here` (34.9 s): `flow login_pin_android_here: start` /
  `wait: element text:"Log in with PIN"` / (PIN) / `optional: skipped text:"SKIP" (not present)` / `optional: skipped step (not present)` /
  `wait: state post_pin_gate` / `branch: matched state logged_in` / `wait: element id:"nav.tab_transactions"` / `done` / `appAlive: true`.

## Device check (2026-10-09 Android, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:19 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/`, stdio via the HTTP daemon on port 47851, cwd mp-native). Strokes and taps from the
`adb` shim (`run9-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only
(`cfg-opt-bank`, `cfg-opt-contacts`, `cfg-optional`, new `cfg-fill`, `cfg-fill-bank`); mp-native's `averi.yaml` untouched.

**I (icon buttons) — Holds. B-1 (text buttons) — still Holds. O — Holds. F — Holds as written, with one residual (new note).**

**I-1 — every Compose icon button tapped by its label, at the label's centre** (wrapper / label / control from `ui_snapshot`, insets
of the control in the wrapper L,T,R,B):

| icon | screen | wrapper | label | control | insets | reply | shim |
|---|---|---|---|---|---|---|---|
| More options | Contacts "Create contact" | `937,88 132x132` | `other 970,121 66x66` | `button 948,99 110x110` | 11,11,11,11 | `Tapped label:"More options"` (21:01:26), menu "Help & feedback" opened, closed by back | `input tap 1003 154` |
| Delete (phone row) | "Create contact" | `948,1566 132x132` | `other 981,1599 66x66` | `button 959,1577 110x110` | 11,11,11,11 | `Tapped label:"Delete"` (21:01:44), the phone field removed | `input tap 1014 1632` |
| Cancel | "Create contact" (a phone typed) | `11,88 132x132` | `other 44,121 66x66` | `button 22,99 110x110` | 11,11,11,11 | `Tapped label:"Cancel"` (21:07:03), "Your changes have not been saved" → `Tapped text:"Discard"` (`576 1171`) | `input tap 77 154` |
| Show list filters | Contacts list | `904,264 132x132` | `other 937,297 66x66` | `checkbox 915,275 110x110` | 11,11,11,11 | `Tapped label:"Show list filters"` (21:00:21), filter row opened; again (`label~"list filters"`) closed it | `input tap 970 330` |
| View labels | Contacts list | `772,264 132x132` | `other 805,297 66x66` | `button 783,275 110x110` | 11,11,11,11 | `Tapped label:"View labels"` (21:00:47), labels sheet opened, closed by back | `input tap 838 330` |
| Navigate up (≈ "Go back") | Contacts photo picker | — (View `button 'Navigate up' 0,66 154x154`) | | | | `Tapped label:"Navigate up"` (21:02:23), back to the editor | `input tap 77 143` |
| Add contact photo (`role:other`) | "Create contact" | `375,352 330x330` | `other 474,451 132x132` | `button 375,352 330x330` | 0,0,0,0 | `Tapped role:other label:"Add contact photo"` (21:02:08), photo picker | `input tap 540 517` |

- Every padded icon measured has its four insets equal (11 px, exact — the rule's 1-px tolerance not needed here). The control's centre
  equals the label's centre in each.
- mp-native's own SWIFT form Back is the same shape (`common.top_bar.back` wrapper `11,88 132x132`, `other 'Back' 39,116 77x77`,
  `button 22,99 110x110`) — tapped through `back_to_tab_host` at `77 154` (R-3.1, the pinned-chrome note).
- `label:"Add contact photo"` alone → `Selector matches 2 elements … Narrow it` (the photo's `other` and the caption `text`) — correct.
- **I-1.4 — Not reached:** no icon cut unevenly by a list edge was staged. **Dismiss**: did not appear (no sync promo, no snackbar).
- **The former O-2 element is now tapped (expected by §3):** 21:07:57 `run_flow o2_refused` (`cfg-opt-contacts`, optional `tap { label:
  "Show list filters" }`) → `tap: label:"Show list filters"` / `wait: element text:"All contacts"` / `done`, `input tap 970 330`.

**B-1 re-run (text buttons) — Holds**, centres byte-identical to round 6: `LOGIN` `540 1463` (20:42:32, 21:13:49), `SIGN IN` `541 1869`,
`PAY ME` `224 716`, `SCAN QR` `857 716`, `PAY` `541 716` (and `541 292` with the list scrolled), `KEEP EDITING` `436 1253` (20:58:18),
`DISCARD` `776 1253` (20:58:32, 21:17:12), `Add phone` (`585 1594` — the editor had scrolled), `Save` with nothing entered `828 155`
(21:07:41, editor closed, list still Abdulla, Sherzod), `permission_deny_button` `540 1358`. B-1.5 `fields` → `fully visible after 1 swipe`
(`540 1167 540 473 695`), B-1.6 `SIGN IN` → `fully visible after 0 swipes` twice, no stroke. The sync promo did not appear (Not reached).

**O-1 — Holds.** 21:07:52 `run_flow o1_absent` → `optional: skipped text:"NO SUCH BUTTON" (not present)` / `wait: element text:"All
contacts"` / `done`.

**O-2 — Holds, on the mp-native row (as §3 asks).** `Loan repayment, 25.06.2026, +162.00 EUR` staged at `66,1793 948x143` (row_3
`66,1793 948x47`) under the host `66,1840 948x248`. 20:48:26 `run_flow o2_row_under_bar` (`cfg-opt-bank`) → `✗ tap label:"Loan repayment,
25.06.2026, +162.00 EUR": failed — optional step not skipped: its element is present, but the tap was refused — … is under container
(66,1840 948x248) at its centre (540,1865), drawn over it; only a 948x47 part of it shows, under the 65x65 a tap may be moved to —
scroll_until it first; nothing was tapped`; the `wait` did not run. **Ladder:** scratch state `o_never`, `reach: [rung_refused,
rung_harmless]`; 20:48:35 `ensure_state o_never` → the same ✗ in `flow rung_refused`; `rung_harmless` never ran. No shim tap.

**F-1 — Holds as specified** (scratch `cfg-fill` on Contacts "Create contact", `cfg-fill-bank` on the SWIFT form):
- **F-1.2:** 21:03:53 `optional: fill { text: "First name", value: "a\tb" }` → `optional step not skipped: averi refused its value before
  anything was typed — cannot type U+0009 ("\t", a control character): it is a key, not text — …`, `✗ fill text:"First name": failed — …`,
  0.1 s, nothing in the shim, the `wait` did not run.
- **F-1.3:** 21:03:53 `optional: fill { text: "NO SUCH FIELD" }` → `optional: skipped step (not present)`, flow done.
- **F-1.4:** 21:04:01 `optional: type { value: "x\ty" }` → `optional: skipped step (cannot type U+0009 …)`, flow done.
- **F-1.1 — Not reached as worded; two shapes tried, neither fails the flow:**
  - Contacts phone field `{ role: textfield, text: "+1" }` + `5551234567` (21:03:19) → `⚠ fill: text:"+1" role:"textfield" = 5551234567 —
    NOT verified: the field could not be found again (the selector no longer matches it)`, flow done; the field shows `+1 555-123-4567`
    (the text landed, reformatted). Correct by the documented `text:`-selector rule (troubleshooting.md).
  - mp-native SWIFT `amount_input` (an id) + `abc` (21:15:14): the field drops letters and stays EMPTY, yet → `⚠ fill:
    id:"swift_payment.form.amount_input" = abc — NOT verified: the matched node exposes no value (role textfield)`, flow done. The value did
    NOT land, but averi cannot tell an empty Compose field from one that withholds its text, so F's "did not land" never fires. **New note:
    `2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md`.**
  - A landing control: `bic_input` + 26 lowercase letters → `fill: id:"swift_payment.form.bic_input" = abcdefghijklmnopqrstuvwxyz` (verified).
- **R-3.2 (mp-native's PIN re-login under round 6b's flow engine) — Holds, twice.** 20:43:04 and 21:14:0x `run_flow login_pin_android_here`
  (42.3 s / 42.0 s): `wait: element text:"Log in with PIN"` / `type_pin: 4 digits` / `optional: skipped text:"SKIP" (not present)` /
  `optional: skipped step (not present)` / `wait: state post_pin_gate` / `branch: matched state logged_in` / `wait: element
  id:"nav.tab_transactions"` / `done` / `appAlive: true`. (Started from the "Logged out" screen without LOGIN → SIGN IN it fails at once with
  `✗ wait text:"Log in with PIN"` — the flow's own entry condition, as designed.)
- **Wording, minor:** an absent optional `fill` / platform-wrapped `android: { tap: … }` prints `optional: skipped step (not present)` without
  its selector, while a bare optional `tap` prints `skipped text:"SKIP" (not present)`. A reader of the login trace cannot tell which hop
  was skipped. Not filed.

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**F-1 on iOS idb — Holds (2, 3, 4); 1 not reachable on iOS.** Scratch `cfg-optfill-ios` (Contacts New Contact open):
- F-1.2: `optional: [ fill: { id: "Company", value: "a\nb" } ]` → `✗ fill id:"Company": failed — optional step not skipped: averi refused
  its value before anything was typed — cannot type U+000A ("\n", a control character): it is a key, not text — …`; no shim call at all
  (not even the focus tap); the `wait` did not run.
- F-1.3: `optional: fill { id: "NoSuchField" }` → `optional: skipped step (not present)` / `wait: element id:"Last name"` / `done`.
- F-1.4: `optional: [ type: { value: "c\u0007d" } ]` → `optional: skipped step (cannot type U+0007 ("\u0007", a control character): …)`
  / the wait / `done`. Nit: the U+0007 text still explains "a newline into ENTER".
- F-1.1: no iOS field that drops typed text was found: `optional: fill { text: "Value*", value: "abc" }` on the SWIFT amount → `⚠ fill:
  … the matched node is role text, not a textfield …` / `⚠ fill: text:"Value*" = abc — NOT verified …` / `done` — the amount accepted
  `abc` (`v='abc'`, dropped on blur), and a label-matched fill is unverifiable, not "did not land". Covered by the Android half.

## Device check (2026-10-10 Android, re-run at 35d5997)

Measured 2026-10-10 06:16–06:47 UTC, emulator-5554 (Pixel_3a AVD, Android 13, 1080x2220, Gboard docked unless stated), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47861, cwd mp-native). Strokes and taps from the
`adb` shim (`run10-android/adb-input.log`); stagings and Gboard mode by hand with the real `adb`. Scratch configs only; mp-native's
`averi.yaml` untouched.

**I (icon buttons), B (text buttons), O, F — Hold.**

- Icon buttons at the label's centre (Contacts): `label:"View labels"` → `input tap 838 330`; `label:"Show list filters"` → `input tap 970
  330` (chips toggled); Create contact `label:"More options"` → `input tap 1003 154` (menu); `label:"Delete"` (phone row) → `input tap 1014
  1632` (row removed); `label:"Cancel"` → `input tap 77 154` (discard dialog). mp-native's back icon `id:common.top_bar.back` → `input tap 77
  154` on the SWIFT form, `110 85` on a transaction's detail.
- Text buttons: LOGIN `540 1463`, SIGN IN `541 1869`, KEEP EDITING `436 1253`, DISCARD `776 1253`, PAY `541 716`, Contacts `Discard` `576
  1171`, the date picker's `Cancel` `744 1804` — round 6b's coordinates where repeated.
- **Residual seen (stated):** with Contacts' app bar collapsed, `View labels` (`other 805,0 66x11` over `button 783,0 110x33`, cut unevenly)
  → `label:"View labels" is under button (783,0 110x33) at its centre (838,6), drawn over it; nothing of it shows — scroll_until it first;
  nothing was tapped` — refused, as stated; but "nothing of it shows" is untrue of an element under its OWN control, and the whole bar lies
  under the status bar there (see the new Android status-bar note).
- O-1 `o1_absent` → `optional: skipped text:"NO SUCH BUTTON" (not present)` / `wait` / `done`. O-2 on mp-native's row under the tab-bar host
  (`cfg-opt-bank`) and its ladder → refused, flow failed, `rung_harmless` never ran (pinned-chrome note).
- F (round 6b) regression, `cfg-fill` on Create contact: `f2_ctrl` → `optional step not skipped: averi refused its value before anything was
  typed — cannot type U+0009 …`; `f3_absent` → `optional: skipped step (not present)`, flow done; `f4_type` → `optional: skipped step
  (cannot type U+0009 …)`, flow done.


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

Round 9 §3.3 (padded icon buttons 132/110/66) — **Holds.** Contacts list: #43 `tap label:"View labels"` → `Tapped`, `17:17:05 input tap 838 330`
(labels sheet, closed by Back); #46 / #49 `label:"Show list filters"` → `Tapped`, `input tap 970 330` ×2 (filter chips opened, then closed —
`img-48-0.png`). Create contact: #85 / #174 / #205 `label:"Cancel"` → `Tapped`, `input tap 77 154` (editor closed; with a typed name the
"Your changes have not been saved" dialog → #207 `text:"Discard"` → `input tap 576 1171`). `label:"More options"` on Create contact now
matches two nodes (the "Picture & calling card" card has its own — a new Contacts layout since round 6b) → `Selector matches 2 elements …
Narrow it` (#57/#58), correct. Text buttons: `LOGIN` `input tap 540 1463`, `SIGN IN` (by id) `540 1869`, `TRY AGAIN`, `Maybe later` (a web
view button, `198 2054`) tapped.
