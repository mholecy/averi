# BUG: on iOS a tap under the soft keyboard presses the keyboard, and the trace reports it done

Measured 2026-10-05 during the on-device verification of the 2026-10-04/05 series
(`docs/plans/2026-10-05-device-verification-handoff.md`), tree at `56a111f`, finportal `login` flow,
iPhone 17 simulator (iOS 26.5), `app.ios.treeSource: wda`.

**Not a regression of the series.** `git diff c4a2491 HEAD -- src/adapters/ios.ts src/interact/` changes nothing
for iOS behaviour: before the series `IosAdapter.softKeyboard()` answered `unknown` without running anything and
`resolveClearOfKeyboard` acted on nothing; now the adapter has no `keyboard` oracle and
`src/interact/keyboard.ts:361` returns the first resolution unchanged. The gap is older than the series; this run
is the first to hit it.

## Claim

The iOS leg of the handoff's `logged_in` step should stop at the 2FA screen, as it did on the 2026-10-05 baseline
run against `5473982`, with this trace:

```
fill: id:"login_username" = *** (cleared)
fill: id:"login_password" = *** (cleared)
tap: id:"login_submit"
optional: skipped text:"Not Now" (not present)
wait: state post_login_fork
flow login: done
```

## What happened

7 runs of the same flow on the same simulator, one session:

| run | result |
|---|---|
| `ios.json` `logged_in` (after a `fresh_launch` with `clearState`) | ✗ `Timed out after 45000ms waiting for state post_login_fork` |
| `run_flow login` alone, `screenshot` straight after | ✗ same |
| `run_flow login` × 5, a few minutes later | ✓ 5/5 reached `twofactor_*` |

Both failing traces are **identical** to the passing ones up to the wait: both fills land and
`tap: id:"login_submit"` is reported done. Nothing in the trace tells the runs apart.

The screenshot taken straight after a failure (1206 × 2622 px, 402 × 874 pt) shows:

- the password field still focused, with the caret after the 16 masked characters;
- the **software keyboard up**, with the "Passwords" AutoFill bar above the keys; its top edge is at about
  y = 546 pt (measured on the screenshot);
- `login_submit` at `{x: 36, y: 547, w: 109, h: 48}` (from `ui_snapshot` in the same state). Its centre,
  (90, 571), is about 25 pt *inside* the keyboard, in the AutoFill bar.

The tap at the centre therefore hit the keyboard's AutoFill bar. Nothing was submitted, and the flow waited out
its 45 s.

In the passing state, a screenshot after `type_text` into `login_password` shows the field focused with a caret but
**no software keyboard on screen**. The keyboard is still in the WDA tree, but parked off-screen:

```
container  UIKeyboardLayoutStar Preview  {x: 0, y: 874, width: 402, height: 233}   ← y == screen height
other      'q'                           {x: 4, y: 881, ...}
button     'done'                        {x: 300, y: 1043, ...}
```

So the outcome depends on whether the simulator happens to show its software keyboard. The simulator hides it once
it believes a hardware keyboard is typing, and shows it again after a restart or a fresh launch. This is consistent
with the failures coming first, right after `clearState`, and the passes afterwards. The exact trigger was not
isolated. What matters is that averi does not look.

## Code says

- `src/adapters/ios.ts:230` — no `keyboard` oracle: "the iOS keyboard is part of the accessibility tree … so
  'which rect does it cover' is a tree question nobody has needed answered yet".
- `src/interact/keyboard.ts:361` — `if (oracle === undefined) return first;` the target is tapped where it
  stands, wherever the keyboard is.
- `src/interact/keyboard.ts:541` — `dismissKeyboard` presses `enter` on an oracle-less adapter. finportal's `login`
  flow does not ask for a dismissal, and `enter` in the password field would submit the form anyway (a different
  path from the one the flow is meant to test).
- `src/adapters/wda-source.ts:27` — `Keyboard: 'container'`: the WDA tree already carries the keyboard. Its
  rect is the answer the oracle needs. The flat idb AX list (`treeSource: idb`) does not include it.

On Android the same situation was fixed on 2026-10-03 (`KeyboardOracle` docs in `src/adapters/types.ts`, the
finportal submit button under the IME). The iOS half was deferred as "nobody has needed it". This run needed it.

## Change (proposed, not made)

1. **An iOS `KeyboardOracle` read from the tree** (WDA source): `state()` = the rect of the `Keyboard` element (and
   the AutoFill bar above it, if that is a separate node; check on device), `shown` only when that rect
   **intersects the screen**. The measurement above shows the keyboard present in the tree at `y == screen height`
   while hidden, so "a Keyboard node exists" would be wrong. `witness()` could compare a second tree read, or
   answer `unknown` and let the existing policy take its conservative branch. That policy question is for the
   design.
2. **Hiding it on iOS** needs a non-submitting key: `enter` in the last field submits, and a `back` key does not
   exist. Candidates to measure: tapping a neutral point outside every interactive node (the keyboard's
   `Done`/`done` button is not always present), or `idb ui key` for the keyboard-dismiss HID usage. Whichever is
   chosen, the target must be resolved again afterwards, exactly as on Android.
3. On `treeSource: idb` there is no keyboard node. The oracle stays absent there and the behaviour is today's.
   Say so in the tool description.

Before changing `src/`: a unit test in `tests/interact/keyboard*.test.ts` that feeds an iOS adapter a tree whose
`Keyboard` rect covers the target's centre and asserts the tap is not sent to that point. Add a second test with the
keyboard at `y == screen height` that asserts nothing changes.

## Workaround for finportal now

`dismissKeyboard` on the password fill is not a fix on iOS: it presses `enter`, which submits from the field, so the
flow's `tap: login_submit` would then race the submission. A safer stopgap is a `tap` on a neutral, non-interactive
point (for example the `login_title` label) between the last fill and the submit. Deciding that is up to the app's
`averi.yaml`.

## Reproduce

Simulator showing its software keyboard (fresh boot, or after a `clearState` launch), finportal `login` flow via the
handoff's driver. The failure is intermittent by nature: the simulator decides whether the keyboard is shown, and
nothing in averi's trace shows which state the run was in. Take a `screenshot` straight after the flow fails.

## Measured 2026-10-07 (pre-fix)

**09:42–09:50 CEST**, averi `f76cb9d`, finportal `sk.finportal.myport`, `iPhone 17` iOS 26.5 (`D34212DB-…`). WDA
was hand-started on port 8199 for K1–K5, and the raw `/source?format=json` was saved per step (`source-K1.json`,
`source-K3.json`, `source-K5b.json`, `source-K5d.json` in the run's scratch dir; they are the fixture candidates).
The software keyboard was up on its own after a launch. The field was focused through a WDA session (`accessibility
id` `login_password` → `click`). Screens are 402 × 874 pt.

- **K3, nothing focused (login screen after launch).** No `Keyboard` node anywhere. `Application` has a single
  `Window`, and the tree has 159 nodes.
- **K1, `login_password` focused, keyboard and "Passwords" bar visible.**
  - `Application` now has **three** `Window`s. Window #1 is `isVisible=0` and holds an `inputView` `{y:539,h:335}`.
    Window #2 (`isVisible=1`) holds the keyboard:
    ```
    Window {0,0,402,874}
      Other {0,0,402,874}
        Other {x:0, y:539, w:402, h:335}            ← union of everything below, reaches the screen bottom
          Other  SystemInputAssistantView {y:539, h:44}
            … Other "Typing Predictions" > Button "Passwords" {x:30, y:539, w:342, h:44} > Image kb-autofill-key
          Other {y:539, h:335} isVisible=0
          Other {y:583, h:233} > Keyboard {x:0, y:583, w:402, h:233} isVisible=1   (35 Key children)
          Other {y:583, h:291} > Button "dictation" {x:325, y:805, w:69, h:70}
    ```
  - **The AutoFill bar is NOT inside the `Keyboard` rect.** It is a separate sibling node 44 pt high, directly
    above it, at 539–583. The `Keyboard` rect alone (583–816) misses both the bar and the dictation row
    (805–875). The common parent `Other {y:539, h:335}` covers 539–874, which matches the screenshot's keyboard top
    (≈540 pt).
  - `login_submit` is at `{x:36, y:547, w:141, h:48}`. Its centre (106, 571) lies in the bar and is above the
    `Keyboard` rect, so a `Keyboard`-only oracle would call the target clear.
- **K2, the parked keyboard: not measured in the first pass** (measured in the second pass, below). This Xcode install has no `Simulator.app` (`open -a Simulator`:
  "Unable to find application named 'Simulator'"; the simulator runs headless), so ⌘K could not be sent. An `idb ui
  key 225` (Left Shift HID) and `idb ui text` typing did not hide the software keyboard either. The only data point
  for the parked state is still the 2026-10-05 one above (`UIKeyboardLayoutStar Preview` at `y: 874`).
- **K5, dismissals** (screenshot after each; dummy values `kbprobe`/`x1` typed by `idb ui text`, so a submit is visible):
  - (a) `POST /session {"capabilities":{}}` → `POST /session/<id>/wda/keyboard/dismiss`, with `{}` and with
    `{"keyNames":["Hide keyboard"]}`: both `invalid element state`, "Did not know how to dismiss the keyboard. Try to
    dismiss it in the way supported by your application under test." The keyboard stayed up. Creating and deleting
    the session did not relaunch the app (the app pid was 85156 throughout).
  - (b) `idb ui tap 85 303` on the "Prihlásenie" title: **hidden, not submitted.** This was confirmed on the empty form
    and on the filled form (Submit enabled, fields kept, no error). Afterwards the keyboard's Window is gone from the
    tree (two `Window`s, no `Keyboard` node).
  - (c) `idb ui swipe 200 330 200 520` on the form: keyboard stays up, nothing submitted.
  - (d) the keyboard's ✓ return key (`idb ui tap 350 774`): **submitted.** The dummy login came back "Nesprávne meno
    alebo heslo, alebo je účet dočasne zablokovaný. Skúste to o chvíľu." with the fields cleared.
- **K4, cost of one `/source`** (10 × `curl -w %{time_total}`, login screen): keyboard up, median 0.873 s, p90
  0.983 s. Keyboard down, median 0.592 s, p90 0.614 s. The keyboard adds ≈0.28 s, about 35 Key nodes plus the
  input windows. The 2FA screen is in the second pass.
- **K6, the bug's baseline.** Hand WDA stopped (port quiet). `run_flow login` × 3 through the driver: **✗ 3 of 3**,
  `Timed out after 45000ms waiting for state post_login_fork`, 68–69 s each. The trace is identical to the claim
  above (`fill` ×2, `tap: id:"login_submit"`, `optional: skipped text:"Not Now"`, then the wait fails). Every
  post-run screenshot shows the password field focused with the caret after 16 masked characters, the software
  keyboard up and the Passwords bar visible. `tap: id:"login_submit"` reports done while nothing was submitted.
  averi's own WDA exited with the driver.
- **After K6: one real submit.** The K5(b) neutral tap hid the keyboard, and an `idb ui tap 90 571` hit Submit with
  the credentials averi had filled. The app answered "Nesprávne meno alebo heslo, alebo je účet dočasne
  zablokovaný" and kept the fields. Further attempts were paused, so as not to lock the account.

## Measured 2026-10-07, second pass (after the owner asked for a retry)

**10:54–10:57 CEST**, same simulator, ≈65 min after the failed submit. The driver ran `run_flow login`, then
`tap text:"Prihlásenie"`, `tap id:"login_submit"` and `ui_snapshot`.

- **`run_flow login` passed this time** (27.1 s): `fill` ×2, `tap: id:"login_submit"`, `wait: state
  post_login_fork`, `flow login: done`, and it stopped on `twofactor_screen`. The credentials are good. The
  09:50 rejection was therefore temporary: a lockout or the backend, cause unknown. The driver's next steps found the
  2FA screen instead of the login form (`text:"Prihlásenie"` matched 2 elements, `twofactor_title` and an unnamed one,
  and `login_submit` timed out). No code was typed.
- **Why it passed (the keyboard on the login screen):** after `twofactor_back` → `login_password` focused, the
  software keyboard was **up but without the Passwords bar**. There was no `SystemInputAssistantView` node, `Keyboard
  {x:0, y:583, w:402, h:233}` was `isVisible=1` with a `Done` key `{y:752}`, plus `dictation {y:805}`. Window
  count: 3. So the bar comes and goes. With it, the keyboard area starts at 539 and covers Submit's centre (571).
  Without it, the area starts at 583 and Submit's centre is clear. That is the intermittency in "What happened" above,
  and the bar's presence was not controlled here (in K6 it was present with filled fields; here it was absent with
  filled fields).
- **K2, the parked keyboard, measured on the 2FA screen** (`twofactor_code` focused, caret visible, no software
  keyboard on screen, only a "Done" bar at the bottom):
  ```
  Window#1 isVisible=0
    Other {y:826, h:48} isVisible=0
      Toolbar "Toolbar" {x:0, y:826, w:402, h:48} isVisible=1   > … > Button "Done" {x:317, y:831, w:64, h:38} isVisible=1
  Window#2 isVisible=0
    Other {y:826, h:298} isVisible=0
      Other {y:891, h:233} > Keyboard {x:0, y:891, w:402, h:233} isVisible=0   (12 Key children, "1" at y 898, isVisible=0)
  ```
  - The parked `Keyboard` sits **below the screen (y 891 > 874) with `isVisible=0`**, and so do its keys. So
    "intersects the screen" and `isVisible` agree.
  - The app's input-accessory **Toolbar ("Done") is on screen at 826–874 and `isVisible=1`**, although its Window
    is `isVisible=0`. `twofactor_screen` shrinks to `h: 826` to make room. An oracle that looks only at `Keyboard`
    misses this 48 pt band. A target there would be under the toolbar.
  - On this screen an `idb ui tap` into the focused field did not raise the software keyboard. It only showed an
    "AutoFill" edit-menu callout. The parked state could not be produced on the login screen, where the keyboard
    showed again (above).
- **K4 on the 2FA screen, keyboard parked:** 10 × `/source`, median 0.750 s, p90 0.782 s.
- **The 2FA screen with the keyboard up (11:05).** The owner tapped into `login_password` in the simulator and the
  software keyboard came up (no Passwords bar). A neutral tap and an `idb ui tap` on Submit led to 2FA, and there the
  number pad was up with the "Done" toolbar above it:
  ```
  Window#1 isVisible=0
    Other {y:518, h:356} isVisible=0
      Toolbar "Toolbar" {x:0, y:518, w:402, h:48} isVisible=1  > … > Button "Done" {x:317, y:523, w:64, h:38} isVisible=1
      Other "inputView" {y:566, h:308} isVisible=0
  Window#2 isVisible=1
    Other {y:518, h:356} isVisible=1              ← union, 518–874
      Other {y:518, h:48} isVisible=0             ← the toolbar's slot
      Other {y:566, h:308} isVisible=1
      Other {y:583, h:233} > Keyboard {x:0, y:583, w:402, h:233} isVisible=1
      Other {y:583, h:291} > Button "dictation" {y:805}
  ```
  - `twofactor_screen` shrinks to `h: 518`.
  - Covered area: **518–874**. `Keyboard` alone covers only 583–816. The toolbar (518–566) sits in a *different*
    Window than the `Keyboard`, and that Window is `isVisible=0` while the Toolbar is `isVisible=1`. In Window#2 the
    common parent `Other {0,518,402,356}` spans the whole area, toolbar slot included.
  - **K4, 2FA keyboard up:** median 0.667 s, p90 0.687 s. That is faster than the parked read (0.750 s), so on this
    screen the keyboard adds nothing measurable.

### Answers (both passes)

| question | answer |
|---|---|
| AutoFill bar inside `Keyboard` rect? (K1) | **no**: a separate `SystemInputAssistantView` sibling at y 539–583, above `Keyboard` 583–816. The dictation button reaches 805–875, and the common parent `Other {0,539,402,335}` covers 539–874. The bar is not always there: it was absent in the second pass with filled fields, and then Submit's centre (571) was clear and `login` passed |
| Parked keyboard: rect and `isVisible` (K2) | (2FA) `Keyboard {0,891,402,233}` with `isVisible=0`, keys `isVisible=0`. **But** an input-accessory `Toolbar` "Done" `{0,826,402,48}` stays on screen with `isVisible=1`. After a neutral-tap dismissal there is no `Keyboard` node at all. With an accessory bar the covered area grows: 2FA keyboard up covers 518–874 (`Toolbar` 518–566 in another Window + `Keyboard` 583–816) |
| `Keyboard` node present with nothing focused? (K3) | no, a single `Window` and no `Keyboard` |
| Extra `/source` cost per tap, median/p90 (K4) | login: up 0.873/0.983 s, down 0.592/0.614 s. 2FA: up 0.667/0.687 s, parked 0.750/0.782 s |
| Non-submitting dismissal that works (K5) | an `idb ui tap` on a neutral, non-interactive point (the title). WDA `keyboard/dismiss` fails both ways, a swipe does nothing, and the return key submits |

## Fix (stage A) — 2026-10-07, not yet device-checked

**Shipped.** A tap on a resolved node whose centre lies under the on-screen keyboard is REFUSED on iOS `treeSource: wda`,
and the refusal is visible in the trace. No device read is added and nothing is pressed. (Revised the same day after
review round 1: the keyboard's own controls are exempt, the band rule has a fail-safe, the guard takes a second look,
and one helper owns the oracle-or-tree switch.)

1. **The band comes from the tree that resolved the target** (`src/adapters/wda-source.ts#keyboardMarks`). For every
   `Keyboard` element that is on screen — `isVisible` is `"1"` AND its rect intersects its Window's — the parser gives
   ONE node the new role `keyboard` (`KEYBOARD_ROLE`, `src/adapters/types.ts`): the outermost ancestor below that
   Window whose rect is a *band* of it — starts below the window's top and is under 60 % of its height
   (`MAX_BAND_FRACTION`; the measured bands are 38–41 %) — falling back to the `Keyboard` itself (exempt from the bound).
   A wrapper merely smaller than its Window (a safe-area inset, a fractional 873.67 edge, a Stage Manager frame) is
   walked past, so it can never be crowned and refuse every tap. On the fixtures the band is the union `Other` the
   measurements above describe: `{0,539,402,335}` with the Passwords bar (K1), `{0,566,402,308}` without it (K2),
   `{0,518,402,356}` with the 2FA toolbar (toolbar slot included). A parked keyboard (2FA-0: `isVisible=0`, y 891) and
   a screen with nothing focused (K3) mark nothing. The `Keyboard` element stays `container`, its keys `other`; the role
   is not interactive and no selector or resolution changes (`tests/adapters/wda-source-keyboard.test.ts`, 46 tests
   over the five shrunk fixtures `tests/fixtures/wda-source-myport-*.json`).
   - **Correction to the second pass above:** the band rule was checked against the screenshots' pixels, and in K2
     the keyboard's grey begins at **566 pt** (at x = 8 %, through the key columns; the left-margin strip at 566–578 is
     the rounded edge), 17 pt above the `Keyboard` rect's 583 — exactly the union `Other {0,566,402,308}`. So
     "covered ≈583–874" for K2 was the `Keyboard` rect, not the drawn area, and Submit's centre (571) lies inside
     the keyboard in K2 as well. K1 and 2FA-up agree with their unions too (grey from 540 at x = 8 %, where the bar
     is keyboard-coloured; the white Done toolbar from 519, grey from 566). Why the second-pass `run_flow login`
     passed is therefore open: not because 571 was clear with the bar absent — more likely the keyboard was parked or
     hidden at the moment of that tap (the 2026-10-05 observation), which the run did not capture.
2. **The keyboard's own controls are the keyboard, not under it** (review round 1). A tap on a key, on the toolbar's
   Done {317,523} — the natural non-submitting dismissal, an OTP digit, the Passwords bar or dictation lands inside
   the band and must not be refused. The parser marks the roots of the keyboard's UI with `UiNode.ofKeyboard`: the
   Window holding a `Keyboard` element, and the Window holding an `inputView`-identified element — UIKit's input-host
   Window, which in the 2FA fixture holds the Toolbar in a *different* Window than the band (so "a descendant of the
   band node" would miss Done). On the roots only, so `ui_snapshot` shows the mark twice, not on seventy keys.
   `ui-tree/soft-keyboard.ts#partOfKeyboard` walks the ancestry; a keyboard-side subject reads as not covered in the
   guard and in the pixel poll. The `inputView` half is guarded twice (review round 2 — `rawIdentifier` is an RN
   `testID`, and renaming K1's `login_card` to `inputView` had marked the app's Window and let `login_submit` be
   tapped): the element must have the placeholder's measured shape — full window width, flush with the window's
   bottom, a band by the 60 % rule (it is the band's own rect in all three keyboard-up fixtures) — AND must not sit in
   the Application's first Window child, the app's own (UIKit orders windows by level; the keyboard's and the input
   host's come after it in all five fixtures). The `Keyboard`-type rule stays unconditional: the type is UIKit's.
   Pinned with the renamed dump (window 0 unmarked, `login_submit` still refused) and per-guard synthetics. Pinned on the real dumps: Done, Toolbar, the `1` key, Passwords, `q`, dictation resolve
   clear; `login_submit` is still refused on K1 and K2. Residual: in the parked fixture the Toolbar's Window holds no
   `inputView` and is not marked — with no band on screen nothing is refused there either.
3. **The guard** (`src/interact/keyboard.ts#resolveClearOfKeyboard`): `resolveSettled` returns the tree of the read
   that settled the target (`ResolvedSettled.tree`, the second agreeing read — pinned: a band in read 1 and none in
   read 2 taps at once); `ui-tree/soft-keyboard.ts#readSoftKeyboard` — THE one switch between the oracle (`state()`)
   and the tree, shared with the pixel poll — reads the keyboard with the target as its subject, through the same
   `windowOver` geometry as Android. Without an oracle a covering first look is not final (the settle wait proves the
   target held still, not the keyboard — one still sliding away after `tap: title` → `tap: submit` would read as
   covering): the guard waits `KEYBOARD_HIDE_DELAY_MS` (300 ms), resolves again and decides on that look
   (`inTreeLook`): clear → the tap, with the note `…; gone on the second look`; still covering →
   `KeyboardWithoutDismissal` (a `KeyboardGuardError`), nothing tapped, nothing pressed; a second look that cannot
   resolve the target (timeout, ambiguity, a dead read) is wrapped the same way the Android second look is
   (`After the soft keyboard covered X at (x,y) on a first look, the second look failed: …. Nothing was pressed`,
   trace line `…; nothing sent, and the second look failed`, the original error as `cause`). The flow engine's existing
   `tracingDismissal` path prints `⚠ tap: the soft keyboard covered id:"login_submit"; no dismissal, nothing sent`
   (the Android line's shape; quoted from the device check below) before the `✗ tap` line; the message quotes the band and the point ("on two looks 300ms
   apart") and says "this adapter cannot hide it (…)" quoting the ADAPTER's own sentence — `DeviceAdapter.keyboardAdvice`,
   set by `IosAdapter` from the K5 measurements (no back key, return submits, WDA `keyboard/dismiss` fails, swipe does
   nothing; a tap on a neutral element hid it; a hardware keyboard keeps it from showing) — so interact/ and verify/
   carry no platform fact. `fill:`'s focus tap goes through the same guard. An adapter WITH an oracle is never read
   from the tree (pinned: oracle `hidden` + band in tree → tap, one query): Android is byte-identical. The guard's
   result carries `node` and `note` only, never the tree (pinned).
4. **Pixel asserts** (`src/verify/pixel-poll.ts`): the round reads `readSoftKeyboard` with the found element as the
   subject — the oracle, else the round's own tree; a keyboard-side element is not covered — and a covered element
   fails closed with both rects; the remedy says "hide it first and re-run; this adapter cannot hide it (<advice>)"
   rather than naming `back`/`dismissKeyboard`.
5. **MCP `tap` / `type_text` descriptions** say so, including that the keyboard's own controls stay tappable;
   `ui_snapshot` shows the band as a `keyboard` node and `ofKeyboard: true` on the two keyboard-side Windows, and its
   description says what both mean.
6. **Fixtures**: shrunk to the parser's fields (29–39 KB, one element per line), the username replaced by
   `user@example`, the filled password normalized to 8 bullets (the real length is not in the repo).

**Deferred / residuals.**
- **Stage B, a dismissal.** The only non-submitting dismissal measured (K5b) is a tap on a neutral point, which is
  app-specific; `dismissKeyboard` / `fill { dismissKeyboard: true }` on iOS still presses `enter` blind (K5d: submits).
  A generic candidate (the toolbar's Done or the keyboard's `Hide keyboard` key when present — both now resolve as
  tappable — or a `dismissKeyboard: { tap: <element> }` option) needs its own measurement. **Done the same day — "Fix
  (stage B)" below: a configured `app.ios.keyboardDismiss` list (a neutral tap, the accessory Done); `enter` is no longer
  pressed.**
- **An accessory toolbar alone** (2FA-0: `Toolbar` on screen at 826–874, `isVisible=1`, keyboard parked below the
  screen) marks no band; a target under it is tapped as before.
- **`treeSource: idb`** has no keyboard in its tree: no band, no marks, no refusal — the pre-fix behaviour, fail-open.
- **iPad split / floating keyboard, a second on-screen `Keyboard`**: not measured; the first on-screen Keyboard's
  band is read; the 60 % bound was chosen on portrait phone measurements.
- **iPhone landscape**: on a 402 pt-tall screen the 60 % bound is 241 pt, and keys + predictive bar + an accessory
  toolbar may well exceed it (unmeasured estimate). The rule would then walk past the union and fall back to a
  deeper, smaller band — or the `Keyboard` rect — and miss the bar: fail-open there, not a false refusal. Measure
  before relying on the guard in landscape; the bound may need to be per-orientation.
- **An app with a second window of its own holding a band-shaped `inputView`-identified element** (full width,
  flush with that window's bottom, under 60 % of its height, starting below its top) gets that window marked as the
  keyboard's, and targets in it are tapped unguarded — the pre-fix behaviour, for that window only (review round 3
  constructed it on K1; no measured app does this).
- **The device check** — done 2026-10-07, see the next section. Expected was, on the finportal `login` flow with the
  keyboard up, a `⚠ tap` refusal naming `[0,539][402,874]` (or `[0,566][402,874]`) and the submit's centre ((107,571)
  in the Slovak UI, (91,571) in the English one) instead of a 45 s timeout; with a `tap: { id: login_title }` before
  the submit, a pass; and `tap text:"Done"` on the 2FA number pad hiding it.

## Device check of the fix (2026-10-07, `6f41787`)

**13:00–13:10 CEST**, `6f41787` built, run with the handoff's driver on this repo's `dist/`. finportal's real config
(`treeSource: wda`) on iPhone 17 iOS 26.5 (`D34212DB-…`). For the submit-free steps, a scratch copy of it adds five
helper flows: `fill_creds` (the `login` flow's two `fill`s), `submit_only` (`tap login_submit` + `wait
post_login_fork`), `title_then_submit`, `back_only` and `tap_submit_only`. Its `.env.averi` is a symlink to finportal's.
The scratch copy lives in the run's scratch dir and nothing in finportal was edited. Real login submits: **3** (listed
below). No 2FA code was completed.

**Raising the software keyboard without Simulator.app (setup, not part of the fix).** After a cold launch and a focus
tap, the keyboard was parked: `UIKeyboardLayoutStar Preview` at y 952, Passwords bar at 874, and **no `keyboard` node**
(correct: nothing on screen). ⌘K is not available. What raised it was writing `com.apple.keyboard.preferences
AutomaticMinimizationEnabled` (recorded `1`) to `false`, or toggling it `true` → `false`, followed by a **focus change**
(tap another field, then the target field). A tap on the field that already had focus only opened the edit menu ("Select
All / AutoFill"). The pref was restored to `1` at the end.
- **Any `fill` parks the keyboard again.** `fill` types with `idb ui text` (HID), and iOS then treats a hardware keyboard
  as attached. Measured: keyboard band up → `fill_creds` → `0 matches for role:keyboard`. Also after `type_text "a"` and
  after every later focus, until the next pref toggle. This probably explains the pre-fix second pass that "passed": at
  the moment of the submit tap, the keyboard was parked by the `fill`s just before it.

Results:
- **K1, band — PASS.** `fresh_launch` → toggle → `tap id:login_password`: `ui_snapshot role:keyboard` returned one node,
  `{x:0, y:539, w:402, h:335}`, with the Passwords bar visible in the screenshot. In the K2 setup below, without the bar,
  it was `{0,566,402,308}`. The full snapshot carried `"ofKeyboard": true` twice. `login_submit` = `{36,547,109,48}`
  (English UI, so 109 wide and not 141, which puts the centre at (91,571) and not (107,571)).
- **K2 as written (`run_flow login` with the band up) — not reproducible here; submit #1.** The keyboard was up
  (`[0,539][402,874]`) when the flow started. The flow's `fill`s parked it, `tap: id:"login_submit"` found no band and
  tapped, and the flow ended on `twofactor_screen` (`flow login: done`, 22.4 s). The guard was right not to refuse:
  nothing covered the button. The second allowed run was not spent, because it would end the same way.
- **K2 via `submit_only`, band up over the filled form — PASS** (after one failed attempt, **submit #2**: the toggle without
  a focus change did not raise the keyboard, and the submit went through to 2FA). With the band up,
  `run_flow submit_only` returned `ERROR in 4.7s`, trace:
  ```
  flow submit_only: start
  ⚠ tap: the soft keyboard covered id:"login_submit"; no dismissal, nothing sent
  ✗ tap id:"login_submit": failed — The soft keyboard covers id:"login_submit": the band it draws over [0,566][402,874] contains the tap point (91,571) on two looks 300ms apart, and this adapter cannot hide it (the keyboard is part of the accessibility tree and no key hides it without a side effect: there is no back key, the return key submits from the field, WebDriverAgent's keyboard/dismiss fails and a swipe does nothing; a tap on a neutral, non-interactive element (a title label) was measured to hide it without submitting, and typing with a hardware keyboard keeps the software keyboard from showing). Nothing was tapped: the tap would have pressed the keyboard and been reported done. From the MCP tools: hide the keyboard first, then tap id:"login_submit" again. In a flow: hide it with a step before this one (a tap: on an element the keyboard does not cover), or lay the screen out so id:"login_submit" is not under the keyboard
  ```
  This fails in seconds, not in 45 s. The `⚠` line reads `⚠ tap: the soft keyboard covered id:"login_submit"; no
  dismissal, nothing sent`, the Android shape. (The "Fix" section above first quoted it as `⚠ tap id:"login_submit"
  — …`; corrected to the measured line.)
  The MCP `tap id:login_submit` right after gave the same refusal in 4.8 s. The screen stayed on the login form with
  the fields filled.
- **K3, workaround — PASS (submit #3).** With the band still `[0,566][402,874]`, `title_then_submit` (`tap
  id:login_title` → `tap id:login_submit` → `wait post_login_fork`) passed in 7.9 s and stopped on the 2FA screen.
- **K4, 2FA number pad — PASS.** After K3 the pad was up: `role:keyboard` `{0,518,402,356}` and `Done` `{317,523,64,38}`.
  `tap text:"Done"` → `Tapped`, then `0 matches for role:keyboard`, and no `Done` in the tree. `tap id:twofactor_code`
  raised the pad again (`{0,518,402,356}`, no toggle needed). `tap label:"1"` (the key at `{4,590}`) → `Tapped`, and
  `twofactor_code` `value: "1"`: the digit landed and was not refused. Then `Done` and `twofactor_back` went back to
  login, with the code not completed.
  - Negative control: with the pad up, the keyboard-avoiding layout moves `twofactor_back`/`twofactor_submit` to
    y 451–499, above the band (`twofactor_screen` h 518). `run_flow back_only` therefore tapped `twofactor_back` with no
    refusal, and color/ocr asserts on `twofactor_submit` measured it (`sampled #FAFAFA`, ocr `read "Log in"`). Both are
    correct: nothing was covered.
- **K5, pixel guard — PASS** (same state as K2, band `0,566 402x308`):
  - `color` on `login_submit`: `FAIL … — the soft keyboard covers the element (element 36,547 109x48, keyboard 0,566
    402x308) — hide it first and re-run; this adapter cannot hide it (…the iOS advice above…); failing closed, color
    unchecked` (6.9 s with `timeout: 6s`).
  - `ocr` on `login_submit`: the same sentence, ending `rendered text unchecked` (6.9 s).
  - `color` on `login_title` (above the band): `PASS … sampled #FFFFFF (dominant, 100% of region) … dE00 0.00` (5.0 s).
  - `ocr` on `login_title`: `PASS … read "Login"` (5.3 s).
- **K6, Android regression (emulator-5554) — PASS.** `list_devices`: `emulator-5554` booted, and no physical device.
  `fresh_launch` → `tap id:login_username` (Gboard up over Submit, screenshot) → `tap_submit_only` with the fields **empty**
  (Submit disabled, so no real submit), 9.7 s:
  `⚠ tap: the soft keyboard covered id:"login_submit"; hidden before tapping` / `tap: id:"login_submit"` /
  `flow tap_submit_only: done`. Afterwards the IME was hidden and the login screen was unchanged.

| scenario | result |
|---|---|
| K1 band on login | **PASS**: `[0,539][402,874]` with the Passwords bar, `[0,566][402,874]` without; `ofKeyboard` ×2 |
| K2 `run_flow login` | not reproducible: `fill` (HID) parks the keyboard, so the submit was clear and tapped (submit #1) |
| K2 refusal (submit_only + MCP tap, band up) | **PASS**: refused in 4.7 / 4.8 s, nothing sent |
| K3 title → submit | **PASS**: 2FA (submit #3) |
| K4 Done / digit | **PASS**: Done hides the pad; `1` lands |
| K5 pixel guard | **PASS**: covered → fail closed with the iOS advice; title → measured PASS |
| K6 Android | **PASS**: unchanged `hidden before tapping` line |

Unexpected:
- The guard can only fire on iOS if the software keyboard is still up at the tap. Every `fill`/`type_text` types through
  HID and parks it, so on a flow that fills right before the submit (finportal `login`), the guard sees no band in
  this setup. That is the honest result and not a false pass. It does mean the bug's original symptom (a tap that
  lands on the keyboard) needs a keyboard raised *after* the last typing.
- The `⚠` line's wording differs from the quote in the "Fix" section (see K2).
- Submit #2 was spent because a pref toggle with no focus change does not raise the keyboard.

## Fix (stage B) — 2026-10-07, not yet device-checked

**Shipped.** A covered target is no longer only refused: when `averi.yaml` names a dismissal, the guard taps it first.
Every measured fact above is a rule, and nothing new is pressed: the only keys ever measured (return, `enter`) submit
(K5d) and stay unpressed; the only things measured to hide the keyboard without submitting — a tap on a neutral
element (K5b, K3 of the device check) and the accessory toolbar's Done (K4) — are what the config may name.

1. **Config: `app.ios.keyboardDismiss`** (`src/flow/config.ts`, strict schema, `KeyboardDismissStrategy`) — an ordered,
   opt-in list, at least one entry when present:
   ```yaml
   app:
     ios:
       bundleId: sk.finportal.myport
       treeSource: wda
       keyboardDismiss:
         - tap: { id: login_title }        # an element spec with a selector: a neutral element whose tap hides the keyboard
         - tap: { id: twofactor_title }
         - accessory: true                 # the input-accessory toolbar's trailing button (the "Done" above the 2FA pad)
   ```
   Opt-in and app-specific on purpose: what is neutral is the app's business, and a wrong choice is a tap on something.
   `flow/config.ts#keyboardDismissals` converts it ONCE into interact/'s vocabulary
   (`interact/keyboard.ts#KeyboardDismissal`: `{ kind: 'tap', target }` | `{ kind: 'accessory' }`), so no config type
   crosses into interact/. The engine converts in its constructor and passes the list to every `tap:`, `fill:` and the
   post-fill dismissal (`GuardOptions.dismissals`); the MCP `tap` and `type_text` tools read it through
   `flow/load.ts#keyboardDismissalsFor` — the same config-optional policy as `iosTreeSourceFor` (android never reads the
   config, ios without averi.yaml gets none, an invalid one throws). Only read under `treeSource: wda`: the idb tree
   carries no band, so nothing is covered or dismissed there.
2. **The accessory button** (`ui-tree/soft-keyboard.ts#accessoryDismissButton`): the WDA parser now maps `Toolbar` to role
   `toolbar` (`adapters/wda-source.ts`; it fell through to `other`; not interactive, not structural, `role:toolbar`
   matches it). The rule: a `toolbar` under an `ofKeyboard` root (UIKit's input-host Window, where the 2FA fixture
   holds the Toolbar beside `inputView`), with positive area, NOT under the `keyboard` band node — which excludes the
   keyboard's own `done` RETURN key (`id:Done` at {300,752} in the login fixtures, a Button inside `Keyboard`; it
   SUBMITS) and the Passwords bar — and its last pre-order `button` with area (a UIToolbar lays items leading to
   trailing). On the fixtures: 2FA-up → Done {317,523,64,38}; the login fixtures → none (no Toolbar at all); the parked
   2FA fixture → none: its Toolbar Window holds no `inputView` and is not marked `ofKeyboard` (the stage A residual), and
   with no band on screen there is nothing to dismiss there either, so the two residuals agree.
3. **The guard protocol** (`interact/keyboard.ts#resolveClearOfKeyboard`, oracle-less branch; the Android branch is untouched
   and reads no dismissal — pinned: the event log with dismissals configured is byte-identical to the log without):
   after stage A's second look still covers, `pickDismissal` judges the configured list on THAT look's tree (no read of
   its own, no wait), and every strategy passed over gets a reason. A `tap` is usable when its target matches a
   NON-INTERACTIVE node with area — review round 1: the resolution policy prefers the sole interactive match, so
   `tap: { text: "Sign in" }` on a screen where a title and a BUTTON share the label would have tapped the button; now
   interactive matches are dropped before any choice (`only interactive match (button) — a dismissal must be a
   non-interactive element`), and the schema refuses `role: button` and the other interactive roles outright — is
   unambiguous under the caller's `refuse` mode (the MCP tools: `2 matches` counts as absent; flows take the first and
   say `(2 matches, the first)` in the note), is not the keyboard's own UI (`partOfKeyboard`: `the keyboard's own
   control` — the return key is a Button, so it is already dropped as interactive, pinned on both login dumps), has its
   centre clear of the band (`under the keyboard`: a configured element under it would be the very tap the guard
   refuses), inside the root's rect (`off screen at (x,y)`: WDA keeps off-screen nodes, a title scrolled above the
   viewport is still found) and not drawn over by later content (`covered by text "Session expired"`: `shadowing`, the
   last non-structural, non-keyboard node after it in pre-order containing the point — an alert's or sheet's text, a
   navigation bar's label; ancestors, earlier siblings, later structural wrappers never count); an `accessory` is
   usable when `accessoryDismissButton` answers (`no accessory toolbar on screen` otherwise). None →
   `KeyboardWithoutDismissal` as before, the message now ending `…; this adapter cannot hide it (<advice>), and no
   dismissal is configured` or `…, and none of the configured dismissals is usable on this screen (tap
   id:"twofactor_title": not found; accessory: no accessory toolbar on screen)`; the `⚠ tap` trace line is unchanged
   (`…; no dismissal, nothing sent`). One → ONE `adapter.tap` at its centre, then up to `KEYBOARD_HIDE_CONFIRM_LOOKS`
   (2) looks `KEYBOARD_HIDE_DELAY_MS` apart, each a `resolveSettled` with the same options with the band read off it
   (review round 1: the 300 ms is an Android floor, and an iOS hide animation caught mid-way must not fail what the
   blind `enter` passed): clear → the tap, note and `⚠ tap` line `the soft keyboard covered id:"login_submit"; hidden
   by tapping id:"login_title" before tapping`; still covering on the last look → `AfterDismissalTap` (a
   `KeyboardGuardError`, the in-tree sibling of `AfterKeyboardDismissal`), trace line `…; tapped id:"login_title" to
   hide it, still covered`, message saying the screen may have changed; a look that cannot resolve the target is
   wrapped the same way the Android second look is (`After tapping id:"login_title" at (201,303) to hide the soft
   keyboard that covered … : Timed out … That tap may have changed the screen`, trace line `…; tapped …, and the look
   after it failed`, the cause kept). NEVER a second strategy after a tap: the tap had an effect this layer cannot
   judge. `IosAdapter.keyboardAdvice` now also says where the measured dismissals are configured, so the refusal points
   at the fix without interact/ naming an iOS config key.
4. **`dismissKeyboard` / `fill { dismissKeyboard: true }`** (`interact/keyboard.ts#dismissKeyboard`, the in-tree model):
   **`enter` is never pressed any more** — a deliberate behaviour change, since the blind key was measured to submit
   (K5d). **Migration:** a flow that relied on that `enter` to SUBMIT (a search field, a form without a button) taps the
   app's own submit/search control. The keyboard's return key (`tap: { id: Done }` / `tap: { label: search }`; the label
   follows the field's return-key type) is the keyboard's own control and passes the guard, but only while the keyboard
   is visibly up (`ui_snapshot` shows the `keyboard` band): after a `fill` it is usually parked below the screen
   (device check, 2026-10-07) with its keys still in the tree, and a tap there would land off screen (review round 2). ONE `uiTree()` read: a band → the same strategy pick, one tap, then up to two re-reads 300 ms apart
   to confirm (still up on the last → `AfterDismissalTap`, trace line `the soft keyboard was up after the fill; tapped …
   to hide it, still up`, which the engine logs as `⚠ fill` before the `✗`, and which an `optional:` skip quotes rather
   than "not present" — review round 1); the fill line then reads `fill: id:"login_password" = ***; keyboard hidden by
   tapping id:"login_title"`. No band — none
   on screen, the keyboard parked by the HID typing the fill just did (every `fill` parks it, the device check), or an
   idb tree — nothing is pressed or tapped, so under `treeSource: idb` the option is a no-op. A band with no usable
   strategy is a WARNING, not a throw: `⚠ fill: id:"login_password": the soft keyboard is up and was left up: no
   dismissal is configured — the next tap under it will be refused` (or the configured list with each entry's reason).
   The key set under `treeSource: idb` (the default) is inert — the idb tree carries no keyboard — and
   `flow/load.ts` says so on stderr once per file (`inertKeyboardDismissNote`); every bad entry is refused with a
   sentence naming the field and the rule (`each entry is { tap: <element spec> } or { accessory: true }`,
   `accessory takes only true`, the interactive-role rule). Decided against a
   refusal because the Android dismissal is best effort too (the witness's veto leaves a keyboard up silently and no
   read confirms the `back`), a `dismissKeyboard: true` written for Android must not fail the iOS leg when the next
   step is not even under the keyboard, and whatever the keyboard would harm — the next tap, a pixel assert — is
   guarded in its own place and refuses there with the full message; the warning makes that refusal no surprise. A
   dismissal that WAS tapped and did not hide the keyboard throws: the screen was touched.
5. **Tests** (87 new, 1473 total; 29 mutants of the rule killed on an rsync copy — the band skip, the keyboard-side skip,
   the confirming looks, the blind `enter`, the band and `ofKeyboard` halves of the accessory rule, the last-button choice,
   the engine's and the tools' plumbing, the android policy, the confirming re-read, the hide delay, the second look's
   tree, the oracle path's empty result, and after review round 1 the interactive filter, the off-screen and shadowing
   checks, the look and read counts, the engine's `⚠ fill` on a failed dismissal, the optional headline, the schema's
   interactive-role rule, the inert note, the first-mode note): `tests/interact/keyboard.test.ts` (the protocol on the synthetic login and on the real
   dumps — K1 with the title configured, swapped for K3 after the tap; the 2FA pad with `accessory`, a target constructed
   under the band since the real submit sits above it at 451, swapped for the parked dump; the return key never chosen;
   Android byte-identical; the in-tree `dismissKeyboard` rows), `tests/ui-tree/soft-keyboard.test.ts` and
   `tests/adapters/wda-source-keyboard.test.ts` (the accessory rule, synthetic and on the five dumps; the `toolbar`
   role), `tests/flow/config.test.ts` (accept/reject, the conversion), `tests/flow/load.test.ts` (the tool policy),
   `tests/flow/engine.test.ts` (the trace lines for `tap:` and `fill:`, the measured flow passing with the title tapped
   by the guard), `tests/mcp/tools.test.ts` (`tap`/`type_text` pass the config's list; android never reads it).

**Deferred (recorded, not built).**
- **An automatic neutral-point heuristic** (tap "somewhere harmless" without config): what is harmless is the app's, and
  a wrong guess is a tap on something; the config is one line.
- **A per-step `dismissKeyboard: { tap: <element> }`**: the per-app list covers every measured screen; a per-step form
  would be a second vocabulary for the same thing. Revisit if one app needs a different dismissal per screen that the
  ordered list cannot express.
- The stage A residuals stand (parked accessory toolbar, idb, iPad split/floating, landscape, the second app window).

**Device check expectations** (not yet run):
- The full finportal `login` flow with `keyboardDismiss: [{ tap: { id: login_title } }]` configured and the band raised
  AFTER the last fill (the pref toggle plus a focus change, as in the stage A check): the trace shows
  `⚠ tap: the soft keyboard covered id:"login_submit"; hidden by tapping id:"login_title" before tapping` then
  `tap: id:"login_submit"` and the flow ends on `twofactor_screen` (one real submit). With the keyboard parked by the
  fills, no `⚠` line and the flow passes as in the stage A check's K2.
- A 2FA accessory dismissal through the guard: `twofactor_code` focused with the pad up (`role:keyboard`
  `{0,518,402,356}`), `fill: { id: twofactor_code, value: "1", dismissKeyboard: true }` with `accessory: true` configured
  → the fill line ends `; keyboard hidden by tapping the accessory toolbar's "Done"`, and afterwards `0 matches for
  role:keyboard`; no code completed. For the guard itself a target under the pad is needed — on this screen the layout
  moves the buttons above it, so the check is the `dismissKeyboard` one unless a covered element is found.
- `treeSource: idb` with `dismissKeyboard: true` on the password fill: no `enter`, no submit, the fill line unchanged,
  the keyboard left as it was.
- Android K6 unchanged: `⚠ tap: the soft keyboard covered id:"login_submit"; hidden before tapping`, `back` pressed once,
  with `keyboardDismiss` configured in the same averi.yaml.

## Device check of the fix (stage B, 2026-10-07, `0036762`)

**15:12–15:24 CEST**, `0036762` built (`npm run build`), driven with the handoff's `run-tools.mts` on this repo's
`dist/` (server stderr captured). finportal only (`sk.finportal.myport`), iPhone 17 iOS 26.5 (`D34212DB-…`) and
emulator-5554. Scratch copies of finportal's `averi.yaml` (`.env.averi` symlinked, never printed), nothing in finportal
edited:
- `wdacfg`: `treeSource: wda` with `keyboardDismiss: [{ tap: { id: login_title } }, { tap: { id: twofactor_title } }, { accessory: true }]`;
- `accfg`: the same with `[{ accessory: true }]` only;
- `absentcfg`: `[{ tap: { id: does_not_exist } }]`;
- `nodcfg`: `treeSource: wda`, no list;
- `idbcfg`: the three-entry list with no `treeSource` (idb);
- `badcfg`: `[{ tap: { role: button } }, { accessory: false }]`.

They all also carry the helper flows `fill_creds`, `submit_only`, `tap_submit_only`, `back_only`, `fill_code_dismiss`
(`fill twofactor_code "1" dismissKeyboard: true`), `fill_code_empty_dismiss`, `fill_pw_dismiss` (`fill login_password
$password, clear, dismissKeyboard: true`), `fill_user_dismiss` (Android) and `tap_support_text`. Ids were checked with
`ui_snapshot` first: `login_title` and `twofactor_title` are both role `text` at `{36,291,330,24}`. **Real login submits:
2** (B2 and B3). No 2FA code was completed. At most one digit was typed.

Raising the keyboard used the stage A technique: toggle `AutomaticMinimizationEnabled` true → false, then a focus
change (username, then password). New observation: **right after a `fill`, the first toggle + focus change never raised
it** (3 of 3: S1, S13 and the idb run), **and a second toggle + focus change always did** (3 of 3). On 2FA, a tap on
`twofactor_title` did not blur the field while the pad was parked (the code tap then opened the edit menu). A tap on
the parked accessory `Done` (`{317,831}`) followed by toggle + code tap raised the pad.

- **B1, config load: PASS.** `wdacfg` loads. Unknown flow → the flow list. `badcfg` is refused with both per-field
  sentences:
  `app.ios.keyboardDismiss.0.tap: a keyboard dismissal must be a non-interactive element (a title, a label) — role: button/textfield/switch/checkbox/radiobutton/slider names a control the tap would press`
  / `app.ios.keyboardDismiss.1.accessory: accessory takes only true (the entry is opt-in; false reads like an override and would be none)`.
  `idbcfg` printed the inert note on stderr **once** over two loads in one server:
  `averi: …/idbcfg/averi.yaml: app.ios.keyboardDismiss is set but app.ios.treeSource is idb (the default): the idb tree carries no keyboard, so no tap is ever refused or hidden and the list is inert — set treeSource: wda for it to apply`.
- **B2, guard via the configured tap: PASS (submit #1).** Setup: `fresh_launch` → `fill_creds` → band `{0,539,402,335}`
  (Passwords bar), `login_submit` `{36,547,109,48}`, so the centre (91,571) is covered. MCP `tap id:login_submit` → `ok in 7.9s`:
  `Tapped id:login_submit (the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" before tapping)`.
  4 s later `twofactor_screen` was up.
  **Confirm looks:** the WDA xcodebuild log (one `FBCustomActions` burst per `/source`) shows **6 tree reads**: 225 /
  225 nodes (first look, settled), 225 / 225 (second look, 300 ms later: still covering), then the title tap, then
  162 / 162 (keyboard gone). So **the band was gone on the FIRST confirm look**, and the second
  `KEYBOARD_HIDE_CONFIRM_LOOKS` slot was not used. Each read took ~0.85 s with the band up, ~0.55 s without it, plus
  ~0.5 s between reads. That makes the 7.9 s mostly six reads.
  Note: the MCP note quotes the target unquoted (`id:login_submit`) and the dismissal quoted (`id:"login_title"`). The
  flow trace quotes both (B4b). Cosmetic.
- **B3, full `run_flow login` with the list configured: PASS, plain (submit #2).** `ok in 26.7s`, trace
  `… fill: id:"login_username" = *** (cleared) / fill: id:"login_password" = *** (cleared) / tap: id:"login_submit" /
  optional: skipped text:"Not Now" (not present) / wait: state post_login_fork / flow login: done` — **no `⚠` line**
  (the fills parked the keyboard, as in stage A's K2). Then `back_only` → login.
- **B4, 2FA number pad.** After B2 the pad was up: band `{0,518,402,356}`, `role:toolbar` `{0,518,402,48}` (id
  `Toolbar`), `Done` `{317,523,64,38}`. Back/Log in sit above it at y 451.
  - (a) `fill_code_dismiss` (`"1"`, `dismissKeyboard: true`) → `fill: id:"twofactor_code" = 1`, **no `; keyboard hidden
    …` suffix**: the idb HID typing parked the pad (`0 matches for role:keyboard`, `toolbar ×1` still in the tree, the
    parked `Done` drawn at y 831), so nothing was tapped. As designed.
  - (b) **A target under the pad does exist:** `twofactor_support_text` (the "If you have a problem logging into your
    account…" label, role `text`) moves to `{16,575,370,40}` with the pad up, so its centre (201,595) is under the
    band. **Accessory via the guard — PASS:** with `accfg`, MCP `tap id:twofactor_support_text` → `ok in 9.2s`,
    `Tapped id:twofactor_support_text (the soft keyboard covered id:twofactor_support_text; hidden by tapping the
    accessory toolbar's "Done" before tapping)`; then `0 matches for role:keyboard` and `twofactor_screen` back to h 874.
    WDA reads: 199/200/200/199 (two looks), then Done, then 150/138: **gone on the first confirm look** again.
    **Ordered list — PASS:** with `wdacfg` (whose first entry `login_title` is absent on 2FA), `run_flow tap_support_text`
    → `⚠ tap: the soft keyboard covered id:"twofactor_support_text"; hidden by tapping id:"twofactor_title" before
    tapping` / `tap: id:"twofactor_support_text"` / `flow tap_support_text: done` (9.6 s; first confirm look).
  - **Accessory via `dismissKeyboard` — NOT reachable.** Every fill that types parks the pad, so the post-fill read sees
    no band. A fill with `value: ""` (to focus without typing) failed: `Command failed (exit 1): idb ui text --udid …
    ('Request was not sent',)`. That is a new defect, filed as
    [2026-10-07-ios-fill-empty-value-fails-in-idb.md](2026-10-07-ios-fill-empty-value-fails-in-idb.md). The accessory
    strategy is shown through the guard only (above).
  - Then `back_only` → login, with the code not completed.
- **B5, no usable dismissal (`absentcfg`).**
  - (a) **PASS.** On 2FA with the pad up, both the MCP `tap id:twofactor_support_text` (4.6 s) and the flow (4.8 s) were
    refused with `… on two looks 300ms apart; this adapter cannot hide it (… and so was the input-accessory toolbar's Done
    — name them under app.ios.keyboardDismiss in averi.yaml …), and none of the configured dismissals is usable on this
    screen (tap id:"does_not_exist": not found). Nothing was tapped …`. The flow logged `⚠ tap: the soft keyboard covered
    id:"twofactor_support_text"; no dismissal, nothing sent` before the `✗`, and the band was unchanged afterwards. On login
    with band `{0,566,402,308}` over the filled form, `tap_submit_only` was refused the same way (5.2 s, `⚠ tap: the soft
    keyboard covered id:"login_submit"; no dismissal, nothing sent`, `(tap id:"does_not_exist": not found)`). No submit.
  - (b) **The `⚠ fill … was left up` line was not observed.** With the band up before it, `fill_pw_dismiss` → `fill:
    id:"login_password" = *** (cleared)`, no `⚠`, band `0 matches` afterwards: the fill's HID typing parked the keyboard
    before the post-fill read. So nothing was left up and no warning was due. **No key was pressed: still on
    `login_screen` 3 s later, `twofactor_screen` 0 matches.** (Before stage B this fill pressed `enter` and submitted,
    per K5d.)
- **B6, `dismissKeyboard` never presses enter: PASS.** `nodcfg`, band `{0,566,402,308}` up on the filled form →
  `fill_pw_dismiss` → `fill: id:"login_password" = *** (cleared)` (7.0 s), no `⚠` (keyboard parked by the typing).
  3 s later still on `login_screen`, with no 2FA. **Not submitted.** Under `idbcfg`, `fill_pw_dismiss` gave the same
  plain line (3.2 s), and `login_submit` was still there with the form unchanged in the screenshot. Not submitted, twice.
  Under idb the keyboard could not be raised first: the idb taps did not raise it after two toggles. That does not
  matter for this check, because the code reads no band there.
- **B7, Android regression (emulator-5554, `wdacfg` with the list): PASS.** `list_devices`: `emulator-5554` was the only
  Android device. `fresh_launch` → `tap id:login_username` (Gboard up, `mInputShown=true`, screenshot) →
  `tap_submit_only` with empty fields (submit disabled, no real submit), 11.4 s:
  `⚠ tap: the soft keyboard covered id:"login_submit"; hidden before tapping` / `tap: id:"login_submit"` / `flow
  tap_submit_only: done`. Then `mInputShown=false`, still on login. Focus again → `fill_user_dismiss` (`"averi"`,
  `dismissKeyboard: true`) → `fill: id:"login_username" = averi (cleared)`, then `mInputShown=false`, still on login (back
  pressed, no navigation). The fill line is as before stage B.

| scenario | result |
|---|---|
| B1 config load / bad config / idb inert note | **PASS** |
| B2 covered submit → `login_title` tapped → 2FA | **PASS** (7.9 s, gone on the 1st confirm look, submit #1) |
| B3 `run_flow login` with the list | **PASS**, plain, no `⚠` (submit #2) |
| B4a 2FA fill `"1"` + dismissKeyboard | nothing tapped (HID parked the pad), as designed |
| B4b accessory via the guard (`twofactor_support_text` under the pad) | **PASS** (9.2 s, 1st confirm look); ordered list picks `twofactor_title` **PASS** |
| B4 accessory via dismissKeyboard | not reachable (fill parks; `value: ""` hits an idb error, new note) |
| B5a absent-only list → refused with the reason | **PASS** (2FA and login) |
| B5b `⚠ fill … left up` | not observed: the typing parks the keyboard; no key pressed, no submit |
| B6 no enter (wda, no list; idb) | **PASS**: no submit in either |
| B7 Android | **PASS**: unchanged `hidden before tapping`, back on fill |

Prefs: `com.apple.keyboard.preferences` dumped before and after. `AutomaticMinimizationEnabled` was `1` before and set
back to `1`, and the dumps are identical. (averi itself re-enables `com.apple.Accessibility AutomationEnabled` /
`ApplicationAccessibilityEnabled` before each launch, simulator-wide and not restored, by design and as stated on its
stderr.) Afterwards ports 8100–8110 and 8199 were quiet, with no xcodebuild, WebDriverAgent or server of this run left. The
only averi server alive was another session's (pid 84616, cwd finportal), and it was not touched.
