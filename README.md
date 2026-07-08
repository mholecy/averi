# averi — Agent Mobile Verify

A subscription-based MCP server that lets coding agents verify their work on iOS Simulators and Android Emulators, including apps that require a login step.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Status

Pre-MVP. Current phase: **Phase 2 — Flow engine** (see [docs/plans/phase-2-flow-engine.md](docs/plans/phase-2-flow-engine.md)). Phase 1 (adapter core) is complete.

## Layout

```
src/
  adapters/        Device Adapter interface + Android (adb) and iOS (simctl/idb) implementations
  flow/            averi.yaml config schema + flow engine (ensure_state, secrets)
  mcp/             MCP server wiring (thin tool layer)
  ui-tree/         Normalized accessibility tree model + selector resolution
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
