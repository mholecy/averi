# Handoff: device measurements before fixing the iOS keyboard tap and the stuck idb tree

*For the agent that runs the measurement. Written 2026-10-07 from two read-only assessments of
[2026-10-05-ios-tap-lands-on-soft-keyboard.md](../bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md) (bug K) and
[2026-10-06-wda-read-wakes-stuck-idb-tree.md](../bugs/2026-10-06-wda-read-wakes-stuck-idb-tree.md) (bug I, parent:
[2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md](../bugs/2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md)).
Neither fix can be designed without the answers below. Nothing here changes code.*

## 0. The mission and its limits

Answer the questions in §3 and §4 with measurements, and record them. You **observe and report**:
- Do NOT change `src/` or `tests/`. Do NOT commit, push or tag. Do NOT edit tracked files in `/Users/mholecy/dev/finportal`.
- **finportal only** (`/Users/mholecy/dev/finportal/app`, bundle `sk.finportal.myport`). Do not touch mp-native at all.
  Its safety rules are in [2026-10-06-device-test-agent-instructions.md](2026-10-06-device-test-agent-instructions.md) §1,
  and rules 4 (other sessions), 7 (credentials) and 8 (time budget) apply here unchanged.
- finportal `login` stops at the 2FA screen by design. Reaching 2FA is fine; never type a code.
- Throwaway files go under `$RUN=/private/tmp/claude-501/-Users-mholecy-dev-mobile-verify/<your session>/scratchpad/kb-idb-run/`.
- Results go into the two bug notes as a new section `## Measured 2026-10-xx (pre-fix)` each, in the existing style
  (what was run → what came back, verbatim where short). Leave them uncommitted.

## 1. Setup

```sh
cd /Users/mholecy/dev/mobile-verify && git log -1 --oneline && npm run build
xcrun simctl list devices booted     # iPhone 17, D34212DB-2134-43E4-99D8-FA89136C729B, iOS 26.5
ps -axo pid,lstart,command | grep -E 'maestro|quality_gate|xcodebuild|gradlew|WebDriverAgentRunner' | grep -v grep
```

If another session's `xcodebuild`/WDA is driving this simulator, wait (rule 4). Record what was running.

`UDID=D34212DB-2134-43E4-99D8-FA89136C729B`. The averi driver is the handoff's `run-tools.mts`
([2026-10-05-device-verification-handoff.md](2026-10-05-device-verification-handoff.md) §2).

### 1.1 A hand-started WebDriverAgent (needed by both parts)

The raw WDA payload is needed because averi's parser drops the element `type`, so a `ui_snapshot` cannot tell a
`Keyboard` from any other container. Start WDA by hand on a port averi never allocates first (averi counts up from 8100):

```sh
XCTESTRUN=$(ls ~/Library/Developer/Xcode/DerivedData/averi-wda/Build/Products/*.xctestrun | head -1)
lsof -ti tcp:8199 && echo "8199 busy — pick another port"
TEST_RUNNER_USE_PORT=8199 xcodebuild test-without-building -xctestrun "$XCTESTRUN" \
  -destination id=$UDID > $RUN/wda.log 2>&1 &
echo $! > $RUN/wda.pid
until curl -s -m 2 localhost:8199/status >/dev/null; do sleep 1; done   # record how long this took
```

`/status` does not read the accessibility tree; `/source` does. Stop it with
`kill -TERM -- -$(cat $RUN/wda.pid)` (the process group), then confirm `lsof -ti tcp:8199` is empty and no
`WebDriverAgentRunner` of YOURS remains. Never kill a WDA on another port: it belongs to another session.

## 2. Run order

**Part I first, Part K second.** finportal's `averi.yaml` sets `treeSource: wda`, so every averi iOS call starts a
WDA, and a WDA read wakes the stuck idb tree. That would contaminate Part I. During Part I, read the tree only with
`idb ui describe-all --json --udid $UDID` and drive the app only with `xcrun simctl`.

For each idb read, record the time, the element count, the shape (`lone 0×0 Application` = stuck), and whether the
companion log shows `Process N (launchctl) exited` between `accessibility_info called` and `succeeded`.

## 3. Part I: the stuck idb tree

Before starting: no WDA of any session is running against this simulator (`pgrep -fl WebDriverAgentRunner`). If one
is, the episode may not occur; record that and wait or ask.

| # | Question | Procedure | Record |
|---|---|---|---|
| I0 | Does the episode still reproduce? | `simctl terminate` + `simctl launch sk.finportal.myport`, idb read at +1, +5, +15 s. 3 launches. | stuck yes/no per read |
| I1 | **Does a bare XCTest attach wake idb, without any `/source`?** | In an episode: start WDA (§1.1), wait for `/status`, do NOT call `/source`. idb read at once and after 5 s. Then stop WDA. 3 episodes. | cured yes/no; time from `/status` ready to first good read |
| I1b | Does the attach have to stay up? | In an episode: start WDA, wait for `/status`, stop it at once, confirm port quiet, then idb read. 3 episodes. | cured yes/no |
| I2 | Does the cure survive a relaunch? | After a cure with WDA **stopped**: terminate + launch, idb read at +1, +5, +15 s. 5 launches. | stuck again yes/no |
| I3 | Does a WDA kept running prevent the re-stick? | Start WDA and keep it up. 5× terminate + launch, idb read at +1, +5, +15 s each. Then stop WDA. | stuck yes/no per launch |
| I4 | Is prior WDA use the trigger? | Create a NEW simulator (`xcrun simctl create kb-idb-probe "iPhone 17"`), boot it, install `ios/build/MyPort.app`, never run WDA on it. 10× launch + idb read at +1, +5, +15 s. Delete only this simulator at the end (`simctl delete`). Do NOT erase the existing one. | stuck rate on a WDA-free simulator |
| I5 | Do accessibility defaults prevent it? | On the original simulator, record then set: `xcrun simctl spawn $UDID defaults read com.apple.Accessibility` (save output); `defaults write com.apple.Accessibility AutomationEnabled -bool true` and `ApplicationAccessibilityEnabled -bool true`. 5× terminate + launch + idb read. **Restore** the recorded values (or `defaults delete` the keys if they were absent). | stuck rate with the defaults |
| I6 | WDA warm-start cost | From I1/I3: time from spawn to `/status`. And note whether `xcodebuild` had to build. | seconds |

If I4 shows a WDA-free simulator never sticks, run I5 there too (does the first WDA run make it start sticking?) only
if time allows.

## 4. Part K: the iOS soft keyboard

Get the software keyboard visible: a cold launch after `run_flow fresh_launch` usually shows it. If a focused field
shows no keyboard, toggle it with Simulator focused: `osascript -e 'tell application "Simulator" to activate' -e
'tell application "System Events" to keystroke "k" using command down'`. If osascript lacks the permission, ask the
user to press ⌘K in Simulator. Confirm visibility with a `screenshot` downscaled (`sips -Z 700`).

Save every raw `/source` you take as `$RUN/source-<step>.json`. They become the test fixtures.

| # | Question | Procedure | Record |
|---|---|---|---|
| K1 | **Is the AutoFill ("Passwords") bar inside the `Keyboard` element's rect, or a separate node?** | Login screen, `login_password` focused, keyboard + AutoFill bar visible. `curl -s localhost:8199/source?format=json`. List every element whose rect reaches below y = 500: `type`, `rect`, `isVisible`, `label`, `name`, and its parent chain up to `Window`. Compare with the screenshot's keyboard top edge. | the node(s) covering y 546–874; union rect |
| K2 | What does the parked keyboard look like? | Same field focused, software keyboard hidden (⌘K). `/source`. | `Keyboard` rect (y == 874?), `isVisible` |
| K3 | Is there a `Keyboard` node before any focus? | Fresh launch to the login screen, nothing focused. `/source`. | present yes/no, rect |
| K4 | Per-tap cost of one more `/source` | 10× `/source` timed with `curl -w '%{time_total}'`, keyboard up and down, on the login screen and on the 2FA screen. | median, p90 |
| K5 | Which dismissal hides the keyboard WITHOUT submitting? | From K1's state, one candidate per try, then screenshot: (a) `POST /session` with `{"capabilities":{}}`, then `POST /session/<id>/wda/keyboard/dismiss` (try the default, then `{"keyNames":["Hide keyboard"]}`), then `DELETE /session/<id>`; (b) `idb ui tap` on a neutral point (the title area); (c) a swipe down on the form; (d) the keyboard's return key. | hidden yes/no; submitted yes/no (2FA appears = submitted); does a session relaunch the app? |
| K6 | Baseline of the bug | Stop the hand-started WDA. With the keyboard up, `run_flow login` through the driver, 3×. | trace, pass/fail; does `tap: id:"login_submit"` say done while nothing is submitted? |

Stop the hand-started WDA before K6 so it does not meet averi's own WDA, and confirm the port is quiet afterwards.

## 5. The answers the fix needs

End each bug note's new section with this table, filled in:

**Bug K**
| question | answer |
|---|---|
| AutoFill bar inside `Keyboard` rect? (K1) | |
| Parked keyboard: rect and `isVisible` (K2) | |
| `Keyboard` node present with nothing focused? (K3) | |
| Extra `/source` cost per tap, median/p90 (K4) | |
| Non-submitting dismissal that works (K5) | |

**Bug I**
| question | answer |
|---|---|
| Still reproduces (I0) | |
| Bare attach without `/source` cures (I1), and must it stay up (I1b) | |
| Cure survives relaunch (I2) | |
| Running WDA prevents re-stick (I3) | |
| WDA-free simulator sticks (I4) | |
| Accessibility defaults prevent it (I5) | |
| WDA warm-start seconds (I6) | |

Anything unexpected becomes its own note under `docs/bugs/` (claim → measured → code says → suggestion).
