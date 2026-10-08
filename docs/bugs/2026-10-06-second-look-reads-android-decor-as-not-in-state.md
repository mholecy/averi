# OBSERVATION (measured): on Android the ladder's 5 s second look ends on the RN decor tree and reads "not in state", so `ensure_state` right after a cold launch wipes an app that was already in the state

> **Status (2026-10-08):** fixed on main in `ed19b3d` (2026-10-07).
>
> Shas below are pre-squash branch commits; on main: `06c74a0` → `ed19b3d`.

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

## Fix (2026-10-07, branch `fix/android-second-look-decor-2026-10-07`; device-checked 2026-10-07 on `06c74a0`, see below)

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

## Device check (2026-10-07)

**Measured 2026-10-07 19:32–19:37 CEST (17:32–17:37 UTC)**, averi built from `06c74a0` (`npm run build`, driven
through the handoff's `run-tools.mts`), finportal `sk.finportal.myport` debug build with Metro up (port 8081),
`emulator-5554` (sdk_gphone64_arm64, Android 13) and `iPhone 17` (`D34212DB-…`, iOS 26.5, `treeSource: wda`). No
login was submitted. `ensure_state` was called right after `launch_app` returned in every cold-launch row (0.1–0.2 s; the "< 1 s" in A7–A8 is what that scenario asked for).

**The transient had to be provoked on Android.** On an idle emulator a cold launch now renders `login_screen` before
the first `uiautomator dump` returns (raw `am force-stop` + `am start` + dump loop: first read at +4.2 s was already
`login_screen`; after `pm clear`: decor at +2.6 s, `login_screen` at +4.9 s). So rows A1–A3 below never reached the
second look. The bug's timeline was reproduced by loading the emulator's 4 CPUs with busy `sh` loops (killed
afterwards):

| load | raw timeline after `am start` |
|---|---|
| 8 loops | +3.3 s decor (6 nodes), +5.5 s decor, +9.5 s `login_screen` |
| 16 loops | +2.5 s null root, +5.2 / +7.8 / +10.4 s decor (6 nodes), +13.9 s decor (16 nodes), +16.2 s `login_screen` |

| # | scenario | outcome | duration of `ensure_state` | key trace lines | verdict |
|---|---|---|---|---|---|
| A1–A3 | 1: Android, `terminate_app` → `launch_app` → `ensure_state logged_out` from the login screen, idle emulator, 3× | no wipe, `state logged_out: already active` | 5.2 s, 5.2 s, 5.2 s | `state logged_out: already active` only (the entry read found `login_screen`) | PASS (transient not present) |
| A4–A6 | 1: same, 8 load loops, 3× | no wipe, already active | 10.5 s, 10.6 s, 10.1 s | `⚠ detect: element id:"login_screen" treated as not detected — every UI tree read was bare, the last one 6 nodes (roles: container ×5, other ×1) of only wrappers and unlabeled decoration` then `state logged_out: already active` | PASS |
| A7–A8 | 2: same, 16 load loops (null root → decor → login), `ensure_state` < 1 s after `launch_app`, 2× | no wipe, already active | 15.8 s, 16.5 s | `⚠ detect: element id:"login_screen" treated as not detected — last UI tree read failed: device emulator-5554 is still settling: uiautomator has no window to dump yet (cold launch or animation; read once). … (uiautomator dump returned no XML: ERROR: null root node returned by UiTestAutomationBridge.)` then `state logged_out: already active` | PASS |
| A9 | 3: Android, `ensure_state logged_in` cold | not run | — | the app is logged out, so after `open_app` lands on `login_screen` the ladder's next rung `login` fills and submits real credentials | NOT RUN (needs a login submit; the cheap rung's no-wait path is pinned in `tests/flow/bare-tree-ladder.test.ts` only) |
| A10 | 4: Android, a rendered off-state screen: `run_flow open_forgot` (the tree holds `forgot_overlay`/`forgot_modal`…, no `login_screen`), then `ensure_state logged_out` (warm, idle emulator) | judged rendered: no ⚠ detect line, no second look, the rung ran at once with its warning | 9.1 s (the wipe plus `fresh_launch`'s `wait` step, timeout 90 s, ending on `login_screen`) | `⚠ reach fresh_launch: this rung is DESTRUCTIVE — …`, `launch: sk.finportal.myport/.MainActivity (state cleared)`, `⚠ clearState: app state wiped (data container deleted) — … (1 this session)`, `state logged_out: reached after fresh_launch` | PASS |
| I1–I3 | 5: iOS, `terminate_app` → `launch_app` → `ensure_state logged_out` from the login screen, 3× | no wipe, already active | 4.8 s, 3.9 s, 3.9 s | I1: `state logged_out: already active` only; I2, I3: `⚠ detect: element id:"login_screen" treated as not detected — every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) of only wrappers and unlabeled decoration` then `state logged_out: already active` | PASS |

- Before the fix, I2/I3 (the WDA splash on the ENTRY probe) and A4–A8 (decor, or null root then decor) are the
  runs that would have wiped — deduced from the code, the old build was not re-run: the entry probe or the 5 s
  second look read a bare tree as "no".
- `launch_app` on iOS printed the accessibility write on stderr before the launch: `averi: set com.apple.Accessibility
  AutomationEnabled and ApplicationAccessibilityEnabled to true on D34212DB-… (simulator-wide, not restored; …)`. No
  stuck idb tree was seen; every tree read here went through WDA.
- The cost row (a cold launch onto a rendered screen outside the state, paying the full 20 s look) could not be
  produced: a finportal cold launch always lands on `login_screen` while logged out. A10 shows only the warm side: a
  rendered entry probe gets no second look.
- No ⛔ refusal was provoked (covered by unit tests).
- **Margin.** Under 16 load loops the state appeared at +16.2 s raw and the call took up to 16.5 s, inside the 20 s
  window but with ~4 s to spare; the 2026-10-06 timeline (`login_screen` at +18.3 s) had less. A slower launch than
  that is refused, not wiped, as the Fix says; nothing new.
- Left: Android on `login_screen` (after A10's wipe, logged out as before), iOS on `login_screen`. No new defect.
