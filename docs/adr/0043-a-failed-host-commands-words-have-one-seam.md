# 43. A failed host command's words have one seam: `ExecError`'s message

Status: accepted 2026-11-06 (performance backlog rows D70 and D65, docs/plans/2026-10-30-performance-backlog.md). The
kinds of reply below change on purpose, listed below with their bytes and pinned. Every other failure is byte-identical. No
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
get the same words because all of them read `message`. Three readers quote `stderr` itself instead: `android.ts`'s dump diagnosis and `ios-liveness.ts#pgrepReason` its last
line, `android.ts`'s `get-state` diagnosis the whole trimmed stderr less its `Command failed:` and `error:`/`adb:` prefix.
They pass it through the exported `withoutHostPaths` (`exec.ts#hostPathsOut` on Android; IosAdapter hands the home to
`pgrepReason`, which stays a pure leaf, ADR 0038's D33), their bytes otherwise unchanged; none is a typing. `android-start.ts` quotes `am`'s lines, the
device's words, and is left as it is. Rejected: a text function at the MCP boundary. Replies that quote
a failure without throwing (`FAILED:` sections, an assert's fail-closed sentence, a `⚠ screenshot:` line) would need
their own call, and text already wrapped would have to be parsed back. The message's stack header, written once at
construction, holds the same words.

The function does three things to exec's shape and nothing else:

1. **A Python traceback in stderr shrinks to one line**, `<tool> crashed: <exception> (Python traceback left out: run the
   command by hand, with the real text and paths, to see it)`. The exception is the first line at the margin of the last
   `Traceback (most recent call last):` header, so a chain's last traceback and an exception group's margin read right,
   and only the first line of a long message is kept. A traceback cut before its exception says `<tool> crashed (…)`. The
   tool is the argv's first word's last segment, and for `xcrun` what it runs. Lines around the traceback, the log line
   `… [ERROR] - root - Exception thrown in main` among them, are dropped with it: the reply says the crash, and `stderr` keeps the rest. CRLF line ends read the same, and an exception line that ends at its colon takes the next line with text as its message when that line is indented, an exception group's rules skipped. An unindented one may be a log line and stays out, so `raise Exception("\nwhy")`, printed unindented, reads `Exception:`. averi writes no log of an idb command, and none is
   invented: the pointer is the command, which stays above it, to run by hand with the real text and paths: as printed it is not runnable, `<typed text>` and `<tmp>/app.apk` being shell redirections. A header on a line of its own counts, and one behind a log prefix (`[ERROR] Traceback …`) when a
   frame stands beneath it, so a stderr that merely mentions the words stays. The exception line is scrubbed, then bounded at 300 code points and an ellipsis.
2. **Host paths leave the whole text, the argv and the note too.** Told apart by an allowlist of folders only a host has,
   each matched only at a word's start (a line's start, after whitespace, a quote, `(`, `[`, `<`, `,`, `=` or `file://`), so
   `/data/local/tmp/…`, inside a word, never matches. A word holding `scheme://` or starting `scheme:`, `file:` apart, is left alone by
   every rule but the own home, so a URL's path never matches, whatever marks stand inside it (`myapp://o/p,/tmp/q`,
   `myapp:open?next=/home/…`):
   - the user's own home (`os.homedir()`, a parameter, its trailing slashes dropped) becomes `~` up to its folder's end (`/opt/me`, not `/opt/mel`). With two folders or more it goes **anywhere**, a URL's path too: it must always go. A home of one folder (`/tmp`, `/root`, `/var`) goes only at a word's start, since anywhere would cut `/data/local/tmp/a.xml`. A home that is no absolute path, or that cannot be read (`exec.ts#hostHome` answers `''`), takes nothing out;
   - any `/Users/…`, `/home/…` (the folder under them) and `/root` at a word's start becomes `~`; `Shared` under `/Users`
     is nobody's home and stays;
   - `/tmp`, `/var/tmp`, `/var/folders` and their `/private` forms become `<tmp>/<basename>`;
   - `/Volumes` and `/opt` become `…/<basename>`.

   Everything else stays, on purpose: `/usr`, `/Applications` and `/Library` name folders on iOS too, and a reply that keeps
   a device path matters more than perfect host scrubbing. `~/…` resolves on the host for the user's own home, not for another's; a basename still names the
   build. A path holding a space ends at the space, unless it is the user's own home. Not in scope: messages that are not
   a command's, such as WDA's `xcodebuild log: <path>`, a pointer the reader needs.
3. **A typed text leaves the argv**: `idb ui text <text> --udid U` and `adb [-s S] shell input text <character>` read
   `<typed text>`, in the first line and in node's own `Command failed: <argv>` line, which exec puts in stderr for a silent
   child. For idb's argv at exit 2, argparse's code (`idb-helper-script.ts` keeps it), argparse's own line (`idb[ …]: error: <why>`) and all after it, since argparse exits right after it and a text can hold a newline, become `idb rejected its arguments (its error line, which can quote the typed text, is left out)`, because a text starting with a dash is taken for an option: `-hunter2` prints `ignored explicit argument 'unter2'`, `--log=s3cret` prints `invalid choice: 's3cret'`. The usage lines stay. The argv itself does not change here (backlog D74).

**Words that throw never destroy the error.** `exec.ts#failureMessage` falls back to `failure-text.ts#lastResortText` if `commandFailureText` throws: `Command failed (exit N): <tool>` or `Command timed out: <tool>`, the argv's first word and nothing else, and it cannot throw itself (`Command failed` on values it cannot print; a near-maximal argv is read for 256 characters). And `hostHome` cannot throw: `os.homedir()` throws when `$HOME` is unset and the uid has no passwd entry, which inside exec's callback would never settle the promise and would end the process.

**Residuals.** Host paths: a word holding both a URL and a host path keeps the path (`{"path":"/tmp/…","url":"http://x"}`), and so does a word that starts with `word:` (`error:"/Users/…"`), the own home apart. A device path after `=` that shares a host folder's name is reduced (`remote=/tmp/…`, read as a host's). Typed text: An exception's own message can still quote a piece of the text: `No keycode found for Š` carries one character, and ADR 0037 refuses that value before idb in a fill or `type:`. Any other stderr idb prints for a typing is not parsed. `idb ui text -h` exits 0, so `type_text "-h"` still reports success with nothing typed: not a leak, filed as D74.

**The argv stays.** It names the device and the failed step, an agent can repeat it once it puts the real text and paths back, the traceback's pointer leans on it, and
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

| Reply | Before | After | Bytes |
| --- | --- | --- | --- |
| A Python crash (idb's, recorded b1d) | `Command failed (exit 1): idb ui text Jan Šťastný --udid U⏎2026-10-19 05:39:32,796 [ERROR] - root - Exception thrown in main⏎Traceback (most recent call last):⏎  File "/Users/…/idb/cli/main.py", line 313, in gen_main⏎ … ⏎Exception: No keycode found for Š` | `Command failed (exit 1): idb ui text <typed text> --udid U⏎idb crashed: Exception: No keycode found for Š (Python traceback left out: run the command by hand, with the real text and paths, to see it)` | before recorded (b1d); after pinned |
| A failed typing, Android (live) | `Command failed (exit 1): adb -s emulator-9998 shell input text h⏎adb: device 'emulator-9998' not found` | `Command failed (exit 1): adb -s emulator-9998 shell input text <typed text>⏎adb: device 'emulator-9998' not found` | live, both |
| A failed typing, iOS, and its timeout | `Command failed (exit 1): idb ui text hunter2 --udid U⏎…`, `Command timed out: idb ui text hunter2 --udid U` | `Command failed (exit 1): idb ui text <typed text> --udid U⏎…`, `Command timed out: idb ui text <typed text> --udid U` | illustrative |
| A typing idb's argparse refuses | `Command failed (exit 2): idb ui text -hunter2 --udid U⏎usage: …⏎idb ui text: error: argument -h/--help: ignored explicit argument 'unter2'` | `Command failed (exit 2): idb ui text <typed text> --udid U⏎usage: …⏎idb rejected its arguments (its error line, which can quote the typed text, is left out)` | illustrative, from the review's probe |
| A host path, home (live, `install_app`) | `Command failed (exit 1): adb -s emulator-5554 install -r /Users/…/app.apk⏎adb: failed to stat /Users/…/app.apk: No such file or directory` | `Command failed (exit 1): adb -s emulator-5554 install -r ~/…/app.apk⏎adb: failed to stat ~/…/app.apk: No such file or directory` | live, both |
| Another user's home | `… /Users/…/a.apk` | `… ~/a.apk` | illustrative |
| `/Volumes`, `/opt` | `… install -r /Volumes/…/b.ipa`, `/opt/homebrew/bin/idb` | `… install -r …/b.ipa`, `…/idb` | illustrative |
| A path after `=` or `file://` | `NSFilePath=<a temporary folder>/x/app.app, NSURL=file://<a temporary folder>/x/app.app` | `NSFilePath=<tmp>/app.app, NSURL=file://<tmp>/app.app` | illustrative |
| The dump's diagnosis, last line of stderr | `adb could not run uiautomator dump: adb: cannot read /Users/…/adb.log` | `adb could not run uiautomator dump: adb: cannot read ~/adb.log` | illustrative |
| `get-state`'s diagnosis | `device S is not reachable: adb get-state says "cannot read /Users/…/adb.log" — …` | `device S is not reachable: adb get-state says "cannot read ~/adb.log" — …` | illustrative |
| `pgrepReason`, an `averi:` line on stderr | `averi: the host process list is unreadable (exit 3: pgrep: /Users/…/x unreadable) — …` | `averi: the host process list is unreadable (exit 3: pgrep: ~/x unreadable) — …` | illustrative |
| A host path, temporary (live, `install_app`) | `… install -r /tmp/…/app.apk⏎adb: failed to stat /tmp/…/app.apk: No such file or directory` | `… install -r <tmp>/app.apk⏎adb: failed to stat <tmp>/app.apk: No such file or directory` | live, both |
| `open_deep_link tel:…`, iOS (batch-13's bytes) | `Command failed (exit 115): xcrun simctl openurl <udid> tel:+421900123456⏎An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=115):⏎Simulator device failed to open tel:+421900123456.⏎Underlying error (domain=LSApplicationWorkspaceErrorDomain, code=115):⏎	The operation couldn’t be completed. (LSApplicationWorkspaceErrorDomain error 115.)` | `No app on this simulator handles tel: links, so nothing opened (simctl openurl: LSApplicationWorkspaceErrorDomain, code 115). A link to an app's own scheme needs that app installed.` | before recorded (batch-13); after pinned, owed a live read |

Anything quoting those messages changes with them: a wrapped error, a first line in a `⚠` or fail-closed sentence, an
`averi:` line on the server's stderr. `Command failed (exit 1): adb -s emulator-9998 shell monkey … ⏎adb: device
'emulator-9998' not found`, and every failure with no traceback, typed text, listed host path or code 115, keeps its bytes:
live on base and branch through MCP, `launch_app` and Android's `open_deep_link` on an unreachable serial read the same.

## Evidence and what is not proven

- The traceback fixture is b1d's stderr from `docs/truth/live-records/ios-forms-a9.json` (idb, 2026-10-19), real bytes
  except that the record wrote the home as `~`; the test puts a home back.
- `tests/fixtures/simctl-openurl-tel-exit115-b13-stderr.txt` is simctl's four stderr lines, cut from the reply batch-13 kept
  on 2026-11-05: rerun 2, main 51778d00, iOS 27.0, idb, 2/2 byte-identical, exec's first line left off (it holds the udid).
  The repo holds no other record of them. The source is outside it: `batch-13/D65/run-20261105-113643-64641/d65-reply-1.txt`
  (and `-2`) in the scratch folder of session 1ea289f1-7bae-463b-9304-adfeaaf20c0c; `batch-9/D58/case-P3-idb.json` beside it reads
  the same with another number. iOS could not run for this change: the new reply is owed a live read by the next iOS batch
  (backlog D65's row).
- Cold mutation run (ADR 0038): `failure-text.ts` 99.54 %, 218 mutants, the one survivor equivalent; `ios-link-failure.ts` 100 %, 13 mutants; floors 97 and 98.

## Amendment: a typing declares its typed words, and iOS types after `--` (2026-11-11, D74 and A17)

**Context.** Two rows of the performance backlog, done together because both change the same lines.
- D74: a text starting with a dash was taken for idb's options. `idb ui text -h --udid U` exits 0 printing argparse's
  usage, so `type_text "-h"` reported success with nothing typed (this ADR's residual above); `-abc` failed with
  `required: text`; `-hunter2` and `--log=s3cret` failed with argparse quoting them, which §3 left out of the message.
- A17 (D70's code review): §3 recognised a typing by regexes over the joined argv (`IDB_TYPING`, `ADB_TYPING` in
  `failure-text.ts`), so a new typing verb, or a typing argv of another shape, leaked silently until someone added its
  shape. D74 changes idb's typing argv anyway, so the regexes are replaced once rather than edited twice.

**Decision, D74.** iOS types with `idb ui text --udid U -- <text>` (`ios.ts#idbText`, every `ui text` the adapter sends,
D24's two included). After `--` argparse takes every word as a positional, so the text is the text whatever it starts
with. `idb.ts#runIdb` puts the `--udid` in before the first `--` (`withUdid`), or last when there is none, as before;
`HID_ARGV`'s typing is `['ui', 'text', '--', ANY]`, so the old shape `ui text <text>` is no longer the helper's.
`scripts/differential/fake-device.ts` drops the `--udid U` and the `--` after it, and records a typing as before D74,
`idb ui text <text>`. Android needs no change: `input text` gets one character per call, so a leading dash is the one
word `-` and cannot form an option (`android-input-dash.sh` below reads that back).

**Decision, A17.** A typing call declares which of its argv's words are typed text: `ExecOptions.typed`, indexes into
`args`. `failure-text.ts#shownCommand(cmd, args, typed)` is exec's own join with `<typed text>` at those indexes, and
every shown argv is built with it:
- `exec.ts` builds `ExecError.command` with it and puts the shown command in place of node's own join in node's
  `Command failed: <argv>` line (exec's stderr for a silent child);
- `runIdb` takes `typed`, moves the indexes past the `--udid` it puts in, hands them to exec, and on the helper's path
  builds the nonzero answer's, the timeout's and `inputLost`'s command with it; `IDB_HELPER_CALL_START`/`END` publish
  the shown argv (`shownArgs`), and `IdbHelperTimeout`'s message is the shown command;
- Android's `shell` alone takes `typed` (`ShellCallOptions`; `adb`, `execOut` and `rawShell` take none, so no caller
  declares one where it would be moved wrongly), moves it three on (`-s S shell`), and `typeText` passes `[2]`.

So **`ExecError.command` no longer holds the text** (the Decision's "`ExecError.command` still holds the text" no longer
holds), and `commandFailureText` quotes the command as given: `IDB_TYPING`, `ADB_TYPING` and `withoutTypedText` are
deleted, and so is the replacement of the raw argv inside stderr, which exec now does once. A fake `ExecFn` that throws
an `ExecError` honours the declaration by building its command with `shownCommand` (the adapters', the flow's and the
tools' tests do). `android-start.ts#withStdoutTail` rebuilds an error from an `ExecError`'s `command`, already shown.

**§3's argparse branch is deleted.** Behind `--` no text reaches argparse as an option: the parse was probed on fb-idb
(`gen_main(['ui', 'text', '--udid', 'U', '--', t])` in idb's own Python, `TextCommand` stubbed to print what it got)
for `-h`, `-abc`, `-hunter2`, `--log=s3cret`, `--`, `a b`, `--udid` and `plain`, each reaching the command unchanged
with the udid `U`. So the branch could only fire on a text that cannot reach it, and an exit 2 now keeps argparse's
line like any other tool's. The table's row "A typing idb's argparse refuses" (above) is superseded: that argv is no
longer sent. A typing's failure now reads `Command failed (exit 1): idb ui text --udid U -- <typed text>⏎…` and
`Command timed out: idb ui text --udid U -- <typed text>` (illustrative; the order of the words is D74's).

**What is not masked.** Stderr. Android types one character per call, so masking it in stderr would mangle unrelated
lines (every `e` of an error); idb's typing prints nothing that quotes the text bar §3's residual (`No keycode found for
Š`, one character, refused before idb by ADR 0037). One argparse residual stays: `unrecognized arguments: …` quotes every word after `--`, the text with them, and
argparse prints it at exit 2. Behind averi's fixed argv it is unreachable — `ui text` takes the `--udid` and one
positional, and the contract test's `-h`, `-hunter2` and `--log=s3cret` reach the companion — unless a later idb stops
accepting `--udid` on `ui text`; the contract test, which runs this argv on the installed fb-idb, is where that would
show. The helper's stdin carries the raw text, as it must, and nothing
prints it. `scripts/perf/instrument.ts`'s execFile wrapper sees the raw argv and records only its label, the first words
with every `-…` word and the udid dropped (`idb ui text`, `adb shell input text`).

**The guard against forgetting.** With no shape recognised, a typing call site that declares nothing is quoted whole.
`tests/adapters/typed-text-leak.test.ts` drives both adapters' `typeText` through every way a typing fails — the CLI
(the real exec over a script in idb's or adb's place: exit 1, exit 2, a silent exit, a timeout), on iOS the helper (a
nonzero answer, silent or not, exit 2, a death after it took the input, its timeout, a request it never took and then
the CLI), the helper off, and D24's split failing on either call; Android on each character — and asserts no piece of
the text in the error's command, message, stack, `inspect` of it, or what the helper's channel published. Dropping the
declaration at either adapter's call site, the index shift in `withUdid` or `shell`, the channel's mask, runIdb's hand-off
to exec, or exec's mask of node's line each fails it (checked by hand, 2026-11-11). A new typing verb needs its own
declaration and its own rows there.

**Evidence and what is not proven.**
- The contract test (`tests/adapters/idb-helper-contract.test.ts`, real fb-idb, companion `localhost:1`) runs the new
  argv for `a`, `Jan Nováček 😀`, `-x`, `-h`, `-hunter2` and `--log=s3cret`: helper and CLI give the same code and
  stderr, and the code is 1 (the companion unreachable), not 0 (`-h`'s help) or 2 (argparse). Put back to `--udid`
  last, all six fail. By hand on the same idb: `ui text -h --udid U` exits 0, `ui text --udid U -- -h` exits 1.
- Golden against T10's base: 1667 checks, Changed 0.
- Cold mutation run (ADR 0038, `npm run mutate -- --group core --force`): `failure-text.ts` 99.00 %, 200 mutants, 2 survivors, both equivalent (`exceptionUnder`'s above, and `shownCommand`'s default `typed = []` filled with a string, which holds no index either); floor 97 kept.
- Not run on a simulator or an emulator (none was up, and no device setting may change): the owner's check is
  `docs/truth/live-records/d74-dash-text/run.sh` — the reset sequence, the lab's form-basic name field, each of `-h`,
  `-abc`, `-hunter2`, `--log=s3cret`, `--` and `a-b` typed with the new argv by hand (exit 0, no stdout, the field's
  AXValue the text), the old argv's `-h` as the control (exit 0, the usage, the field unchanged), then through averi's
  typeText (`type-via-averi.ts`) with the helper on and with `AVERI_IDB_HELPER=off`. Android's `input text -`, and
  `-h` as averi sends it, are read back by `android-input-dash.sh` beside it, when the emulator is up.
