# Device check: round 2, phase 1 — ElementNotFoundError and the averi.yaml read policy (2026-10-08)

**Measured 2026-10-08 09:58–10:04 CEST (07:58–08:04 UTC)**, averi `dist/` built from `fb171ef` (branch
`architecture/round2-2026-10-08`; commits `8040351` refactor(interact) ElementNotFoundError, `fb171ef` refactor(mcp)
one averi.yaml read per tool call). Driven through the handoff's stdio MCP driver `run-tools.mts`
(docs/plans/2026-10-05-device-verification-handoff.md §2, with the `sleep` / `sh` pseudo-steps of the 2026-10-07
check), server cwd `/Users/mholecy/dev/finportal/app` (its `averi.yaml` and `.env.averi`, unmodified — every
broken-config and scratch-flow case passes `configPath` to a copy in the session scratchpad `device-round2/`).
Devices: `emulator-5554` (sdk_gphone64_arm64, Android 13) and `iPhone 17` (`D34212DB-…`, iOS 26.5,
`treeSource: wda`). finportal `sk.finportal.myport` debug build, Metro up on 8081. No login was submitted; no
`login` / `ensure_state logged_in` was run; no credentials were typed. Durations are the tool call's own.

Host load: Spotlight (`mds_stores`, ~400 % CPU) held the load average at 27–38 throughout. The first Android
run hit 15 s `uiautomator dump` timeouts (rows 1a′, A-cleanup read-back); those steps were re-run and the
re-runs are the verdict rows. The timeouts themselves are a useful data point (Observations 2).

Scratch configs (`device-round2/`):
- `valid-averi.yaml` — finportal's file plus a flow `optional_probe`:
  `wait login_screen` → `optional: [tap id:nosuch_probe_id, timeout 2s]` → `optional: [fill id:login_username value "tab\there" clear]`
  → `optional: [wait element id:nosuch_probe_wait, timeout 2s]` → `optional: [scroll_until id:nosuch_probe_scroll, down, maxSwipes 2]` → `wait login_screen`.
- `broken-yaml.yaml` — `flows:` → `flows: [` (YAML syntax error).
- `broken-schema.yaml` — `launch:` → `launhc:` in `open_app` and `login` (schema-invalid, valid YAML).
- `nosuch-averi.yaml` — does not exist; and the scratch directory itself for EISDIR.

## A — `8040351` ElementNotFoundError / `optional:`

| # | scenario | outcome | duration | key trace lines | verdict |
|---|---|---|---|---|---|
| 1a | Android `tap id:nosuch_probe_id` (non-optional, default 5 s budget) | isError, never-found wording | 31.6 s (slow reads under load) | `Timed out after 5000ms waiting for element id:nosuch_probe_id to appear` — no "visible and settled" | PASS |
| 1a′ | same, first attempt, last tree read timed out | isError, plain Error with the read error beneath (a dead/slow device is never "not present") | 15.1 s | `Timed out after 5000ms waiting for element id:nosuch_probe_id to appear` / `(last UI tree read failed: device emulator-5554 is reachable but SLOW: uiautomator dump timed out after 15 s …)` | PASS (as designed) |
| 1b | iOS `tap id:nosuch_probe_id` | isError | 6.4 s | `Timed out after 5000ms waiting for element id:nosuch_probe_id to appear` | PASS |
| 1c | Android `scroll_until id:nosuch_probe_scroll` `maxSwipes: 2` | isError | 10.5 s | `scroll_until id:nosuch_probe_scroll failed after 2 swipes (maxSwipes) — element never appeared in the tree` | PASS |
| 1c′ | same, first attempt under load | isError, the read error named instead of "never appeared" | 25.3 s | `scroll_until id:nosuch_probe_scroll failed after 15000ms (timeout) — last UI tree read failed: device emulator-5554 is reachable but SLOW: …` | PASS (as designed) |
| 1d | iOS `scroll_until`, same | isError | 5.8 s | `… failed after 2 swipes (maxSwipes) — element never appeared in the tree` | PASS |
| 2 | `run_flow optional_probe` (`configPath` → valid copy), username seeded `keepme` first, keyboard hidden; Android | ok; four skips, each with its own reason; field unchanged | 25.7 s | `optional: skipped id:"nosuch_probe_id" (not present)` / `optional: skipped step (cannot type U+0009 ("\t", a control character): it is a key, not text — … Refused on both platforms before anything was sent. …pressKey('enter') …)` / `optional: skipped step (Timed out after 2000ms waiting for element id:"nosuch_probe_wait")` / `optional: skipped step (not present)` (scroll_until) / `flow optional_probe: done`; read back `"value": "keepme"` | PASS |
| 2′ | same on iOS | identical trace; field unchanged | 15.5 s | the same four `optional: skipped …` lines; read back `"value": "keepme"` | PASS |
| — | cleanup both platforms: `type_text id:login_username ""` `clear: true`, keyboard hidden (Android `back`, iOS tap `login_title`) | field empty | 22.5 s / 6.3 s | `Filled id:login_username (0 characters, cleared first)`; iOS read back `"value": null`; Android raw dump `text=""` `focused="false"` | done |
| 3 | found-but-unsettled ("…to hold still (found, but never at the same position in two consecutive reads)") | not provoked | — | needs an element that moves between every pair of tree reads for the whole budget; finportal's login screen has none | NOT RUN (unit tests only) |

## B — `fb171ef` one averi.yaml read per tool call

All error rows are the FIRST call(s) of a fresh server unless noted; 0.0 s means no device was touched (no adb /
simctl / WDA call precedes the read).

| # | scenario | outcome | duration | key lines | verdict |
|---|---|---|---|---|---|
| 1a | Android `assert` → `broken-yaml.yaml` | isError before binding | 0.0 s | `Block collections are not allowed within flow collections at line 99, column 5:` / `  open_app:` — the file is NOT named (Observations 1) | PASS (behaviour) / wording defect |
| 1b | Android `assert` → `broken-schema.yaml` | isError, file named | 0.0 s | `Invalid /…/device-round2/broken-schema.yaml:` / `  flows.open_app.steps.0: Unrecognized key(s) in object: 'launhc'` / `  flows.open_app.steps.0: platform override needs android and/or ios` (+ same for `login`) | PASS |
| 1c | Android `assert` → valid copy | ok, health line | 2.9 s | `All 1 asserts passed` / `PASS  element id:"login_username" exists` / `appAlive: true` | PASS |
| 1d | Android `assert` → missing file | ok, NO health line | 2.8 s | `All 1 asserts passed` / `PASS …` (no `appAlive:`) | PASS |
| 1e | Android `assert` → a directory | isError | 0.0 s | `EISDIR: illegal operation on a directory, read '/…/device-round2'` | PASS |
| 1f | iOS `assert` → `broken-yaml.yaml` | isError | 0.0 s | same YAML message | PASS |
| 1g | iOS `assert` → valid copy | ok, health line (WDA tree source from the copy) | 3.5 s | `PASS  element id:"login_username" exists` / `appAlive: true` | PASS |
| 2a | `terminate_app` (pidof exit 1), then Android `launch_app sk.finportal.myport` (neither activity nor intent) → `broken-yaml.yaml`, then → `broken-schema.yaml` | both isError; app NOT started | 0.0 s each | the YAML message / the `Invalid …broken-schema.yaml:` message; 2 s later `pidof sk.finportal.myport` exit 1 | PASS |
| 2b | Android `launch_app` `activity: .MainActivity` → `broken-yaml.yaml` (policy none) | launched | 0.3 s | `Launched sk.finportal.myport/.MainActivity on android`; `pidof` → `25178` | PASS |
| 2c | Android `launch_app` (no activity) → missing file | launched via monkey (no `app.android.activity` fallback) | 0.7 s | `Launched sk.finportal.myport on android` (no `/.MainActivity`); `pidof` → `25224` | PASS |
| 2d | Android `launch_app` (no activity) → valid copy | launched with the config's activity | 0.1 s | `Launched sk.finportal.myport/.MainActivity on android` | PASS |
| 2e | iOS `launch_app` → `broken-yaml.yaml` (policy none) | launched | 0.9 s | `Launched sk.finportal.myport on ios` | PASS |
| 3a | Android `ui_snapshot id:login_screen` → `broken-yaml.yaml` (policy none) | ok, no config error | 3.4 s | `[]` + `⚠ 0 matches for id:login_screen, and the tree is bare: 11 nodes …` — taken 4 s after the cold launch of 2d under load, the app was still rendering; the same filter 6 s later in the same server returned `login_screen` | PASS |
| 3b | Android `tap id:login_title` → `broken-schema.yaml` | ok | 6.1 s | `Tapped id:login_title` | PASS |
| 3c | iOS `tap id:login_title` → `broken-yaml.yaml` (first call of the server) | isError before binding | 0.0 s | YAML message; no WDA session, no accessibility-defaults stderr line before row 2e | PASS |
| 3d | iOS `ui_snapshot` → `broken-schema.yaml` | isError | 0.0 s | `Invalid /…/broken-schema.yaml: …` | PASS |
| 3e | iOS `type_text id:login_username "x"` → `broken-yaml.yaml` | isError, nothing typed | 0.0 s | YAML message | PASS |
| 3f | iOS `scroll_until id:login_submit` → `broken-yaml.yaml` | isError | 0.0 s | YAML message | PASS |
| 3g | iOS `ui_snapshot id:login_username` → missing file | ok on the default idb tree source | 0.4 s | `textfield … "identifier": "login_username"` (0.4 s vs 1.3 s for the WDA read with the real config right after) | PASS |
| 4a | Android `run_flow open_forgot` → `broken-yaml.yaml` / `broken-schema.yaml` | isError, no modal opened | 0.0 s | YAML message / `Invalid …broken-schema.yaml:`; final snapshot shows `login_screen`, no `forgot_modal` | PASS |
| 4b | Android `run_flow open_forgot` → missing file (required) | isError | 0.0 s | `ENOENT: no such file or directory, open '/…/nosuch-averi.yaml'` | PASS |
| 4c | Android `ensure_state logged_out` → `broken-yaml.yaml` | isError | 0.0 s | YAML message | PASS |
| 4d | `verify` android `state: logged_out` → `broken-yaml.yaml` | thrown isError, no `## android` section | 0.0 s | YAML message only | PASS |
| 4e | iOS `run_flow open_forgot` → `broken-schema.yaml`; iOS `ensure_state logged_out` → `broken-yaml.yaml` | isError | 0.0 s | as above | PASS |
| 5a | regression, real config, Android: `launch_app` (no activity), `assert` ×2, `ui_snapshot`, `tap id:login_forgot`, `press_key back`, `ensure_state logged_out` | all ok | 0.1 / 5.2 / 2.5 / 5.4 / 0.1 / 4.0 s | `Launched sk.finportal.myport/.MainActivity on android`; `appAlive: true`; `Tapped id:login_forgot` → `forgot_modal` in the tree; after `back` `PASS element id:"forgot_modal" is absent`; `state logged_out: already active`; stderr one `averi: loaded AVERI_STAGE_USERNAME, … from .env.averi` line (at the first engine tool only) | PASS |
| 5b | same on iOS (modal closed with `tap id:forgot_close`) | all ok | 6.8 / 1.4 / 3.1 / 3.0 / 2.6 / 2.7 s | `appAlive: true`; `Tapped id:login_forgot` → `forgot_modal`; `Tapped id:forgot_close`; `state logged_out: already active` | PASS |

## Observations

1. **A YAML syntax error does not name the file** (wording defect, minor; pre-existing — `parseConfig` is
   unchanged from `00c6892` — but newly prominent). `flow/config.ts#parseConfig` names `source` only for a
   schema failure (`Invalid <path>:`); a `parseYaml` throw escapes as the bare yaml-library message. Since
   `fb171ef` every tool under optional/required policy fails with it — including an Android `assert` / `launch_app`
   that never mentioned averi.yaml before — so the user sees, for an `assert` or a `tap` on iOS, only:
   ```
   Block collections are not allowed within flow collections at line 99, column 5:

     open_app:
   ```
   with no hint that it is averi.yaml (let alone which one, when `configPath` points elsewhere). ARCHITECTURE.md §5
   says a present-but-invalid file "fails the call, naming the file". Suggested fix: wrap `parseYaml` in
   `parseConfig` and rethrow as `Invalid <source>: <yaml message>`, with a test beside the schema-invalid one.
   **Fixed** in the config-policy commit (`1225d63`): a syntax error now reads `Invalid <path>: Block collections are
   not allowed … at line N, column M: …` with the parser's error as `cause`; pinned in `tests/flow/config.test.ts`,
   `tests/flow/tool-config.test.ts` and through the MCP `assert` tool. To be re-run on device with phase 2.
2. **Under host load, the read-error path behaves as designed.** With `uiautomator dump` timing out at 15 s, a
   non-optional `tap` on an absent id said "…to appear" with the `(last UI tree read failed: … SLOW …)` line beneath
   (plain Error, not ElementNotFoundError), and `scroll_until` named the read failure instead of "never appeared".
   No optional step was skipped as "(not present)" on a failed read during the run (the optional probe flow ran
   between slow reads and its reads succeeded).
3. Noise, pre-existing: a schema-invalid step prints a second line per step from the union's other branch
   (`platform override needs android and/or ios`) beside the real `Unrecognized key(s) … 'launhc'`. **Fixed** in
   the same commit: that issue is dropped only where an unknown-key issue sits at the same path (`- {}` still gets it).
4. Missing file under the required policy (row 4b) is the raw `ENOENT: no such file or directory, open '…'` — it
   names the path, so it is clear enough; not a defect.
5. MCP `tap`/`scroll_until` quote a selector as the user wrote it (`id:nosuch_probe_id`), the flow trace as
   `id:"…"`; unchanged by these commits.

No other defect.

## Not tested

- Found-but-unsettled (`…to hold still (found, …)`) — not provokable on finportal (row A3).
- An optional tap whose presence check SIGHTED the element and then lost it (quotes its own timeout) — needs an
  element that disappears within ~1 s of appearing.
- An optional step skipped on a failed last read (`skipped … (<headline> (last UI tree read failed: …))`) — the
  host load produced read failures only on the non-optional tools; not forced (would need killing the device mid-flow).
- `install_app` under the policy (not run: reinstalling resets the app; unit-tested).

## State left

Android: finportal on `login_screen` (terminated and relaunched several times by B2, no state wipe), username
empty and unfocused, no modal. iOS: finportal on `login_screen` (relaunched in B2e), username empty, no keyboard,
no modal. finportal's `averi.yaml` / `.env.averi` untouched (mtimes Sep 22 / Sep 18). Scenario JSONs, logs and
the scratch configs: the session scratchpad `device-round2/`.
