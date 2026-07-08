# averi — Agent Mobile Verify

A subscription-based MCP server that lets coding agents verify their work on iOS Simulators and Android Emulators, including apps that require a login step.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Status

MVP feature-complete (phases 1–4): adapters, flow engine (`ensure_state`), verification (`assert`, `verify_both`, appAlive), agent skill ([skill/SKILL.md](skill/SKILL.md)), license client + packaging. Remaining before launch: license service provisioning, banking-app dogfood, pilot teams.

## Layout

```
src/
  adapters/        Device Adapter interface + Android (adb) and iOS (simctl/idb) implementations
  flow/            averi.yaml config schema + flow engine (ensure_state, secrets)
  mcp/             MCP server wiring (thin tool layer)
  ui-tree/         Normalized accessibility tree model + selector resolution
  verify/          Assert engine (element checks, screenshot baselines) + crash scan
skill/             SKILL.md shipped to subscribers
docs/plans/        Phase plans
```

## Development

```bash
npm install
npm run build      # tsc
npm test           # vitest
npm run dev        # run MCP server over stdio
```

Requirements: Node 20+, Xcode + `idb` (iOS), Android SDK platform-tools (`adb`).

iOS notes:
- `idb`: `brew install idb-companion` + `pipx install fb-idb --python python3.13` (fb-idb breaks on Python 3.14).
- If `xcode-select -p` points at CommandLineTools, the adapter automatically injects `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` for simctl/idb — no sudo needed.

## Licensing

- `AVERI_API_KEY` — subscription key. On startup the server exchanges it for a signed ~24 h license token (cached at `~/.averi/license.json`); a network failure falls back to the cached token with a 7-day grace past expiry. A *rejected* key never falls back.
- Without a key the server runs in **dev mode** (all features, stderr warning) — pre-launch behavior, flips to hard-require at GA. The token-verification public key in `src/license/client.ts` is a placeholder to regenerate when the license service is provisioned (service API contract: `docs/plans/phase-4-licensing.md`).
- Plans: Solo (core tools, sequential `verify_both`), Team (parallel `verify_both`, baselines), CI (headless). Usage pings carry tool-call counts only — screenshots, UI trees, and secrets never leave the machine.

## Using with Claude Code

```json
// .mcp.json in the app repo (next to averi.yaml)
{ "mcpServers": { "averi": { "command": "averi-mcp" } } }
```

`skill/SKILL.md` teaches the agent the workflow (golden path, rules, recipes).
