# Phase 1 — Adapter Core (weeks 1–3)

Goal (from ARCHITECTURE.md §9): adb + simctl/idb adapters, screenshot, tap/type/swipe, normalized `ui_snapshot`, MCP wiring, manual smoke test on a real app.

Exit criteria: from a coding agent connected over stdio, on both a booted Android emulator and an iOS simulator, you can `list_devices`, `install_app`, `screenshot`, `ui_snapshot`, and drive `tap`/`type_text`/`swipe`/`press_key` reliably.

## Milestones

### 1.1 Project plumbing
- [x] Repo, TypeScript scaffold, `DeviceAdapter` interface (`src/adapters/types.ts`)
- [x] `npm install`, vitest smoke test, CI-less local `npm test` green
- [x] Small `exec` helper (`src/adapters/exec.ts`): run a CLI command with timeout, capture stdout as Buffer (screenshots are binary), stdin support, typed errors

### 1.2 Android adapter (`src/adapters/android.ts`) — pure adb
- [x] `listDevices` — `adb devices -l` + `getprop ro.build.version.release`
- [x] `install`/`launch`/`terminate` — `adb install -r`, `monkey` launch (with `pm clear` for `clearState`), `am force-stop`
- [x] `screenshot` — `adb exec-out screencap -p`
- [x] `uiTree` — `uiautomator dump /dev/tty` → XML (fast-xml-parser) → normalized `UiNode`; role mapping table (android.widget.* → button/text/textfield/...)
- [x] input — `input tap/swipe/text/keyevent`; text escaping (spaces → %s, shell metachars)
- [x] `logs` — `adb logcat -d -T <epoch>`
- [ ] `setClipboard` — no reliable pure-adb path found; deferred (throws with a clear message)
- Unit tests run against recorded fixtures (sample `uiautomator` XML, `adb devices` output); no emulator needed in tests.

### 1.3 iOS adapter (`src/adapters/ios.ts`) — simctl + idb
- [x] `listDevices` — `xcrun simctl list devices --json`
- [x] `install`/`launch`/`terminate`/`openDeepLink` — `simctl install/launch/terminate/openurl`; `clearState` wipes the data container in place (no `pm clear` equivalent)
- [x] `screenshot` — `simctl io <udid> screenshot` via temp file
- [x] `uiTree` — `idb ui describe-all --json` (flat list → synthetic root; same role vocabulary as Android)
- [x] input — `idb ui tap/swipe/text/key/button`; `back` key rejected with guidance (no iOS equivalent)
- [x] `logs` — `simctl spawn <udid> log show --start <date>`
- All idb calls grouped in one module section so a WebDriverAgent swap stays cheap (ARCHITECTURE.md §10 risk).

### 1.4 Selector resolution (`src/ui-tree/selectors.ts`)
- [x] Parse `id:`, `text:"..."`, `role:... label~"regex"` selector syntax
- [x] Resolve against a `UiNode` tree → matching node(s) + tap point (rect center); `findOne` errors list ambiguous matches
- [x] `tapElement` on both adapters uses this
- Fully unit-testable against fixture trees — highest test density here.

### 1.5 MCP wiring (`src/mcp/server.ts`, `src/mcp/registry.ts`)
- [x] Stdio server via `@modelcontextprotocol/sdk`; tools: `list_devices`, `install_app`, `launch_app`, `terminate_app`, `open_deep_link`, `screenshot` (image content), `ui_snapshot` (JSON, optional selector filter), `tap`, `swipe`, `type_text`, `press_key`, `get_logs`
- [x] Zod schemas per tool; `appAlive` deferred until log scanning exists (don't fake it)
- [x] Screen-stability heuristic before `screenshot` returns (two identical consecutive captures, bounded wait)
- [x] Adapter registry binds each platform to the first booted device; rebinds if the device vanishes

### 1.6 Smoke test (manual, real devices)
- [x] Stdio round-trip verified: initialize → tools/list → `list_devices` found a real booted device (Pixel 8 Pro over adb); `screenshot` returned a real PNG
- [x] Full walk on booted Android emulator + iOS simulator (2026-07-08): `launch_app` Settings on both → `ui_snapshot` → selector tap (`text~"Network"` / `label:General`) → screenshot confirmed the navigation happened → `press_key back` / `get_logs`. Every tool worked on both platforms.
- [ ] Repeat against the banking app dev build with paired screenshots (needs the app build — first real dogfood, ties into Phase 2 `averi.yaml`)

**Findings (feeds §10 risk assessment):**
- Android Settings tree is rich: stable `resource-id`s (`title`, `summary`), labels intact. `uiautomator dump /dev/tty` worked as expected.
- iOS Settings tree via `idb ui describe-all` is a flat list but very usable: buttons carry stable identifiers (`com.apple.settings.general`) and full labels. Screen-level containers come back as role `other` with null ids — selector matching should prefer `id:`/`label:` over structure. Flat-list normalization (synthetic root) was the right call.
- Environment gotchas fixed in code/docs: `xcode-select` pointing at CommandLineTools breaks simctl AND idb_companion — adapter now auto-injects `DEVELOPER_DIR` when Xcode is at the default path. fb-idb is broken on Python 3.14 (`asyncio.get_event_loop`) — needs pipx install with ≤3.13. idb_companion logs its full environment (secrets included) to stderr — never forward adapter stderr into agent-visible output or telemetry.

## Deliberately out of scope for Phase 1
Flow engine / `averi.yaml`, `ensure_state`, secrets, asserts, `verify_both`, licensing. (Phases 2–4.)

## Open decisions to settle during 1.2/1.3
- Minimum `idb` feature set actually needed vs. jumping straight to WDA if `describe-all` output is too sparse.
- Whether `uiautomator dump` latency (~1s) forces a caching strategy for `ui_snapshot`.
