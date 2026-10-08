# FINDING (measured): one WebDriverAgent read ends a stuck idb tree at once, and every relaunch re-enters it

> **Status (2026-10-08):** superseded — "Code says" below (no cure but waiting) is no longer the current state: since `73eea5f` (2026-10-07) every launch and deep link first re-enables the simulator's accessibility keys, which prevents the stuck tree, and since `79b458e` (2026-10-07) the empty-tree advice says terminate then launch. See [2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md](2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md).

**Measured 2026-10-06 23:23–23:47 CEST**, finportal `sk.finportal.myport` (Expo / React Native debug build, Metro
running), `iPhone 17` simulator iOS 26.5 (`D34212DB-…`), averi built from `1e0501d` (branch `fix/bugs-2026-10-06`).
idb was exercised from a scratch copy of finportal's `averi.yaml` with `app.ios.treeSource: idb`. The WDA reads used
finportal's own config (`treeSource: wda`, untouched). Found during the device check of `1e0501d`
(`2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md`, "## Fix").

## Claim

The stuck-idb note lists "Cure: a bridge kickstart, or `AutomationEnabled`" as deferred, and says nothing else wakes
idb: a tap and an app switch did not. It also says the episode lasts "minutes" (2.5 min on finportal, 4+ min on
mp-native) and looks rare.

## Measured

- **Trigger rate.** Every launch entered the episode, 12 of 12:
  - plain `simctl terminate` + `simctl launch`: 10 of 10, with the first read at +0.3, 0.8, 1.4, 5.4, 15.4 and 30.4 s;
  - `launch {clearState:true}` (averi's `fresh_launch`): 2 of 2.
  - The first read was already stuck in every case. The shape never changed during an episode: a lone
    `{"type":"Application","AXFrame":"{{0, 0}, {0, 0}}","AXLabel":null}`. There was no `[]`, no full-frame lone
    `Application`, and no `other` child.
  - The companion log shows the known signature on every stuck read: `Process N (launchctl) exited with code 0`
    between `accessibility_info called` and `succeeded in 160–186ms`. Healthy reads took 25–58 ms with no
    launchctl line.
  - `screenshot` showed the rendered login form, or a RN red box before Metro was started.
- **No natural recovery observed.** One episode ran 23:27:43 → 23:37:02 (9 min 19 s) without recovering, and one
  ran 23:44:23 → 00:02:36 (18 min 13 s), read every 5 s and stuck on every read; see the addendum. The idb reads were every 2–5 s.
- **A WDA read cures it.** One `ui_snapshot` through WDA (≈3 s, finportal's config) was followed by a full idb tree on
  the next `idb ui describe-all`, 12 of 12 times. That was 14 elements on the login screen, or 7 on the red box. The
  first time, at 23:26:30, WDA itself read the red box in full while idb was stuck. The earlier finportal episode in
  `2026-10-06-bare-tree-misses-wda-rn-splash.md` also ended about 1 min after a WDA read.
- `idb ui describe-point` during an episode, at (200,120), (60,830) and (200,400) over visible text and buttons: `No
  translation object returned for simulator …` each time (`accessibility_info failed after 4–6ms`).

## Code says

`IdbTreeSource.read` now throws `IdbEmptyTreeError`, and the advice in it ends with "app.ios.treeSource: wda". That is
correct, but it is the only remedy offered. A project that needs idb (the default) has no cure except waiting, and
waiting was not measured to end the episode within 9 min.

## Suggestion (owner's choice)

- Measure first whether a bare XCTest attach is enough: start and stop WDA without a `/source`. If it is, an idb
  read that throws `IdbEmptyTreeError` N times could start one WDA session as a "wake" and retry. That needs the WDA
  build, so it is opt-in at most.
- At least name the cure in the error text: "a single read through WebDriverAgent (treeSource: wda) has ended
  this every time it was measured".
- Find out why this simulator now sticks on every launch when earlier sessions saw it rarely. One candidate, not
  verified: WDA had been used on this simulator just before. The deferred simulator-wide interventions (bridge
  kickstart, `com.apple.Accessibility` defaults, `simctl erase`, `idb kill`, a client upgrade) were NOT tried.

## Addendum: the natural-recovery episode

- Launched 23:44:22. Stuck from the first read at +1.4 s. The companion log shows the launchctl signature on every
  read through 00:02:36. The host then appears to have slept: there were no reads until 00:11:51, and the read at
  00:12:10 was still stuck.
- So the lower bound measured here is **18 min continuously stuck with no recovery**, against 2.5–4 min in the
  earlier notes.
- A WDA read at 00:28 ended it on the next idb read (14 elements, `MyPort`, `English`, …, `Login`).

## Measured 2026-10-07 (pre-fix)

**09:27–09:42 CEST**, averi `f76cb9d` (built, not used: Part I ran no averi call), finportal `sk.finportal.myport`
(debug build, Metro up), `iPhone 17` iOS 26.5 (`D34212DB-…`). No other session's WDA, `xcodebuild`, Maestro or gate
was running. Tree read only with `idb ui describe-all --json`, app driven only with `xcrun simctl`. WDA hand-started
on port 8199 (`xcodebuild test-without-building` on `averi-wda`'s prebuilt `.xctestrun`), `/status` only, no
`/source`, no session. Each read logged its element count, its shape, and whether the companion log shows
`Process N (launchctl) exited` between `accessibility_info called` and `succeeded`.

- **The signature holds without exception.** 55 stuck reads and 101 healthy reads were taken. Every stuck read was a lone
  0×0 `Application` with the launchctl line, in 159–205 ms. Every healthy read had no launchctl line and took 25–110 ms.
- **I0.** 3 launches × reads at +1, +5 and +15 s: 9 of 9 stuck.
- **I1, a bare attach (`/status` only).** 3 episodes. The read right after `/status` answered (≈0.1 s later) was
  already full: 14 elements (`MyPort`, `Slovensky`, `Česky`, `English`, …). It was still full 5 s later. 3 of 3 cured.
- **I1b, the attach stopped before the read.** Start, wait for `/status`, `kill -TERM` the process group, port
  quiet, no `WebDriverAgentRunner` left, then read: 14 elements at once and 5 s later. 3 of 3 cured. The attach does
  not have to stay up.
- **I2, a relaunch after a cure, WDA stopped.** 5 launches × 3 reads: 15 of 15 stuck. The cure does not survive a
  relaunch.
- **I3, WDA kept running.** 5 launches × 3 reads: 15 of 15 healthy. At +1 s the tree was the Expo bundle screen
  (`MyPort`, `Downloading 100%…`, 2 elements). From +5 s it was the login screen (14). A running WDA prevents
  the re-stick.
- **I4, a WDA-free simulator.** A new `kb-idb-probe` (iPhone 17, iOS 26.5) was created, booted, given
  `ios/build/MyPort.app` and never shown WDA. 10 launches × 3 reads: **0 of 30 stuck**. The +1 s reads were a lone
  `Application` with a real frame, the bundle screen, or the full form, and they were healthy from +5 s.
  - **On the same probe, one WDA start and stop (I4b), then 5 launches × 3 reads: 15 of 15 stuck**, with the same
    signature. One WDA session is the trigger.
  - **After `simctl shutdown` + `boot` of the probe (I4r):** 3 launches × 3 reads, 9 of 9 healthy. A reboot clears it.
  - Probe deleted afterwards (`simctl delete`). The original simulator was not erased.
- **I5, accessibility defaults.**
  - Recorded first, on the original simulator: `AutomationEnabled = 0`, `ApplicationAccessibilityEnabled = 0` (both
    present; the full dump is 13 keys).
  - With both written `-bool true`: 5 launches × 3 reads, **15 of 15 healthy**.
  - Restored to `false`. A re-read was identical to the recorded dump, and a control launch was stuck again (2 of 2).
  - On the probe after its WDA run, the same two keys read `0`. **Deleting them** (absent, as on a never-WDA simulator)
    did not help: 9 of 9 stuck. So the WDA teardown leaves state behind that the keys' absence does not undo, a
    value of `1` overrides it, and a reboot clears it.
- **I6, warm start.** Spawn to `/status` took 1.9 s (7 times), 2.2 s (twice), and 3.2 s (first run on the fresh
  probe). Nothing was built: the `xcodebuild` log shows `ServerURLHere` and then `** BUILD INTERRUPTED **` on kill,
  with no compile step.

| question | answer |
|---|---|
| Still reproduces (I0) | yes, 9/9 reads over 3 launches |
| Bare attach without `/source` cures (I1), and must it stay up (I1b) | yes, 3/3, at the first read after `/status`; no, starting and stopping it cures too, 3/3 |
| Cure survives relaunch (I2) | no, 15/15 stuck after 5 relaunches |
| Running WDA prevents re-stick (I3) | yes, 15/15 healthy over 5 relaunches |
| WDA-free simulator sticks (I4) | no, 0/30; after ONE WDA start+stop, 15/15; after a reboot, 0/9 |
| Accessibility defaults prevent it (I5) | `AutomationEnabled` + `ApplicationAccessibilityEnabled` = `true`: yes, 15/15 healthy; deleting the keys: no |
| WDA warm-start seconds (I6) | 1.9–2.2 s (3.2 s first time on a new simulator), no build |

The trigger is the subject of [2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md](2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md).
