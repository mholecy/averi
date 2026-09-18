# BUG: a busy MCP server's WebDriverAgent outlived it, and the next server refused to adopt it

Measured 2026-09-18 (finportal, first iOS call after the 0.7.0 → 0.8.0 upgrade and `/mcp` reconnect):

```
A WebDriverAgent answers /status on port 8100, but this session did not start it (udid …)
```

`pkill -f WebDriverAgentRunner` and a retry cleared it. The finportal wiki recorded it as "0.8.0 refuses to adopt
a WDA it did not start" — the refusal is correct and is NOT new to 0.8.0 (the ownership guard in
`WdaServer.doEnsureRunning` predates it). The first version of this document then over-corrected in the other
direction ("every reconnect orphaned a WebDriverAgent"); the review of 0.8.1 measured what actually happens.

## What actually happens (measured 2026-09-18, review of 0.8.1)

- The MCP SDK's stdio client closes a server in three steps — `stdin.end()`, 2 s, `SIGTERM`, 2 s, `SIGKILL`
  (`@modelcontextprotocol/sdk` `client/stdio.js`, `StdioClientTransport.close()`).
- An IDLE server exits 0 on the stdin close in ~15 ms; Node's `exit` hooks run and `WdaServer`'s exit hook kills
  its child. No orphan.
- A BUSY server — a tool call in flight; a WDA `/source` is budgeted at 30 s, a first WDA build at minutes — misses
  the close, takes the SIGTERM, and Node runs no `exit` hook for a signal. Its WebDriverAgent survives.
- Even when the hook does run, its process-group kill reaches only `xcodebuild`: the `WebDriverAgentRunner` that
  listens on the port is a child of `launchd_sim` inside the simulator, in its own process group
  (`ps -o pid,ppid,pgid` on a live tree). The runner ends only through xcodebuild's own test-session teardown, and
  nothing waited to see whether it did.
- Whether Claude Code closes servers through that SDK path could not be determined from here.

## Fix (0.8.1)

- `src/mcp/lifecycle.ts` installs `process.once` handlers for SIGTERM/SIGINT/SIGHUP, installed BEFORE the
  transport connects: `await registry.shutdown()` raced against a 1.5 s budget (inside the SDK's 2 s
  SIGTERM→SIGKILL window), then `server.close()` (≤ 200 ms, flushes a pending frame), then `process.exit(0)` —
  exiting ourselves, since a handled signal no longer terminates the process; `process.exit` then runs the old
  `exit` hook as a backstop. `once`, so a second signal during the wait meets the default handler and kills the
  process (status 143) — the force-quit convention. Exit 0 because the shutdown is clean by construction.
- `AdapterRegistry.shutdown()` closes the registry (a `get()` parked on a probe when shutdown ran can no longer
  create and cache a fresh adapter — which on iOS/wda would have spawned the very WebDriverAgent just stopped),
  drops the bindings and awaits every adapter's `dispose` through one `disposeQuietly` helper that both it and
  `evict()` use — one place where "a dispose failure never escapes" is decided.
- `WdaServer.shutdown()`: `stop()`, then poll the port (≤ 600 ms, 150 ms probes) until the connection is REFUSED —
  a probe that times out is a wedged listener, not a free port, and keeps waiting — then `lsof -ti -n -P -sTCP:LISTEN
  tcp:<port>` and SIGKILL whatever still LISTENS, our own pid excluded. Two review rounds shaped this: a bare
  `lsof -ti tcp:<port>` also lists the CLIENT end — this process, after its probes — and the first cut SIGKILLed averi
  itself before the runner (measured with the real lsof); and the phases must add up inside the 1.5 s budget (600 +
  300 + kills, where 1 000 + 2 000 had been reasoned about, not summed). Killing by port is safe only because
  `shutdown()` escalates solely when WE spawned onto the port (`doEnsureRunning` refuses to spawn onto a held one);
  the per-UDID port is a per-PROCESS allocation and proves nothing across processes. `killChild()` no longer signals
  a reaped child's process group (PID reuse). After `shutdown()` the server refuses `ensureRunning()` — terminal,
  unlike `stop()`.
- `DeviceAdapter.dispose` may return a promise that resolves when the resource is released; `IosAdapter.dispose`
  returns its WdaServer's `shutdown()`.

## Verification

Unit tests pin each guarantee and each was mutation-checked (every reverted fix fails its test). One integration
test runs the REAL `lsof` against a listener child with a client end in the test process and in a second child,
driving `WdaServer.shutdown()` against that mute listener: the real fetch times out, the wait runs its 600 ms, the
real lsof lists only the listener, and only it is passed to `killProcess`. Two independent Opus 5 review loops (three
rounds each) verified the escalation end to end against real sockets: refused → ~7 ms early return; answering → ~700
ms then kill; wedged → ~830 ms then kill; idle server exits 0 in ≤ 18 ms on SIGTERM/SIGINT/SIGHUP/stdin EOF.

**Acceptance check on a real simulator (not yet run — a live averi server owned the only WDA at the time):** with a
warmed DerivedData build, start the server by hand with stdin held open, make one `uiTree` call to bring a WDA up,
`kill -STOP` the xcodebuild pid (so its teardown cannot clear the runner), then SIGTERM the server. Expect: exit
status 0 (not 137), `pgrep -f WebDriverAgentRunner` empty within ~2 s, `lsof -ti tcp:8100` empty. Without the SIGSTOP
the happy path hides the escalation entirely.

## Not covered, by nature

- SIGKILL (no handler runs) and a second signal during the ≤ 1.5 s wait (deliberate force-quit).
- A SIGTERM during the first WDA BUILD: `killChild` has no child yet, and `exec.ts` exposes no handle to the
  `xcodebuild build-for-testing` process, so it keeps building; the next server starts a second build into the same
  DerivedData. No port is held, so it is not the reported symptom.
- A WebDriverAgent left by a different tool on the same port is never reached by the last resort: `shutdown()` only
  escalates when this server spawned onto the port, and it would have refused to spawn onto a held one.
- A shutdown that cannot run `lsof` (missing, or over its 300 ms) says so on stderr and leaves the port as it is.
