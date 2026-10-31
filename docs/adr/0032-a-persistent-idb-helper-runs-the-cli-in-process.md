# 32. A persistent idb helper runs the CLI in-process

Status: accepted 2026-10-31 (performance backlog row D7, docs/plans/2026-10-30-performance-backlog.md, section "### D7
and D24 measured"; the orchestrator's design from the D7 analysis). Part a (reads) implemented on
`perf/d7a-idb-helper-reads`; part b (input) is D7b.

## Context

- Every idb call averi makes is one `idb <args> --udid <udid>` process (`adapters/idb.ts#runIdb`): IosAdapter's input
  (tap, swipe, text, keys, viewport) and the idb tree source's `ui describe-all --json` (15 s budget).
- fb-idb's CLI is Python. Measured 2026-10-31 by the owner on the lab simulator (iPhone 17, iOS 27.0, a fresh
  companion, n = 20, against averi's exact argv): `describe-all` 114.3 ms by the CLI, 24.7 ms by a persistent client in
  one process (−90); `ui tap` 219.0 → 96.5 ms (−122). `idb --help` alone costs 91.6 ms, and a fresh `Client.build` per
  call costs the same as a kept one (connect 8.5 ms): the saving is the interpreter's start-up and the CLI's imports,
  not the connection.
- averi ships `dist/` alone (tsc copies no `.py`), and its users install fb-idb themselves (SETUP.md step 0), in
  whatever Python that install chose.

## Decision

**One helper process per simulator runs fb-idb's own CLI entry, `idb.cli.main.gen_main(argv)`, in-process, per request.
In D7a it serves `ui describe-all --json` alone; every other call, and every call it cannot take, is the CLI as
before.**

- The helper (`adapters/idb-helper-script.ts`, a string run as `<python> -I -c <script> <idb path>`) imports the CLI
  once, says `{"ready"}` on fd 3, then answers one JSON request a line on stdin, `{id, argv}`, with `{id, code, stdout,
  stderr}` on fd 3. `sys.stdout`/`sys.stderr` and the root logging handlers' stream point at buffers for the call; fd 3
  is the protocol's alone, so a stray print cannot corrupt it. It exits on stdin's EOF.
- The interpreter is the one the CLI runs under: the shebang of the `idb` on the PATH exec uses — `#!/abs/python…` as
  is, `#!/usr/bin/env python…` through PATH; anything else (a binary, a shell wrapper, arguments) is no helper. An import
  that fails exits before `ready`: a failed start.
- Node side: `adapters/idb-helper.ts#IdbHelper`, one per simulator, created by `mcp/registry.ts#defaultFactory` and
  shared by `IosAdapter` (which owns and disposes it) and `IdbTreeSource`, as `exec` is. `runIdb` offers it an
  allowlisted argv (`HELPER_ARGV`); the helper answers or declines.
- Lifecycle: the first allowlisted call starts it in the background and runs on the CLI — no call waits for it. Until
  `ready`, while busy (one request at a time: concurrent reads of an iOS leg go to the CLI), and when off, the CLI
  serves. A start that never says ready (exit, spawn error, 10 s) counts as failed; after 2 the helper is off for the
  process. A helper that dies after ready is restarted lazily by the next call.
- No orphans: the child and its pipes are unref'd; it exits on stdin EOF (dispose, or node's death closing the pipe);
  `IosAdapter.dispose()` kills it; a `process.once('exit')` hook kills it as the backstop (WdaServer's pattern).
- Kill switch: `AVERI_IDB_HELPER=off` (SETUP.md, troubleshooting). The differential fake device sets it: the golden
  log pins the CLI's argv per call, and the fake answers execFile only.
- The D0 harness sees helper calls on `node:diagnostics_channel` (`averi:idb-helper:start`/`end`, published by
  `runIdb`), recorded as `idb ui describe-all` with `via: helper` (`recordHelperCalls` in `scripts/perf/instrument.ts`).

### Error parity

What an agent reads must not change with the helper:
- A nonzero code throws `new ExecError('idb ' + argv, code, stderr, false, stdout)` — the message exec builds for the
  CLI failing alike (`Command failed (exit N): idb ui describe-all --json --udid U` and the stderr); an empty stderr
  is replaced by node's own `Command failed: <command>\n`, as exec's `stderrText || err.message` does.
- The caller's timeout SIGKILLs the helper and throws `ExecError(…, timedOut = true)`: `Command timed out: idb …`,
  not retried.
- A helper that dies under a call (a read, idempotent) is retried once on the CLI; the CLI's result or error is the
  one returned.
- The contract test (`tests/adapters/idb-helper-contract.test.ts`, the real fb-idb, no simulator) runs both on
  `--companion localhost:1 ui describe-all --json` (equal code and stderr) and on `ui describe-all --help` (equal
  stdout bytes, `usage: idb …`: the helper sets `sys.argv[0]` to idb's path for argparse).

## Why Python and `gen_main`, not a node gRPC client

- A node client would re-implement the companion protocol (grpc, the proto, idb's target resolution and companion
  discovery, its own error texts): a second idb to keep in step with fb-idb, and different error messages.
- `gen_main` is the CLI itself: the same argparse, the same command classes, the same companion lookup, the same
  stderr. The analysis measured in this sandbox byte-identical stderr and the same exit code as the CLI for a failed
  connect, ~8 ms a call.

## Residuals

- `gen_main` is not public fb-idb API. An fb-idb that renames or reshapes it fails the import (no `ready`: the CLI
  serves) or answers differently — the contract test is what catches the latter on an upgrade.
- A helper living for hours is unmeasured: leaks, a companion restarted under it (each call builds its client afresh,
  as the CLI does, so a new companion should be found — not measured), grpc state across many calls.
- One request at a time: concurrent iOS reads still pay the CLI. Input (D7b) is out of scope here because a helper
  dying under a HID event may have delivered it — a retry is not safe the way a read's is.
- `-I` ignores `PYTHONPATH` and user site-packages that the CLI would see; an install that depends on them fails the
  import and stays on the CLI.

## Consequences

- Every `describe-all` after the helper is ready saves the CLI's start-up: −90 ms measured in isolation (D7). Only the
  device shows it in a whole tool call — the owner's A/B: `ios-run.sh` native and idb legs with
  `AVERI_IDB_HELPER=off` vs on.
- One more long-lived child per simulator, Python, ~idb's import in memory.
