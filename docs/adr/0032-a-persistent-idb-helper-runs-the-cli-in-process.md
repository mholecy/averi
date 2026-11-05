# 32. A persistent idb helper runs the CLI in-process

Status: accepted 2026-10-31 (performance backlog row D7, docs/plans/2026-10-30-performance-backlog.md, section "### D7
and D24 measured"; the orchestrator's design from the D7 analysis). Part a (reads) implemented on
`perf/d7a-idb-helper-reads` (e1bd812f, ca108196, efa53625, 138025ed, 4d0d4d07, 13478551), merged 5fb79290; part b
(input, D7b) implemented on `perf/d7b-idb-helper-hid` (c1afc5e0, acc106c2, 90995f24, a8609ac2), merged a4746de9 —
section "D7b" below. D26b (screenshots through idb on the idb tree source, `perf/d26b-idb-screenshot`) — section
"D26b" below.
Amended 2026-11-01 (D41: every tool gets the project's adapter, so one simulator runs one helper — see the amendment
below).
Amended 2026-11-01 (D44: the capture source no longer follows the tree source, so a wda project captures through idb
too — see the amendment below).
Amended 2026-11-02 (D48: a wda project's launch waits too — it asks WebDriverAgent which app it reads, once WDA is
running — see the amendment below).
Amended 2026-11-02 (D49a: a deep link to the project's own scheme waits as a launch does — see the amendment below).
Amended 2026-11-02 (batch-5: D49a's ⚠ path device-checked — the D49a amendment's last paragraph).
Amended 2026-11-02 (D54: when iOS's "Open in …?" alert holds such a link, the reply names the alert and its buttons'
centres instead of the ⚠ line — see the amendment below).
Amended 2026-11-02 (D56: a launch that waits behind iOS's system alert names it and its buttons' centres in its ⚠ note
— see the amendment below).
Amended 2026-11-02 (batch-7: D56 device-checked — the D56 amendment's last paragraph).
Amended 2026-11-02 (D57: the alert's advice leads with a tap by the button's label, its x and y the fallback — see the
amendment below).
Amended 2026-11-02 (D58: before a link to the project's own scheme, averi records the answer an Open tap records, so iOS
should not ask "Open in …?" — see the amendment below).
Amended 2026-11-03 (batch-8: D58's gate device-checked — the D58 amendment's last paragraph).
Amended 2026-11-03 (batch-9: D58 checked end to end through averi — the D58 amendment's last paragraph, after
batch-8's).
Amended 2026-11-06 (A10: the alert goes up as a fact, on both verbs, and its words move above the adapters — see the
amendment below; replies byte for byte).

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

**One helper process per iOS adapter — in D7a at most one live per simulator: a wda adapter never started its helper (since D7b its input starts it: section "D7b") — runs fb-idb's own CLI entry, `idb.cli.main.gen_main(argv)`, in-process, per request.
In D7a it serves `ui describe-all --json` alone; D7b adds averi's HID verbs (section "D7b"); every other call, and
every call it cannot take, is the CLI as before.**

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
  `runIdb`), recorded as `idb ui describe-all` (since D7b also `idb ui tap`, `idb ui text`, …) with `via: helper` (`recordHelperCalls` in `scripts/perf/instrument.ts`).

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
- Since D21 (2026-10-31) one caller reads a failure's text: `IdbTreeSource` turns a describe-all whose stderr says
  "accessibility service named no frontmost application" into `IdbNoFrontmostError` (the simulator's wedged AX
  service, cured only by a reboot). It reads the `ExecError`'s `stderr` field, which the helper's nonzero answer carries
  as exec's does, so the CLI and the helper are matched alike.
- The contract test (`tests/adapters/idb-helper-contract.test.ts`, the real fb-idb, no simulator) runs both on
  `--companion localhost:1 ui describe-all --json` (equal code and stderr) and on `ui describe-all --help` (equal
  stdout bytes, `usage: idb …`: the helper sets `sys.argv[0]` to idb's path for argparse), on `--companion
  localhost:abc` (`logger.exception`'s traceback through the logging handler: equal but the timestamp), and 50 requests
  in a row (equal each time). A fake fb-idb under the same interpreter pins the bootstrap: the package beside idb's
  real path is imported, not one planted in the cwd; the code is masked; a logging handler's output is captured.

### D7b — input through the helper (2026-10-31, `perf/d7b-idb-helper-hid`)

D7 measured `ui tap` 219.0 → 96.5 ms through a persistent client (−122); D7b sends averi's HID verbs the same way.

- **The allowlist** (`adapters/idb.ts`, `READ_ARGV` and `HID_ARGV`, the `--udid <udid>` appended last as for the CLI):
  exactly the argv IosAdapter sends (`ios.ts`), word by word — `ui tap X Y` (tap), `ui tap X Y --duration S`
  (longPress), `ui swipe X1 Y1 X2 Y2 --duration S` (swipe), `ui text T` (typeText; D24's split sends two),
  `ui key-sequence K…` with one or more codes (clearText: `42`… then `76`…), `ui key 40` and `ui button HOME`
  (pressKey) — besides D7a's `ui describe-all --json`. A number is a plain decimal (`-?\d+(\.\d+)?`, what `String(x)`
  writes for averi's coordinates and durations); `T` is any string. Anything else — another button, a coordinate
  `String()` printed in exponent form, `describe --json` (the viewport, memoized: one call an adapter) — is the CLI's.
  A text the two would receive differently is the CLI's too: a lone surrogate reaches the CLI's argv as U+FFFD (node
  encodes it so) but the helper's JSON as itself, and a NUL makes execFile refuse the call where the helper would type
  it (both measured 2026-10-31, node 22).
- **The ack.** The script writes `{"got": id}` on fd 3 right after it reads a request line off stdin, before
  `gen_main` runs it (review round 1, MINOR-1). Node marks the pending request taken; an ack of any other id is stale
  and ignored. It is what splits a death in two below.
- **No retry after a death under an input it took.** A read the helper died under is retried on the CLI (a read twice
  is one read); an input acknowledged is not: fb-idb sends the HID event over the companion's gRPC before it answers,
  so a death after the ack may come after the event reached the simulator — a tap repeated is two taps, a `ui text`
  repeated types the text twice. `runIdb` throws instead, in exec's shape (an `ExecError`, exit `null` as a CLI killed
  by a signal reads, not timed out), the sentence where the CLI's stderr would be — the one new error text of the
  helper:

  ```
  Command failed (exit null): idb ui tap 120 640 --udid <udid>
  the idb helper exited during this input; it may or may not have reached the simulator — look at the screen before repeating it
  ```

  (`idb.ts#INPUT_LOST`; the first line is exec's, the second does not repeat the command — review round 1, NIT-2.) A
  disposed adapter under an input it took reads the same; one disposed under an input the helper had NOT taken (written,
  no ack) runs that input once on the CLI after the dispose — accepted (review of D7b): it runs once, as a CLI call in
  flight at the dispose did before D7. Nothing in averi matches idb's input errors by text
  (grep of `src`, `tests`, `docs` 2026-10-31: callers read `ExecError.timedOut`, never the message), so no caller
  changes.
- **A death before the helper took the request runs the CLI**, input or not — `gen_main` never saw it, so it runs
  once: the child has exited (`exitCode`/`signalCode` set, or stdin no longer writable) with its `exit` not handled
  yet — `run` declines, nothing is written; the write itself failed (EPIPE: a pipe with no reader took none of the
  line) — `IdbHelperReply` `unsent`, and the helper is killed; or it died and its fd 3 ended with no ack — `unsent`.
  node may run `exit` before fd 3's last lines (an ack written just before the death), so an unacknowledged request is
  judged only once fd 3 has ended; a fd 3 still open `DRAIN_MS` (1 s) after the exit leaves it unknown, and unknown
  is `died`: reported, never repeated. `DRAIN_MS` is a backstop for an unknown holder of fd 3, not an expected path:
  fb-idb starts its children (the companion it may spawn, `idb/common/companion*.py`) with
  `asyncio.create_subprocess_exec`, whose `close_fds=True` default keeps fd 3 out of them (no `close_fds`/`pass_fds`
  anywhere in fb-idb, grep 2026-10-31). The reviewer's
  fuzz of round 1 found 21 of 22 "lost" reports were inputs the helper had never read, before the ack.
- **Timeouts** as for reads: the helper is SIGKILLed, `Command timed out: idb …`, not retried, and counted toward
  `TIMEOUTS_IN_A_ROW` with reads (a read's timeout then an input's turn it off).
- **stdout carries bytes** (NIT-2 of D7a's review, the residual below now closed): each stream is a `TextIOWrapper`
  over a `BytesIO`, in the encoding and error handler of the helper's own stdout/stderr — the CLI's under the same
  locale (stderr's `backslashreplace` pinned: a surrogate escape prints as `\udcff`, as the process's own stderr does) — so `sys.stdout.buffer` exists (fb-idb's `screenshot -`, `file pull … -`, `video` write there), and the
  reply carries both streams as base64 of their bytes; node decodes them as exec does (stdout a Buffer, stderr utf-8).
  The HID verbs print nothing on stdout; `--help` and argparse's errors are the paths that print, and are pinned.
- **Busy → CLI, and ordering.** HID and reads share one helper and one request at a time: an input issued while a read
  is in it goes to the CLI, as a concurrent read does. That cannot reorder input: every input path awaits its idb call
  before the next (typeText, D24's split, clearText's two sequences; `Promise.all` in `src` joins reads and disposal
  only — `runEnsureState`'s health check and frame, verify's legs per platform, the registry's discovery and
  disposal), so one adapter never has two HID calls in flight, and a CLI call cannot overtake a helper call it
  follows. Two MCP tool calls in flight on one simulator could interleave their inputs before D7 as well.
- **One helper per adapter, now started by input too.** D7a's "a wda adapter never starts its helper" held because
  only a tree read started it; a WDA-tree adapter's input now does (its input is idb's — the AveriLabRN runs use WDA's
  tree). A simulator served under both tree sources at once (two projects, two cached adapters) runs two helpers —
  each still one request at a time; sharing one per simulator would need a refcount across adapters, not done.
- **D24's split through the helper.** `typeText` into an app that drops a tail sends `ui text <first>`, waits
  `FIRST_KEY_ALONE_MS` (150 ms, explicit, unchanged here; 50 ms since ADR 0023's D25 amendment), then `ui text <rest>`.
  Through the CLI the second call paid the Python start-up (~90 ms of D7's −122 on a tap; `ui text` unmeasured) between
  the wait and its first event; through the helper it does not, so the gap between the first key and the rest shrinks by
  roughly that — the wait itself (FIRST_KEY_ALONE_MS) stays. D24's 15/15 was measured through the CLI (raw
  `idb ui text`); the owner's RN re-check (`ios-run.sh --app react-native`, rn-fill-20, helper on) must confirm the
  split still lands whole first time.
- Tests: `tests/adapters/idb-helper.test.ts` (each HID argv to the helper; near-miss shapes and ill-formed texts to the
  CLI; a death after the ack → the error, no CLI call; before it, an exit not yet seen, and a failed write → the CLI;
  an ack read after the exit still counts; a fd 3 that never ends → the error; a stale ack ignored; a dispose under
  an input never taken → the CLI once; an input's
  timeout counted; clearText's two sequences one after the other), `tests/adapters/idb-helper-contract.test.ts` (every
  HID argv against `--companion localhost:1`, a dash-led text, and `ui tap --help`: equal code, stderr and stdout bytes
  to the CLI; a fake fb-idb writing to `sys.stdout.buffer`, printing a surrogate escape to stderr, and dying inside
  `gen_main` — `died` five times in five, the real ack read), `tests/perf/instrument.test.ts` (D0 labels each HID
  helper call as its CLI call, `via: helper`).

### D26b — screenshots through idb on the idb tree source (2026-10-31, `perf/d26b-idb-screenshot`)

`simctl io screenshot` stalls ~+1 000 ms in ~7 % of calls with or without the helper (backlog row D26, "### D26 diag":
120 interleaved rounds on the lab simulator — simctl png 398 / 417 ms p50 / p90 and 8 stalls; no simctl variant avoids
it; it is a ~1 s wait inside CoreSimulator, worst beside a `simctl spawn launchctl` at 38 %). `idb screenshot` took
168 / 179 ms through the CLI and 77 / 88 ms through a persistent fb-idb client, 0 stalls in 120 each.

- **On the idb tree source `IosAdapter.screenshot` is `idb screenshot - --udid U`**, through `runIdb`: the helper when
  it is ready and idle, the `idb` CLI otherwise. `['screenshot', '-']` is on `READ_ARGV` — it changes nothing on the
  simulator, so a helper that dies under it is retried on the CLI; its budget is describe-all's 15 s
  (`ios.ts#IDB_SCREENSHOT_TIMEOUT_MS`), and a timeout counts toward `TIMEOUTS_IN_A_ROW` with the tree reads.
  `screenshot <file>`, `screenshot` alone and any flag more are the CLI's. The PNG travels as base64 of
  `sys.stdout.buffer`'s bytes (D7b made the streams bytes); the contract test checks `screenshot -` against
  `--companion localhost:1` and `screenshot --help` (same code, stderr and stdout bytes as the CLI) and 5 MB of binary
  stdout from a fake fb-idb, byte-equal.
- **The WDA tree source keeps `simctl io screenshot` exactly as before**, and `AVERI_IOS_SCREENSHOT=simctl` forces it
  on the idb source too (SETUP.md, troubleshooting). Both are fixed when the adapter is made — the kill switch is read
  once per adapter — so an adapter captures every frame from one source (the rule, for every adapter, is on
  `adapters/types.ts#DeviceAdapter.screenshot`).
- **No simctl fallback at run time.** idb draws the Dynamic Island (a black pill, 378×112 px at the top centre of the
  1206×2622 frame) where simctl shows the app's background, and 16 corner pixels differ; the rest is equal (same size,
  same sRGB). The stability wait (`verify/capture.ts`) compares a pair of captures byte for byte: one from each source
  reads as a moving screen. So an idb failure is the answer — a plain Error whose first line is exec's (the command,
  or its timeout) with the remedy after it (the companion, `idb list-targets`, the kill switch), exec's ExecError as
  its `cause`: the remedy must sit on the line `captureRefusal` quotes; or, for bytes that are no PNG, the transport
  error naming `idb screenshot - --udid U` with the same remedy and the reboot.
- **Baselines.** A stored baseline from simctl (every one before D26b), or one written by an adapter on the other tree
  source of the same simulator, differs from an idb capture in the island alone: 1.219 % of the lab frame, over the
  1 % default threshold. The iOS baseline diff (`verify/assert.ts#iosBandRows`) therefore leaves the status band —
  `viewport().statusBand` × the png's scale, 62 pt = 186 rows there — out of both images, and says `status band
  excluded` in the detail. This loosens a check, held to exactly that: iOS only, the band's rows only; a png that is
  not the viewport at one scale is compared whole (defensive; whether a rotated simulator's capture is ever landscape
  is unmeasured), and so is one whose viewport cannot be read, as before. It applies on the WDA tree source too, on
  purpose: a stored baseline may have been taken under either source, so either may meet the island; a
  difference in the first row under the band still fails (tests/verify/assert.test.ts). The band is the status bar's
  and the island's, never the app's to assert on — the same band a tap counts as off the screen.
- **D0** counts both captures (`SCREENSHOT_LABELS` in `scripts/perf/stats.ts`): the totals as before, `stalls.byLabel` in
  the JSON (added, nothing changed), a stall line per capture in the text.
- The differential's fake device answers `idb screenshot -` with the same frame as simctl's file: the replay serves the
  truth capture's frames (taken with simctl) for both commands, so golden cannot see the island or any other
  idb-vs-simctl pixel difference; the truth capture itself is unchanged.
- Residuals:
  - The companion's own screenshot path under load is measured only by the diag (120 rounds, one simulator); a
    long-lived helper serving ~5 MB replies is unmeasured for memory; the owner's device check (backlog, "### D26b") is
    still to come.
  - An app that hides the status bar (a full-screen player, a game, a splash, a hero image under the bar) has its top
    62 pt no longer compared in a baseline diff. Accepted: averi's baselines target app UI, and the island makes that
    strip depend on the capture's source.
  - An island device missing from `IOS_SAFE_AREA_TOPS` (adapters/ios-status-band.ts — the iPhone Air, 420x912) gets
    the 20 pt fallback band, which does not cover the island: an old simctl baseline can still fail there on the
    island alone — a false failure, not a hidden regression.

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
- One request at a time: concurrent iOS calls still pay the CLI.
- A HID event lost when the helper dies after it took the request (D7b) is reported, not repeated: the agent reads that the input may
  or may not have landed and must look before it repeats the step. A CLI killed mid-call left the same uncertainty,
  but a helper death is a new way to get there (one process for many calls).
- ~~stdout is TEXT~~ — closed by D7b: the streams are bytes (`sys.stdout.buffer` exists), carried as base64.
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

## Amendment: every tool gets the project's adapter (2026-11-01, backlog D41)

Which adapter a tool call is served by, only; what the helper is and how it runs are unchanged. The registry keeps one
adapter per simulator and tree-source kind, and each iOS adapter owns its helper. Every MCP tool now asks the registry
for the project's kind: each handler goes through one resolver, `mcp/tools.ts#deviceFor`, with the
`app.ios.treeSource` of the config the call loaded, and the registry's `get` takes that kind as a required argument
(`undefined` is the default, idb): the kind-less overload is gone, and the one resolver plus
`tests/mcp/registry-gets.test.ts`, which pins it as the only `registry.get` in `src/`, keep every call on the
project's kind. Eight tools (`install_app`, `launch_app`, `terminate_app`, `open_deep_link`, `screenshot`, a
coordinate `swipe`, `press_key`, `get_logs`) used to ask without the kind, and several of them could not know it,
because their policy read no averi.yaml on iOS. Each now takes `configPath`, and on iOS each reads the file under the
`optional` policy.

So one project drives one adapter per simulator, with one helper. The D7b note "a simulator served under both tree
sources at once runs two helpers" mostly came from those kind-less calls inside one `treeSource: wda` project, not
from two projects. Two projects with different tree sources on one simulator and one server still run two helpers.
The same calls had put `launch_app`'s foreground wait, D24's tail-drop memory and `terminate_app`'s front-app memory
on an adapter the project's tree tools never used.

The screenshot source follows the tree source (D26b) for the `screenshot` tool too. In a wda project the tool captures
through simctl, the source of the frames that `assert` and `ensure_state` read, at about 300 ms more than idb's
helper. `launch_app` has no foreground wait there, because the wda source answers no application label; a flow's
`launch:` step already behaved this way. `press_key` and a coordinate `swipe` still send idb input, through the wda
adapter's own helper. Without a project config nothing changes: the kind is the default, as it already was for the
tree tools. Because these tools read `./averi.yaml` by default, they now honour the file in the server's working
directory, as the tree tools did.

## Amendment: the capture source no longer follows the tree source (2026-11-01, backlog D44)

D26b moved screenshots to idb on the idb tree source only. That was a scope decision, not a technical one: the WDA
runs measured then had no stalls. An iOS adapter now captures through `idb screenshot -` (the helper first, the `idb`
CLI as its fallback) whatever its tree source; `AVERI_IOS_SCREENSHOT=simctl` still forces `simctl io screenshot` for
both kinds (`ios.ts`, the constructor's `screenshotVia`).

Why: the D41 device A/B on a wda project, on the lab simulator. Through the wda adapter, which captured with simctl, the
`screenshot` tool took a median of 1 087 ms over 10 runs, and 3 of the 10 stalled at about 2.1–2.2 s (2 118, 2 133 and 2
225 ms). On the same simulator, with that project's WebDriverAgent session live, the idb adapter's helper captured in
about 440 ms (medians 446.5 and 436 ms over two runs of 10, no stall). The same runs showed no conflict between idb and
WDA: after those 10 idb captures, the wda adapter's launch-then-tree reads went 5/5. That count was unproven: it was
judged by the app name, and a stuck iOS "Open in “AveriLab”?" alert from the probe's own deep link covered every launch
in batch-1 and in the first batch-2 run. The re-check with a lab-id judge (batch-2 block D, 2026-11-02, main 39c1fcda)
read 3/5: in 2 of 5 runs `launch_app` replied "Launched dev.averi.lab on ios" and the `ui_snapshot` right after it still
read Contacts' tree while idb's front app was already AveriLab — `launch_app` returns before the launched app's tree is
readable (backlog D48; the alert is D49), not a conflict between idb and WDA; `home` leaves the lab as it should. A wda
adapter has driven its input (`press_key`, a swipe, typing) through its own idb helper since D7b. Since D41 every wda
project has one adapter, and that adapter already runs that one helper, so the capture adds no process.

The one-source rule (`adapters/types.ts#DeviceAdapter.screenshot`) still holds per adapter: the source is fixed when
the adapter is made, the kill switch is read once then, and there is still no simctl fallback at run time. The status
band is unchanged: `verify/assert.ts#iosBandRows` gates on the platform, not the tree source, and already left the band
out on the WDA tree source. That matters now, because a wda project's stored baselines were taken with simctl and now
meet idb frames. They have the same size and the same sRGB, and differ in the Dynamic Island and 16 corner pixels; the
band covers the island, as it has for an idb project's older baselines since D26b. The residual on an island device
missing from `IOS_SAFE_AREA_TOPS` applies to wda projects too.

Device A/B (2026-11-02, batch-1 at main 0262c69d): `scripts/perf/baseline.ts` on a wda project, 10 repeats per
scenario, three runs in the order simctl / idb / simctl, every scenario 10/10 ok. Medians in ms:

| scenario | simctl (run 1) | idb (run 2) | simctl (run 3) |
|---|---|---|---|
| screenshot | 1 112 | 505 | 1 087 |
| colour assert | 1 471 | 839 | 1 454 |
| OCR assert | 1 674 | 1 020 | 1 625 |
| ensure_state, cold | 6 677 | 6 019 | 6 724 |
| ensure_state, warm | 1 179 | 506 | 1 144 |
| tap (control) | 692 | 692 | 679 |

So on the wda tree source, capture through idb saves about 590 ms on a screenshot, 620 on a colour assert, 630 on an
OCR assert, 650 on a warm ensure_state and 680 on a cold one; the tap, which captures nothing, is unchanged. D26
stalls: simctl 9 of 100 captures in run 1 and 0 of 100 in run 3; idb 0 of 102, its ok calls at a median of 94 ms
against simctl's ~400 ms.

## Amendment: the launch asks WebDriverAgent which app it reads (2026-11-02, backlog D48)

The D41 amendment above says `launch_app` has no foreground wait in a wda project, because the wda source answered no
application label. That was a decision of 2026-10-09 (`adapters/wda-tree-source.ts`): the idb lag after an app switch
had not been measured on WDA's sessionless `/source`, and asking would move WebDriverAgent's start (a build on first
use, then up to 60 s for `/status`) into `launch_app`. It is measured now. Batch-2 block D (2026-11-02, main 39c1fcda,
a wda project on the lab simulator): Contacts in front, `launch_app dev.averi.lab`, a `ui_snapshot` at once. In 2 of 5
runs the snapshot was Contacts' whole tree — neither empty nor bare, so nothing downstream doubted it — while the reply
was the bare `Launched dev.averi.lab on ios` (launchMs 340–364: no wait ran).

The mechanism, from WDA 16.1.7's source: averi holds no WDA session, so `/source` reads
`XCUIApplication.fb_activeApplication` (FBDebugCommands.m), the app AX lists as active — and the lab's WDA log shows AX
listing one app, which for a moment after `simctl launch` returns is still the previous one. The same lag idb was
measured with (docs/bugs/2026-10-09-ios-launch-app-reads-previous-apps-tree.md), through another reader.

Decision:

- `WdaServer.upGeneration()` — no device call: which start of ours is up (it reached `/status`, and its xcodebuild has
  neither exited nor been stopped since), or none. `WdaServer.activeAppInfo()` — `GET /wda/activeAppInfo`, sessionless; FBCustomCommands.m resolves its
  app with the same `request.session.activeApplication ?: fb_activeApplication` as `/source`, so it names the app the
  next `/source` reads, without walking the tree. It never starts or restarts WDA; one request under 2 s; a refusal, a
  timeout or an HTTP error fails naming the port and the log.
- `WdaTreeSource.applicationLabel()`: WDA not up → `declined`, as before (the first read's own start, 7.7 s in that
  run, outlasts the switch, and a launch must not start WDA); up → the new `{ kind: 'bundle', bundleId }` from
  `value.bundleId`, `unlabelled` when that is not a non-empty string; released → the released error. A failed ask
  is the "could not check" note, and that WDA child is not asked again: every later launch gets the remembered error at
  once, so its note still says it could not check (never a silent decline) without paying the ask's 2 s again on a
  wedged runner — until a `/source` read succeeds on that child, or WDA restarts (review 2026-11-02, two rounds). The bundle id is matched exactly: WDA
  reports the app's canonical identifier, the id `simctl launch` was given.
- `ios-foreground.ts#awaitForeground`: a `bundle` answer matches when it is the launched bundle — exact, so no
  `simctl appinfo`, no names, no localized-name reading. Another bundle is polled like a stale label within the same
  3 s bound, and then the note: `3 s after launching <id>, WebDriverAgent still read <other> as the active app — a
  ui_snapshot now reads that app's tree, on which an absent check passes. Read again; if it repeats, take a
  screenshot`, SpringBoard (`com.apple.springboard`) named as "SpringBoard (the home screen, the launch animation or a
  system alert)". A failed ask, or no bundle id to the bound, is the "could not check" note, worded for WebDriverAgent.
  Every launch note's advice is one (review 2026-11-02): read again before trusting a read — the screenshot switches
  before the tree, on either source.
- `launch_app`, a flow's `launch:` and `ensure_state`'s launch rungs all pass `IosAdapter.launch`, so all gain it.
  `openDeepLink` still waits for nothing (a link may bring another app forward — see the D49a amendment).

Considered, not chosen:

- Reading `/source` until its root is the launched app: a whole tree read per poll (0.9–1.25 s in that run), and the
  display names (`appinfo`) to match it against again.
- idb's Application label in a wda project: another reader, whose lag is not `/source`'s.
- Starting WDA inside `launch_app`: the 2026-10-09 objection stands — a build and up to 60 s of start in a project's
  first launch, where declining costs nothing.
- `ui_snapshot` naming the app it read and warning when it is not the last launched: an extra ask per read, and a false
  ⚠ after a deep link or a tap that legitimately opens another app.

Cost: WDA not up — nothing (`declined`, no call). Up, the app already in front — one `/wda/activeAppInfo` (estimated
tens of ms: an AX query, no tree walk; unmeasured). Up, AX still lagging — the lag (estimated 0.3–1 s), time the next
read would otherwise spend on a stale tree; at worst the 3 s bound plus one ask in flight (≤ 2 s) and a ⚠ line. The idb
source is unchanged. The differential replay's recorded WDA source answers the replayed app's bundle to a side that
asks (`Side.asksWdaBundle` in `scripts/differential/side.ts`) and `declined` to an older one, so neither side's reply moves.

To check on the device (the next batch): Q2 ×10 A/B main vs this change, judged by lab ids; the raw lag window
(`/wda/activeAppInfo` every 50 ms after `simctl launch`); the happy-path cost (accept ≤ +150 ms median); a cold launch;
a launch before WDA is up; an idb project unchanged. Android has the same shape of code (no wait after `am start`) but a
different read (`uiautomator dump` waits for 1 s of accessibility idle) — not changed until measured.

Checked on the device (batch-4, 2026-11-02, lab simulator; main 7e6d2d47 against 9d8b57dc, the src before this change;
`d48-probe.ts`, four alternated runs): Q2 — main read the lab's tree in 10/10 (⚠ 0), before read Contacts silently in 4
of 10; the happy path — `launch_app` median 342.5 ms before, 361 ms main (+18.5, within the +150 accepted), about one
ask a launch, no ⚠; one raw `/wda/activeAppInfo` with the lab in front: median 11.8 ms, p90 18.5 ms (n 20), the lab
named 20/20 — the "tens of ms" estimate above holds; the lag (`simctl launch` → WDA names the lab, 50 ms polls): 0 ms
in 10/10, never Contacts at the first poll, so the 3 s bound was not approached; a cold launch 5/5 the lab's tree
(two asks, 2.0–2.1 s); WDA not up 3/3 (no ask, the lab's tree); an idb project unchanged (5/5 both sides, no ask).

## Amendment: a deep link to the project's own scheme waits as a launch does (2026-11-02, backlog D49a)

`open_deep_link` replied `Opened <url> on ios` once `simctl openurl` returned, and read nothing after it. Batch-1 D's
probe (main 0262c69d, wda): with SpringBoard in front, `open_deep_link averilab://d41` replied "Opened" in 383 ms while
iOS asked "Open in “AveriLab”?"; the five `launch_app`s after it all stayed behind the alert (every `ui_snapshot` read
SpringBoard's root). With the lab in front there was no alert (batch-2 rerun). The D48 wait already flags the launches
that follow; nothing said so at the call that caused it.

Decision (the D49 analysis, split by the orchestrator: D49a now, D49b after a device capture):

- `open_deep_link` hands `IosAdapter.openDeepLink` the project's app (`app.ios.bundleId`, `DeepLinkOptions.appId`).
  After the accessibility writes and `simctl openurl` — sent exactly as before — the adapter asks whether the URL's
  scheme is one that app declares: not `http`/`https`, and in its Info.plist's `CFBundleURLTypes`. `simctl appinfo` and
  `listapps` carry no URL types (measured); `plutil -extract CFBundleURLTypes json -o - <Path>/Info.plist` does, a host
  read of milliseconds at the `Path` appinfo already gives (`adapters/ios-url-schemes.ts` reads the answer; plutil's
  "No value at that key path" is "declares none"). Cached per bundle until `install`, as appinfo is. (Since D58 the
  ask comes first, before the writes and `openurl` — see that amendment.)
- When it is, the D48 wait runs as for a launch (`ForegroundCheck.link`): idb's Application label or WDA's active
  bundle, at most 3 s, failing open, declining while WDA is not up. Its notes say "opening <url> in <bundle>" and lead
  with what the wait knows: when it read another app or SpringBoard to the bound, "averi did not see <app> come
  forward after the link: iOS may be asking to confirm it ("Open in “…”?") or another app may be in front — take a
  screenshot, and if it shows a system alert, answer it (every launch stays behind it until then)"; when it could not
  tell (a read error, an unlabelled or empty tree), "averi could not check that <app> came forward …" with the same
  advice (review of D49a: no over-claim). A WDA not up yet (`declined`), which a launch leaves silent, gives a short
  note too — not checked, answer an "Open in …?" if iOS asks — so no own-scheme link replies a bare "Opened". The reply
  keeps `Opened <url>` with that `⚠` line under it. A match moves D24's `front` to the app: a link that brought it
  forward is a launch of it.
- Every other link reads nothing of the UI after `openurl`, and has no note: none given, a web link, one of iOS's own
  schemes (`tel`, `telprompt`, `mailto`, `sms`, `facetime`, `facetime-audio`, `maps`, `itms-apps`, `itms-services`,
  `app-settings`, `shortcuts`, `x-apple-*` — `ios-url-schemes.ts#isSystemScheme`, no lookup at all), another app's
  scheme. Schemes that could not be read (appinfo failed or listed no `Path`, plutil failed otherwise, another JSON
  shape) are the same, plus one stderr line naming why — not knowing is the old behaviour, but not silently. A plutil
  or shape failure on a bundle whose appinfo named its Path is cached until `install` like an answer (one line); an
  appinfo failure or a missing Path is not (review round 2, as appinfo's own cache): the app may be installed later
  outside averi, and every own-scheme link after that would otherwise reply a bare "Opened".

Considered, not chosen:

- Naming the alert and its buttons from the tree at the give-up, or tapping Open (the D49 analysis's (a) in full, and
  its (b)): the alert's shape in idb's and WDA's trees was never captured (the only fixture is hand-written), idb's
  match would be English text, and a wrong tap on a SpringBoard dialog has side effects the agent did not ask for. D49b,
  after the device check (E1–E7).
- `simctl launch` of the app before `openurl`, to avoid the alert: it changes what is tested (a warm link and a cold one
  run different app code).
- Scanning every installed app's Info.plist for the scheme: N reads per link for a case the agent rarely has.

Cost: no project app, a web link or one of iOS's own schemes — nothing. Another scheme — one `simctl appinfo` (shared
with the launch's cache) and one `plutil` per bundle per adapter life (a failed plutil read included, cleared by `install`; an appinfo failure is asked again),
no read of the device's UI, no wait, no note — the review accepted this as "as before" for another app's link. The project's scheme — that, plus the D48 wait:
one ask when the app is already in front, the stale window when the link brings it forward, the 3 s bound and a note
when it never comes. Android unchanged: a link with two handlers starts the chooser, which `am start` reports as
started — a separate row, after a device check.

Checked on the device (batch-4, 2026-11-02, lab simulator; main 7e6d2d47 against d3aa6818, `d49-probe.ts`): the happy
path holds — E1 (the lab in front) no ⚠ under idb and WDA, main adding one `simctl appinfo`, one `plutil` and the ask
(idb 367 → 470 ms, WDA 359 → 467 ms); https and tel the same calls as before, byte for byte, no ⚠. The alert path is
NOT verified: in E2–E4 (SpringBoard, Contacts, a cold start) iOS raised no "Open in" alert — idb listed none, WDA's
`/source` held no Alert and `/wda/activeAppInfo` named the lab, whose opened cell was in front after the link; E6 (raw,
no averi) saw no alert in 27 polls over 3 s — so the link went straight through and the reply's bare "Opened" was
right. Likely iOS remembered an earlier "Open" tap. The ⚠ line has not yet been seen on a device; raising the alert
reproducibly is part of D54.

Checked again (batch-5, 2026-11-02, lab simulator, main 28c1d37d, `d49-probe-v2.ts`): the alert path holds. The alert
was raised on purpose by deleting the decision iOS remembers, `com.apple.CoreSimulator.CoreSimulatorBridge-->averilab`
(= `dev.averi.lab`) in the simulator's `com.apple.launchservices.schemeapproval` defaults domain (`simctl spawn <udid>
defaults delete`, live); with no change (t0) the link was proven to go straight through, so that key is the cause. In
all 6 cases — E2 (SpringBoard in front), E3 (Contacts), E4 (a cold start), each under idb and WDA — the alert was up
(idb listed "Open in “AveriLab”?" with Cancel and Open; WDA's `/source` held an Alert and `/wda/activeAppInfo` named
`com.apple.springboard`) and the reply carried the ⚠ line, "averi did not see dev.averi.lab come forward after the
link …", at the 3 s bound (about 3.4 s). Answered by the probe, Open brought the lab forward and Cancel left Contacts in
front. The decision was restored afterwards and verified (read back after a reboot, the link through with no alert).
The alert's shape in both trees is D54's input.

## Amendment: the alert named in the reply (2026-11-02, backlog D54, D49b)

D49a's note at the bound says only that iOS *may* be asking; the agent then needs a screenshot to learn what is up and
how to answer it. Batch-5 D49A captured the alert in both trees (above), so it is now named.

Decision (spec-D54, adopting the D54 analysis; review round 1 reshaped the seams):

- `adapters/ios-system-alert.ts`, pure functions returning the title and the buttons, each label verbatim with its
  centre (`SystemAlert`), or nothing. On idb two parts, apart because the source holds the elements and the wait holds
  the app's names: `alertShapeInIdb(elements)` — the first Application is SpringBoard's (label `' '`), every other
  element is a StaticText or a Button, the first StaticText (the title) is labelled, and there are 1–4 Buttons, each
  labelled and framed — and the title gate `titleAsksToOpen(title, appNames)` — one of the app's names in it, or the
  English `Open in “…”?`. idb has no Alert type; the shape is what idb measured (the alert listed alone, no status
  bar: SpringBoard's measured launch tree, with its status items, fails it), and the gate keeps another SpringBoard
  prompt out. `alertInWda(tree)`: in SpringBoard's tree (root labelled `' '`), the first layer averi's parser marks
  `presentation: 'alert'` (wda-source.ts's `PRESENTATIONS`) that holds a title and a visible button — every marked
  layer is tried, so a hidden alert in an app-switcher card before the real one does not hide it; its title the
  Alert's label, else its first text; its buttons the labelled, not-hidden Buttons inside that layer — Contacts'
  hidden "Return to AveriLab" breadcrumb, in the card beneath, is not one of them.
- idb, no extra call: `IdbTreeSource.applicationLabel`'s answer for SpringBoard carries, as plain data, the
  `candidate` alert shape of the same read; the link's wait — which asks the names after its first label anyway —
  gates its title and ends at the read that lists the alert (`WaitEnd` `alert`), not at the 3 s bound. When the names
  cannot be read, the gate runs with none, so the English form alone passes; any other candidate is "could not check".
- WDA, one short `/source` read: `/wda/activeAppInfo` names only `com.apple.springboard`, so at the bound, and only
  when the last bundle named was SpringBoard's, `ForegroundCheck.alert()` asks `IosTreeSource.systemAlert()`
  (WdaTreeSource's alone; idb has none, and the wait never asks it there, idb naming no bundle). It is
  `WdaServer.quickSourceIfUp()`: one GET under its own `SYSTEM_ALERT_SOURCE_TIMEOUT_MS`, 2 s — not `source()`'s 30 s, and
  never `ensureRunning`, a `/status` probe or a restart. 2 s because a whole app tree read in 0.9–1.25 s (batch-2 D)
  and the alert's SpringBoard tree is small (about 24 KB of XML), while the read is an aid to a reply that must not let
  a wedged runner hold it for 30 s or be restarted by it. WDA not up is no alert, and so is a read that throws, times
  out or holds no alert: the reply is the D49a note (fail open).
- The reply (`mcp/tool-text.ts#deepLinkText`, `DeepLinkOutcome.alert`): the "Opened" headline and the ⚠ line give way
  to `iOS has not opened <url> yet: it asks "<title>" — buttons "<label>" at (x, y), … Answer it with a tap at the
  chosen button's x and y (averi taps nothing itself); every launch stays behind the alert until it is answered`.
  "it asks" only when the title contains one of the app's names (`LinkAlert.asksForApp`; the English form alone is
  not enough, its quoted name may be another app's; on WDA the names come from the appinfo the scheme lookup cached,
  unreadable names are none); any other alert is "a system alert is up, "<title>"". Either way the headline says iOS
  has not opened the link yet — true whenever the alert holds it, which is when the wait found it in place of the app
  — and the title and the labels are quoted verbatim, never paraphrased or judged by their words. Only coordinates are
  advised: batch-5 answered the alert by coordinates, and a selector tap on
  SpringBoard's tree is unverified (D57; since then proven, and a tap by the label leads — see that amendment).
  `front` does not move: the app is not in front.
- Unchanged: a link that matches (no `/source`, no extra call on either source), a launch (it looks for no alert; since
  D56 it does — see that amendment), every link that expects no app (web links, iOS's own schemes, another app's
  scheme).

A correction to the backlog row: WDA's payload has no `presentation` key, in either `/source` form; `presentation:
'alert'` is averi's own mark on the layer holding an `Alert` element.

Considered, not chosen: tapping Open, or an opt-in `confirm: true` (a tap on a SpringBoard dialog acts for the agent,
and which label opens is localised; D58); reading `/source` on every WDA poll (a whole tree per poll for the rare
case); reading it through `source()` (its start, its 30 s and its restart are a recovery, not an aid); the same naming
in `launch_app`'s D48 note (the detectors fit it, but its wording is D48's — D56; since then done — see that
amendment). Since then D58 builds no confirm tap and prevents the alert instead — see that amendment.

Cost: the happy path none (pinned by call counts in `tests/adapters/ios-deep-link.test.ts`). The alert up: idb ends at
its first read (about 0.4 s, from about 3.4 s); WDA pays one `/source` of a small tree at the bound (unmeasured, at
most SYSTEM_ALERT_SOURCE_TIMEOUT_MS). Residuals, stated: idb's alert-only shape is one iOS (27.0) and one device class —
a future iOS that lists the status bar with it falls back to the note; a localised title that omits the display name
falls back to the note on idb; a short app name contained in another SpringBoard alert's title words that alert as
asking to open the link; on idb, when the app's names cannot be read (appinfo lists no name), only an alert titled in
the English `Open in “…”?` is named (as not asking for the app) — a localised title needs the names, so the wait then
ends at once with D49a's "could not check" note, even while the alert is up; a WDA `/source` slower than
2 s at the bound falls back to the note. To check on the device (the next owner batch): D49A E2–E4 judged on the new
reply, the WDA `/source` time at the bound.

## Amendment: the alert named in launch_app's note (2026-11-02, backlog D56)

With an alert up — an unanswered "Open in “AveriLab”?" — `launch_app` on iOS waited behind it to the 3 s bound and gave
D48's ⚠ note: on idb "the UI tree was still SpringBoard's (the home screen or the launch animation) … Read again", on
WDA "still read SpringBoard … Read again; if it repeats, take a screenshot". Neither said what held the launch back, and
"read again" cannot answer it: only a tap does. The alert keeps every later launch behind it (batch-2's first run lost
two cases to it; backlog D41: it covered every launch in batch-1). The detectors were D54's already; only the caller
was gated out: on idb the wait threw away the read's `candidate` for a launch, and on WDA the alert read was wired for
links alone.

Decision (spec-D56, adopting the D56 analysis):

- Wiring: `IosAdapter.foregroundCheck` wires `ForegroundCheck.alert` (`IosTreeSource.systemAlert`, WDA's) for every
  wait, a launch's as a link's; the two `link` gates in `ios-foreground.ts` (`idbAlert`, `alertAtBound`) are gone. The
  title gate `titleAsksToOpen` is unchanged, judged against the launched app's names, which the idb wait asks after
  its first label anyway — or none when they cannot be read, so the English `Open in “…”?` alone passes, as for a link.
- The wait's end: a launch that finds the alert ends on it (`WaitEnd` `alert`) — on idb at the read that lists it, on
  WDA at the bound — and `awaitForeground` returns `{ note: alertNote(...) }` in place of D48's note. `LaunchOutcome`,
  `Launched`, the flow engine and `launchText` are unchanged: they carry the note already, so `launch_app`'s ⚠ line and
  a flow's `⚠ launch` line both show it. The launch never fails: D48's rule holds, the wait only delays, and `simctl
  launch` succeeded (batch-1: a bare "Launched" behind the alert).
- One wording of the buttons and the advice, then in `adapters/ios-system-alert.ts` (since A10 in
  `interact/app-holder-text.ts`, the amendment below): `alertButtonsText(alert)` (`buttons
  "Cancel" at (127, 474), "Open" at (275, 474)`, "button" for one) and `ALERT_ADVICE` ("Answer it with a tap at the
  chosen button's x and y (averi taps nothing itself); every launch stays behind the alert until it is answered").
  `mcp/tool-text.ts`'s alertText (open_deep_link's reply) uses both and stays byte-identical (since D57 the advice
  leads with a tap by the label — see that amendment).
- The note: `iOS has not brought <bundle> forward yet: a system alert is up, "<title>" — buttons "<label>" at (x, y),
  …. <ALERT_ADVICE> — then read again before trusting a read`. Always "a system alert is up", never "it asks": the alert
  belongs to something earlier (a link) and may name another app (launching Contacts behind "Open in “AveriLab”?"). The
  title is quoted verbatim. No "3 s after": idb ends at once, WDA at the bound. The tail keeps D48's "read again"
  without its parenthesis: what comes forward once the alert is answered is unmeasured.
- Device calls: the happy path is call-identical on both sources (pinned by call lists in
  `tests/adapters/ios-deep-link.test.ts`). idb makes no extra call: `candidate` rides on the label read. WDA makes at
  most one `quickSourceIfUp` read, only at the bound, only when SpringBoard was the last bundle named; a launch asks no
  names for it, so a WDA launch pays no `simctl appinfo`. The wait's `alert` end carries the alert as the source listed
  it, with the names its title was judged by; only a link's outcome builds `LinkAlert.asksForApp` from them. A read
  that throws, times out or holds no alert gives D48's note byte-identical (fail open).
- The sources differ, as for a link: on WDA any SpringBoard alert found at the bound is named, whatever its title —
  `alertInWda` has no title gate, and a launch has no names to judge one with (pinned with an "Allow notifications?"
  title); on idb only one titled `Open in “…”?` or naming the launched app (`titleAsksToOpen`). The advice's "every
  launch stays behind the alert until it is answered" is measured for "Open in …?" alone (batch-1, batch-2); for
  another SpringBoard alert WDA names it is unmeasured.

Considered, not chosen: a structured `LaunchOutcome.alert` (new fields in three types and both renderers, and wording
in `flow/launch.ts`, which may not import `mcp/`, for one line the note already carries); "it asks" for a launch (a
link's fact, and on WDA it would need an appinfo the launch does not otherwise pay); failing the launch, or a flow's
`launch:` step, on the alert (the launch did happen; a flow's next read meets SpringBoard and says so in its own
words).

Cost: the happy path none. The alert up: an idb launch ends at the read that lists it instead of at 3 s; a WDA launch
pays one `/source` of a small tree at the bound (386–539 ms in batch-6 for a link, at most
`SYSTEM_ALERT_SOURCE_TIMEOUT_MS`). Paid in a new place: a WDA cold launch still on SpringBoard at the bound gains that
one read before the same D48 note (batch-4's cold launches matched at 2.0–2.1 s, so the bound is rarely reached).
Residuals, stated: D54's apply (a localised title without the app's name falls back to D48's note on idb; an alert
shape another iOS lists differently falls back too); a localised alert that names another app than the launched one
is not found on idb (the title gate judges the launched app's names), and the note is D48's; on idb, when the launched
app's names cannot be read, a localised alert gives D48's "could not check" note at once; on idb the wait ends at the
first read that lists the alert, so a stale tree served just after the alert was answered would name it as up
(unmeasured); on WDA another SpringBoard alert at the bound is named with the same advice, whose "every launch stays
behind" is measured only for "Open in …?". To check on the device (the next owner batch, the D56 analysis's cases):
L1 an idb launch behind the alert (the note, one describe-all, the reply time against main's) and L2 a WDA one (one
`/source` at the bound, timed; no appinfo); L3 and L4, a tap on Cancel and on Open at the quoted centre, then a read at
once and at 1 s — what comes forward decides whether the note's tail should say "launch again"; L5 a launch of another
app behind the alert (the same note, the title verbatim); L6 the happy path's call lists and launch time against main,
on both sources; L7 a WDA cold launch, no `/source` when matched before the bound; L8 answer the alert, then
`launch_app` at once on idb, ×3 (is the answered alert named from a stale tree?); L9 a WDA launch behind another
SpringBoard alert (a permission prompt): named, and does it hold the launch back as "Open in …?" does?

Checked on the device (batch-7, 2026-11-02, lab simulator, main a6410f64 against 21559529, the tree before this change;
the alert raised as batch-5 did, causally: t0 proven not raised, t1 raised it): PASS on L1–L8 (L1, L2, L5, L6, L7 PASS;
L3, L4, L8 observed), L9 inconclusive. L1 idb, Contacts in front: the note 2/2, one `idb ui describe-all`, the wait
ended at 127–130 ms; reply 492/469 ms, against the happy path's 374 ms (L6's main median) and 3287 ms before this change
(D48's note, 12 describe-alls). L2 WDA: the note 2/2, one `/source` at the bound (560/563 ms, started +2922/+2932 ms),
no appinfo; reply 3854/3866 ms, against 3250 ms before (D48's note) — the `/source` is the cost. Every quoted centre lay
in its Button on a fresh read (idb, and WDA's `/source`). L3 and L4: a tap at the quoted Cancel or Open centre dismissed
it 2/2 each; at once SpringBoard was in front, at 1 s the lab (after Cancel) or the lab's open cell (after Open), on
both sources — the launch held behind the alert goes through by itself once it is answered, either way. So the open
question is answered: the tail's "then read again" is right, and "launch again" is not needed (no code change). L5
(Contacts launched behind it): the note names `com.apple.MobileAddressBook` and the title verbatim on both (485 ms idb,
3955 ms WDA); after Cancel Contacts came forward at 1 s. L6 (the happy path, 5 runs a side): no D56 extra on either
source — no note, no `/source`, no added appinfo, no recurring surplus; median idb 374 → 374 ms (Δ +0), WDA 388 → 425 ms
(Δ +37, within ±150). L7 (WDA cold launch): 3/3 matched at 1942 ms, no `/source`, no note. L8 (Cancel, then `launch_app`
at once on idb, ×3): the answered alert was named 0/3 — a bare `Launched` in 486–510 ms, the alert no longer listed; the
stale-tree residual above was not seen in 3 tries, and it stays stated (unmeasured is not disproved). L9: INCONCLUSIVE —
no SpringBoard alert other than "Open in …?" can be raised on the lab simulator without a lab change (the lab requests
no permission; `tel:` has no handler there, batch-4), so "every launch stays behind" is still measured for "Open in …?"
alone. The remembered answer was restored and verified. The same batch tapped the alert's buttons by text (backlog D57,
an observation; the advice above is unchanged). Since then D57 rewords the advice — see that amendment.

## Amendment: the alert's advice names a tap by the button's label (2026-11-02, backlog D57)

D54 advised only a tap at a button's coordinates, the one answer then proven on a device; a tap by text on
SpringBoard's tree was unverified. Batch-7 block B (2026-11-02, lab simulator, iOS 27.0, main a6410f64 — the same tap
code as this change's base) tapped the "Open in “AveriLab”?" alert by text: `tap text:"Cancel"` and `tap text:"Open"`
dismissed it in 8 cases (Cancel and Open × idb and WDA × over SpringBoard and over Contacts), one run each — one Button
matched each time, tapped at its centre, never the other button and no refusal. A tap by text is also the steadier
answer, by reasoning rather than measure: it waits for two reads that agree on the rect, so it should ride out the
alert's appear animation, and it is judged, where coordinates are sent as given; and it is what an agent reaches for
first.

Decision (spec-D57, adopting the D57 analysis's option A with a test that pins today's tap):

- Only `ALERT_ADVICE` (`adapters/ios-system-alert.ts`) changes, to "Answer it with tap text:"<label>" for the button you
  mean, or a tap at its x and y (averi taps nothing itself); every launch stays behind the alert until it is
  answered". `<label>` is literal: the button list before it already quotes every label, so the agent copies one. Both
  replies follow the one constant — open_deep_link's (then `mcp/tool-text.ts`'s alertText) and launch_app's ⚠ note
  (then `ios-foreground.ts`'s alertNote; both since A10 `interact/app-holder-text.ts#appHolderText`) — and change
  together on purpose.
- No tap code. The selector path already lands on the alert's own Button: idb lists the alert alone (the title and its
  Buttons, nothing of the app or the status bar beneath), and on WDA the alert's layer is the marked top layer
  (`presentation: 'alert'`), so a target behind it — Contacts' hidden "Return to AveriLab" breadcrumb — is refused
  "an alert is presented over it (…) — close it first; nothing was tapped". Pinned by
  `tests/interact/tap-system-alert.test.ts`: the real `tapElement`, with its `ambiguous` option `'refuse'` (as the MCP
  tap passes it), over the three committed alert captures.
- No "alert layer first" guard in the resolution: its only effect would be to turn today's honest ambiguity refusal
  into a guess. "averi taps nothing itself" stands (an opt-in confirm is D58's). Since then D58 builds no confirm and
  prevents the alert instead — see that amendment.
- Unchanged, byte for byte: the detection, the headline (`iOS has not opened <url> yet: …`, `iOS has not brought
  <bundle> forward yet: …`), the button list with its centres, launch_app's tail ("then read again before trusting a
  read"), the happy-path replies, D48's and D49a's ⚠ notes, every call list, the cost.

Residuals, stated: measured on one iOS (27.0), with English labels, for this one alert — another SpringBoard alert gets
the same advice untested; a label that cannot be written as a selector (it contains `"`: the grammar has no escape),
or two buttons sharing a label, needs the coordinates the same reply quotes; another Button with the same label
elsewhere in SpringBoard's tree (none measured) makes the tap refuse as ambiguous and name both — averi never taps it
instead; on idb a tap at an app element while the alert is up times out "to appear" without naming the alert (WDA
refuses it "close it first"; outside D57); on WDA a tap by text costs two `/source` reads for its settle, about
1.2–1.6 s, against about 0.6 s on idb. To check on the device (the next owner batch): D49A E2 under idb and WDA, the
new reply read once and its first remedy followed.

## Amendment: the project's own scheme is pre-approved for simctl's opener (2026-11-02, backlog D58)

iOS asks "Open in “AveriLab”?" when `simctl openurl` opens a scheme its opener has no remembered answer for. The answer
lives in the simulator's `com.apple.launchservices.schemeapproval` domain, one key per opener and scheme: batch-5's
capture of the lab simulator (iOS 27.0) held `com.apple.CoreSimulator.CoreSimulatorBridge-->averilab = dev.averi.lab`
after Open was tapped, and deleting the key raised the alert again on the next `simctl openurl`, with no reboot
(batch-7). The opener is CoreSimulatorBridge, the caller behind `simctl openurl`; Safari and other openers have keys of
their own. So the alert comes once per simulator per scheme, on a fresh or erased simulator or after the key is deleted.
Since D54 and D57 the reply names it and a tap by its label; that still costs the agent one turn, and on WDA the 3 s
bound first.

Decision (spec-D58, adopting the D58 analysis's option D; its confirm tap, options B and C, is not built):

- `adapters/ios-url-schemes.ts#schemeApprovalWrite(scheme, bundleId)` gives the `defaults write` argv:
  `defaults write com.apple.launchservices.schemeapproval com.apple.CoreSimulator.CoreSimulatorBridge--><scheme> -string
  <bundleId>`, the scheme lower-cased as the captured key holds it. The domain and opener are constants there, with the
  capture's provenance.
- `IosAdapter.openDeepLink` asks whether the link's scheme is the project app's (`linkHandler`, D49a's lookup and cache)
  BEFORE `openurl`, no longer after it. When it is, `prepareForOpen` (the accessibility writer, extended) runs the
  approval write beside the two `com.apple.Accessibility` writes, in one `Promise.allSettled`, so it adds no wall time
  of its own; then `openurl` and the same wait. It writes on every such link (idempotent; a key deleted under the
  session is restored by the next link), and says so on stderr once per bundle and scheme.
- A failed write never fails the link: one stderr line, then `openurl` and the wait as before — if iOS then asks, D54's
  reply and D56's note name the alert. Not tried again until `install`, as the scheme cache.
- Unchanged: web links, iOS's own schemes, another app's scheme and no project app make no write (and, but for the
  first lookup of another app's scheme now coming before `openurl`, the same calls); `launch()` writes no approval;
  every reply text, byte for byte; the detection and naming of the alert; the MCP schema (no new option).

Why prevention, not a tap: the alert is a test-harness artefact (simctl's opener has no answer yet), not the app's UX,
and writing the answer an Open tap writes removes the alert, the extra turn and WDA's bound on both sources and in any
language. A tap made for the agent would guess a localised label, break "averi taps nothing itself", and need a schema
field that means nothing on Android (D55's "Open with" is a chooser, not a confirm).

Residuals, stated: the key and its effect are measured on one iOS (27.0) and one Xcode; whether a live write before the
link stops the alert is the merge gate's device check (batch-8: passed, see below), and the end-to-end check through
averi is a later batch's. The write is persistent and simulator-wide: the same answer an Open tap writes, scoped to
CoreSimulatorBridge and the scheme the project's own app declares, and averi never removes it. An alert for another
app's scheme is not prevented, and is still named (D54). A change in the key's format on another iOS or Xcode fails
open: the alert comes, and D54's reply and D56's note name it as before.

Checked on the device (batch-8, 2026-11-03, lab simulator, main 0133247c, the tree before this change, the batch making
D58's write itself; the alert raised as batch-5 did, causally: t0 proven not raised, t1 raised it; a first run was void,
no verdict, by a bug in the batch's key-absent check): the gate PASS 5/5. With the key deleted and no write, four
controls (over SpringBoard, over Contacts, a cold start, and one at the end) each raised the alert from the first read
(30 of 30 reads over ~3 s each). With the key deleted and then written (the `defaults write` 215–245 ms) before `simctl
openurl`, the alert never came in five cases: over SpringBoard, over Contacts and on a cold start, each 1 s after the
write; at once (no pause); and at once beside the two `com.apple.Accessibility` writes (`prepareForOpen`'s shape) — 0 of
20–29 reads over ~3 s listed it, the lab's open cell was in front at the first read (at 1058 ms on the cold start), and
the key read back `dev.averi.lab`. So a live write just before the link stops the alert, with no reboot and no pause.
The same batch read D57's reply on the device: open_deep_link's alert reply was main's text verbatim on idb (457 ms) and
WDA (3916 ms), and `tap text:"Cancel"` dismissed it 2/2. The remembered answer was restored and verified. Still open, a
later batch's: the end-to-end check through averi (a bare `Opened` with the key deleted, no write for https and tel
links, the happy path's Δ, a second link with the key present).
Since then batch-9 ran it and it passed: see the next paragraph.

Checked end to end through averi (batch-9, 2026-11-03, lab simulator iOS 27.0, main e734fedf; the alert raised as
before, causally: with the key deleted and no write, four controls — over SpringBoard, over Contacts, on a cold start
and at the end — each raised it from the first read, 29–30 of 29–30 reads): PASS on P1–P5. P1 6/6: with the key deleted,
`open_deep_link averilab://cell/open` replied a bare `Opened` over SpringBoard, over Contacts and on a cold start, on
idb and WDA (511–2121 ms); 0 of 28–29 reads listed the alert, the lab's open cell was in front at 0–1 ms, the key read
back `dev.averi.lab`, with one write and one D58 stderr line (the write's announcement). P2 2/2: on 0133247c, the tree
before this change, the same link drew D54's alert reply verbatim, idb and WDA. P3 2/2: an https and a `tel:` link made
no write and no D58 line, and the key stayed absent. P4: the happy path's Δ, median idb +14 ms (437 against 423 ms) and
WDA +17 ms (441 against 424 ms), within 50 ms. P5 2/2: with the key present every reply was bare, the key unchanged, one
D58 stderr line an adapter. So the end-to-end check stated open above is done. The remembered answer was restored and
read back after a reboot. Not D58's: on the simulator the `tel:` link's reply is simctl's raw exit-115 trace (no app
handles `tel:` there), which averi does not name.

## Amendment: the alert is a fact of one closed answer, worded above the adapters (2026-11-06, A10)

**Context.** The D54 and D56 sections above describe one fact in two shapes: `awaitForeground` returned `{ alert }` for
a link and a `{ note }` sentence for a launch, and `mcp/tool-text.ts` imported `adapters/ios-system-alert.ts` and
`adapters/android-chooser.ts` to word the rest, against ARCHITECTURE.md §2 (the architecture review of 2026-11-05).

**Decision.** No reply, device call or order changes.
- `launch` and `openDeepLink` answer one closed type, `adapters/types.ts#AppHolder`: `none`, `alert` (its facts, the
  `LinkAlert`), `chooser` (ADR 0041's A10 amendment), or `unknown` with a `caveat`. `LaunchOutcome` and `DeepLinkOutcome`
  are gone, and with them "at most one of the three is set" as a comment.
- `awaitForeground` answers the same `alert` on both verbs. Whether a link's text says "it asks" stays the fact
  `asksForApp`, judged with the names the wait held. A launch's text never reads it (D56's rule), now in the words.
- The words move: `alertButtonsText`, `ALERT_ADVICE` and what `alertNote` and `mcp/tool-text.ts`'s alertText said are
  `interact/app-holder-text.ts#appHolderText`'s, which takes the subject (a link's url or an app's id) and the answer.
  The kind of holder decides the wording; no platform is passed. `ios-system-alert.ts` keeps the detectors alone
  (`alertShapeInIdb`, `titleAsksToOpen`, `alertInWda`, `namesApp`).
- The caveat stays a sentence from `ios-foreground.ts`: every clause of it is about the wait and its tree source (the
  bound, the label or bundle last read, the names asked, each source's lag), and nothing above the adapters decides on
  it, so facts for it would only move those clauses and carry a dozen fields up. `appHolderText` shows it verbatim.
- Where the text goes stays the callers': a link's headline or ⚠ line (`mcp/tool-text.ts#deepLinkText`), a launch's ⚠
  line (`flow/launch.ts#launchApp`).

**Tests.** The byte pins moved with the words to `tests/interact/app-holder-text.test.ts`, literally the same strings.
The end-to-end pins (`tests/mcp/ios-alert-replies.test.ts`, `tests/flow/launch-alert.test.ts`) are unchanged. A temporary
characterization recorded 260 replies with their device calls at the base and after (both verbs on real adapters, MCP
and flow): identical.

Residual: the amended text above names `alertNote` and `alertText`, which no longer exist, as they were at their date.
