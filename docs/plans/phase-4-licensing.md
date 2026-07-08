# Phase 4 — Licensing + Packaging (weeks 9–10)

Goal (ARCHITECTURE.md §6, §9): license client (API key → signed JWT, offline grace), plan entitlements, anonymous usage pings, npm packaging.

Decision: the cloud license service is a separate deliverable. This phase ships the CLIENT with the API contract documented and the verification key embedded. Enforcement activates when `AVERI_API_KEY` is set; without it the server runs in dev mode with a stderr warning (pre-launch behavior — flip to hard-require at GA).

## API contract (license service, to be built)

- `POST /v1/license/exchange` `{ "apiKey": "..." }` → `{ "token": "<JWT>" }`
  - JWT: ES256, claims `{ sub: customerId, plan: "solo"|"team"|"ci", features?: string[], iat, exp }`, exp ≈ 24 h
- `POST /v1/usage` `{ "counts": { "<tool>": n, ... }, "plan": "..." }` → 204. Tool-call counts only — never screenshots, trees, or secrets.

## Milestones

### 4.1 License client (`src/license/client.ts`)
- [ ] Exchange key for token, verify signature (jose, embedded public JWK), parse entitlements
- [ ] Cache token at `~/.averi/license.json`; offline → cached token; expired-but-within-grace (7 days) → stale-but-valid; beyond grace → hard fail
- [ ] Plan → default features: solo=core; team=+parallel_verify,baselines; ci=+headless; dev=all
- [ ] Tests against a local mock service (real keypair, wrong-key rejection, grace windows, dev mode)

### 4.2 Usage pings (`src/license/usage.ts`)
- [ ] Tool-call counter, periodic fire-and-forget flush; disabled in dev mode; payload is counts only

### 4.3 Server integration
- [ ] Startup license check (stderr logging — stdout is MCP protocol); entitlements exposed to tools
- [ ] `verify_both` runs platforms in parallel only with `parallel_verify` (Team+); sequential on Solo
- [ ] Every tool call counted via a registerTool wrapper

### 4.4 Packaging
- [ ] npm audit triage; `files`/`prepublishOnly`; bin smoke test from `dist/` (shebang intact)
- [ ] README install/licensing docs
