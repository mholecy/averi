# OBSERVATION (measured): on Android the ladder's 5 s second look ends on the RN decor tree and reads "not in state", so `ensure_state` right after a cold launch wipes an app that was already in the state

**Measured 2026-10-06 23:44–23:47 CEST**, finportal `sk.finportal.myport` (Expo / React Native debug build, Metro
running), `emulator-5554` (Android 13), averi built from `1e0501d` (branch `fix/bugs-2026-10-06`). Scenario 4 of the
device check of `1e0501d`. This is not a regression: before `1e0501d` the rung ran on the first unreadable probe
anyway.

## Claim

`1e0501d` gives an unreadable (`unknown`) probe in front of a destructive rung one second look over `tapTimeoutMs`
(5 s). It does this "so Android's null-root transient right after a cold launch (~2–3 s) does not refuse an ordinary
run". "A second look that reads the state ends the call; one that reads any tree runs the rung as before."

## Measured

- The app was on its login screen: `ui_snapshot` found `identifier: login_screen`.
- Three runs of `terminate_app` → `launch_app` → `ensure_state logged_out`. Each one:
  - got `⚠ detect: element id:"login_screen" treated as not detected — … uiautomator has no window to dump yet`;
  - then `⚠ reach fresh_launch: this rung is DESTRUCTIVE`, `launch … (state cleared)` and `⚠ clearState: app state
    wiped`;
  - then `state logged_out: reached after fresh_launch`, 30.8–31.2 s.
- There was no ⛔, as the fix intends.
- Raw timeline of the same cold launch (`am force-stop` + `am start`, then `uiautomator dump` in a loop):

  | time after launch | what the read returned |
  |---|---|
  | +2.6 s | null root |
  | +5.3 to +13.8 s | decor only (`android:id/content`, `action_bar_root`) |
  | +18.3 s | `login_screen` |

- So the second look reads a tree (the decor) inside its 5 s and answers "no". The state the app was already in
  appears ~13 s later.

## Code says

`FlowEngine.ensureStateInner`: `probe = await this.detects(state.detect, this.tapTimeoutMs)`. Any tree read in that
window makes the answer `no` (`detects`: "One good read makes it 'no'"), and the destructive rung runs. A splash or
decor tree is "a tree" here, as `isBareTree`'s docblock already notes for loading screens.

## Suggestion (owner's choice)

- Accept and document it. The rung is the wipe the state asks for, and a config that cares puts a cheap
  wait-for-launch rung first (finportal's `logged_in` does: `open_app`).
- Or, for a destructive rung only, treat a bare tree (`isBareTree`) on the second look like an unreadable one, so the
  look keeps polling, or refuses, until the app has rendered something. Only the destructive path pays the cost.
