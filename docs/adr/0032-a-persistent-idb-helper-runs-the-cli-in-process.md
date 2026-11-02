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
