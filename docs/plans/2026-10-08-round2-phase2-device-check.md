# Device check: round 2, phase 2 — regex at parse, PNG-or-transport-error, empty secrets, state cycles (2026-10-08)

> **Status (2026-10-08):** on main.
>
> Shas below are pre-squash branch commits; on main: `0bde46f` → `2794f5e`, `1e0d0bf` → `3400e12`, `25cb887` → `069c7c0`.

**Measured 2026-10-08 11:04–11:12 CEST (09:04–09:12 UTC)**, averi `dist/` built from `25cb887` (branch
`architecture/round2-2026-10-08`; phase-2 commits `cb2192b` fix(interact) AfterDismissalTap, `83f99bb` fix(verify)
regex refused at parse, `0bde46f` fix(adapters) a screenshot is a PNG or a transport error, `1e0d0bf` fix(flow) empty
secrets / type_pin without digits / SetupError inside `optional:`, `25cb887` fix(flow) detect cycles and reach/requires
re-entry; plus the phase-1 recheck of `1225d63`). Driven through the handoff's stdio MCP driver `run-tools.mts`
(docs/plans/2026-10-05-device-verification-handoff.md §2, with the `sleep` / `sh` pseudo-steps), server cwd
`/Users/mholecy/dev/finportal/app` (its `averi.yaml` and `.env.averi` unmodified — mtimes Sep 22 / Sep 18 after the
run; every scratch case passes `configPath` to a copy in the session scratchpad `device-round2-p2/`). Devices:
`emulator-5554` (Android 13) and `iPhone 17` (`D34212DB-…`, iOS 26.5, `treeSource: wda`). finportal
`sk.finportal.myport` debug build, Metro up on 8081. No login was submitted; no `login` / `ensure_state logged_in`
was run; the only values typed were `keepme` and `probe-user` into `login_username`, cleared afterwards. Durations are
the tool call's own; 0.0 s means no device was touched.

Scratch configs (`device-round2-p2/`):
- `p2-valid.yaml` — finportal's file plus: `app.ios.keyboardDismiss: [{ tap: { id: login_title } }]`;
  `credentials.probe: ""` and `credentials.probe_env: ${AVERI_NOSUCH_PROBE_VAR}` (unset); states `forgot_open`
  (detect `forgot_modal`, reach `[via_x]`), `x_state` (detect absent id `nosuch_probe_x`, reach `[via_forgot]`), and
  the same pair `forgot_open_fb` (reach `[via_x_fb, open_forgot]`) / `x_state_fb` (reach `[via_forgot_fb]`); flows
  `via_x` (requires `x_state`), `via_forgot` (requires `forgot_open`), `via_x_fb` / `via_forgot_fb` likewise (each a
  single `tap login_forgot`, never reached), `secret_fill` (`fill login_username = $probe`), `secret_fill_optional`
  (the same inside `optional:`, then `wait login_screen`), `secret_fill_env` (`= $probe_env`), `pin_abc`
  (`type_pin "abc"`), `pin_abc_keypad` (`type_pin "abc"` with `keypad.id_pattern`), `literal_fill`
  (`fill login_username = "probe-user"`, `clear`, `dismissKeyboard: true`), `valid_match_assert`
  (`assert: [login_username, login_title match "^Log"]`).
- `p2-bad-regex.yaml` — finportal's file plus a flow `bad_regex` whose `assert:` step has `{ element: { id: login_title }, match: "(" }` at index 1.
- `p2-cycle.yaml` — finportal's file plus `cyc_a.detect: any: [element nosuch_probe_a, state: cyc_b]`, `cyc_b.detect: state: cyc_a`.
- `broken-yaml.yaml` — phase 1's copy (`flows:` → `flows: [`).
- `bin/adb`, `bin2/adb` — PATH-prefixed wrappers that forward everything to the real adb except `exec-out screencap -p`,
  which exits 0 with nothing (`bin/`) or with `Killed\n` (`bin2/`). Only the driver's server process saw them.

## 1 — `83f99bb` a regex that does not compile is refused at parse

| # | scenario | outcome | duration | key lines | verdict |
|---|---|---|---|---|---|
| 1a | MCP `assert` (fresh server, `configPath` → valid copy) `[login_username, {login_title, match: "("}]`; Android / iOS | isError, nothing judged, no device bound | 0.0 s / 0.0 s | `"message": "not a valid regular expression — Invalid regular expression: /(/: Unterminated group", "path": ["match"]` (see Observations 1) | PASS |
| 1b | `get_logs grep: "tpm\|("`; Android / iOS | isError, input validation, before any log pull | 0.0 s / 0.0 s | `MCP error -32602: Input validation error: Invalid arguments for tool get_logs: … "not a valid regular expression — Invalid regular expression: /tpm\|(/i: Unterminated group", "path": ["grep"]` | PASS |
| 1c | `run_flow bad_regex` → `p2-bad-regex.yaml`; Android / iOS | isError at load, file + path named | 0.0 s / 0.0 s | `Invalid /…/p2-bad-regex.yaml:` / `  flows.bad_regex.steps.0.assert.1.match: not a valid regular expression — Invalid regular expression: /(/: Unterminated group` | PASS |
| 1d | regression: MCP `assert` `[login_username, {login_title, match: "^Log"}]` | ok | 6.8 s / 5.2 s | `PASS  element id:"login_title" matching /^Log/ exists` / `appAlive: true` | PASS |
| 1e | regression: `run_flow valid_match_assert` (assert: step with a valid match) | ok | 5.9 s / 2.5 s | `assert PASS: element id:"login_title" matching /^Log/ exists` / `flow valid_match_assert: done` | PASS |
| 1f | regression: `get_logs grep: "tpm\|averi"` `sinceSeconds 5` | ok | 0.2 s / 1.2 s | `[grep /tpm\|averi/i matched 0 of 0 lines]` / `… matched 0 of 8429 lines` | PASS |

## 2 — `1e0d0bf` empty secrets, type_pin without digits, SetupError inside `optional:`

Username seeded `keepme` (MCP `type_text … clear`), keyboard hidden (Android `back`, iOS tap `login_title`) before 2a.

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 2a | `run_flow secret_fill` (`credentials.probe: ""`); Android / iOS | isError at the fill, no tap | 2.4 s / 1.1 s | `wait: element id:"login_screen"` / `✗ fill id:"login_username": failed — Credential "$probe" is empty (declared as "" under credentials:) — give it a value there (a ${VAR} set in .env.averi keeps the secret out of averi.yaml), and retry` | PASS |
| 2b | `run_flow secret_fill_optional` (same fill inside `optional:`) | flow FAILS, not skipped; the final `wait` never ran | 2.6 s / 1.2 s | same single `✗ fill …` line; no `optional: skipped` line, no `flow …: done` | PASS |
| 2c | `run_flow secret_fill_env` (`${AVERI_NOSUCH_PROBE_VAR}` unset) | isError, own wording kept | 2.6 s / 1.3 s | `✗ fill id:"login_username": failed — Environment variable AVERI_NOSUCH_PROBE_VAR is not set (needed for credential "probe_env") — set it in .env.averi beside averi.yaml, or export it, and retry` | PASS |
| 2d | `run_flow pin_abc` (keystroke path) | isError before any key | 2.7 s / 1.3 s | `✗ type_pin: failed — type_pin "abc" has no digits — a PIN is typed digit by digit and everything else is dropped as formatting, so nothing would be typed; give it a value with digits, and retry` | PASS |
| 2e | `run_flow pin_abc_keypad` (keypad path) | same refusal, no keypad lookup | 2.6 s / 1.2 s | same line | PASS |
| 2f | read back after 2a–2e | field untouched | 2.5 s / 1.2 s | `"identifier": "login_username", "value": "keepme"` on both | PASS |
| 2g | regression: `run_flow literal_fill` (`probe-user`, clear, dismissKeyboard) | ok, value typed | 17.7 s / 8.5 s | `fill: id:"login_username" = probe-user (cleared)` / `flow literal_fill: done`; read back `"value": "probe-user"` | PASS |
| — | cleanup: MCP `type_text id:login_username ""` `clear`, keyboard hidden | field empty | 11.1 s / 6.4 s | `Filled id:login_username (0 characters, cleared first)`; read back `"value": null` | done |

## 3 — `25cb887` detect cycles at parse, reach/requires re-entry at run time

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 3a | `ensure_state cyc_a` and `run_flow open_forgot` → `p2-cycle.yaml`; Android / iOS | isError at load (any tool), path named | 0.0 s each | `Invalid /…/p2-cycle.yaml: states.cyc_a.detect refers back to itself: states.cyc_a → states.cyc_b → states.cyc_a (a { state: … } condition is evaluated through that state's detect, so this one would never finish)` | PASS |
| 3b | `ensure_state forgot_open` from the login screen (neither loop state detected), no fallback; Android / iOS | isError, fails fast, NO tap (modal absent after) | 12.4 s / 5.4 s | `⚠ reach via_forgot: failed — ensure_state forgot_open re-entered itself: states.forgot_open → flows.via_x → states.x_state → flows.via_forgot → states.forgot_open — no state on this loop is on screen, so its rungs can only call each other; start from a screen one of them detects, or drop the requires: that closes the loop` / `⚠ reach via_x: failed — <same>`; the result's headline is the same ReentryError; next `assert` `PASS element id:"forgot_modal" is absent` | PASS |
| 3c | `ensure_state forgot_open_fb` (reach `[via_x_fb, open_forgot]`) | ok, escalated to the fallback and reached | 26.0 s / 12.7 s | `⚠ reach via_forgot_fb: failed — ensure_state forgot_open_fb re-entered itself: states.forgot_open_fb → flows.via_x_fb → states.x_state_fb → flows.via_forgot_fb → states.forgot_open_fb — …` / `⚠ reach via_x_fb: failed, escalating to open_forgot — <same>` / `flow open_forgot: start` … `tap: id:"login_forgot"` … `flow open_forgot: done` / `state forgot_open_fb: reached after open_forgot` + image | PASS |
| — | close the modal (Android `back`, iOS `tap id:forgot_close`), assert absent | closed | 0.1 s / 3.0 s | `PASS element id:"forgot_modal" is absent` | done |

The only tap in all of 3b/3c is the fallback's own `login_forgot` (the loop rungs' taps never ran, as designed: no step runs in a re-entry subtree).

## 4 — `0bde46f` a screenshot is a PNG or a transport error

| # | scenario | outcome | duration | key lines | verdict |
|---|---|---|---|---|---|
| 4a | regression: `screenshot`; Android / iOS | image | 1.5 s / 1.3 s | png returned | PASS |
| 4b | regression: `assert` `[{login_submit, color #000000}, login_username]` (measuring) | color FAILs on a real measurement, element PASS | 15.0 s / 13.8 s | `sampled #FAFAFA (dominant, 90% of region) vs expected #000000 → dE00 98.03 > 8` (iOS 91 %, scale 3.000) | PASS |
| 4b′ | regression: same with `#FAFAFA` | both PASS | 7.7 s / 6.8 s | `fill within dE00 8 of #FAFAFA — sampled #FAFAFA … dE00 0.00 ≤ 8` | PASS |
| 4c | regression: `verify platforms:[p] state: logged_out` | ok, image | 5.4 s / 3.4 s | `## android` / `state logged_out: already active` + image (iOS likewise) | PASS |
| 4d | regression: `ensure_state logged_out` | ok, image | 4.3 s / 2.7 s | `state logged_out: already active` + image | PASS |
| 4e | Android, `bin/adb` (0-byte, exit 0): `screenshot` | isError, transport message | 0.0 s | ``adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 0 bytes — not a PNG, though the command reported success: the device transport failed (a dying or hung emulator / simulator), not the app's screen. Re-check `adb devices` and retry; if it repeats, the emulator, not the app, needs attention.`` | PASS |
| 4e′ | Android, `bin2/adb` (`Killed\n`, exit 0): `screenshot` | isError | 0.2 s | `… returned 7 bytes starting "Killed" — not a PNG, though the command reported success: …` | PASS |
| 4f | `bin/adb`: `assert` `[{login_submit, color #FAFAFA} (passes with real captures), login_username]` | color fails closed after one capture, element still judged | 4.1 s | `FAIL  element id:"login_submit" fill within dE00 8 of #FAFAFA — screenshot failed: <the transport message>; failing closed, color unchecked` / `PASS  element id:"login_username" exists` | PASS |
| 4g | `bin/adb`: `assert` `[{login_title, ocr "Login"}, {login_title, match "^Log"}]` | ocr fails closed, element still judged | 4.1 s | `FAIL  element id:"login_title" renders text "Login" — screenshot failed: …; failing closed, rendered text unchecked` / `PASS  element id:"login_title" matching /^Log/ exists` | PASS |
| 4h | `bin/adb`: `verify platforms:[android] state: logged_out` | ok, trace kept, no image | 2.1 s | `## android` / `state logged_out: already active` / `⚠ screenshot: <the transport message> — no image is returned` / `appAlive: true` | PASS |
| 4i | `bin/adb`: `ensure_state logged_out` | ok, trace kept, no image | 2.1 s | `state logged_out: already active` / `appAlive: true` / `⚠ screenshot: … — no image is returned` | PASS |

iOS refusal path (simctl io) not simulated: a `xcrun` wrapper would have to intercept a subcommand of a multiplexer the
WDA/idb paths also use; not attempted.

## 5 — `cb2192b` iOS in-tree post-fill dismissal

| # | scenario | outcome | duration | key lines | verdict |
|---|---|---|---|---|---|
| 5a | iOS `run_flow literal_fill` (`dismissKeyboard: true`, `keyboardDismiss: [tap login_title]` in the copy) | ok; no dismissal tap needed | 8.5 s / 10.2 s (rerun) | `fill: id:"login_username" = probe-user (cleared)` — no `; keyboard hidden by …` suffix: the simulator has a hardware keyboard connected, the soft keyboard is off screen (the WDA tree's keyboard node sits at y 874 = screen bottom, `"ofKeyboard": true`), screenshot shows no keyboard, so the in-tree model correctly found nothing to hide | PASS (regression; tap path not exercised) |
| 5b | iOS MCP `type_text id:login_username probe-user clear` | ok | 6.4 s | `Filled id:login_username (10 characters, cleared first)`; screenshot: no keyboard | PASS |
| 5c | a read that FAILS after the dismissal tap (AfterDismissalTap) | not provoked | — | needs the soft keyboard on screen (Simulator "Connect Hardware Keyboard" off — a host UI setting, not changed) AND a WDA read that throws within ms of the tap | NOT RUN (unit tests only) |

## 6 — phase-1 recheck (`1225d63`)

| # | scenario | outcome | duration | key lines | verdict |
|---|---|---|---|---|---|
| 6 | `assert` → `broken-yaml.yaml`; Android / iOS | isError before binding, file named | 0.0 s / 0.0 s | `Invalid /…/device-round2-p2/broken-yaml.yaml: Block collections are not allowed within flow collections at line 99, column 5:` / `  open_app:` / `    steps:` / `    ^` | PASS (phase-1 Observation 1 fixed) |

## Observations

1. **MCP `assert` refusal does not say which assert** (minor, pre-existing — `parseAsserts` in `src/mcp/tools.ts`
   parses each element of `asserts` separately, so the ZodError's path is relative to the one spec). Row 1a, with the
   bad `match` at index 1 of 2, returns only
   ```
   [ { "code": "custom", "message": "not a valid regular expression — Invalid regular expression: /(/: Unterminated group", "path": [ "match" ] } ]
   ```
   — no `asserts.1`, no "Invalid arguments" headline, unlike `get_logs` (`MCP error -32602: Input validation error:
   Invalid arguments for tool get_logs: … "path": ["grep"]`) and the config path (`flows.….assert.1.match`). With
   several element asserts the user cannot tell which one. Suggested: parse the array as one schema
   (`z.array(assertSpecSchema)`) or prefix each issue path with the index.
2. Cosmetic: the fail-closed detail joins the adapter's sentence and the verdict with `.;` —
   `… the emulator, not the app, needs attention.; failing closed, color unchecked` (rows 4f/4g). **Fixed** in the screenshot commit
   (`2794f5e`): `screenshotFailed` drops the adapter sentence's full stop; pinned in `tests/verify/assert.test.ts`.
3. Cosmetic: the `⚠ screenshot:` line sits before `appAlive:` in `verify` (4h) but after it in `ensure_state` (4i).
4. 3b/3c on Android took 12.4 s / 26.0 s for what are reads only (iOS 5.4 s / 12.7 s): each loop entry is a full
   detect probe through `uiautomator dump`; bounded as designed, not a defect.
5. Both finportal apps leave `login_username` focused (caret visible, Android `focused="true"`) after the cleanup
   fill; the soft keyboard is not shown on either (Android `mInputShown=false`; iOS hardware keyboard). Tapping
   `login_title` does not blur the field on Android. Harmless; noted because phase 1 recorded "unfocused".

No functional defect.

## Not tested

- AfterDismissalTap (5c) — the iOS soft keyboard never shows on this simulator (hardware keyboard connected); the
  in-tree dismissal therefore never taps. Unit tests only.
- The iOS screenshot refusal (simctl io writing a non-PNG) — not simulated (see §4).
- A refused capture inside a screenshot-baseline assert — not run (no finportal baseline); the color and ocr rows
  cover the same fail-closed path.
- ReentryError's "none of this loop's states could be read on this probe" variant — needs a failing tree read at the
  re-entry probe.

## State left

Android: finportal on `login_screen`, `login_username` empty (focused, no soft keyboard), no modal. iOS: finportal on
`login_screen`, `login_username` empty (focused, no keyboard on screen), no modal. finportal's `averi.yaml` /
`.env.averi` untouched. Scenario JSONs, logs, wrappers and scratch configs: the session scratchpad `device-round2-p2/`.
