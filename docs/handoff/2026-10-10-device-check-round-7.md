# Handoff: on-device check of round 7 (`fix/round-7` @ `35d5997`)

STATUS: READY FOR ON-DEVICE VERIFICATION

> The line above is the gate. While it reads `STATUS: WAITING FOR REVIEW`, round 7 is still being reviewed and fixed
> after its code review: do not check out, build or test anything. When it reads
> `STATUS: READY FOR ON-DEVICE VERIFICATION`, the hash in the title and the expected replies below are final: start.
> Any other STATUS value: stop and ask the owner.

For the agent that runs the device check. Round 7 = branch `fix/round-7` = `fix/round-6b` @ `5e5a3d1` (round 6b, checked on
device) + the fixes for the 8 bug notes and the residuals round 6b's device check found. The checklist and the expected
replies are re-checked against the final code before the STATUS flips.

## 0. Before anything else

- The earlier rounds' results are uncommitted edits in `docs/bugs/`. Do not stash, reset or discard them.
- **Never** run `launch_app … clearState: true` on mp-native or any app whose data matters, never run anything that
  registers the device, and do not run adb server commands.

## 1. What changed

| item | what changes | bug note |
|---|---|---|
| A1 | Android: a node Compose cut short at a sticky header reads its descendants' extent (same x and width, along y, one side, only under a node listed after it); `ui_snapshot` shows the widened rect and the dumped one as `cutBounds` | `2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md` |
| A2 | Android: a tap on a node evidently cut to a sliver at its scroll container's edge (under the minimum tap piece) is refused; plain `scroll_until` no longer stops on such a sliver, and turns at once for one at the far edge | `2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md` |
| B1 | Android: inverted uiautomator bounds read as zero size at the clip edge, marked `clippedOut`; a wait's hint says "clipped out above/below its scroll container" with the direction | `2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md` |
| B2 | `scroll_until` turns at once when a top bar starts a few points below the target's top (Contacts' Toolbar 5 pt under `add url`) | round-6b S-1 residual |
| C1 | iOS: a floating tab bar covers the strip above its buttons (0.2× the button height); on idb also when its items are listed first | `2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md` |
| C2 | iOS WDA: a cell background given as nested empty frames, a text field's scroll indicator and a label's own text field are no longer covers | `2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md` |
| K | iOS idb: the keyboard band's TOP bounds the scroll stroke and the tap's chrome cut; averi still never reads the keyboard as shown on idb and never dismisses it there | `2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md`, round-6b M-1 residual |
| D2 | A hold-still wait that saw its target only on the last read takes one more read; the timeout says "found once …" instead of blaming movement | `2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md` |
| D3 | A fill into a text field that drops every character fails (a field's empty value is read as empty, not as "exposes no value"); inside `optional:` it fails the flow | `2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md` |
| D4 | The control-character refusal names ENTER only for a newline or a return | round-6b F-1 nit |

## 2. Build

1. Run `git checkout fix/round-7` (the docs/bugs edits carry over).
2. `git rev-parse --short HEAD` must print the hash in the title. If it does not, stop and ask.
3. Run `npm run build`, then restart the averi MCP server on this `dist/`. Record the hash in every result.

Rules as in rounds 3–6b: do not push or merge; write each result as `## Device check (<date>, re-run at <hash>)` at the end
of the bug note named in its item; anything new goes into a new bug note; commit only notes, and only if the owner asks;
leave `docs/architecture-reviews/` alone.

## 3. Regression: re-run round 6b's checklist

Run `docs/handoff/2026-10-09-device-check-round-6b.md` sections 3 and 4 (and its R-3) again. Everything that held at
`5e5a3d1` must still hold. Expected changes are listed per item below.

## 4. Round 7 checklist

### A1. Android: a row cut at a sticky header
Note: `2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md`.
1. The note's screen (a list with a sticky date header; mp-native Account Detail transactions): stage `row_0` half under
   `date_header_0`. `ui_snapshot` → the row's rect is its descendants' extent (e.g. `66,403 948x143`) with
   `cutBounds` = the dumped rect (e.g. `66,480 948x66`).
2. `scroll_until { selector: 'id:"…row_0"', fully: true }` → at least 1 stroke (content down), then fully visible —
   **never** `fully visible after 0 swipes` while it is cut.
3. `tap` on it: with ≥ 65 px clear below the header → `Tapped …` on the clear part (the reply says it moved); with a thinner
   strip → refused naming `date_header_0`, nothing tapped.
4. **Still holds:** Contacts' icon buttons (I-1: More options, Cancel, Delete) tapped at their centres; Account Detail rows
   under the floating tab bar as in round 6b.

### A2. Android: a sliver at the scroll container's edge
Note: `2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md`.
1. The note's shape (SWIFT form, `details_toggle` showing a 948x55 strip at the form's bottom): `tap` it →
   `… is cut at its scroll container's bottom edge (container …); only a 948x55 part of it shows, 55 deep across that edge,
   under the 65 a tap needs — scroll_until it first (if it is whole and only its own content runs to that edge, no scroll
   shows more: tap a child of it, or tap by coordinates); nothing was tapped`. No shim tap.
2. Plain `scroll_until` to it (no `fully`) → it strokes (does not stop on the strip) and stops with the toggle whole; the
   `tap` then lands (the section expands).
3. The same with the strip at the TOP edge (scroll the form so the toggle is cut by the form's top): a default
   (`down`) `scroll_until` turns at once — 1 stroke content down — never 6 swipes to a failure.
4. **Record** any whole element at a list edge that is now refused ("only its own content runs to that edge") — the stated
   residual; note its rect and its children's.

### B1. Android: inverted bounds (clipped out)
Note: `2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md`.
1. Settings with the collapsing app bar scrolled so `Apps` is past the top: `ui_snapshot` → `Apps` has a zero-height rect
   at the clip edge and `"clippedOut": "top"` — no negative heights anywhere.
2. `wait`/`tap` on `text:"Apps"` with a short timeout → the timeout's hint says
   `it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first`.
3. `scroll_until { selector: 'text:"Apps"', direction: "up" }` → reached. A plain (`down`) `scroll_until` started with it
   already clipped out does NOT turn on its first stroke (owner's default) — record the stroke count.

### B2. A top bar starting just below the target
1. Contacts (iOS idb, "Create contact" sheet): get `add url` to rest at y ≈ 78 under the Toolbar at 83; plain
   `scroll_until` → one stroke back (content down), then a stop. The same with `fully: true`.
2. **No new turns:** the round-6b S-1.4 shapes (Android Account Detail rows under the floating tab bar, the SWIFT rows at
   785/790 under CONTINUE) take as many strokes as in round 6b.

### C1. iOS: the floating tab bar's strip above its buttons
Note: `2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md`.
1. mp-native Account Detail, idb: get a row (`row_3`) whose centre lies 743–755 (in the pill above the tab buttons).
   `tap` it → refused or moved off the strip; **never** a tab pressed (the screen must not change tab). The reply may name a
   tab's frame (`201,755 82x64`) with a centre above it — known.
2. The same under WDA.
3. Tab items themselves (`nav.tab_*`) → tapped, the tab opens (M-1.5 still holds).
4. **WDA, presented over the bar:** an action sheet or alert whose buttons lie over the tab bar (e.g. a Settings or
   Contacts action sheet) → its buttons tapped at their centres (Cancel etc.), never moved by the tab bar.

### C2. iOS WDA: false covers
Note: `2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md`.
1. Settings › General › Language & Region: `tap text:"Region"` and `id:LOCALE` → tapped at their centres.
2. A text field's own scroll indicator no longer covers its label/placeholder (the note's field) → tapped.
3. mp-native SWIFT form under WDA: `tap label:"Payee’s name"` (the placeholder its field overhangs by 1 pt) → tapped at
   its centre (≈ 94,457), the field focuses.
4. **Still covers:** a labelled button over a text; RN icons with an identifier (`#login_password_toggle_icon`).

### K. iOS idb: the keyboard band
Note: `2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md`; round-6b M-1 residual.
1. SWIFT form with the number pad up (idb): `scroll_until` a field below → the shim's strokes all touch down ABOVE the
   keys (≈ `201 472 → 201 118`), never at y ≈ 699; no digit typed into the focused field.
2. Contacts with the QWERTY keyboard up (idb): the same — no stroke starts on the keys.
3. M-1.4 again (`value_date_select` under the lifted CONTINUE with the pad up) → refused naming the lifted CONTINUE, and
   the reply says `nothing of it shows above the soft keyboard` (not "a 354x7 part").
4. **Unchanged on idb:** `fill … dismissKeyboard` does not tap or press anything to hide the keyboard (one tree read only);
   averi never reports the keyboard as shown under idb.
5. Account Detail (idb, no keyboard, tab bar visible): strokes as in round 6b (no band read).

### D2. WDA start-up: one sighting
Note: `2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md`.
1. Right after WDA starts (first tap of a session, a cold WDA), `tap` a static title → `Tapped …` (the one more read
   settled it), or a timeout reading `… (found once, but no second read came within the budget to confirm its position)` /
   `… (found once; the one read after the budget did not find it again)` — **never** "never at the same position" for a
   static element.

### D3 / D4. Fills
Note: `2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md`. Scratch config only.
1. Android: `fill` `abc` into a digits-only field (the amount field) → fails `fill: typed 3 characters but the field shows 0
   — the field did not change: …`. As an `optional: fill` → `optional step not skipped: its field is present, but its
   value did not land — …`, the flow fails.
2. Android: `fill` digits into the same field → lands as before.
3. **iOS idb, record:** `fill` a password into a `SecureTextField` (mp-native login or Settings) with and without `clear`
   → does it pass? (A secure field idb reports with no value would now FAIL as "shows 0" where it used to warn — unmeasured.)
4. `type_text` with U+0007 → refused, `… may send it as a key event … Type the text without it; there is no key for it, so it
   cannot be typed.`; with a tab → `… there is no tab key, so a tab cannot be typed.`; with `\n` still names
   `pressKey('enter')`.

### R-4. Regressions in mp-native's own flows
1. `login_pin_*_here` after an inactivity logout on both platforms (as R-2): optional LOGIN / SIGN IN / SKIP hops behave as
   in round 6b; the PIN digits are typed (no tap refused on a key by the new band or tab-bar rules).
2. `back_to_tab_host` on Android from the SWIFT form (round 6b R-3.1) → holds.
3. Android Account Detail: plain `scroll_until` to a transaction far below and back up → stroke counts as in round 6b; no
   failure on a whole row reading `… element is in the viewport but cut at its scroll container's … edge …` or
   `… stayed cut at its scroll container's … edge …`.

### R-5. Regressions of round 7's rules outside the named screens (added by the device-check agent)
Round 7 widens what reads as a cover (C1's tab-bar strip, K's band, A1's widened rows) and what a fill checks (D3), so check
the shapes the rules can catch by mistake:
1. **D3 on fields that format or mask their value:** SWIFT IBAN typed with and without spaces, the amount field with digits
   (both platforms), and an Android password field (e.g. Settings › Network › add Wi-Fi network password, or any masked field
   reachable without data loss) → each `fill` passes or warns as in round 6b, never "shows 0" for text that landed.
2. **C1 look-alikes:** iOS Contacts / Settings bottom toolbars and sheet buttons near the bottom (no floating tab bar) → taps on
   rows just above them land; record any refusal naming a "tab".
3. **mp-native PIN pad (iOS idb + Android):** the PIN re-login of R-4.1 types every digit — the pad's last row is a stated C1
   look-alike; record if any key tap is refused or moved.
4. **A1 / A2 on non-bank lists (Android Contacts, Settings):** taps on whole rows at the list's top and bottom edges, and on
   rows under Contacts' letter headers → tapped; record any new refusal with the rect, `cutBounds` and the children's rects.

## 5. Out of scope: do not report these as regressions
- A1: a node cut at both ends (between the sticky header and the tab bar) reads whole; widening only along y, never
  sideways; a child overflowing one edge into the next row listed after it (or under a screen-sized wrapper such as a
  snackbar host) reads as a cut.
- A2: a cut leaf (no descendants) or a classic View cut at a horizontal scroller's side is still tapped; a whole node under
  the minimum tap piece whose own content (or a child laid out wholly past it) runs to the edge it is flush with reads cut —
  refused, and `scroll_until` fails with `element is in the viewport but cut at its scroll container's … edge` (or
  `stayed cut at …` at `maxSwipes`); a node inverted both ways counts only its vertical side.
- B1: a plain `scroll_until` started with the target already clipped out on the far side strokes the wrong way first (owner).
- C1: a classic non-floating UITabBar, a PIN pad's last row or three equal content buttons near the bottom read as a tab
  bar and refuse the strip just above them; on idb a sheet drawn over the bar has the tab items over its rows; a bar of two
  items or of unequal heights is not recognised.
- C2: an opaque background or SVG icon that WDA gives only as nested empty frames (no identifier) is not a cover; a
  placeholder label still listed over a field that already holds a value is refused.
- K: a target whose centre lies in the band with no key over it is still tapped; `scroll_until` on idb judges visibility
  over the whole screen; a sheet background listed right after a content row inside it, or a tab bar's background listed
  after its buttons, reads as a band (strokes stay above it).
- D2: the extra read may run one read past the budget.
- Everything in section 5 of the round-6b handoff.

## 6. Results table

| item | platform / device | commit | result | evidence (reply text, shim log line, screenshot path) |
|---|---|---|---|---|
| round-6b checklist re-run | both | 35d5997 | **Holds** on both | Android: B-1 text + I-1 icons, B-2, O-1/O-2 + ladder, R-1, R-3, L-1 `(1 this session)`/`(2 this session)`, Settings drag; row under the tab-bar host refused at `948x56` (6b: 47 — the dumped part is now the measure), 1 stroke; budget still so. iOS: M-1 (`201 423`, `201 479`, picker), P-1, S-1.1/1.2, H-1, T-1 |
| A1 cut row at a sticky header | Android | 35d5997 | **Holds** (1–4) | `row_1 66,440 948x143`, `cutBounds 66,480 948x103`; `fully` 1 stroke `540 765 540 1311 547`; 38 px refused naming `date_header_1`; 67 px → `Tapped … tapped the uncovered part 948x67` |
| A2 edge sliver | Android | 35d5997 | **Holds** (1–3); A2.4 no whole element refused. Residual seen: a tap on the toggle's cut child still says `Tapped` and does nothing — the refusal's own hint ("tap a child of it") points there | refusal verbatim; plain scroll 1 stroke, then the tap expands; top edge → `direction: up` hint, default scroll turns at once |
| B1 inverted bounds | Android | 35d5997 | **Holds** (1–3). Gap: a plain `scroll_until` failing from `clippedOut: top` (4 wrong strokes, owner's default) blames "a fling?" and gives no `direction: "up"` hint, unlike the wait | `Apps 198,297 126x0 clippedOut=top`; wait hint verbatim; `up` 1 stroke |
| B2 top bar just below the target | iOS / Android | 35d5997 | **Holds** | iOS `add url` at 80/86 under Toolbar 83 → 1 stroke `201 175 201 437`, plain and `fully`; Android no new turns (tab-bar row, sticky-header row, top-edge toggle 1 stroke each) |
| C1 floating tab bar strip | iOS idb + WDA | 35d5997 | **Holds** (1–4) | row_3 refused `under button "Cards" … 354x21`, no tab change (idb, WDA); tabs tapped; filter sheet buttons in the band tapped |
| C2 WDA false covers | iOS WDA | 35d5997 | **Holds** (1–4; RN icon not reached) | `text:"Region"` `63 210`, `id:LOCALE` `190 210`, `scroll_until` 0 swipes; `Payee’s name` tapped, field focused; label under CONTINUE refused naming CONTINUE |
| K idb keyboard band | iOS idb | 35d5997 | **Holds** (1–5) | strokes `201 472 → 201 118` with the pad and QWERTY, nothing typed; `nothing of it shows above the soft keyboard`; `fill … dismissKeyboard` sends no dismissal; Account Detail strokes as in 6b |
| D2 single sighting | iOS WDA | 35d5997 | **Holds** 3/3 (6b: timeout 4/4) | cold WDA → `Tapped id:nav.tab_home` ×3 |
| D3 / D4 fills | Android (+ iOS secure field) | 35d5997 | **Holds** on Android (D3.1 plain + optional, D3.2, D4 all four texts); iOS replies honest (`typed 3 characters but the field shows 4` — that field accepts letters). **D3.3 not measured:** the only secure field is behind the Password-login CONTINUE (registration path) | `fill: typed 3 characters but the field shows 0 …`; optional → `… its value did not land …` |
| R-4 mp-native flows | both | 35d5997 | **Holds** (Android 1–3; iOS 1 ×2). iOS `back_to_tab_host` from payment screens still fails — mp-native's back id `BackButton` (as 6b R-3.1) | `type_pin: 4 digits`, 4 taps, none refused; Android back `77 154`; long scrolls with no cut-edge failure |
| R-5 look-alikes, masked/formatted fills, non-bank lists | both | 35d5997 | **Holds**; Android password field not reached (Wi-Fi off) | amount `1,234.50`, IBAN with/without spaces `Filled`; nothing read as a tab bar on iOS; all PIN digits typed; Settings/Contacts edge rows tapped |

New bug notes from this check (2): `2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md` (Contacts with its
app bar collapsed: `tap text:"All contacts"` → `Tapped` at `256 3`, inside the status bar, nothing happens; plain `scroll_until` → "fully
visible after 0 swipes" on a 6-px sliver), `2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md` (color/OCR asserts sample the
status bar or CONTINUE over their element: a false color PASS in the status band, OCR reads "Contacts"; `src/verify/pixel-poll.ts:449–466`).
