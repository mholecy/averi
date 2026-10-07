# Device check: the top-4 architecture refactors (2026-10-07)

**Measured 2026-10-07 23:25–23:36 CEST (21:25–21:36 UTC)**, averi `dist/` built from `45fd47e` (branch
`architecture/top4-2026-10-07`; commits `7f423bf` C1 adb argv, `f30fdd0` C2 start detection, `9a3e691` C4 flow
engine, `45fd47e` C3 parity window width). Driven through the handoff's stdio MCP driver `run-tools.mts`
(docs/plans/2026-10-05-device-verification-handoff.md §2, plus `sleep` / `sh` pseudo-steps for device-side
evidence), server cwd `/Users/mholecy/dev/finportal/app` (its `averi.yaml` and `.env.averi`, unmodified).
Devices: `emulator-5554` (sdk_gphone64_arm64, Android 13, 1080x2220 @ 440 dpi) and `iPhone 17`
(`D34212DB-…`, iOS 26.5, `treeSource: wda`). finportal `sk.finportal.myport` debug build, Metro up on 8081.
No login was submitted; no `login` / `ensure_state logged_in` was run. Durations are the tool call's own
(driver `--- ok in Ns`).

Device-side evidence for C1: `myport://` is finportal's VIEW scheme (`dumpsys package`). Each deep link was sent
right after `terminate_app`, so it cold-started the task and `dumpsys activity activities` shows the task's root
intent with its FULL data (logcat's `START u0 {… dat=myport://probe/...}` truncates the data on API 33 and cannot
prove it).

## C1 — `7f423bf` one owner for the `adb shell` argv

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 1a | `open_deep_link myport://probe/amp?a=1&b=2` | full url on device | 0.2 s | `Opened …`; dumpsys `Intent { act=android.intent.action.VIEW dat=myport://probe/amp?a=1&b=2 flg=0x10000000 cmp=sk.finportal.myport/.MainActivity }` | PASS |
| 1b | encoded space `myport://probe/sp%20enc?q=a%20b` | full url | 0.2 s | `dat=myport://probe/sp%20enc?q=a%20b` | PASS |
| 1c | raw space `myport://probe/sp raw?q=a b` | full url | 0.2 s | `dat=myport://probe/sp raw?q=a b` | PASS |
| 1d | quote `myport://probe/quote?n=it's` | full url | 0.2 s | `dat=myport://probe/quote?n=it's` | PASS |
| 1e | `myport://probe/dollar?h=$HOME&u=${USER}&b=`` `id` `` | nothing expanded | 0.2 s | `dat=myport://probe/dollar?h=$HOME&u=${USER}&b=`id`` | PASS |
| 2a | injection `myport://probe/inj?x=1;touch /data/local/tmp/averi_probe` | delivered literally, nothing run | 0.2 s | `dat=myport://probe/inj?x=1;touch /data/local/tmp/averi_probe`; `ls: /data/local/tmp/averi_probe: No such file or directory` | PASS |
| 2b | injection `myport://probe/inj2?x=$(touch /data/local/tmp/averi_probe2)` | delivered literally, nothing run | 0.2 s | `dat=myport://probe/inj2?x=$(touch /data/local/tmp/averi_probe2)`; `ls: /data/local/tmp/averi_probe2: No such file or directory`; `/data/local/tmp` holds only `.studio`, `dalvik-cache`, `perfd` | PASS |
| 3 | `type_text id:login_username` `a b&c;d'e"f\g$h`, `clear: true`, read back with `ui_snapshot` | every character landed, in order | 12.1 s | `Filled id:login_username (15 characters, cleared first)`; read back `"value": "a b&c;d'e\"f\\g$h"` (JSON-escaped; the field holds exactly `a b&c;d'e"f\g$h`) | PASS |
| 4a | `type_text` (no selector) `"x\ny"` | refused, nothing sent | 0.1 s | `typeText cannot type "\n" on Android: \`input text\` may turn it into a key event (a newline into ENTER, which submits the form mid-fill). Type the text without it and send the key deliberately — pressKey('enter') (the \`press_key\` tool, \`key: enter\`); there is no tab key.` | PASS |
| 4b | `type_text id:login_username` `"tab\there"` | refused; field unchanged (read back still `a b&c;d'e"f\g$h`) | 6.6 s | same sentence with `"\t"`. The 6.6 s is the fill's focus tap: with a selector the field is resolved and tapped BEFORE typeText refuses — no character is typed, but the refusal is not "before anything is sent" (see Observations) | PASS (no text sent) |
| — | cleanup: `type_text id:login_username ""` `clear: true` | field emptied | 10.5 s | `Filled id:login_username (0 characters, cleared first)`; read back `"value": null` | done |
| 5 | regression: `terminate_app` ×9, `launch_app` ×4, `ui_snapshot` (exec-out uiautomator dump) ×8, `screenshot` (exec-out screencap), `tap id:login_forgot`, `press_key back` ×3 / `home` | all ok; tap opened the forgot modal (`forgot_overlay`, `forgot_modal` … in the tree), back closed it | 0.1–6.1 s | `Tapped id:login_forgot`; `Pressed back`; screenshot a valid 1080x2220 png | PASS |

## C2 — `f30fdd0` one owner for "did the device start anything"

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 6 | `open_deep_link nosuch://nothing` (Android) | isError | 0.2 s | `Android opened nothing for nosuch://nothing — either no installed app has an activity whose intent filter matches it (…), or the one that does refused it (not exported / permission — am's message below says which). Check the url, and that the app meant to handle it is installed. am start said: Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=nosuch://nothing/... flg=0x10000000 }` | PASS |
| 7a | `open_deep_link myport://home` (+ the seven `myport://probe/…` links of C1) | `Opened …`, no false refusal | 0.2 s | `Opened myport://home on android`; logcat `START u0 {… dat=myport://home/... cmp=sk.finportal.myport/.MainActivity}` | PASS |
| 7b | url two apps handle: `tel:123` (VIEW resolves to `com.google.android.contacts` AND `com.google.android.dialer`) | started | 0.3 s | `Opened tel:123 on android`; logcat `START u0 {act=android.intent.action.VIEW dat=tel:xxx … cmp=com.google.android.dialer/…MainActivity}`. No chooser appeared: the dialer is the preferred handler on this image, so the chooser branch itself (ResolverActivity) was not exercised; no https link has two handlers here (Chrome only) | PASS (chooser not reachable) |
| 8 | `launch_app sk.finportal.myport` (no activity → `app.android.activity` `.MainActivity`, `am start -n`) | ok, wording as before | 0.1–0.2 s | `Launched sk.finportal.myport/.MainActivity on android` | PASS |
| 9a | monkey path, bogus package: `launch_app com.nosuch.pkg` (not finportal's package, so averi.yaml's activity is not consulted) | isError with monkey's reason | 0.3 s | `monkey started nothing in com.nosuch.pkg — check that com.nosuch.pkg is installed and has a launcher activity, or name the activity to start: \`activity:\` on the launch step / launch_app, or app.android.activity in averi.yaml — or monkey itself could not run; its line says which. monkey said: ** No activities found to run, monkey aborted.` | PASS |
| 9b | monkey path, real package with no launcher: `launch_app com.android.providers.contacts` | isError, same reason | 0.2 s | `… monkey said: ** No activities found to run, monkey aborted.` | PASS |
| 9c | monkey path, success: `launch_app com.android.settings` | started | 0.9 s | `Launched com.android.settings on android` | PASS |
| 10a | iOS `terminate_app` → `launch_app sk.finportal.myport` | ok | 0.9 s | `Launched sk.finportal.myport on ios` (stderr: the usual accessibility-defaults line) | PASS |
| 10b | iOS `open_deep_link myport://probe/amp?a=1&b=2` | ok | 0.8 s | `Opened myport://probe/amp?a=1&b=2 on ios` | PASS |
| 10c | iOS `open_deep_link nosuch://nothing` (unchanged path, for the record) | isError | 0.8 s | `Command failed (exit 115): xcrun simctl openurl … nosuch://nothing … LSApplicationWorkspaceErrorDomain error 115` | PASS (unchanged) |

## C4 — `9a3e691` one tool call is one engine run

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 11a | `verify` both platforms, `state: logged_out`, `flow: close_forgot` (its `tap id:forgot_close` cannot be found on the login screen), `environment: stage` | not isError; each leg FAILED with the state's line first and ONE environment line | 8.3 s | per leg (android and ios identical): `FAILED: Timed out after 5000ms waiting for element id:"forgot_close" (visible and settled)` / `Steps that ran before the failure:` / `environment stage: overrides: username, password` / `state logged_out: already active` / `flow close_forgot: start` / `✗ tap id:"forgot_close": failed — …` | PASS |
| 11b | `verify` android, `state: logged_out`, no environment, `flow: close_forgot` | same shape, no environment line (none is active) | 8.6 s | `state logged_out: already active` / `flow close_forgot: start` / `✗ tap id:"forgot_close": …` | PASS |
| 11c | `verify` android, `state: logged_out`, `flow: nosuch_flow` | FAILED with the state's line | 2.7 s | `FAILED: Unknown flow "nosuch_flow" — known: open_app, fresh_launch, login, switch_to_sk, open_forgot, close_forgot, smoke` / `Steps that ran before the failure:` / `state logged_out: already active` | PASS |
| 12a | one server: `run_flow open_forgot` → `ensure_state logged_out` (wipes) → `run_flow fresh_launch` → `run_flow smoke` | count increments across tools | 14.5 / 14.1 / 25.9 s | `⚠ clearState: … is gone (1 this session)`, then `(2 this session)`, then `(3 this session)` | PASS |
| 12b | NEW server: `run_flow fresh_launch` | restarts at 1 | 13.8 s | `(1 this session)` | PASS |
| 12c | another server: iOS `run_flow smoke`, then Android `run_flow open_forgot` → `verify` android `state: logged_out` (wipes) | `verify` shares the count, across platforms too | 6.7 / 12.8 s | iOS `(1 this session)`; verify's leg `environment stage: overrides: username, password` / `⚠ reach fresh_launch: this rung is DESTRUCTIVE …` / `(2 this session)` / `state logged_out: reached after fresh_launch` | PASS |
| 13 | `ensure_state` android and `verify` (both) with `environment: "nope"` | isError, no device work, no `## android` section | 0.0 s each | `Unknown environment "nope" (from requested) — known: stage, edu` | PASS |
| 14 | regression: `smoke` (checked first: `launch {clearState: true}`, wait, 4 asserts; no login) and `ensure_state logged_out`, both platforms | ok | android smoke 25.9 s, iOS smoke 6.7 s; `logged_out` 2.6 s (android, already active) / 2.3 s (iOS) / 14.5 s (android, wiping) | 4 × `assert PASS` per platform, no `⚠ frame:` line; `state logged_out: already active` | PASS |
| — | `↻ no recovery … already spent on <state>` | not provoked | — | needs a state ladder whose recovery pass fails followed by a flow `requires:` ladder in the same run; finportal's flows have no `requires:` and its only reachable state's ladder (`fresh_launch`) is a single destructive rung with no recovery candidates | NOT RUN (unit tests only) |

## C3 — `45fd47e` one owner for trusting the window width

Scratch contract (`figma_frame_width: 402`, the iOS point width; anchors `login_card`, `login_title`,
`login_username_field`, `login_submit` (`aspect: false`), `login_forgot` with `x`/`w`) and `rect` assert
`{"element":{"id":"login_submit"},"rect":{"x":36,"w":109,"h":48,"frameWidth":402}}`.

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 15 | `verify` both, `state: logged_out`, contract | table measured, no refusal, no `!` note | 9.0 s | `widths: android 1080   ios 402   figma frame 402`; every x/w within 0.9 % vs contract and a-vs-i; `rect parity: 4 DELTA(S) OVER 2.00%` — all android-vs-ios `h`/aspect of the card/title/username field (2.35–2.81 %), i.e. the app's real Android-vs-iOS text heights, not the denominator | PASS |
| 16 | `assert` rect on `login_submit`, each platform | measured, PASS | 2.9 s / 1.1 s | android `x 99.0 vs contract 36 → Δ+0.21% · w 300.0 … Δ+0.66% · h 132.0 … Δ+0.28%; screen width 1080`; ios `… Δ+0.00% …; screen width 402` | PASS |
| 17a | Android landscape with finportal | finportal is portrait-locked: with `user_rotation 1` the display stayed `ROTATION_0`; the assert / `verify` (new server too) measured as in portrait, WITHIN TOLERANCE on all 5 anchors | 2.7–4.4 s | `mCurrentRotation=ROTATION_0`; `screen width 1080` | PASS (landscape not reachable in finportal) |
| 17b | Android landscape with Settings (`cmd window user-rotation lock 1` → `ROTATION_90`, `cur=2220x1080`), rect assert on `text:"Search settings"`: fresh server, then portrait, then landscape again in the SAME server | measured every time, no refusal and no note — a landscape window against a memoized portrait `wm size` (1080x2220) is judged against the long side | 5.4–5.9 s (the asserts FAIL on the made-up contract numbers and spend their 3 s budget) | landscape `… Δ-58.05% OVER; screen width 2220`, portrait `…; screen width 1080`, landscape again `…; screen width 2220` | PASS |
| 18a | `wm size 720x1600` after the screen was read at 1080x2220 (same server) | `verify` contract table measured with the "narrower" note; `login_submit` / `login_forgot` MISSING (scrolled off on the smaller screen) | 3.9 s | `widths: android 720`; `! android: window 720 wide on a 1080x2220 DEVICE screen — narrower than the short side a portrait window faces (1080), so the deltas are % of a window that does not cover the screen (split view?); check it is the canvas the Figma frame describes` | PASS (as documented) |
| 18b | `wm size 720x1600`, NEW server | measured silently: the override size is what `viewport()` reads | 4.4–6.0 s | `widths: android 720`, no `!` line; rect assert `screen width 720` | PASS |
| 18c | screen read at 720x1600, then `wm size reset` (same server) | rect assert fails closed, table FAILS whole, naming the changed screen | 5.7 s / 4.4 s | assert `the tree's window is 1080 wide but the 720x1600 device screen is 720 on the short side a portrait window faces — … — or the device screen changed since it was read (a fold or unfold, \`wm size\`): it is read once per session, so re-run; failing closed, geometry unchecked`; verify `## rect parity` / `FAILED: rect parity: android: the tree's window is 1080 wide … failing closed.` | PASS (refusal correct) — but see New defects 1 |

## Unverified items settled

**adb-shell.ts** — *"For `'`, `\` and the other escaped characters the argv `input text` receives is the same as
before; UNVERIFIED on a device"*: settled. `a b&c;d'e"f\g$h` typed per character into a Compose/RN text field
read back as exactly `a b&c;d'e"f\g$h` (row 3) — `'`, `"`, `\`, `$`, `&`, `;` and the `%s` space all land
literally.

*"typeText REFUSES a newline, a return or a tab … `input text` likely turns a newline into an ENTER key event
(UNVERIFIED on a device; not risked)"*: the refusal is confirmed (rows 4a/4b, wording names `pressKey('enter')`
and `press_key`). What `input text` would do with a literal newline remains deliberately untested (not risked
next to a login form).

The header's three measured breakages (`&` truncation, split extras, `$HOME;id` executed) are now confirmed
FIXED for the deep link path: the full data arrives (rows 1a–1e) and neither injection ran (2a/2b). Intent
extras (`--es` with a space) were not exercised: no MCP tool takes extras without an averi.yaml `intent:`
launch, and finportal declares none.

**android-start.ts** — *"the exact text of monkey's line. The review measured the exit and that the reason is on
stdout, and did not quote it"*: settled on API 33. Raw `monkey -p com.nosuch.pkg -c android.intent.category.LAUNCHER 1`
exits **252** and prints `** No activities found to run, monkey aborted.` on **stdout** (stderr carries only the
`bash arg:` echo); averi quotes it (rows 9a/9b). Also confirmed: `am start` for an unresolvable url exits **0**
with its `Error: Activity not started, unable to resolve Intent …` line on stderr (stdout: `Starting: Intent …`),
and averi now refuses it (row 6). *"A url two apps handle starts the system chooser — `started`"*: a url with two
VIEW handlers (`tel:`) started the preferred handler and was `started`; the chooser itself was not produced
(no unpinned two-handler url on this image). Still unmeasured: an app crashing on monkey's launch event, a
shell-v1 device.

**`windowWidth` (scale.ts)** — *"Not yet run on a device (2026-10-07): the witness rule rests on the units
contract of `DeviceAdapter.viewport()` — the same units as the tree, `wm size`'s override size when one is set —
and on the window never being wider than the panel"*: settled for the Android emulator and the iOS simulator.
Real frames are measured with no refusal and no note on both platforms (rows 15, 16: tree window 1080 on
1080x2220, 402 on the iPhone 17). A fresh read under `wm size 720x1600` returns the override size and the
720-wide window is silent (18b) — the units contract holds. A landscape window (2220) against the memoized
portrait screen is judged against the long side and measured silently (17b). The memo caveat (*"`viewport()` is
memoized per adapter … the refusal names a changed screen and says re-run"*) is confirmed on a device with `wm
size` standing in for an unfold: a screen read small and then grown refuses with the changed-screen sentence
(18c); read large and then shrunk measures with the "narrower … split view?" note (18a). Still unmeasured: a
real foldable, an Android letterboxed / freeform window, iPad Stage Manager; iOS landscape (optional, not run).

## New defects

1. **The changed-screen refusal's "so re-run" does not help within the same MCP server** (C3, minor, wording).
   `viewport()` is memoized for the life of the adapter, and the registry keeps the adapter for the life of the
   server, so re-running the tool — even after `select_device` on the same serial — keeps refusing until the MCP
   server is restarted. Repro (finportal on `login_screen`, one server):
   `adb shell wm size 720x1600` → `assert` `{"element":{"id":"login_title"},"rect":{"x":36,"w":330,"frameWidth":402}}`
   (measured, `screen width 720`) → `adb shell wm size reset` → the same `assert` three times, the third after
   `select_device android emulator-5554`: all three `FAIL … the 720x1600 device screen is 720 … it is read once
   per session, so re-run; failing closed`. The doc comment already says "a fresh-read API is not part of this
   change"; the user-facing sentence should say "restart the averi MCP server" (or the memo should be dropped on
   refusal). Not a false refusal of a legitimate frame: it needs the screen to change mid-session.

   **Fixed (wording) in the parity commit before merge:** the refusal now ends "it is read once per averi server
   session and select_device does not re-read it, so restart the averi MCP server, then re-run", and the
   `windowWidth` caveat records this measurement. Dropping the memo on refusal is left for a later change.

   **Fixed in code after this run** (code review, same day; supersedes the rewording): before a
   wider-than-screen refusal the screen is now re-read once, bypassing the memo (`viewport({ fresh: true })`,
   `capture.ts#ScreenWitness`), and the window judged again — so the 18c sequence measures at 1080 after
   `wm size reset` instead of refusing until a restart. A refusal that survives says the screen was read again
   (or that the re-read failed); the "restart the averi MCP server" sentence is gone. A failed `viewport()` read
   is no longer memoized either. Not re-run on a device.

No other defect. Observations, not defects:
- `type_text` with a selector and a refused character (row 4b) taps the field to focus it before typeText
  refuses (6.6 s, the keyboard comes up); no character is typed. Refusing in `fillField` before the focus tap
  would make the refusal free; harmless on the login form. **Fixed in code after this run** (code review, same
  day): the refusal moved to `interact/type-text.ts` and comes before any device call — no tree read, no tap,
  no clear — on both platforms, for every C0 control character and DEL (iOS used to type a `\n`). Its wording
  changed with it (`cannot type U+0009 ("\t", a control character): …`, still naming `pressKey('enter')`);
  rows 4a/4b quote the old Android-only sentence. Not re-run on a device.
- The rect-parity deltas in row 15 (card/title/username-field height and aspect, 2.35–2.81 % android-vs-ios) are
  finportal's real cross-platform geometry, not an averi effect.

## State left

Android: finportal on `login_screen` (wiped several times by `fresh_launch` / `smoke`; username field emptied
before that), rotation restored (`accelerometer_rotation 1`, `user_rotation 0`, `cmd window user-rotation free`,
`ROTATION_0`), `wm size` reset (`Physical size: 1080x2220`, no override), no probe files in `/data/local/tmp`,
Settings and Dialer force-stopped, no load loops were started. iOS: finportal on `login_screen` (after `smoke`'s
wipe). Scratch contract and logs: the session scratchpad `device-top4/`.

## Re-check of the code-review fixes (2026-10-08)

**Measured 2026-10-08 07:52–08:04 CEST (05:52–06:04 UTC)**, averi `dist/` built from `016b737` (same branch),
same driver, devices and finportal build as above; scenario JSONs, logs and raw dumps (`dump-<case>.xml`) in the
session scratchpad `device-top4/` (`r1-*`, `r2-*`, `r3-*`, `r4-*`, `probe.sh`, `r3-case.sh`). Baseline before
the run: navbar overlay `com.android.internal.systemui.navbar.gestural` enabled, no cutout overlay,
`accelerometer_rotation 1`, `user_rotation 0`, no `wm size` override. No login was submitted.

Row 3x method: Settings (`am start -n com.android.settings/.Settings`, not `launch_app`: monkey's launch
re-enabled `accelerometer_rotation` on the first attempt and the display went back to `ROTATION_0`), rotation by
`cmd window user-rotation lock 1|3`, navbar by `cmd overlay enable-exclusive --category …navbar.<name>`, cutout by
`cmd overlay enable …cutout.emulation.<name>`. Window bounds from `dumpsys window windows` (`frame=`) and the
raw `uiautomator dump` (top-level node); the rect assert `{"element":{"text":"Search settings"},"rect":{"x":60,"w":300,"frameWidth":402}}`
(made-up contract, so it FAILs on the numbers — what matters is the denominator and the reported `x`), in a
fresh server, then once more in the same server.

| # | scenario | outcome | key lines / bounds | verdict |
|---|---|---|---|---|
| 4c | Android `type_text id:login_username` `"x\ny"`, field unfocused | refused in 0.0 s; IME untouched | `cannot type U+000A ("\n", a control character): it is a key, not text — … Refused on both platforms before anything was sent. …pressKey('enter') …`; `dumpsys input_method` before and after: `mInputShown=false`, `mServedView=DecorView@…[MainActivity]` (no field took focus) | PASS |
| 4d | Android same with `"esc\x1bhere"` | refused 0.0 s, IME untouched | `cannot type U+001B ("\u001b", …)`; `mInputShown=false`, `mServedView=DecorView` | PASS |
| 4e | Android: seed `keepme` (`clear: true`), hide keyboard, then `fill` `clear: true` with `"a\nb"` and with `"a\x1bb"` | both refused 0.1 s; field still `keepme`; keyboard stays down | read back `"value": "keepme"` after each; `mInputShown=false` | PASS |
| 4f | Android `type_text` (no selector) `"q\x7f"` (DEL) | refused | `cannot type U+007F ("", a control character) …` — see Observations | PASS |
| 4g | iOS 4c–4f (same steps; keyboard checked with `ui_snapshot role:keyboard` on the WDA tree, plus a screenshot) | all four refused in 0.1 s; `keepme` intact | `0 matches for role:keyboard` before and after every refusal; screenshot after the two unfocused refusals shows no caret, no keyboard; read back `keepme` ×3 | PASS |
| — | cleanup both platforms: `type_text id:login_username ""` `clear: true`, keyboard hidden (Android `back`, iOS tap `login_title`) | field empty | read back `"value": null`; Android `mInputShown=false`, iOS `0 matches for role:keyboard` | done |
| 18d | 18c re-run, ONE server: `wm size 720x1600` → assert `login_title` (`screen width 720`) → `wm size reset` → assert → `verify` contract | measured at 1080 after the one fresh re-read, no restart | assert `PASS … x 99.0 … Δ+0.21% · w 882.0 … Δ-0.42%; screen width 1080`; verify `widths: android 1080`, `WITHIN TOLERANCE (2.00%) on all 5 anchor(s)`; a second shrink → reset cycle in the same server measured 1080 again | PASS |
| 18e | a refusal that SURVIVES the re-read (wording "the device screen was read again …") | not reachable on this device: with `wm size` the tree follows the screen, and an assert sent the instant after `wm size 720x1600` already read a 720 window (measured with the known "narrower … split view?" note, as 18a) | `screen width 720 (window 720 wide on a 1080x2220 DEVICE screen — narrower than the short side …)` — the memoized 1080x2220 was not re-read because nothing was refused | NOT REACHED (unit tests only) |
| 19a | 3-button nav, 90° (bar on the right) | measured 2220 silently — Settings' window is NOT inset by the nav bar | display `cur=2220x1080 app=2088x1080`; Settings `frame=[0,0][2220,1080]`, dump root `[0,0][2220,1080]`; `Search settings` `[209,584][577,658]`; assert `x 209.0 … screen width 2220` | PASS |
| 19b | 3-button nav, 270° (bar on the left) | measured 2220 silently; window full-screen, content padded by the app | `frame=[0,0][2220,1080]`, root `[0,0][2220,1080]`; `Search settings` `[341,584][709,658]` (the 132-px bar is inside the window); assert `x 341.0 … screen width 2220` | PASS (no A1/A2 shape: the bar does not inset this window) |
| 19c | `cutout.emulation.tall`, gestural, 90° (cutout on the left) — **A1** | measured 2088, no note, x from the window's left edge | `cur=2220x1080 app=2088x1014`; `frame=[132,0][2220,1080]`, root `[132,0][2220,1080]` (gap 132 = 5.9 % of 2220); `Search settings` `[341,584][709,658]`; assert `x 209.0 vs contract 60 → Δ-4.92% … screen width 2088` — 209 = 341 − 132 | PASS |
| 19d | tall cutout, 270° (cutout on the right) — **A2** | measured 2088 silently, no "split view?" | `frame=[0,0][2088,1080]`, root `[0,0][2088,1080]`; `Search settings` `[209,584][577,658]`; assert `x 209.0 … screen width 2088` | PASS |
| 19e | `cutout.emulation.corner`, 90° / 270° | same shapes and answers as 19c / 19d | 90°: root `[132,0][2220,1080]`, assert `x 209.0 … screen width 2088` (341 − 132); 270°: root `[0,0][2088,1080]`, `x 209.0 … screen width 2088` | PASS |
| 19f | 3-button nav + tall cutout, 90° (cutout left, bar right) | A1, measured 2088 from x = 132 | `cur=2220x1080 app=1956x1080`; root `[132,0][2220,1080]` (the bar overlaps the window's right end, not inset); `Search settings` `[341,584][709,658]`; assert `x 209.0 … screen width 2088` | PASS |
| 19g | 3-button nav + tall cutout, 270° (bar left, cutout right) | A2, measured 2088 silently | root `[0,0][2088,1080]`; `Search settings` `[341,584][709,658]` (bar padded inside the window); assert `x 341.0 … screen width 2088` | PASS |
| 19h | portrait with the tall cutout (gestural, and with 3-button nav) | as before | root `[0,0][1080,2220]` (`app=1080x2022` / `1080x1956`); `Search settings` `[209,650][577,724]`; assert `x 209.0 … screen width 1080` | PASS |
| 20 | regression, ONE server: row-15 `verify` both platforms `state: logged_out` + contract, then `ensure_state logged_out` and `run_flow smoke` (Android) | unchanged | verify (Android wiped by `fresh_launch`, `(1 this session)` — Settings had been on top) `widths: android 1080   ios 402   figma frame 402`, the same 4 android-vs-ios `h`/aspect deltas as row 15 (2.35–2.81 %), every x/w within 0.9 %; `state logged_out: already active`; smoke `(2 this session)`, 4 × `assert PASS`; both platforms end on `login_screen` | PASS |

Every second assert in the same server (19a–19h) answered as the first.

**What the landscape windows really look like on API 33 (answers the A1/A2 "not from a dump" caveat).** The
Settings window is inset ONLY by the display cutout: `frame=[132,0][2220,1080]` with the cutout on the left,
`[0,0][2088,1080]` with it on the right — y = 0, full 1080 tall, one 132-px (5.9 %) gap, exactly the shape
`besideSystemBars` admits, and averi measures both at 2088 with `x` taken from the window's edge. The 3-button
nav bar never insets this window, on either side or combined with a cutout: the window spans it and the app pads
its content (19b, 19f, 19g); the A2 "short of the long side by a NAV BAR" shape therefore was not produced on this
image — its right-hand gap came from the cutout instead. A non-edge-to-edge app whose window the nav bar does
inset (older target SDK) was not found on the emulator (Clock, Contacts, Dialer, Messages, Calendar, Files and
Chrome all report full-display frames in landscape). Not tried: `cutout.emulation.double` / `hole` / `waterfall`.

### New defects

None. Observation (wording, nit): the refusal quotes the character with `JSON.stringify`, which escapes C0 but
not DEL, so U+007F prints as an invisible character inside the quotes — `cannot type U+007F ("", a control
character)`. The code point before it still names it; `\u007f` in the quote would read better.

### State left

Android: navbar overlay back to `gestural` only, `cutout.emulation.tall` / `.corner` disabled (`cmd overlay list`
matches the baseline), `cmd window user-rotation free`, `accelerometer_rotation 1`, `user_rotation 0`,
`ROTATION_0`, `cur=1080x2220 app=1080x2154`, no `wm size` override; Settings (and the Clock, Contacts, Dialer,
Files, Messages, Calendar, Chrome probed for frames) force-stopped; finportal on `login_screen` (after `smoke`'s
wipe), username empty. iOS: finportal on `login_screen`, username empty, no keyboard.
