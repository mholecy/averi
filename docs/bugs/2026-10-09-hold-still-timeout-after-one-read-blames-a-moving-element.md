# BUG: the first WDA tap after WebDriverAgent starts times out "never at the same position in two consecutive reads" — after one read of a static element

**Measured 2026-10-09 20:56–20:59 UTC**, iPhone 17 simulator iOS 27.0, `treeSource: wda`, averi `5e5a3d1` (and `2f98900`).

## Observed

Each time WDA had to start (4/4: 20:56:22, 20:58:13 on 2f98900, 20:58:54, 20:59:40 after `pkill -f WebDriverAgentRunner`):

```
tap { selector: "id:swift_payment.form.title", configPath: cfg-swift-wda }                                      (5.3 s)
→ [isError] Timed out after 5000ms waiting for element id:swift_payment.form.title to hold still (found, but never at the same position in two consecutive reads)
```

The title never moves: four `ui_snapshot`s right after a WDA start (the first 5.4 s, then 1.3–1.4 s each) read `135,73 131x22` every
time, and the same tap a moment later → `Tapped` (`201 84`). Round 6 recorded it as a one-off (`row_swift`, 18:11:5x).

## Why (read from the source)

`resolveSettled` (`src/interact/resolve.ts:243–280`) polls inside the 5 s settle budget; WDA's start-up (≈4–5 s) is spent inside the
first read, so the budget ends after ONE successful read: `sighted` is true, `lastRect` set, no second read to compare. The message
(l. 270–276) then states two reads disagreed.

## Why it matters

The text sends the caller after an animation that does not exist; in a flow, an `optional:` tap is SKIPPED on exactly this text (the
"never held still" exception), so an interstitial can be silently passed over on the first WDA call of a run.

## Suggested fix

Start the settle budget after the first successful read (or after the backend is up), and say "found once, no second read within the
budget" when only one read happened.

## Repro

`pkill -f WebDriverAgentRunner`; a WDA config; `tap` any static element → the timeout; tap again → `Tapped`.

## Device check (2026-10-10 iOS, re-run at 35d5997)

Measured 2026-10-10 06:16–06:40 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-7` @ `35d5997` (`dist/`, stdio via the HTTP daemon on port 47863, cwd mp-native), mp-native's
`averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-*` in `run10-ios`), `idb` PATH shim logging every
`idb ui tap|swipe|text|key`. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run10-ios/manual.log`).

**D2 — Holds, 3/3.** `pkill` WebDriverAgentRunner + its xcodebuild, then the first WDA call of each cold start, `tap id:nav.tab_home`
(`cfg-swift-wda`) → `Tapped id:nav.tab_home` at 06:18:45, 06:18:55, 06:19:06 (8.3–8.4 s each). At 5e5a3d1 the same first tap timed
out "never at the same position in two consecutive reads" 4/4. No "found once …" timeout was needed.

## Device check (2026-10-12 iOS, re-run at 0ff6df3)

Measured 2026-10-12 09:50–10:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt; booted
headless after the Mac's reboot, the only booted simulator), averi = mobile-verify `fix/round-8` @ `0ff6df3` (`dist/`, stdio via the HTTP
daemon on port 47873, cwd mp-native), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch config `cfg-wda.yaml`
(`treeSource: wda`, otherwise a copy) in `run11-ios`, `idb` PATH shim logging every `idb ui tap|swipe|text|key`. Positions set by hand
with slow `idb ui swipe … --duration 2.5` drags (`run11-ios/manual.log`). The software keyboard was raised by setting the simulator's
`com.apple.keyboard.preferences` `AutomaticMinimizationEnabled`/`HardwareKeyboardLastSeen` to false and relaunching the app; both restored
to 1 at the end. mp-native logged in twice by the owner-approved `login_pin_ios_here` (09:50, 10:19), never the `login` rung.

**D2 — Holds, 3/3 (plus 1).** WDA killed before each call (`xcodebuild test-without-building` stopped, port 8100 closed), then the first
call of a cold WDA: `tap id:swift_payment.form.title` → `Tapped` at 10:00:59 (8.1 s), 10:01:16 (7.2 s), 10:01:27 (7.3 s). The session's
very first WDA call (C1.2, a refusal) also resolved without a timeout.
