# BUG: on iOS 27 an idb read in the first ~2 s after `launch_app` returns SpringBoard's launch tree (status bar + app icon), which is not "bare" — an absence passes, and `ensure_state` runs a DESTRUCTIVE rung with no second look

> **Status (2026-10-08):** fixed on branch `fix/p0-launch-tree`; unmeasured on a device: `isBareTree` (src/ui-tree/bare-tree.ts) recognizes a status bar — a `text` whose whole label is a time, wholly inside the top 8 % of the screen, with a labelled or valued `container`/`other` status item beside it — skips every node wholly above the clock's bottom plus 1 % of the screen, and calls a lone `button` beside such a status bar the launch icon, so both measured shapes (7 and 6 nodes) are bare and the existing guards apply — `unknown` verdicts, the bare ⚠, the second look, the destructive refusal (tests/ui-tree/bare-tree.test.ts, tests/flow/bare-tree-ladder.test.ts, built from the trees below). The bare wording merge task is done (on `fix/keyboard-aware-scroll`): `ui_snapshot`'s note, the ladder's and `bareTimeoutNote`'s now say the tree holds "nothing of the app's (only wrappers, unlabeled decoration, or iOS's status bar and launch icon)". Inferred misses, read as before the fix (not bare): the home screen before the zoom (status bar + several icons); an extra SpringBoard node beside the icon (a Dock `other`); a status bar whose clock has no digits to read (a call or recording pill) or reads otherwise ("18 h 29"); status items with no label or value, or typed as a mapped role, on an early frame; iPhone landscape (no status bar, the icon alone); and the entry probe is a single read, so a read that misses is a destructive rung run at once. Follow-up ideas (to measure): ask idb which app is frontmost, or tell SpringBoard's Application (labelled ' ') from the app's (its display name). To check on the device: the repro's four steps on iOS 27 — the early `ui_snapshot` carries the bare ⚠, the absent assert fails as "could not verify" until the PIN screen renders, `ensure_state pin_seen` answers "already active" after a `⚠ detect … bare` line with no rung run. Triaged P0 (an `absent:` passed and `ensure_state` could run a DESTRUCTIVE rung on SpringBoard's launch tree).

**Measured 2026-10-08 16:28–16:42 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`, iOS tree source
default `idb`; the ladder probe used a scratch config, below), iPhone 17 simulator **iOS 27.0**
(`37956039-94EA-4F51-93E5-94F7723A4578`), app `com.finshape.dbosbanking` (registered install, cold launch lands on the
PIN screen), averi = mobile-verify @ `c35388a` built from source (`dist/`, `node dist/mcp/server.js` over stdio).

Related, fixed: [2026-10-06-ui-snapshot-empty-right-after-launch.md](2026-10-06-ui-snapshot-empty-right-after-launch.md)
(the iOS 26.5 shape: a 0×0 `Application`, now `IdbEmptyTreeError` + one re-read). On iOS 27.0 the first reads are a
different shape that neither that error nor `isBareTree` catches.

## Observed (measured)

### 1. What idb returns right after `launch_app`

`terminate_app` → `launch_app` (0.8 s) → `ui_snapshot { platform: ios }` 0.3 s later (16:29:08 UTC), full tree:

```
container None None None {x:0, y:0, w:0, h:0}
 other ' ' None None {x:0, y:0, w:402, h:874}
 text '18:29' None None {x:50, y:22, w:48, h:22}
 other 'Cellular' None value='No signal' {x:285, y:25, w:20, h:14}
 other None id='3 of 3 Wi-Fi bars' value='SSID, 3 of 3 Wi-Fi bars' {x:314, y:26, w:18, h:13}
 other '100 % battery power' None value='Not charging' {x:341, y:25, w:29, h:14}
 button 'Skeleton Internal' id='Skeleton Internal' {x:-2, y:234, w:406, h:406}
```

That is SpringBoard's status bar plus the app's icon zooming in (the app's display name is "Skeleton Internal"). The
screenshot taken right after shows the app's own launch screen (a grey world map, no text, no controls). No `⚠`, no
error: the tree is presented as a rendered screen.

A launch-to-render timeline (each line one `ui_snapshot { filter: 'text:"Enter your PIN to log in"' }`, seconds since
the `launch_app` call):

```
1.2s 0 matches for text:"Enter your PIN to log in" in a tree of 7 nodes (roles: other ×4, button ×1, container ×1, text ×1)
1.5s 0 matches … in a tree of 6 nodes (roles: other ×4, container ×1, text ×1)
1.8s 0 matches … in a tree of 6 nodes (roles: other ×4, container ×1, text ×1)
2.1s 0 matches … in a tree of 6 nodes (roles: other ×4, container ×1, text ×1)
3.0s ⚠ 0 matches for text:"Enter your PIN to log in", and the tree is bare: 2 nodes, none readable or interactive …
3.4s [ { "role": "text", "label": "Enter your PIN to log in", … } ]
```

So for ~2 s the answer is "0 matches in a tree of N nodes", which troubleshooting.md reads as "the tree has content and
none of it matches"; only the read at 3.0 s gets the bare-tree ⚠. Reproduced on 4 cold launches (#11, #14, #19, the
timeline), every time.

### 2. An absent assert passes on a screen that is about to show the element

```
16:28:57.647  launch_app → Launched com.finshape.dbosbanking on ios   (0.8 s)
16:28:58.456  assert [{ element: { text: "Enter your PIN to log in" }, absent: true, timeout: 1 }]
→ All 1 asserts passed
  PASS  element text:"Enter your PIN to log in" is absent
  appAlive: true                                                        (0.7 s)
```

The PIN screen rendered ~2 s later (`assert … exists` passed). (`timeout: 1` is ms — my slip; the verdict came from the
first read either way.)

Same through a flow — scratch config `states.no_pin_screen.detect: { element: { text: "Enter your PIN to log in" },
absent: true }`, flow `[launch: { clearState: false }, wait: { state: no_pin_screen, timeout: 2s }]`, after a
`terminate_app`:

```
flow wait_absent_launch: start
launch: com.finshape.dbosbanking
wait: state no_pin_screen
flow wait_absent_launch: done          (1.2 s; 3 of 3 runs, 16:41:04–16:41:30 UTC)
```

skill/references/averi-yaml.md:45 promises the opposite: "A bare tree (a cold launch's decor or splash) decides no
condition. An `absent:` check there is not satisfied … It is therefore safe to call `ensure_state` right after
`launch_app`."

### 3. `ensure_state` runs a destructive rung at once on a registered app that is already in the state

Scratch config (nothing in mp-native edited; the rung is harmless by construction):

```yaml
states:
  pin_seen:
    detect: { element: { text: "Enter your PIN to log in" } }
    reach: [fake_destructive_rung]
flows:
  fake_destructive_rung:
    destructive: true
    steps:
      - wait: { element: { text: "zzz-never" }, timeout: 1s }
```

`terminate_app` → `launch_app` → `ensure_state { state: pin_seen }` (16:41:34 UTC):

```
⚠ reach fake_destructive_rung: this rung is DESTRUCTIVE — it wipes app state, and any device registration with it. …
flow fake_destructive_rung: start
✗ wait text:"zzz-never": failed — Timed out after 1000ms waiting for element text:"zzz-never"
⚠ reach fake_destructive_rung: failed — Timed out after 1000ms waiting for element text:"zzz-never"
state pin_seen: reached after fake_destructive_rung
```

Reproduced at 16:41:45 (same first two lines). An `ensure_state` on the rendered screen 1.8 s later answered `state
pin_seen: already active`. There was no `⚠ detect … (second look …)` and no `⛔ refused`: the second look and the
destructive-rung refusal never engaged. Had the rung been a real `launch: { clearState: true }`, this is the
2026-08-12 / 2026-09-11 registration loss in mp-native's `averi.yaml` comments, on an app that was already in state.

## Why (read from the source)

- `src/ui-tree/bare-tree.ts:103–111` `isBareTree`: any node whose role is not `container`/`other` counts as content
  (`return true` at :110), "even unlabeled". The status-bar clock is `text '18:29'`, and the zooming icon is a labelled
  `button`, so the launch tree is NOT bare. The labelled status-bar `other`s (`Cellular`, battery) would count too
  (:109, they are far smaller than the 402×874 wrapper).
- `src/ui-tree/verdict.ts:59–73`: `presenceVerdict` / `absenceVerdict` return `'no'` / `'yes'` on a non-bare tree, so
  the absent assert, the `absent:` detect and the presence detect all decide on SpringBoard's tree.
- `src/flow/engine.ts:625`: the second look (and the destructive refusal at :635) runs only when the probe answered
  `bare` or learned nothing; a `no` on this tree goes straight to the rung.
- `src/adapters/ios-tree-source.ts:242`: `IdbEmptyTreeError` fires only when no child has area — not this shape. The
  `ui_snapshot` re-read (`src/adapters/ios.ts:113–125`) is likewise keyed on that error only.
- Nothing in the iOS path checks that the tree belongs to the app being driven: the status bar and the icon carry no
  bundle id in idb's flat list, and averi does not ask which app is frontmost.

## Why it matters

- The registration guard every mp-native doc prescribes ("look at the device first", "PIN = registered") is a
  `ui_snapshot`/`assert` right after `launch_app`; for ~2 s on iOS 27 it reads "0 matches in a tree of 7 nodes" for
  both the PIN text and the Welcome text — indistinguishable from a real screen that has neither.
- `absent:` conditions pass early, and `ensure_state` right after a launch can take a destructive rung on a registered
  app — the exact case the second look (2026-10-06/07) exists to prevent, and which averi-yaml.md:45 says is safe.

## Possible fix directions (owner's choice)

- Treat iOS status-bar nodes as decoration in `isBareTree` (on idb they sit at the top inset with no identifier other
  than SpringBoard's; or: discard any node whose rect lies entirely within the status-bar band), and a lone
  `button` whose label equals the app's display name / bundle as the launch icon — then this tree is bare and every
  existing guard (bare ⚠, `unknown` verdicts, second look, refusal) applies.
- Or ask idb/simctl which app is frontmost (the "foreground" field suggested in the 2026-10-06 report) and call a tree
  that is SpringBoard's "not the app yet" for every reader.
- At minimum, have `launch_app` wait until a read is neither empty nor SpringBoard-only (bounded), so the next tool sees
  the app.

## Repro

1. iOS 27 simulator, any app with a launch screen, default `treeSource` (idb).
2. `terminate_app`, `launch_app`, then immediately `ui_snapshot` (no filter) → status bar + one `button` named after the
   app, no ⚠.
3. `terminate_app`, `launch_app`, `assert [{ element: { text: "<text on the first screen>" }, absent: true }]` → PASS.
4. With the scratch config above: `terminate_app`, `launch_app`, `ensure_state pin_seen` → `⚠ reach
   fake_destructive_rung: this rung is DESTRUCTIVE` and the rung runs, no second look.


## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:06–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
(`feature/swift-payment`), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). **Confirmed fixed** (all four repro steps, default idb):

- `terminate_app` → `launch_app` → `ui_snapshot` (no filter), 6 cold launches: both measured shapes now carry the bare ⚠ —
  `⚠ The tree is bare: 6 nodes, nothing of the app's (only wrappers, unlabeled decoration, or iOS's status bar and launch
  icon). …` (status bar only) and `… bare: 7 nodes …` (status bar + `button 'Skeleton Internal'` at -2,234 406x406).
- `assert [{ element: { text: "Enter your PIN to log in" }, absent: true, timeout: T }]` right after the launch:
  T=500 → `FAIL … is absent — could not verify within 0.5 s (the last UI tree read was bare, 6 nodes …)`; T=1500 → the
  same, `bare, 2 nodes`; T=6000 → `FAIL … is absent — still visible after 6 s` (the PIN screen rendered). No false PASS.
- Scratch flow `[launch: { clearState: false }, wait: { state: no_pin_screen (absent), timeout: 2s }]`, 2 runs →
  `Timed out after 2000ms waiting for state no_pin_screen (the last UI tree read was bare, 2 nodes …)` (was: `done`).
- `ensure_state pin_seen` (scratch config, reach = a fake DESTRUCTIVE rung that only waits for `zzz-never`) right after
  `launch_app`, 3 of 3: `⚠ detect: element text:"Enter your PIN to log in" treated as not detected — every UI tree read was
  bare, the last one 7 nodes (roles: other ×4, button ×1, container ×1, text ×1) …` then `state pin_seen: already
  active` (4.3 s). The rung never ran; no DESTRUCTIVE line.
- Regression watch: loaded screens full of times/dates/amounts were not called bare — the dashboard (account header,
  `17.07.2026` date headers, `+602,00 EUR` rows), the Transactions tab and a transaction detail (`Booking date,
  17.07.2026`) all returned their trees with no ⚠. (With the app up, idb lists no status-bar nodes at all.)
- Not measured: landscape (no Simulator.app window to rotate — the simulator runs headless here).

## Device check (2026-10-09 iOS, re-run at 610660f)

Measured 05:22–05:46 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`). **The mp-native SWIFT form was
not reachable this session**: the bank app was still logged in on the device, but every Hive read came back
`SUBGRAPH_RESPONSE_BODY_EMPTY` from `gds-business` (app log, 07:22–07:45 local — the no-session signature named in mp-native's
`scripts/hive-probe.mjs`), so the SWIFT form, the own-transfer form, the dashboard list and the Transactions tab all rendered
"That's an error"; logging in again was not permitted to this session. Fixtures instead: the bank app's account-detail screen
(search field + error state), the stock Contacts "New Contact" sheet (UIKit form, ~4 pages) and Settings (SwiftUI list).
Software keyboard raised by toggling `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen`
to false and switching apps (`launch_app` bank → `launch_app` Contacts) — a toggle plus focus change alone did not raise it
after a `fill` this time; both prefs restored to 1 at the end. Strokes recorded with an `idb` PATH shim logging every `idb ui
swipe|tap|text` the server sent.

**Not re-measured.** The P0 repro needs `terminate_app` + `launch_app` on the registered bank app, which lands on PIN login;
this session was not permitted to log in again, so the app was never terminated (it kept pid 78966 throughout). `launch_app`
of the running app (bringing it back from Contacts/Settings) cannot reach the SpringBoard launch tree.

Neighbouring finding from those app switches, filed separately because the tree is NOT bare: for ~1 s after `launch_app`
brings a backgrounded app to the front, idb returns the PREVIOUS app's full tree, and an `absent:` assert passes on it
(3 of 3) — [2026-10-09-ios-launch-app-reads-previous-apps-tree.md](2026-10-09-ios-launch-app-reads-previous-apps-tree.md).

## Device check (2026-10-09 iOS bank form, re-run at 610660f)

Measured 05:56–06:08 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native SWIFT
form (`feature/swift-payment`, logged in by the owner-authorised PIN-only `login_pin_ios_here` after a cold relaunch; data
loaded), averi = mobile-verify `fix/keyboard-aware-scroll` `dist/` built at `610660f` (the branch head has since moved to
`57dd6ac`; `dist/` predates those commits — no `fill-verdict.js` in it), stdio, cwd `/Users/mholecy/Finshape/mp-native`.
Scratch configs only (`treeSource: wda` + `keyboardDismiss: [tap: { id: swift_payment.form.title }]`; mp-native's `averi.yaml`
untouched). Decimal pad raised the round-1 way: `com.apple.keyboard.preferences` `AutomaticMinimizationEnabled` /
`HardwareKeyboardLastSeen` set to NO before a cold relaunch, then a focus TAP (not a fill) on
`id:swift_payment.form.amount_input` → WDA `role:keyboard` `0 572 402 302`; prefs restored to 1 at the end. Strokes and taps
recorded with an `idb` PATH shim.

**Holds again** (default idb, 6 cold relaunches of the registered app, which then lands on PIN login):

- `terminate_app` → `launch_app` → `ui_snapshot` at once, 3 of 3 (05:57:07–05:57:10): `⚠ The tree is bare: 6 nodes …` (status bar
  only, clock `07:57`) once, `… bare: 7 nodes …` (status bar + `button 'Skeleton Internal'`) twice.
- `assert [{ element: { text: "Enter your PIN to log in" }, absent: true, timeout: T }]` right after `launch_app`: T=500 →
  `FAIL … could not verify within 0.5 s (the last UI tree read was bare, 6 nodes …)`; T=1500 → same, `bare, 2 nodes`; T=6000 →
  `FAIL … is absent — still visible after 6 s`. No false PASS.
- Then `assert` PIN present + `Welcome` absent → PASS, and `login_pin_ios_here` (no `requires:`) logged in (7.8 s); tab bar present.
- The previous-app variant ([2026-10-09-ios-launch-app-reads-previous-apps-tree.md](2026-10-09-ios-launch-app-reads-previous-apps-tree.md))
  did not occur: no app switch was made this session (every launch was cold, after a terminate).
- Side note: the first `screenshot` on the PIN screen (05:56:4x) returned `⚠ frame: the screen did not settle: 6 captures, each
  different from the last …`; the screen looked static (PIN keypad).

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default `treeSource: idb`,
`idb` PATH shim logging every `idb ui tap|swipe|text|key-sequence`. Run folder: `scratchpad/averi-repo/run5-ios`.

**Holds — cold launch, foreground wait and bare-tree rules together, no double warning.** Contacts in front; bank app
terminated (`xcrun simctl terminate`), then:

```
11:36:52 launch_app { platform: ios, appId: com.finshape.dbosbanking }                                      (3.5 s)
→ Launched com.finshape.dbosbanking on ios                    (no ⚠ line: the foreground wait matched "Skeleton Internal")
11:36:56 ui_snapshot { platform: ios }                                                                      (0.4 s)
→ 21 nodes, no ⚠: other 'Skeleton Internal' 0 0 402 874, button 'Password login', 'Log in', 'Enter your PIN to log in',
  4 × pinDotEmpty, keys 1–0, 'delete 1', 'Forgot PIN?'
```

Screenshot `run5-ios/img-82-0.png`: the PIN screen, rendered. The 3.5 s is the foreground wait reading through the launch
(SpringBoard / the previous app) until the bank's label appeared; nothing reached the bare-tree ⚠, and the wait's own note was
not printed, so the two did not double up. Other cold launches in the run: Contacts 11:28:50 (3.4 s), 11:29:33 (3.2 s),
11:32:28 (3.5 s), all without ⚠, first reads Contacts'. The PIN login then ran (`login_pin_ios_here`, 7.7 s, `branch: matched
state logged_in`).

## Device check (2026-10-09 iOS, re-run at dd50327)

Measured 2026-10-09 15:35–16:02 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47833, cwd mp-native, server restarted 15:52:36
for the launch-note items), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim.

**Holds; the launch reply is one line (C1).** `terminate_app com.finshape.dbosbanking` + `launch_app` (15:36:19, 3.9 s) →
`Launched com.finshape.dbosbanking on ios` (one line), and a `ui_snapshot` sent right after it (0.3 s) already read the PIN screen
(`other 'Skeleton Internal'`, `button 'Password login'`, `text 'Log in'`, the keypad — 21 nodes), never SpringBoard's launch tree;
again at 15:42:09 (2.8 s, PIN screen). Every other `launch_app` of the run (Contacts, Settings, bank) answered one line, with no
wipe line (no `clearState` was ever sent).

## Device check (2026-10-09 iOS, re-run at 2f98900)

Measured 2026-10-09 18:09–18:45 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native), mp-native's `averi.yaml`
untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim. Comparisons with `dd50327` ran on a scratch worktree
build of that hash on the same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags.

**Holds; the launch reply is one line (C1).** `terminate_app com.finshape.dbosbanking` + `launch_app` (18:11:3x, 3.9 s; and 18:32:2x, 3.1 s)
→ `Launched com.finshape.dbosbanking on ios` (one line), and a `ui_snapshot` sent right after it (0.4–0.5 s) read the PIN screen
(`other 'Skeleton Internal'`, `button 'Password login'`, `text 'Log in'`, `Enter your PIN to log in`, the keypad), never `[]` nor
SpringBoard's launch tree. No `launch_app` of the run carried a wipe line (no `clearState` sent).

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**Holds.** See the 5e5a3d1 section of `2026-10-09-ios-launch-app-reads-previous-apps-tree.md`: every launch (bank ×9, Contacts ×6,
Settings ×1) returned one line and a populated tree; no `⚠`, no empty `Application`. No launch code changed between `2f98900` and `5e5a3d1`.
