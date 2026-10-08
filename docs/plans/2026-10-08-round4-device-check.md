# Device check: round 4 — the RN text echo, the idb launch transient, the nits (2026-10-08)

**Measured 2026-10-08 14:08–14:14 CEST.** averi `dist/` was rebuilt (`npm run build`) from `b546c98`, the head of branch
`architecture/round4-2026-10-08`. It carries three commits: `e7d497e` (nits: seconds in messages, the second-look line,
no stderr pointer), `6a93602` (WDA drops the unidentified StaticText echo under every RN text) and `b546c98`
(ui_snapshot's settle read re-reads an idb empty tree once after 1 s).

The checks were driven through the stdio MCP driver `run-tools-p.mts` (round 3's copy of `run-tools.mts`, which
overrides only the server's `PATH`), with server cwd `/Users/mholecy/dev/finportal/app`. Its `averi.yaml` and
`.env.averi` were not modified, and every call passed `configPath` to a scratch copy.

Devices:
- `emulator-5554` (Android 13, `wm size` 1080x2220)
- `iPhone 17` (`D34212DB-2134-43E4-99D8-FA89136C729B`, iOS 26.5)

App: `sk.finportal.myport`, the debug build (expo dev-client), with Metro on :8081 started for the run and stopped
after it.

What was not done: no login was submitted, and no `login` flow or `ensure_state logged_in` was run. Nothing was typed.
No clearState, logout, uninstall or simulator reboot was used. Cold launches were `simctl terminate` or
`am force-stop`, followed by `launch_app` without clearState.

Scratch files are in the session scratchpad, under `device-round4/`:
- `r4-wda.yaml`: round 3's `r3p2-averi.yaml` (`treeSource: wda`). Its state `no_prompt` is an absence detect whose
  only rung is `r3_harmless`, a 1 s optional tap on a missing id, so it has no clearState.
- `r4-idb.yaml`: the same file without `treeSource`.
- `r4-contract.json`: round 3's scratch text contract, with `login_title` "Login" and `maintenance_text`.
- `bin-noswift/`: wrappers for adb and idb, plus `xcrun` and `xcodebuild` symlinks. With a server `PATH` of
  `bin-noswift:/bin`, `swiftc` is ENOENT.
- `bin-log/`: idb and adb wrappers that log each `ui describe-all` and `uiautomator dump` to `idb-calls.log` and
  `adb-calls.log`, with a millisecond timestamp and the payload's element count, first type and size.
- Logs: `t1`, `t2`, `i1`, `i1b`, `i1c`, `i2`, `n`, `n3` and `fin`, each as `.json`, `.log` and `out-*`.

## T — `6a93602` the RN text echo (iOS, WDA)

| id | what | expected | observed (quoted) | verdict |
|---|---|---|---|---|
| T1 | full `ui_snapshot` of the login screen | each RN text once | 165 nodes, 10 text nodes, and **every text label occurs once**: `Infra - rozsirenie docker o dalsi node`, `from 13. 10. 2026 9:00`, `to 13. 10. 2026 11:00`, `English`, `Login`, `Username`, `Password`, `Log in`, `Reset account`, and the support sentence. No text node has an unidentified child with the same label. The remaining same-label pairs are distinct identified elements: button `lang_en` / text `login_language_switcher_label`, `login_submit` / `login_submit_label`, `login_forgot` / `login_forgot_label`, and label text / textfield for Username and Password. `filter id:login_title` → one node, `"label": "Login", "identifier": "login_title"`, rect 36,351 330x24 | PASS |
| T2 | `text:` selector, tap-free | exactly one match, no multi-match note | `ui_snapshot filter text:"Login"` → **1 node** (`identifier: login_title`). `text:"Infra - rozsirenie docker o dalsi node"` → 1 node (`maintenance_text`). `assert` → `All 2 asserts passed` / `PASS  element text:"Login" exists` / `PASS  element text:"Infra - rozsirenie docker o dalsi node" exists`. No "N matches" note anywhere | PASS |
| T3 | `verify` both legs, text contract, OCR unavailable (`PATH=bin-noswift:/bin`) | the ios column reads the text once, and round 3's 4 TEXT findings are gone | `(ios: OCR failed — … spawn swiftc ENOENT — that platform compared from the tree.)`, then `login_title  tree  Login  Login  Login  —  OK` and `maintenance_text  tree  Infra - rozsirenie dock… Infra - rozsirenie dock… Infra - rozsirenie dock…  —  OK`, then **`text parity: MATCHES (size tolerance 10.00%) on 2 of 2 anchor(s) — 0 not opted in.`** Round 3 (`device-round3-p2/o2-noswift-ios.log`) had ios `Login Login`, both rows FAIL, and `text parity: 4 COPY DRIFT(S)`. Rect parity is unchanged: the same 2 ASPECT deltas (2.81%, 2.51%) | PASS |

## I — `b546c98` the idb launch transient (iOS, default idb tree source)

| id | what | expected | observed (quoted) | verdict |
|---|---|---|---|---|
| I1 | `launch_app` then `ui_snapshot` at once, **13 cold launches** (5 after a 1.5 s pause, 3 logged, 5 logged with no pause) | a tree from the re-read, or the retried error | **12/13 returned a rendered tree**, for example `text:"Login"` → `"label": "Login"`, rect 36,351 330x24. `launch_app` took 0.9–1.0 s and `ui_snapshot` **1.7–2.0 s**. The idb log shows the re-read at work every time: first read `-> 1 [('Application', 0, 0)]`, and **1.39–1.54 s later** `-> 17 [('Application', 402, 874)]`. In one logged launch (i1b.1), the first read was already non-empty (`2 [('Application', 402, 874)]`, a single read in 1.1 s): `[]` / `0 matches for text:"Login" in a tree of 3 nodes (roles: container ×1, other ×1, text ×1)`, which is the dev-client loading tree. In one launch (i1c.2), the re-read was a 402x874 Application with no children, so it was bare rather than empty, and the reply was the bare ⚠: `⚠ 0 matches for text:"Login", and the tree is bare: 2 nodes, …`. **The "still empty after the re-read" error was never provoked**: no re-read was still 0×0. Its wording was read from the built module (`new IdbEmptyTreeError(udid, ['Application'], { reread: 1000 })`): first line `idb returned an empty accessibility tree (only a 0×0 Application)`, then `The read was retried once after 1 s and was still empty; a healthy idb had a tree with area by +1 s on 10 of 10 measured launches, … reboot the simulator (\`xcrun simctl shutdown D34212DB-… && xcrun simctl boot D34212DB-…\`); …`. Without `reread`, there is no retry sentence | PASS (error path from the module, not provoked on device) |
| I2 | `assert element text:"Login"` with timeout 2000 / 2000 / 1500, right after a cold launch | polls past the transient | All three passed in 1.9 s: `All 1 asserts passed` / `PASS  element text:"Login" exists`. The idb log for each: `0×0 Application` → (+0.69 s) `2 [Application 402x874]` → (+0.54 s) `17 […]`. The poll reads at its own cadence, with no added 1 s settle wait. The re-read applies only to the one-shot read | PASS |
| I3 | no "1000 ms", no stderr pointer | none | `grep -c "1000 ms\|1000ms\|stderr"` over every round-4 log: 0 in each. `grep -rn "1000 ms\|1000ms" dist src skill`: no hits. `grep stderr skill/SKILL.md`: no hits. The only "stderr" output is the server's own launch line on its stderr stream (`averi: set com.apple.Accessibility … on D34212DB-…`), which does not tell the agent to read stderr | PASS |

## N — `e7d497e` nits

| id | what | expected | observed (quoted) | verdict |
|---|---|---|---|---|
| N1 | assert failure sentences say seconds | `… after 1.5 s` | On both Android and iOS (WDA), with identical sentences: `FAIL  element id:"login_title" is absent — still visible after 1.5 s` (2.1 s); `FAIL  element id:"r4_nosuch_n1" exists — not found within 1.5 s` (2.0 s); and with the default timeout, `FAIL  element id:"r4_nosuch_n1" exists — not found within 3 s` (4.1–4.4 s) | PASS |
| N2 | the second look's ⚠ detect line, from `ensure_state no_prompt` right after a cold launch | one plain ⚠ line, plus one with `(second look over N s)` if the second look also stays bare | 6 runs. **Android ×3:** (1) `⚠ detect: element id:"r3_nosuch_prompt" treated as not detected — every UI tree read was bare, the last one 6 nodes (roles: container ×5, other ×1) …` then `state no_prompt: already active` (11.6 s); (2) and (3) an unread entry probe (`… still settling: uiautomator has no window to dump yet (cold launch or animation; read once) …`), then the cheap rung `flow r3_harmless: start` / `optional: skipped id:"r3_nosuch_rung_marker" (not present)` / `done`, then `state no_prompt: reached` and `reached after r3_harmless`. **iOS ×3:** (1) `state no_prompt: already active` (5.1 s, no ⚠); (2) and (3) `⚠ detect: … every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) …` then `already active` (2.9 s). A bare entry probe did start the second look each time, but the screen rendered inside the 20 s window, so the second look answered `yes` and wrote no line. **The `(second look over 20 s)` line was not provoked**: it needs a tree that stays bare for 20 s, which this app does not do on a cold launch, and it was not forced. No line was repeated word for word. No clearState rung exists on this state | PASS (no-regression only; the new wording was not seen) |
| N3 | Android tree read right after a cold launch | works; a null-root message, if any, says "retried once after 1 s" | 6 cold launches, then `ui_snapshot filter id:login_screen` at once. All 6 returned `"identifier": "login_screen"` in **4.3–4.5 s**. `adb-calls.log` shows exactly one `uiautomator dump /dev/tty` per call, and it returned XML, because the dump itself waits for idle. A null root was not seen on a one-shot read, so the retried wording did not appear. The detect probe in N2 did hit `ERROR: null root node`, and correctly said `read once` (a poller, not a settle read) | PASS (the retry path was not reached) |

## Findings

1. **No defects found in the round-4 code.** T1–T3 show the echo is gone, and round 3's 4 false TEXT findings no
   longer appear. The idb re-read rescued 12 of 13 cold-launch snapshots that would have read `0×0 Application`
   first. The 13th was already non-empty on its first read.
2. Not exercised on device:
   - the "retried once … still empty" `IdbEmptyTreeError`: the re-read always found area (+1.39–1.54 s, 13/13). Its
     wording was confirmed from the built module.
   - the `(second look over 20 s)` ⚠ line: the second look always ended on a rendered screen.
   - Android's "retried once after 1 s" null-root message: the one-shot dump never returned a null root.

   All three are covered by unit tests only.
3. Observation (pre-existing, not round 4): the dev-client loading tree is sometimes the first non-empty idb read.
   In i1b.1 it was 3 nodes with one text node. A one-shot `ui_snapshot` filter then answers `0 matches … in a tree
   of 3 nodes` rather than the bare ⚠. This is the same expo dev-client cost round 3 phase 1 recorded.
4. Side observation: the OCR-unavailable reason in `## text parity` is now on one line (`… swiftc --version — spawn
   swiftc ENOENT — that platform compared from the tree.`). In round 3 it broke across two lines.

## Device state left

- **Android** `emulator-5554`: finportal `MainActivity` in focus, on the login screen with `login_username` and
  `login_password` both `value: null`. Portrait (`user_rotation 0`), 1080x2220.
- **iOS** iPhone 17 (`D34212DB-…`): on the login screen (English), with Username and Password empty (screenshot
  `out-fin/04-screenshot-1.png`). Portrait. Not rebooted.
- **Metro** (`expo start --dev-client --port 8081`): stopped, and port 8081 is free.
