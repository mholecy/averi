# Phase 2 — Flow Engine (weeks 4–6)

Goal (ARCHITECTURE.md §4, §9): `averi.yaml` schema, `ensure_state`, branch/optional/wait, secret injection; login works end-to-end on both platforms after reinstall.

Exit criteria: with an `averi.yaml` checked into an app repo and credentials in env vars, `ensure_state("logged_in")` detects the current state, runs the right login path (PIN vs. fresh), dismisses interstitials, and confirms the target state — without the agent ever seeing a credential.

## Milestones

### 2.1 Config schema + loader (`src/flow/config.ts`)
- [x] Zod schema for `averi.yaml`: `app` (android package/apk, ios bundleId/app), `credentials`, `states` (detect conditions + reach flows), `flows` (requires + steps)
- [x] Step types from the doc: `launch`, `tap`, `type`, `type_pin` (keypad id_pattern, twice), `wait` (element/state + timeout), `branch` (when/do), `optional`, per-step platform overrides (`android:`/`ios:`)
- [x] Conditions: `element` spec (id/text/role/label), `state` reference, `any`/`all` combinators
- [x] Duration strings ("15s", "500ms") → ms
- [x] Helpful validation errors (zod issue paths + cross-reference checks for unknown states/flows)

### 2.2 Engine (`src/flow/engine.ts`)
- [x] `ensureState(name)`: detect → run `reach` flows → confirm with wait; idempotent
- [x] `runFlow(name)`: honors `requires:` (recursive ensureState), executes steps
- [x] Waits, not sleeps: `tap` polls for its element; `branch` polls until an arm matches; `wait` polls element/state conditions
- [x] Tap stability: an element must hold an identical rect across two consecutive polls before being tapped (launch/transition animations otherwise cause mis-taps — hit this for real on iOS Settings); zero-area nodes are never tap targets
- [x] `optional`: attempt each sub-step with a short timeout, swallow absence
- [x] `type_pin`: per-digit keypad taps via `id_pattern` ("pin_key_{digit}"), `twice` for set+confirm
- [x] Secrets: `$name` → credentials → `${ENV_VAR}`; missing var errors name the exact variable; resolved values are redacted from traces and error messages (the agent never sees them)
- [x] Step trace returned to the caller (redacted) for reporting
- Tests: FakeAdapter with programmable screens/transitions replays the doc's banking scenario — returning-user PIN path, fresh-install full login, interstitial dismissal, redaction, timeout errors, animated-element stability.

### 2.3 MCP tools (`src/mcp/server.ts`)
- [x] `ensure_state(platform, state, configPath?)` — the killer tool; returns trace + final screenshot
- [x] `run_flow(platform, flow, configPath?)` — any named flow
- [x] `install_app` path now optional — falls back to averi.yaml build paths
- [x] Config default: `./averi.yaml` relative to server cwd
- [x] Verified end-to-end on real devices (2026-07-08) with a Settings-app averi.yaml: cold `ensure_state` navigates and confirms on BOTH platforms; second call is an idempotent no-op ("already active")

### 2.4 Dogfood (manual)
- [ ] Write `averi.yaml` for the banking app dev build; `ensure_state("logged_in")` end-to-end on both platforms after reinstall — needs the app build + test credentials

## Out of scope
`assert`, `verify_both`, log-scan `appAlive`, baselines (Phase 3); licensing (Phase 4); OTP `prompt_human`, `record_flow` (v2).
