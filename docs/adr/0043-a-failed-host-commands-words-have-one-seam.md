# 43. A failed host command's words have one seam: `ExecError`'s message

Status: accepted 2026-11-06 (performance backlog rows D70 and D65, docs/plans/2026-10-30-performance-backlog.md). Four
kinds of reply change on purpose, listed below with their bytes and pinned. Every other failure is byte-identical. No
tool description changes.

## Context

- An `ExecError`'s message was `Command failed (exit N): <argv>⏎<stderr>`, quoted as it stood by every tool (the MCP SDK
  turns a thrown error's `message` into the `isError` reply; no handler catches) and by the flow's guard. So idb's Python
  traceback reached the agent whole, about 27 lines of frames, with the host's home in each (D70;
  `tests/fixtures/idb-ui-text-no-keycode-traceback-b1d-stderr.txt`).
- The readers of an `ExecError`, grepped 2026-11-06. By `stderr`, `exitCode`, `timedOut`, `stdout`: `pgrepVerdict`,
  `pgrepReason`, `NO_FRONTMOST`, `PLUTIL_NO_SUCH_KEY`, the dump's and `get-state`'s diagnosis, `runStart`, `writeBuildLog`,
  OCR's `timedOut`. By `message`: words quoted on (`headline`, `captureRefusal`, wrapped `new Error(…: ${errorMessage(e)})`,
  `failedLookMessage`, `idbScreenshot`'s first line) and one detector, OCR's `/\bEAGAIN\b/` on a spawn failure, which holds
  no traceback, typed text or host path. **No detector parses what changes.** So the seam can be the message itself.
- `simctl openurl` with a scheme no app takes exits 115, and the agent read simctl's trace (D65; batch-4, batch-9,
  batch-13 2/2 byte-identical, and `nosuch://nothing` on 2026-10-07).
- Whether the argv stays had to be decided, and that decision found a leak (below).

## Decision

**`ExecError`'s `message` is `adapters/failure-text.ts#commandFailureText(failure, home)`, a pure function; its fields
keep every byte.** `command`, `stderr`, `stdout`, `exitCode`, `timedOut` and `cause` are unchanged for detectors and for
`writeBuildLog`. There is no per-call wrapping and no catch in `mcp/`: a wrapped error, a first-line quote and the flow
get the same words because all of them read `message`. Rejected: a text function at the MCP boundary. Replies that quote
a failure without throwing (`FAILED:` sections, an assert's fail-closed sentence, a `⚠ screenshot:` line) would need
their own call, and text already wrapped would have to be parsed back. The message's stack header, written once at
construction, holds the same words.

The function does three things to exec's shape and nothing else:

1. **A Python traceback in stderr shrinks to one line**, `<tool> crashed: <exception> (Python traceback left out: run the
   command in a terminal to see it)`. The exception is the first line at the margin of the last
   `Traceback (most recent call last):` header, so a chain's last traceback and an exception group's margin read right,
   and only the first line of a long message is kept. A traceback cut before its exception says `<tool> crashed (…)`. The
   tool is the argv's first word's last segment, and for `xcrun` what it runs. Lines around the traceback, the log line
   `… [ERROR] - root - Exception thrown in main` among them, go with it. averi writes no log of an idb command, and none is
   invented: the pointer is the command, which stays above it. Only a header on a line of its own counts, so a stderr
   that merely mentions the words stays.
2. **Host paths leave the whole text, the argv and the note too.** Told apart by an allowlist of folders only a host has,
   each matched only at a word's start (a line's start, after whitespace, a quote, `(`, `[`, `<` or `,`), so a URL's path
   and `/data/local/tmp/…`, inside a word, never match:
   - the user's own home (`os.homedir()`, a parameter) becomes `~` **anywhere**, a URL's path too: it must always go;
   - any `/Users/…`, `/home/…` (the folder under them) and `/root` at a word's start or after `file://` becomes `~`; `Shared` under `/Users`
     is nobody's home and stays;
   - `/tmp`, `/var/tmp`, `/var/folders` and their `/private` forms become `<tmp>/<basename>`;
   - `/Volumes` and `/opt` become `…/<basename>`.

   Everything else stays, on purpose: `/usr`, `/Applications` and `/Library` name folders on iOS too, and a reply that keeps
   a device path matters more than perfect host scrubbing. `~/…` still resolves on the host; a basename still names the
   build. A path holding a space ends at the space, unless it is the user's own home. Not in scope: messages that are not
   a command's, such as WDA's `xcodebuild log: <path>`, a pointer the reader needs.
3. **A typed text leaves the argv**: `idb ui text <text> --udid U` and `adb [-s S] shell input text <character>` read
   `<typed text>`, in the first line and in node's own `Command failed: <argv>` line, which exec puts in stderr for a silent
   child.

**The argv stays.** It names the device and the failed step, an agent can repeat it, the traceback's pointer leans on it, and
`captureRefusal` and the flow's `✗` line quote exactly that line. Pins and D73's `adb -s emulator-9998 shell monkey …` keep
their bytes. The udid or serial is no secret: `list_devices` prints it. The one thing an argv must not hold is what was typed.

**The leak this closes.** A flow's secrets are redacted by the engine as whole strings (`FlowEngine#redact`), and a failed
typing could quote a part of one, which no whole-string match catches: D24's split (`ui text` of the rest), a dropped tail
typed again (ADR 0023), and Android's one `input text` per character. Live on base through MCP, `type_text hunter2` on an
unreachable serial replied `… shell input text h`. On iOS a whole value whose split is off is redacted by the flow, not by
`type_text`, whose caller gave the value. WDA's `/wda/keys` puts no text in its messages. `ExecError.command` still holds
the text: only code reads it, and nothing in `src/` quotes it for a typing.

**D65: a typed error, not an `AppHolder`.** `adapters/ios-link-failure.ts#noLinkHandler` detects
`(domain=LSApplicationWorkspaceErrorDomain, code=115)` in the stderr of what `simctl openurl` threw, and
`IosAdapter.openDeepLink` throws `NoLinkHandlerError { scheme, cause }`. Every `AppHolder` answer is a link that went out
and something may be holding it; here nothing opened and nothing holds, and the call must stay an error so that a flow's
step fails too. An answer would have needed a new "failed" branch in `deepLinkText` and in the engine. It is worded in the
adapter, the exception A10 keeps for thrown errors (`interact/app-holder-text.ts`'s header): `message` is what the SDK and
the flow's guard quote, and neither may ask an adapter's type. Any other `openurl` failure stays exec's. Android words its
own (`Android opened nothing for <url> — …`, `android.ts#openDeepLink`), and is left as it is.

## Replies that change

| Reply | Before | After |
| --- | --- | --- |
| A Python crash (idb's, recorded b1d) | `Command failed (exit 1): idb ui text Jan Šťastný --udid U⏎2026-10-19 05:39:32,796 [ERROR] - root - Exception thrown in main⏎Traceback (most recent call last):⏎  File "/Users/…/idb/cli/main.py", line 313, in gen_main⏎ … ⏎Exception: No keycode found for Š` | `Command failed (exit 1): idb ui text <typed text> --udid U⏎idb crashed: Exception: No keycode found for Š (Python traceback left out: run the command in a terminal to see it)` |
| A failed typing, Android (live) | `Command failed (exit 1): adb -s emulator-9998 shell input text h⏎adb: device 'emulator-9998' not found` | `Command failed (exit 1): adb -s emulator-9998 shell input text <typed text>⏎adb: device 'emulator-9998' not found` |
| A failed typing, iOS, and its timeout | `Command failed (exit 1): idb ui text hunter2 --udid U⏎…`, `Command timed out: idb ui text hunter2 --udid U` | `Command failed (exit 1): idb ui text <typed text> --udid U⏎…`, `Command timed out: idb ui text <typed text> --udid U` |
| A host path, home (live, `install_app`) | `Command failed (exit 1): adb -s emulator-5554 install -r /Users/…/app.apk⏎adb: failed to stat /Users/…/app.apk: No such file or directory` | `Command failed (exit 1): adb -s emulator-5554 install -r ~/…/app.apk⏎adb: failed to stat ~/…/app.apk: No such file or directory` |
| A host path, temporary (live, `install_app`) | `… install -r /tmp/…/app.apk⏎adb: failed to stat /tmp/…/app.apk: No such file or directory` | `… install -r <tmp>/app.apk⏎adb: failed to stat <tmp>/app.apk: No such file or directory` |
| `open_deep_link tel:…`, iOS | `Command failed (exit 115): xcrun simctl openurl <udid> tel:…⏎(domain=LSApplicationWorkspaceErrorDomain, code=115) … Simulator device failed to open tel:…` | `No app on this simulator handles tel: links, so nothing opened (simctl openurl: LSApplicationWorkspaceErrorDomain, code 115). A link to an app's own scheme needs that app installed.` |

Anything quoting those messages changes with them: a wrapped error, a first line in a `⚠` or fail-closed sentence, an
`averi:` line on the server's stderr. `Command failed (exit 1): adb -s emulator-9998 shell monkey … ⏎adb: device
'emulator-9998' not found`, and every failure with no traceback, typed text, listed host path or code 115, keeps its bytes:
live on base and branch through MCP, `launch_app` and Android's `open_deep_link` on an unreachable serial read the same.

## Evidence and what is not proven

- The traceback fixture is b1d's stderr from `docs/truth/live-records/ios-forms-a9.json` (idb, 2026-10-19), real bytes
  except that the record wrote the home as `~`; the test puts a home back.
- **`tests/fixtures/simctl-openurl-tel-exit115-stderr-shape-from-d65-row.txt` is not simctl's bytes.** Batch-13's capture
  (rerun 2, main 51778d00, iOS 27.0, idb, 2/2 byte-identical) was in its scratch output, which is gone, and it had four
  lines. The fixture holds only the fragments the repo recorded: the domain, the code and the "failed to open" line from
  backlog D65, and `LSApplicationWorkspaceErrorDomain error 115` from the 2026-10-07 device check. The detector asks only
  the `(domain=…, code=115)` fragment, which D65's row quotes. iOS could not run for this change: the reply and the real
  bytes are owed to the next iOS batch (backlog D65's row).
- Cold mutation run (ADR 0038): `failure-text.ts` 100 %, 113 mutants; `ios-link-failure.ts` 100 %, 13 mutants; both floors 98.
