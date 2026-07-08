# Phase 1 — Adapter Core (weeks 1–3)

Goal (from ARCHITECTURE.md §9): adb + simctl/idb adapters, screenshot, tap/type/swipe, normalized `ui_snapshot`, MCP wiring, manual smoke test on a real app.

Exit criteria: from a coding agent connected over stdio, on both a booted Android emulator and an iOS simulator, you can `list_devices`, `install_app`, `screenshot`, `ui_snapshot`, and drive `tap`/`type_text`/`swipe`/`press_key` reliably.

## Milestones

### 1.1 Project plumbing
- [x] Repo, TypeScript scaffold, `DeviceAdapter` interface (`src/adapters/types.ts`)
- [ ] `npm install`, vitest smoke test, CI-less local `npm test` green
- [ ] Small `exec` helper (`src/adapters/exec.ts`): run a CLI command with timeout, capture stdout/stderr as Buffer (screenshots are binary), typed errors

### 1.2 Android adapter (`src/adapters/android.ts`) — pure adb
- [ ] `listDevices` — `adb devices -l` + `getprop ro.build.version.release`
- [ ] `install`/`launch`/`terminate` — `adb install -r`, `am start` (with `pm clear` for `clearState`), `am force-stop`
- [ ] `screenshot` — `adb exec-out screencap -p`
- [ ] `uiTree` — `uiautomator dump` → XML (fast-xml-parser) → normalized `UiNode`; role mapping table (android.widget.* → button/text/textfield/...)
- [ ] input — `input tap/swipe/text/keyevent`; text escaping (spaces, quotes, unicode limitations of `input text`)
- [ ] `logs` — `adb logcat -t <time>`
- Unit tests run against recorded fixtures (sample `uiautomator` XML, `adb devices` output); no emulator needed in tests.

### 1.3 iOS adapter (`src/adapters/ios.ts`) — simctl + idb
- [ ] `listDevices` — `xcrun simctl list devices --json`
- [ ] `install`/`launch`/`terminate`/`openDeepLink` — `simctl install/launch/terminate/openurl`
- [ ] `screenshot` — `simctl io <udid> screenshot -`
- [ ] `uiTree` — `idb ui describe-all` JSON → normalized `UiNode` (same role vocabulary as Android)
- [ ] input — `idb ui tap/swipe/text`, key events
- [ ] `logs` — `simctl spawn <udid> log show --last`
- Keep every idb call in one module section so a WebDriverAgent swap stays cheap (ARCHITECTURE.md §10 risk).

### 1.4 Selector resolution (`src/ui-tree/selectors.ts`)
- [ ] Parse `id:`, `text:"..."`, `role:... label~"regex"` selector syntax
- [ ] Resolve against a `UiNode` tree → matching node(s) + tap point (rect center)
- [ ] `tapElement` on both adapters uses this
- Fully unit-testable against fixture trees — highest test density here.

### 1.5 MCP wiring (`src/mcp/server.ts`)
- [ ] Stdio server via `@modelcontextprotocol/sdk`; tools: `list_devices`, `install_app`, `screenshot` (image content), `ui_snapshot` (JSON, optional filter), `tap`, `swipe`, `type_text`, `press_key`, `get_logs`
- [ ] Zod schemas per tool; every response includes `appAlive` once log scanning exists (else omit — don't fake it)
- [ ] Screen-stability heuristic before `screenshot` returns (two identical consecutive captures, bounded wait)

### 1.6 Smoke test (manual, real devices)
- [ ] Booted Android emulator + iOS simulator; connect Claude Code to the server; install the banking app dev build; navigate one screen by taps; capture paired screenshots
- [ ] Write findings back into this doc (AX-tree quality on Compose/SwiftUI screens — feeds the §10 risk assessment)

## Deliberately out of scope for Phase 1
Flow engine / `averi.yaml`, `ensure_state`, secrets, asserts, `verify_both`, licensing. (Phases 2–4.)

## Open decisions to settle during 1.2/1.3
- Minimum `idb` feature set actually needed vs. jumping straight to WDA if `describe-all` output is too sparse.
- Whether `uiautomator dump` latency (~1s) forces a caching strategy for `ui_snapshot`.
