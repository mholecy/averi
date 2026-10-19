# BUG: under WDA a childless screen-sized `toolbar` still covers a dismissal target the screenshot shows uncovered — the keyboard-covered tap is refused

**Measured 2026-10-09 05:30:31 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt),
averi = mobile-verify `fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio), scratch config `treeSource: wda` +
`keyboardDismiss: [tap: { role: text, text: "New Contact" }]`, stock Contacts "New Contact" sheet (UIKit). Follow-up of
[2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md](2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md),
whose round-2 fix holds on the mp-native SWIFT form (that note's 2026-10-09 sections); noted there and filed on its own here.

## Observed (measured)

Keyboard up (`role:keyboard` `0 573 402 301`), target `role:text text:"add pronouns"` at y 714, under it:

```
05:30:31  tap { selector: 'role:text text:"add pronouns"', configPath: <scratch> }                              (13.3 s)
→ The soft keyboard covers role:text text:"add pronouns": the band it draws over [0,573][402,874] contains the tap point
  (223,703) on two looks 300ms apart; … none of the configured dismissals is usable on this screen (tap text:"New Contact"
  role:"text": covered by toolbar "Toolbar"). Nothing was tapped: …
```

WDA pre-order after the title `text 'New Contact' 149 89 104 22` (inside `container id:"New Contact" 0 78 402 54`):

- `scrollable 0 62 402 812` WITH children (excused since round 2, absent from the reply),
- `toolbar 'Toolbar' 0 83 402 48`, with ONE empty `Other`/container child of the same rect,
- `toolbar 'Toolbar' 0 62 402 812`, with ONE empty `Other`/container child of the same rect (93 % of the screen).

> **Correction (2026-10-09, re-run at 347e70d):** the first version of this note said both toolbars have **no children**.
> That was wrong: the 610660f capture (`run3-ios/wda-contact1.txt` l. 267–270) already shows each with one empty,
> same-sized container child. The round-3 fix `ae23890` was built on the wrong premise (`children.length === 0`), so it
> does not hold on the device (section at the end). "Itemless" has to be judged by content (no labelled / interactive
> descendant), not by child count.

Either toolbar contains the title's point (201,100). The screenshot shows the title drawn with nothing over it. As a
statement about the pixels the refusal is false (the safe direction: nothing was tapped, and the reply says how to hide the
keyboard otherwise). Whether a title tap would have hidden the keyboard in a UIKit sheet was not tried.

## Why (read from the source)

`src/ui-tree/geometry.ts#shadowing` (l. 683–690) excuses a later node only through `coversOnlyThroughContent`:
`n.children.length > 0 && !isInteractive(n) && (CONTENT_FRAMED_ROLES.has(n.role) || area >= screen × SCREEN_SIZED_FRACTION)`.
A WDA `toolbar` with no children is neither a host (no children) nor a content-framed role, so it covers as itself, with
its full frame. On this UIKit sheet WDA reported both toolbars as empty, frame-only nodes, one over the bar area and one
over the whole sheet (one screen measured; other UIKit screens not checked).

## Why it matters

- The first fix's premise ("a screen-sized node covers only through its content") is shown on SwiftUI hosts; this UIKit sheet
  gives the same full-screen toolbar WITHOUT children, so a configured title-tap dismissal on it is refused, and every
  keyboard-covered tap there fails.
- The 402×48 toolbar shows the same shape at bar size: a childless, non-interactive bar frame over a title it does not paint over.

## Possible fix directions (owner's choice)

- Treat a childless, non-interactive, unlabelled `toolbar` (and other structural roles) as not covering, or as covering only
  where it does not contain the node being tested's ancestors' rects (the title's container `0 78 402 54` lies inside the
  402×48 toolbar's band).
- Excuse a screen-sized node regardless of children when it is non-interactive and has no label/value, i.e. extend the
  host rule to childless frames (the trade-off: a genuinely opaque empty overlay would pass silently; the doc's "silent pass"
  trade-off applies).
- At minimum keep refusing but say which kind: `covered by an empty toolbar frame (no children) — may not be drawn over it`.

## Repro

1. iOS 27 simulator, Contacts → + (New Contact), `treeSource: wda`, config `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`.
2. Focus a field so the software keyboard is up (the hardware-keyboard prefs off, as in the parent note's device checks).
3. `tap { selector: 'role:text text:"add pronouns"' }` (a row under the keyboard) → refused, `covered by toolbar "Toolbar"`.

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only
(mp-native's `averi.yaml` untouched), `idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder:
`scratchpad/averi-repo/run5-ios`.
Contacts "New Contact" (opened after a terminate+launch with `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` set to NO,
so the sheet's `First name` autofocus raised the software keyboard: WDA `keyboard 0 573 402 301`), scratch `treeSource: wda` +
`keyboardDismiss: [tap: { role: text, text: "New Contact" }]`; target `text 'add pronouns' 80 714 286 23` under the band.

**Fails — the exact FAIL text of the handoff:**

```
11:32:47 tap { platform: ios, selector: 'role:text text:"add pronouns"', configPath: <scratch wda> }          (14.7 s)
→ [isError] The soft keyboard covers role:text text:"add pronouns": the band it draws over [0,573][402,874] contains the tap
  point (223,726) on two looks 300ms apart; this adapter cannot hide it on its own (…) and none of the configured dismissals is
  usable on this screen (tap text:"New Contact" role:"text": covered by toolbar "Toolbar"). Nothing was tapped: …
```

No idb tap sent; the keyboard stayed up (`keyboard 0 573 402 301` after). Screenshot `run5-ios/img-65-0.png`.

**Why: the two toolbars are not childless.** Raw WDA `/source?format=json` (11:33, `run5-ios/wda-src2.json`), every `Toolbar`:

```
Toolbar 'Toolbar' {0,83 402x48}   vis 0 acc 0 kids 1
  Other None      {0,83 402x48}   vis 0 acc 0 kids 0
Toolbar 'Toolbar' {0,62 402x812}  vis 0 acc 0 kids 1
  Other None      {0,62 402x812}  vis 0 acc 0 kids 0
(+ three list-side Toolbars 0,0 402x874, each with one Other child; one holds the Search field)
```

averi's tree carries them the same way (`toolbar 'Toolbar' 0 83 402 48` → `container 0 83 402 48`). Each sheet toolbar has ONE
empty, frame-only `Other` of its own size. The fix (`ae23890`, `src/ui-tree/geometry.ts` l. 814:
`itemlessToolbar = n.role === 'toolbar' && n.children.length === 0`) never applies: the 48-pt toolbar has a child, is not
screen-sized (`coversOnlyThroughContent` needs ≥ 0.9 of the screen; the 812-pt one, 93 %, IS excused that way), so it covers
the title as itself. The unit test (`tests/ui-tree/geometry.test.ts` l. 424–448) builds the toolbars with no children, after
this note's "no children". **That premise was a misreading**: the 610660f-era capture of the same sheet
(`run3-ios/wda-contact1.txt`, 07:27 UTC) already shows `toolbar 'Toolbar' 0 83 402 48` followed by an indented
`container None None None 0 83 402 48`, and the same for `0 62 402 812`. The shape did not change between runs; the note did
not record the empty child.

Possible direction: judge "itemless" by content, not by child count — a toolbar whose descendants are only structural, unlabelled,
childless frames (here `Other`/`container` with no label, value or identifier) lists no item. The silent-wrong-action trade-off
stated on `shadowing` is unchanged by that.

**Not reached:** whether a title tap hides this UIKit sheet's keyboard (the refusal came first).

## Device check (2026-10-09 iOS, re-run at 86eb42d)

Measured 13:10–13:12 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), scratch configs only, `idb`
PATH shim. Run folder: `scratchpad/averi-repo/run6-ios`. Setup as in the 347e70d section: `AutomaticMinimizationEnabled` /
`HardwareKeyboardLastSeen` = NO, Contacts terminate+launch through averi (13:10:4x, 3.6 s), `tap role:button text:"Add"` (idb
`13:10:56 ui tap 350 822`) → "New Contact" with `First name` focused and the software keyboard up (screenshot `run6-ios/img-45-0.png`).
WDA snapshot (13:11:12, `run6-ios/wda-c1.txt`) shows the round-3 shape unchanged: `toolbar 'Toolbar' 0 83 402 48` → one
`container 0 83 402 48`, `toolbar 'Toolbar' 0 62 402 812` → one `container 0 62 402 812`, `keyboard 0 573 402 301`, title
`text 'New Contact' 149 89 104 22`, target `text 'add pronouns' 80 714 286 23`.

**2.1 Holds — no toolbar refusal.** Scratch `treeSource: wda` + `keyboardDismiss: [tap: { role: text, text: "New Contact" }]`:

```
13:11:29 tap { platform: ios, selector: 'role:text text:"add pronouns"', configPath: <scratch wda> }          (29.2 s)
→ [isError] Tapped text:"New Contact" role:"text" at (201,100) to hide the soft keyboard covering role:text text:"add pronouns",
  but it is still up: the band [0,573][402,874] still contains the tap point (223,726) on 2 looks 300ms apart; nothing else was
  tapped. That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look
  at it (ui_snapshot / screenshot) before retrying. From the MCP tools: hide the keyboard another way, then tap role:text
  text:"add pronouns" again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out so
  role:text text:"add pronouns" is not under it
```

Shim: `13:11:45 ui tap 201 100` (the title) and nothing after it. The round-3 `covered by toolbar "Toolbar"` refusal is gone:
the 48-pt toolbar is now excused by content (its only descendant is an empty `container`) and the title was tapped at the
handoff's (201,100). The handoff's second expectation (the `hidden by tapping …` reply, then the row tap) was **not reached**,
for the reason 2.2 records — not because of the cover judgement.

**2.2 Measured — a title tap does NOT hide this UIKit sheet's keyboard.** The `AfterDismissalTap` error above is the
handoff's "correct behaviour, not a regression": averi re-looked twice 300 ms apart, found the band unchanged, and tapped
nothing else. Screenshot after (`run6-ios/img-48-0.png`, 13:12): visually the same sheet as before (compared by eye with `img-45-0.png`) — keyboard up,
`First name` still focused with its caret, no field changed, no sheet moved; the title tap changed nothing visible. So on the
stock Contacts "New Contact" sheet a title tap is not a usable dismissal at all; the reply says so and points at the
alternatives. (Duration: 16 s from the call to the title tap — WDA reads; then ~13 s of re-looks.) Sheet closed with
`tap role:button text:"close"` (WDA config, 6.6 s), nothing saved.

## Device check (2026-10-09 iOS, re-run at dd50327)

Measured 2026-10-09 15:35–16:02 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47833, cwd mp-native, server restarted 15:52:36
for the launch-note items), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim.

Setup: keyboard prefs `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` toggled YES→NO (the HID typing in the bank app had
parked the keyboard again), Contacts `terminate_app` + `launch_app` (15:49:10, 3.3 s, one line), `tap role:button text:"Add"` → New
Contact with the software keyboard up (screenshot `run7-ios/img-164-0.png`; WDA `keyboard 0,573 402x301`). Scratch `cfg-c-wda`.

**2.1 — Holds as at 86eb42d (refusal gone; the title tap does not hide this keyboard).**

```
15:49:33 tap { selector: 'role:text text:"add pronouns"', configPath: <cfg-c-wda> }                                 (27.6 s)
→ [isError] Tapped text:"New Contact" role:"text" at (201,100) to hide the soft keyboard covering role:text text:"add pronouns", but
  it is still up: the band [0,573][402,874] still contains the tap point (223,726) on 2 looks 300ms apart; nothing else was tapped.
  That tap may have changed the screen … — look at it (ui_snapshot / screenshot) before retrying. …
```

Shim: one `idb ui tap 201 100`. **2.2 — measured again: no**, the same as 86eb42d.

**C3-6 Contacts "New Contact" sheet, WDA — Holds, no false refusal.** Keyboard still up:
`tap id:"First name"` → `Tapped id:"First name"` (6.9 s, shim `201 417`), `id:"Last name"` → `Tapped` (`201 470`), `id:Company` →
`Tapped` (`201 523`), `role:button text:close` (Cancel) → `Tapped role:button text:close` (`38 100`), the sheet closed to the list.
All at their centre; the sheet's four `toolbar 'Toolbar'` nodes (`0,0 402x874` ×3, `0,83 402x48`, `0,62 402x812`) excused, no
"under …" note.

## Device check (2026-10-09 iOS, re-run at 2f98900)

Measured 2026-10-09 18:09–18:45 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native), mp-native's `averi.yaml`
untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim. Comparisons with `dd50327` ran on a scratch worktree
build of that hash on the same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags.

Setup: keyboard prefs `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` YES → NO (restored at the end), Contacts `terminate_app` +
`launch_app`, `tap role:button text:"Add"` → New Contact with the software keyboard up (screenshot `run8-ios/img-228-0.png`). Scratch
`cfg-c-wda`.

**2.1 — Holds as at 86eb42d / dd50327 (no toolbar refusal; the title tap does not hide this keyboard).**

```
18:30:1x tap { selector: 'role:text text:"add pronouns"', configPath: <cfg-c-wda> }                                 (28.0 s)
→ [isError] Tapped text:"New Contact" role:"text" at (201,100) to hide the soft keyboard covering role:text text:"add pronouns", but
  it is still up: the band [0,573][402,874] still contains the tap point (223,726) on 2 looks 300ms apart; nothing else was tapped. …
```

Shim: one `idb ui tap 201 100`. **2.2 — measured again: no.**

**C3-6 Contacts "New Contact" sheet — Holds, no false refusal.** WDA, keyboard up: `tap id:"First name"` → `Tapped` (7.3 s, `201 417`),
`id:"Last name"` → `Tapped` (`201 470`), `id:Company` → `Tapped` (`201 523`), `role:button text:close` (Cancel) → `Tapped` (`38 100`), the
sheet closed. idb (`cfg-contacts-idb`; idb lists only the sheet, not the list behind it): `id:"Last name"` → `Tapped` (`201 447`),
`id:Company` → `Tapped` (`201 500`), `role:button text:"Add photo"` (under the sheet's `other 'Toolbar' 0,83 402x48`, listed after it) →
`Tapped` (`202 197`, the photo picker opened; `tap id:OnboardingCancelButton` → `Tapped`, `38 84`, closed it).
