# Phase 4 — Licensing + Packaging (weeks 9–10)

Goal (ARCHITECTURE.md §6, §9): license client (API key → signed JWT, offline grace), plan entitlements, anonymous usage pings, npm packaging.

Decision: the cloud license service is a separate deliverable. This phase ships the CLIENT with the API contract documented and the verification key embedded. Enforcement activates when `AVERI_API_KEY` is set; without it the server runs in dev mode with a stderr warning (pre-launch behavior — flip to hard-require at GA).

## API contract (license service, to be built)

- `POST /v1/license/exchange` `{ "apiKey": "..." }` → `{ "token": "<JWT>" }`
  - JWT: ES256, claims `{ sub: customerId, plan: "solo"|"team"|"ci", features?: string[], iat, exp }`, exp ≈ 24 h
- `POST /v1/usage` `{ "counts": { "<tool>": n, ... }, "plan": "..." }` → 204. Tool-call counts only — never screenshots, trees, or secrets.

## Milestones

### 4.1 License client (`src/license/client.ts`)
- [x] Exchange key for token, verify signature (jose, embedded public JWK), parse entitlements
- [x] Cache token at `~/.averi/license.json`; offline → cached token; expired-but-within-grace (7 days) → stale-but-valid; beyond grace → hard fail with renewal message
- [x] A REJECTED key (401/403) never falls back to the cache — only network failures do
- [x] Plan → default features: solo=core; team=+parallel_verify,baselines; ci=+headless; dev=all
- [x] Tests against a local mock service (real ES256 keypair, wrong-key rejection, grace windows, dev mode)

### 4.2 Usage pings (`src/license/usage.ts`)
- [x] Tool-call counter, periodic fire-and-forget flush (unref'd timer); disabled in dev mode; payload is counts only; failed flushes retry next interval

### 4.3 Server integration
- [x] Startup license check (stderr logging — stdout is MCP protocol); entitlements exposed to tools
- [x] `verify_both` runs platforms in parallel only with `parallel_verify` (Team+); sequential on Solo
- [x] Every tool call counted via a registerTool wrapper

### 4.4 Packaging
- [x] npm audit → 0 vulnerabilities (fast-xml-parser@5, vitest@4); `files` (dist, skill, ARCHITECTURE.md), `prepublishOnly`; dist bin smoke-tested (shebang intact, 16 tools, dev-mode stderr warning)
- [x] README licensing + Claude Code integration docs

## GA blockers (deliberate)
- Provision the license service and PIN the real token-verification public key (placeholder in `src/license/client.ts`)
- Flip dev mode to hard-require `AVERI_API_KEY`
- Decide usage-ping auth (currently anonymous per §6; consider signing with the license token)
