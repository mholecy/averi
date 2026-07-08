# Phase 3 — Verification + Skill (weeks 7–8)

Goal (ARCHITECTURE.md §5, §7, §8, §9): `assert`, `verify_both`, crash detection (`appAlive` + log scan), and the SKILL.md that teaches agents the workflow.

Exit criteria: an agent can run the golden path — `ensure_state` → navigate → `assert`/`verify_both` — and get deterministic pass/fail results with paired screenshots, plus fail-fast crash excerpts when the app dies.

## Milestones

### 3.1 Adapter: app liveness (`isAppRunning`)
- [x] `DeviceAdapter.isAppRunning(appId)` — Android `pidof`, iOS `launchctl list` (UIKitApplication label)
- [x] Crash-signature scan over `logs()` output (FATAL EXCEPTION / ANR / uncaught NSException / EXC_BAD_ACCESS ...) with trailing stack context

### 3.2 Verifier (`src/verify/`)
- [x] Assert specs (zod, shared with MCP): element exists (default) / `absent` / `text` exact / `match` regex, with poll timeout; `screenshot: { baseline, threshold }` pixel-diff
- [x] Baselines under `.averi/baselines/<platform>/<name>.png`; missing baseline → created (pass, noted); size mismatch → fail; diff ratio vs. threshold (default 1%)
- [x] Pure-JS diff (pngjs + pixelmatch), no native deps
- [x] Failed element asserts report what WAS there (actual label/value of near-matches)

### 3.3 MCP tools
- [x] `assert(platform, asserts, configPath?)` — declarative checks, returns per-assert results + `appAlive` (+ crash excerpt when dead)
- [x] `verify_both(state?, flow?, asserts?, configPath?)` — same sequence on iOS AND Android in parallel (allSettled: one platform failing doesn't hide the other), paired screenshots + per-platform assert results + appAlive
- [x] `ensure_state`/`run_flow` responses gain `appAlive` fail-fast crash excerpts
- [x] New `swipe:` flow step (gesture direction + times) — added after a real failure: iOS reports only visible elements, so a scrolled-away target must be scrolled back into view by the flow

### 3.4 Skill (`skill/SKILL.md`)
- [x] Golden path, rules (always ensure_state; ui_snapshot before screenshots; verify_both before declaring cross-platform done; never ask for credentials), recipes, averi.yaml quick reference

### 3.5 Real-device verification
- [x] `verify_both` against Settings apps with a cross-platform state (platform-override steps) + screenshot baselines (2026-07-08): run 1 recovered iOS from a deliberately scrolled-away list (swipe ×3 → tap → reached) and created both baselines; run 2 was idempotent on both platforms with 0.00–0.01% pixel diff; element asserts and the failing-assert detail path verified; appAlive true throughout

**Findings:**
- iOS AX tree contains only VISIBLE elements — flows must scroll; consider auto-scroll-into-view for `tap` as a future engine feature (needs a scroll-container heuristic).
- Screenshot baselines at 2% threshold are stable across runs on both platforms (status-bar clock noise stayed under 0.01%); keep 1% default and let flows override.

## Open (backlog)
- Auto-scroll-into-view for tap/assert when the element exists in the descriptor but not in the visible tree
- `verify_both` timing: platforms run in parallel; slowest device dominates — fine for 2 devices
