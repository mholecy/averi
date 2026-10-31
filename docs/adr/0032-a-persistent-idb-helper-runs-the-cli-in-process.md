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

**One helper process per iOS adapter — at most one live per simulator: a wda adapter never starts its helper — runs fb-idb's own CLI entry, `idb.cli.main.gen_main(argv)`, in-process, per request.
In D7a it serves `ui describe-all --json` alone; every other call, and every call it cannot take, is the CLI as
before.**

- The helper (`adapters/idb-helper-script.ts`, a string run as `<python> -c <script> <idb path>`) imports the CLI
  once, says `{"ready"}` on fd 3, then answers one JSON request a line on stdin, `{id, argv}`, with `{id, code, stdout,
  stderr}` on fd 3. Per request it creates an event loop and closes it after, as the CLI's one per process is;
  `sys.stdout`/`sys.stderr` and the root logging handlers' stream (`logger.exception`'s tracebacks) point at buffers for
  the call; fd 3 is the protocol's alone, so a stray print cannot corrupt it. It exits on stdin's EOF.
- What it imports is what the shebang'd CLI imports (review 2026-10-31, MINOR-5). No `-I`: `PYTHONPATH` and the user
  site-packages count as they do for `idb` (an earlier `-I` could import a different fb-idb, or none). Under `-c`,
  `sys.path[0]` is `''` — the cwd; the script's first statement replaces it with the directory of idb's REAL path, the
  entry Python itself puts there when it runs the script — only when it is `''`: under safe-path mode
  (`PYTHONSAFEPATH`, 3.11+) `-c` prepends nothing and neither does the CLI's run, so the path is left alone. `sys` is
  built in and `os` already imported by `site`, so nothing is looked up on the cwd before it is gone, and `''` is never
  on the path after: a module planted in averi's cwd cannot be imported (the bootstrap test plants one).
- The interpreter is the one the CLI runs under: the shebang of the `idb` on the PATH exec uses — `#!/abs/python…` as
  is, `#!/usr/bin/env python…` through PATH; anything else (a binary, a shell wrapper, arguments) is no helper. An import
  that fails exits before `ready`: a failed start.
- Node side: `adapters/idb-helper.ts#IdbHelper`, one per iOS adapter, created by `mcp/registry.ts#iosAdapterFor` and
  shared by `IosAdapter` (which owns and disposes it) and `IdbTreeSource`, as `exec` is. `runIdb` offers it an
  allowlisted argv (`HELPER_ARGV`); the helper answers or declines.
- Lifecycle: the first allowlisted call starts it in the background and runs on the CLI — no call waits for it. Until
  `ready`, while busy (one request at a time: concurrent reads of an iOS leg go to the CLI), and when off, the CLI
  serves. A failure is a start that never says ready (exit, spawn error, 10 s) or a helper that dies before it has
  answered any request (one that says ready and dies under every request would otherwise restart forever); after 2 in
  a row the helper is off for the process, and says so in one line on the server's stderr, with the tail of its own.
  Two requests in a row that time out in the helper, with no answer between, turn it off as well — each costs the
  caller's whole 15 s, and one hung helper would otherwise make every read pay it; one alone does not (a stuck
  companion times the CLI out as well). Any answered request resets both counts. Otherwise a helper that
  dies is restarted lazily by the next call; one disposed under a read answers it `died`, and the read runs on the CLI.
- No orphans: the child and its pipes are unref'd; it exits on stdin EOF (dispose, or node's death closing the pipe);
  `IosAdapter.dispose()` kills it; one `process.once('exit')` hook for every helper in the process kills what dispose
  did not reach (WdaServer's pattern; one hook, not one per helper, so an 11th simulator raises no listener warning).
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
  not retried. The message is exec's; the error's `stderr` field is `''` where exec's carries what the killed CLI had
  printed (or node's message) — no caller reads it off a timeout today.
- The exit code is the CLI's process status: `gen_main`'s int or a `SystemExit`'s code, masked `& 0xff`; a non-int code
  is printed to stderr and is 1, as `sys.exit` does.
- A helper that dies under a call (a read, idempotent) is retried once on the CLI; the CLI's result or error is the
  one returned.
- The contract test (`tests/adapters/idb-helper-contract.test.ts`, the real fb-idb, no simulator) runs both on
  `--companion localhost:1 ui describe-all --json` (equal code and stderr) and on `ui describe-all --help` (equal
  stdout bytes, `usage: idb …`: the helper sets `sys.argv[0]` to idb's path for argparse), on `--companion
  localhost:abc` (`logger.exception`'s traceback through the logging handler: equal but the timestamp), and 50 requests
  in a row (equal each time). A fake fb-idb under the same interpreter pins the bootstrap: the package beside idb's
  real path is imported, not one planted in the cwd; the code is masked; a logging handler's output is captured.

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
- stdout is TEXT (a `StringIO`): a command that writes bytes to `sys.stdout.buffer` (`idb screenshot -`, any binary
  output) breaks in the helper. D7b must solve that before the allowlist grows past `describe-all`.
- Process-scoped state outlives a request where the CLI's died with its process: the `warnings` registry (a warning
  printed once by the CLI each run is printed by the helper once per process), handlers a plugin adds to a logger,
  and anything native code writes to fd 2 directly (it goes to the helper's own stderr, kept only as a tail, not to
  the reply).
- A companion the client spawns (fb-idb's `--companion-path` path, for a udid with no companion running) would be a
  child of the helper and may hold pipes the helper holds, for the helper's life rather than one call's — not
  measured here (no companion in the sandbox). The device soak must look at that path.

## Consequences

- Every `describe-all` after the helper is ready saves the CLI's start-up: −90 ms measured in isolation (D7). Only the
  device shows it in a whole tool call — the owner's A/B: `ios-run.sh` native and idb legs with
  `AVERI_IDB_HELPER=off` vs on.
- One more long-lived child per idb-backed simulator, Python, ~idb's import in memory.
