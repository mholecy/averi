# Instructions: on-device verification of the architecture/deepening series

> **Status (2026-10-08):** run 2026-10-06; its findings are the `docs/bugs/2026-10-06-*.md` notes (the first four in `d0c7764`).
>
> Shas below are pre-squash branch commits; on main: `ea5c66a` → `1f5473a`, `c444c79` → `9adf9c0`, `d69511e` → `b413ae8`.

*For the agent that runs the device test. Written 2026-10-06. The authoritative scenario list and the
expected results are in [2026-10-05-device-verification-handoff.md](2026-10-05-device-verification-handoff.md);
this file adds what that handoff lacks: the run order, the mp-native mechanics (taken from the mp-native
session of 2026-10-05/06), the safety rules, and the report format. Where the two disagree, the safety rules
here win.*

## 0. The mission and its limits

Prove on real devices what the commits since `c4a2491` claim. That covers the first and second series in the
handoff's table, plus `ea5c66a` and `c444c79` (the pixel poll, element-region stability, rect confirmation) and
`d69511e` (test only, nothing to prove on a device).

You **observe and report**. You do NOT change `src/` or `tests/`, you do NOT commit, push or tag, and you do NOT
edit either app repo's tracked files (`/Users/mholecy/dev/finportal`, `/Users/mholecy/Finshape/mp-native`).
- Throwaway files (driver, scenario JSON, contracts you author, screenshots, logs) go under
  `/private/tmp/claude-501/-Users-mholecy-dev-mobile-verify/9f3935d1-240c-470b-93c9-c353ad95f1dd/scratchpad/device-run/`.
- A finding becomes a note under `/Users/mholecy/dev/mobile-verify/docs/bugs/`, written in the style of the
  existing notes (claim → measured → code says → suggestion). Leave it uncommitted.

## 1. Hard safety rules (stop and report instead of breaking any of them)

1. **Never spend a device registration on mp-native.**
   - Do not run its `login`, `login_here`, `login_ios_here`, `login_here_env`, `login_registered` or
     `fresh_launch`-type flows.
   - Do not run any `ensure_state`, `run_flow` or `verify` whose `requires:`/`reach:` chain could fall through to one
     of them. On mp-native a failed `requires:` escalates to `login`, whose `clearState` wipes the Android registration.
   - Before any mp-native state or flow call, LOOK first (`screenshot`) and classify the screen:
     - PIN, or Welcome + SIGN IN = registered (safe).
     - Welcome + REGISTER = unregistered: **stop, do not register, report**.
   - From a pushed screen, run `back_to_tab_host` first. After any launch, run `dismiss_post_login_prompts` explicitly.
   - Never `adb uninstall`, `xcrun simctl uninstall`, `simctl erase`, or `install_app` on mp-native. Its apps are installed
     and registered; reinstalling is not needed for this run.
2. **Never create real banking data on mp-native.**
   - No CONFIRM tap, no `certify_*`, `create_template` or `delete_first_template` flow, and nothing on the certification
     screen.
   - `goto_payment_summary` stops before CONFIRM, so it is allowed.
3. **Login, logout and `clearState` scenarios run on finportal only** (`/Users/mholecy/dev/finportal/app`). There, login
   stops at the 2FA screen by design, so no code is ever typed. Do not try to get past 2FA.
4. **Do not disturb other sessions.**
   - Another Claude Code session's averi MCP server may be alive: `npm exec averi@0.9.0`, cwd mp-native (pid 703/1199 at
     the time of writing). Do not kill it.
   - Before you drive a device, check `ps -axo pid,lstart,command | grep -E 'maestro|quality_gate|xcodebuild|gradlew'`.
     If a Maestro run, an iOS quality gate or a build is in flight, wait. If it is still running after 10 min, stop and
     report. Never drive a simulator while a gate uses it.
5. **VPN (mp-native backends are IP-gated).**
   - Check before the mp-native part:
     `curl -s -o /dev/null -w '%{http_code}\n' https://starterkit-solution.dev.bsccloud.net/uapi/graphql`
   - Any 403, or no answer, means the VPN is down: skip the mp-native part and report it.
   - A down VPN can look like bad credentials ("Wrong PIN", "Login failed", "The login name does not exist"). Never read
     those as a test result.
6. **Target the emulator explicitly.**
   - A physical Pixel 8 Pro (`42281FDJG000RR`) is sometimes attached.
   - Run `list_devices` first and confirm averi marks `emulator-5554` active. Use `adb -s emulator-5554` for any adb
     command of your own.
7. **Never print or ask for credentials.** Both projects read them from their gitignored `.env.averi`; you only need to
   see the stderr line naming the keys.
8. **A time budget.**
   - A single tool call may legitimately take up to 6–7 min: the first iOS WDA build on finportal, or `verify` across
     both legs.
   - If a scenario hangs past 20 min, kill only YOUR driver process, note it, and move on.

## 2. Setup

```sh
cd /Users/mholecy/dev/mobile-verify
git log -1 --oneline        # expect d69511e or later on architecture/deepening; record it in the report
npm run build               # dist/mcp/server.js — the artifact under test
adb devices                 # emulator-5554
xcrun simctl list devices booted   # iPhone 17 (D34212DB-2134-43E4-99D8-FA89136C729B), iOS 26.5
```

**The driver.** Use the handoff §2 `run-tools.mts` verbatim, saved as `.mts` in your scratch dir and run from the
mobile-verify root. Point it at a project with environment variables:

```sh
# finportal (default APP_CWD)
node --import tsx $RUN/run-tools.mts $RUN/<scenario>.json $RUN/out/<scenario>
# mp-native
AVERI_APP_CWD=/Users/mholecy/Finshape/mp-native node --import tsx $RUN/run-tools.mts $RUN/<scenario>.json $RUN/out/<scenario>
```

Each scenario spawns its own server from `dist/`. Do NOT use mp-native's `.mcp.json` server (it runs the published
0.9.0, which predates every commit under test), and do not edit `.mcp.json`. Use a fresh out dir per scenario.

Tool argument shapes:
- `tap` takes `selector` (a selector string, e.g. `text:"Odhlásiť sa"`).
- `ui_snapshot`'s `filter` is a selector.
- Selector values with spaces are quoted: `text:"SIGN IN"`.
- Regex filters are JS regexes, so there are no inline flags such as `(?i)`; list the casings instead.

**Context hygiene.** Screenshots dominate context. Prefer a filtered `ui_snapshot` and the driver's text output. Look at
a png only when a verdict depends on it, and downscale it first (`sips -Z 700 <png> --out <png>`; there is no
ImageMagick or PIL on this host).

## 3. Run order

Run each part only if the previous one left the devices in a known state. Record wall time per step from the driver's
`ok in N s` lines.

**Part A: finportal, the handoff as written.**
1. `unknown-env.json` (V6). This is the cheapest scenario and needs no device work.
2. `android.json`.
3. `ios.json`. Log out first: the keychain session survives `clearState`.
4. `both.json`.

The expected results are in handoff §4. Record the stderr `averi: loaded … from .env.averi` count: exactly one per
scenario (C2). Two finportal-specific notes:
- The first iOS tree read may build WebDriverAgent, which takes minutes. That is expected.
- The `⚠ tap: the soft keyboard covered id:"login_submit"` line in Android `logged_in` is the keyboard-guard proof. Its
  absence, or a stray character in the password field, is a C1/V1 regression.

**Part B: finportal, the static-screen pixel checks** (handoff §5, the baseline-screenshot bullet and the static half of
the element-region bullet).
- On the `logged_out` login screen with nothing focused:
  - `assert { screenshot: "login", threshold: 0.01 }` twice: `baseline created`, then `0.00% of pixels differ`.
  - A `color` assert on `login_submit` (take the expected fill from a downscaled `screenshot`) and an `ocr` assert on its
    label. Both PASS, with no `⚠ frame:` line on `screenshot` or `ensure_state` output.
- Then focus `login_username` (tap it) so a caret blinks, and repeat the `color` and `ocr` asserts. Both must PASS. Before
  `c444c79` they failed `the screen did not settle: …`.
  - Record each assert's wall time. Expect two rounds, because the region-only settle needs a confirming tree read.
  - `screenshot` on the caret screen must still carry exactly one `⚠ frame:` line.
- Delete the `login` baseline you created when you are done (it lives under finportal's `.averi/baselines/`), unless it
  existed before you started. Check first and note which.
- If the Android keyboard covers `login_submit` while the field is focused, that is expected:
  - Assert on an element still visible above the keyboard (the title or the label, if the tree has it), and say which
    one you used.
  - Do not hide the keyboard, since that ends the caret.

**Part C: mp-native, the pixel poll and the contract tables.** Only if the VPN is up and the look in rule 1 shows a
registered app on that platform. Do Android first, then iOS. iOS reads the **idb** tree there, so container ids
(`…amount_input`, `iban_input`, `bic_input`) are invisible: target buttons and rows, and type into fields by label.
1. **Look.** `list_devices`, then `screenshot {platform}`. Classify the screen (rule 1).
   - If it shows PIN, the app is registered but locked. Reaching Account Detail needs `login_registered`, which types the
     PIN and does not register.
   - Run it ONLY via `ensure_state account_detail` on a screen you just classified as PIN or Account Detail, and read its
     trace for any `login` or `clearState` rung before trusting it. If the plan shows `login` (not `login_registered`),
     stop.
2. **Static screen with live content elsewhere.**
   - `run_flow goto_swift_payment_form {platform}`. Android works. On iOS, averi.yaml now detects `debit_select`; if the
     flow still waits on `amount_input`, report it and use `goto_payment_form` instead.
   - Keep the status-bar clock visible (no `simctl status_bar override`) and focus an input to get a caret:
     - Android: tap `id:swift_payment.form.iban_input`.
     - iOS: tap `label:"IBAN*"`.
     - Then blur by tapping a field ABOVE, never below. On iOS a tap below the focused field lands on the pinned CONTINUE.
   - Assert `color` on `swift_payment.form.continue_button` with `#3f3f50e5` (dE00 default), and `ocr` text `CONTINUE`.
   - If the keyboard hides CONTINUE (Android drops it from the tree while the IME is up; on iOS it rides the keyboard),
     use `swift_payment.form.title` with `ocr` "SWIFT PAYMENT", and report which target you used.
   - Expected: PASS in about two rounds. On a moving screen this proves the region path; record each wall time.
3. **An element that animates itself.**
   - On first entry, the SWIFT form shows a full-screen loading spinner while four catalogs load.
   - Start the `color` assert as soon as the flow returns, with `timeout: "3s"`. If it catches the spinner over the
     measured rect, it must FAIL `the screen did not settle: N captures …`.
   - If the spinner is gone before the first capture, say so. That is not a failure, just not measured.
4. **`verify` with a real contract** (C3, V4+V5, color parity):
   - Contract: `contract: /Users/mholecy/Finshape/mp-native/convergence/contracts/layout/swift-payment-form.json`.
   - State: `swift_payment_form` (or the state name averi.yaml uses for that screen; read it, don't guess).
   - Run it once per platform via `verify`, starting from the form, so `requires:` is already active.
   - Check the section order `## rect parity` / `## color parity` / `## text parity` and the leg wording against handoff §0.
   - On iOS, container anchors will read MISSING (idb); expected, list them.
5. **Rect confirmation on a moving element** (handoff §5, the rect-confirmation bullet):
   - Start a `color` assert on `accounts.detail.payment_type_sheet.row_swift` with a generous `timeout`, from Account
     Detail with live content (the clock).
   - Then immediately `tap id:accounts.detail.action_pay` from a second driver step. The driver is sequential, so do it as
     two processes, or start the assert with a delay. Describe what you did.
   - Expected: no sampled colour reported while consecutive reads disagree on the rect; a pass samples the final rect.
   - Close the chooser with `back_to_tab_host` or the BackButton afterwards.
6. **The recorded residuals** (handoff §5):
   - Attempt them only if steps 1–5 went cleanly and you have budget.
   - Record the numbers either way, and file any pass-before-visible under `docs/bugs/` as the residual measured, not a
     regression.
7. **`scroll_until`** (the 500 → 400 ms post-swipe pause):
   - `run_flow back_to_tab_host`, then `run_flow goto_payment_templates` (it uses `scroll_until`; it requires
     `user_settings_overview`).
   - Watch for an overshoot, i.e. a read before the list settled.
8. **Leave the app on Account Detail or the tab host.** Never on a form with entered data, never on Summary.

**Part D, optional: the comparison baseline.** The handoff compares the text-parity table with a run on `5473982`. Do
this only if Parts A–C are done and you have budget:
- `git worktree add $RUN/wt-5473982 5473982 && cd $RUN/wt-5473982 && npm ci && npm run build`
- Run the same `verify` with `AVERI_SERVER=$RUN/wt-5473982/dist/mcp/server.js`.
- Remove the worktree afterwards (`git worktree remove`).

## 4. Known noise, so you don't file it again

All of these already have notes under `docs/bugs/` (dated 2026-10-05/06):
- `⚠ reach …: this rung is DESTRUCTIVE` printed on a navigation flow whose `requires` is already active.
- An iOS `ui_snapshot` right after `launch_app` returning `[]` or the SpringBoard tree. Use `screenshot` instead; never
  read `[]` as "absent".
- A flow `wait` on an id idb cannot see, burning its full timeout with no hint.
- Android floating Gboard; an iOS tap under the soft keyboard.

Mention them only if they blocked a scenario.

## 5. The report

Write `$RUN/REPORT.md` and reply with its path plus a 15-line summary. The report contains:
1. The commit under test, the date and time, devices, and VPN status.
2. One table per part. Columns: step | expected (quote handoff §4 or this file) | observed (verbatim key lines) | wall
   time | verdict (PASS / FAIL / NOT RUN + why).
3. Per commit in the handoff's §0 table: proven / contradicted / not covered on device, with the evidence row.
4. Every new `docs/bugs/` note you wrote, one line each.
5. The device state you left: which app and which screen on each platform, and baselines created or removed.
6. What you could not do and why: a safety rule, VPN, time, an unregistered app.

Facts only. Quote output, don't paraphrase it. "Not run" is a valid result; a guess is not.
