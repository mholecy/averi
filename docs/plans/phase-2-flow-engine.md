# Phase 2 — Flow Engine (weeks 4–6)

Goal (ARCHITECTURE.md §4, §9): `averi.yaml` schema, `ensure_state`, branch/optional/wait, secret injection; login works end-to-end on both platforms after reinstall.

Exit criteria: with an `averi.yaml` checked into an app repo and credentials in env vars, `ensure_state("logged_in")` detects the current state, runs the right login path (PIN vs. fresh), dismisses interstitials, and confirms the target state — without the agent ever seeing a credential.

## Milestones

### 2.1 Config schema + loader (`src/flow/config.ts`)
- [ ] Zod schema for `averi.yaml`: `app` (android package/apk, ios bundleId/app), `credentials`, `states` (detect conditions + reach flows), `flows` (requires + steps)
- [ ] Step types from the doc: `launch`, `tap`, `type`, `type_pin` (keypad id_pattern, twice), `wait` (element/state + timeout), `branch` (when/do), `optional`, per-step platform overrides (`android:`/`ios:`)
- [ ] Conditions: `element` spec (id/text/role/label), `state` reference, `any`/`all` combinators
- [ ] Duration strings ("15s", "500ms") → ms
- [ ] Helpful validation errors (path into the YAML)

### 2.2 Engine (`src/flow/engine.ts`)
- [ ] `ensureState(name)`: detect → run `reach` flows → confirm with wait; idempotent
- [ ] `runFlow(name)`: honors `requires:` (recursive ensureState), executes steps
- [ ] Waits, not sleeps: `tap` polls for its element; `branch` polls until an arm matches; `wait` polls element/state conditions
- [ ] `optional`: attempt each sub-step with a short timeout, swallow absence
- [ ] `type_pin`: per-digit keypad taps via `id_pattern` ("pin_key_{digit}"), `twice` for set+confirm
- [ ] Secrets: `$name` → credentials → `${ENV_VAR}`; missing var errors name the exact variable; resolved values are redacted from traces and error messages (the agent never sees them)
- [ ] Step trace returned to the caller (redacted) for reporting
- Tests: FakeAdapter with programmable screens/transitions replays the doc's banking scenario — returning-user PIN path, fresh-install full login, interstitial dismissal, redaction, timeout errors.

### 2.3 MCP tools (`src/mcp/server.ts`)
- [ ] `ensure_state(platform, state, configPath?)` — the killer tool; returns trace + final screenshot
- [ ] `run_flow(platform, flow, configPath?)` — any named flow
- [ ] Config default: `./averi.yaml` relative to server cwd

### 2.4 Dogfood (manual)
- [ ] Write `averi.yaml` for the banking app dev build; `ensure_state("logged_in")` end-to-end on both platforms after reinstall

## Out of scope
`assert`, `verify_both`, log-scan `appAlive`, baselines (Phase 3); licensing (Phase 4); OTP `prompt_human`, `record_flow` (v2).
