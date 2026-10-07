# FINDING (measured): one WebDriverAgent read ends a stuck idb tree at once, and every relaunch re-enters it

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
