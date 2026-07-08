# Phase 3 — Verification + Skill (weeks 7–8)

Goal (ARCHITECTURE.md §5, §7, §8, §9): `assert`, `verify_both`, crash detection (`appAlive` + log scan), and the SKILL.md that teaches agents the workflow.

Exit criteria: an agent can run the golden path — `ensure_state` → navigate → `assert`/`verify_both` — and get deterministic pass/fail results with paired screenshots, plus fail-fast crash excerpts when the app dies.

## Milestones

### 3.1 Adapter: app liveness (`isAppRunning`)
- [ ] `DeviceAdapter.isAppRunning(appId)` — Android `pidof`, iOS `launchctl list` (UIKitApplication label)
- [ ] Crash-signature scan over `logs()` output (FATAL EXCEPTION / ANR / uncaught NSException / EXC_BAD_ACCESS ...)

### 3.2 Verifier (`src/verify/`)
- [ ] Assert specs (zod, shared with MCP): element exists (default) / `absent` / `text` exact / `match` regex, with poll timeout; `screenshot: { baseline, threshold }` pixel-diff
- [ ] Baselines under `.averi/baselines/<platform>/<name>.png`; missing baseline → created (pass, noted); size mismatch → fail; diff ratio vs. threshold (default 1%)
- [ ] Pure-JS diff (pngjs + pixelmatch), no native deps

### 3.3 MCP tools
- [ ] `assert(platform, asserts, configPath?)` — declarative checks, returns per-assert results + `appAlive` (+ crash excerpt when dead)
- [ ] `verify_both(state?, flow?, asserts?, configPath?)` — same sequence on iOS AND Android in parallel, paired screenshots + per-platform assert results + appAlive
- [ ] `ensure_state`/`run_flow` responses gain `appAlive` fail-fast crash excerpts

### 3.4 Skill (`skill/SKILL.md`)
- [ ] Golden path, rules (always ensure_state; ui_snapshot before screenshots; verify_both before declaring cross-platform done; never ask for credentials), recipes, tool reference

### 3.5 Real-device verification
- [ ] `verify_both` against Settings apps with a cross-platform state (platform-override steps) + screenshot baselines
