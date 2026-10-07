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

## Fix (2026-10-07, branch `fix/android-second-look-decor-2026-10-07`; not yet device-checked)

The second suggestion, widened to cover the WDA splash, where the ENTRY probe was the one that read the bare tree.

- **A bare tree is not knowledge.** The detect probe (`FlowEngine.detects`) asks `isBareTree` of every tree that
  missed. It answers `bare` when it read trees but none of them was rendered. One rendered read still makes it `no`.
  It logs `⚠ detect: <condition> treated as not detected — every UI tree read was bare, the last one N nodes (roles:
  …) of only wrappers and unlabeled decoration` in place of the read-error line (a probe whose trees were all bare
  gets this line alone, even if a later round's read failed). Salvage and the recovery pass compare
  against `'yes'`, so for them `bare` is still "not detected", as before.
- **Before a DESTRUCTIVE rung, `bare` is treated like `unknown`.** Both get one second look, and the look now runs
  over `ensureTimeoutMs` (20 s by default) instead of `tapTimeoutMs` (5 s). It is one poll with one deadline, so null
  root → decor → rendered (the timeline above, `login_screen` at +18.3 s) is one transient. If the look reads the
  state, the call ends ("already active"). If it reads a rendered tree outside the state, the rung runs with its usual
  ⚠. If it still reads nothing rendered, the rung is refused with `⛔ reach` and `UnreadTreeRefusal`, now worded for
  what the probe before the rung and the second look learned together: `…never read a RENDERED UI tree, a second look
  included — every UI tree read was bare, the last one N nodes (roles: …) of only wrappers and unlabeled decoration —
  so whether the app is in "X" is unknown. Compare with screenshot; retry once the screen has rendered, or run_flow
  "<rung>" runs it deliberately`. When only the probe before the rung read a (bare) tree and every read of the second
  look failed, the clause goes on `…unlabeled decoration, and every read after it failed (last UI tree read failed:
  …)`. When neither probe read any tree, the unread wording is unchanged. (Review, same day: the first version worded
  the refusal from the second look alone, so a bare entry read followed by failed reads said "never read a UI tree",
  and a failed entry read followed by bare ones said "every read was bare".)
- **Cheap rungs do not wait.** They run at once on an unknown or bare probe. The entry probe stays a single read.
- A state with no reach flows and a bare probe now says `State "X" could not be checked (every UI tree read was
  bare, the last one N nodes (roles: …) of only wrappers and unlabeled decoration) and it has no reach flows`, not
  `Not in state "X"` — the same clause as the `⚠ detect` line and the refusal (`describeUnreadCause`).
- **Costs.** A second look that does see a rendered screen outside the state polls to its deadline before the rung
  runs, as every detect window does. That is up to 20 s, and only after a cold-launch probe: a cold launch onto a
  screen genuinely outside the state takes ~15 s longer than the 30.8–31.2 s measured above (the second look is
  20 s, was 5 s; the rung and the final 20 s `waitFor` are unchanged). Ending the look at the first rendered miss was rejected: the timeline above has an
  unexplained gap between +13.8 s and +18.3 s, and a rendered intermediate screen there would trigger the wipe. A
  stuck idb tree is now refused after ~20 s instead of ~5 s. A loaded screen made
  only of identified-but-unlabeled icons is bare by the rule (ui-tree/bare-tree.ts), so it cannot reach a
  destructive rung through `ensure_state`. It is refused, never wiped, and `run_flow` of the rung still runs it.
- **Out of scope, pre-existing:** an `absent: true` detect answers `yes` on a bare tree, because nothing in a bare
  tree matches. The bare answer is asked only of a tree that missed.
- Pinned in `tests/flow/bare-tree-ladder.test.ts`, through the real uiautomator and WDA parsers.
