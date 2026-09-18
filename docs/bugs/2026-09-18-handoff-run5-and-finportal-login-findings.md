# Evaluation: the 2026-09-18 averi handoff (mp-native run 5, Part A; finportal login run, Part B)

Source: `mp-native/docs/2026-09-18-averi-handoff.md`. Each row was checked against the code before anything
was changed; what the code contradicted is marked as such. Fixes below are in `src/`, each with a test that
reproduces the measured symptom. Live check 2026-09-18 on `emulator-5554`: a normal dump 3.2 s; a dump fired
right after `am force-stop` + launcher intent succeeded in 7.8 s with the retry that `ui_snapshot`/`tap` opt into (`settle`; a poller would have seen the miss and polled again).

## Part A — verdicts

| row | claim | code says | change |
|---|---|---|---|
| a1/a4 | `no XML: Killed` / empty = offline emulator, message names uiautomator | Confirmed. `adb exec-out` exited 0 with `Killed`/nothing, so the `ExecError` path never fired and `uiTree()` had no device check. Whether a pre-check would have caught it is unknown (the handoff's own cause is "offline"); the post-failure probe covers both orders. | `AndroidAdapter.uiTree`: on no XML — or a dump TIMEOUT — run `adb get-state` and lead with the device state (`is not reachable: adb get-state says "device offline"`, `reachable but SLOW`, `several devices attached … select_device`), keeping the dump text as evidence. |
| a2 | `tap` takes `selector`, not `text` — caller's shape | Confirmed. | none (tool description now states the quoting rule). |
| a3 | `text:SIGN IN` fails at `"IN"`; "the correct form is `text~"SIGN IN"`" | **Half wrong.** `parseSelector` always accepted `text:"SIGN IN"` (`(?:"([^"]*)"|(\S+))`); the regex form works but is unanchored. The error did name the leftover token, not the rule. | Error now states the rule and adds `did you mean text:"SIGN IN"?`. Ask 2's first option already existed. |
| a5 | `null root node` = settling device | Confirmed (pollers already treated it as a miss; a direct `ui_snapshot` did not). | `uiTree({ settle: true })` — one bounded retry (1 s) that only the one-shot tools (`ui_snapshot`, `tap`, `type_text`'s focus) ask for; pollers keep their own interval as the retry (review round 1: a hidden extra second per miss would shrink the probes a deadline affords). A miss on a reachable device is classified `is still settling`; a dump TIMEOUT on a reachable device is `reachable but SLOW` (host load, b4's shape). |
| a6 | wrong tool namespace — caller | Confirmed. | none |
| gap 1 | iOS containers invisible; ask: `include_containers` option | **Already an opt-in**: `app.ios.treeSource: wda` reads the XCUIElement tree (what XCTest/Maestro read). Measured for RN host views (2026-08-12); not yet on mp-native's SwiftUI `.contain` containers. | none in averi; documented in mp-native's `averi.yaml` header as a trial, not flipped. |
| gap 2 | rendered rects, not touch-target rects | Confirmed, by design. | none |

## Part B — verdicts

| row | claim | code says | change |
|---|---|---|---|
| b1 | masked field: `typed 16 … shows 16` | Confirmed: `landed = observed === value`; the best-effort path needs `undefined`, bullets are a string. | `fillField` compares a bullets-only read-back by LENGTH — the SHORT direction only, which is what detects dropped keystrokes: `=== value.length` with clear, `>= held-after-focus + value.length` without. The pre-fill count is re-read AFTER the focus tap (autofill populates on focus, a re-entry screen clears on focus — review round 2 measured both as false failures against a pre-tap count). The rule cannot see content, so typing onto an autofilled password reads as a correct append; that case is a `⚠ fill … typing APPENDS; pass clear: true` trace line (and a `⚠` in `type_text`'s reply), not a failure. Error names `(masked field — compared by length; it held N after focus)`. |
| b2 | Slovak host keyboard → wrong HID characters | Not averi. | `SETUP.md` Troubleshooting bullet with the pin command. |
| b3 | steps log only on success; the failing step is unnamed | Confirmed (`this.log('fill', …)` after `fillField`). | `runStep` wraps dispatch: a failure logs `✗ <kind> <target> — failed — <headline>` then rethrows. A `swallowDepth` counter set by `optional` suppresses the line for anything nested under it — including through a `branch` (review round 1 found the direct-dispatch version leaked there). Selector rendering delegates to `describeElementSpec` with only the four selector fields, so `value`/`clear`/`timeout` cannot reach the line; `type`/`type_pin` print the bare kind. |
| b4 | `appAlive: false` from a tree-read timeout under load | Confirmed: `isAppRunning` caught EVERY error (incl. a 30 s adb timeout) as `false`. | Android `isAppRunning` runs `pidof <pkg> \|\| true`: exit 0 always, empty stdout = not running, ANY `ExecError` = the transport failed and propagates (the first attempt keyed on `stderr === ''`, which `exec.ts` can never produce — review round 1 BLOCKER, verified live: rc 0 both ways). `appHealth` reports `appAlive: unknown — could not ask the device … NOT evidence that the app died`, with a per-platform check hint. |
| b5 | WDA died overnight, not relaunched | Confirmed: `source()` threw after `ensureRunning` fast-pathed on a stale `/status`. | `source()` re-probes `/status` on a failed GET. Alive → NOT restarted: `answered /status but GET /source did not complete` — a deep tree (the documented WDA weakness) or a wedged server, `pkill` named as the fallback (review round 1: a timeout must not cost the session). Dead → `stop()` and one respawn + retry; a second death says `restarted once and still does not answer`. |
| b6 | empty `[]` during the first WDA build after an Xcode upgrade | **Not reproducible from code**: the build is awaited before any `/source`. Review round 1 checked the alternative I floated (stale xctestrun picked by mtime after an Xcode upgrade, never rebuilt): the mechanism is REAL — `doEnsureRunning` skips the build whenever any xctestrun exists — but its failure shape is a runner that does not start, not an empty tree, so it does not explain b6. Worth its own fix (gate the rebuild on `xcrun --show-sdk-version`, not file existence). The stderr "first build" note is invisible to an MCP caller either way. | none for b6 — needs a repro with the xcodebuild log. |
| b7 | 402 pt device vs 375 pt frame → 13 width-biased deltas | Confirmed: no note existed. | `formatRectParity` prints one `! ios 402 pt vs figma frame 375 pt (+7.2%) … WIDTH-BIASED, not drift` line when iOS (points, same unit as the frame) differs by > 5 % from a DECLARED `figma_frame_width` (`frameWidthDeclared`; the inferred widest-anchor fallback is not a frame — review round 1). With Android in the run the note adds that android cannot be judged this way (pixels, density unknown) rather than staying silently asymmetric. |
| b8 | OCR drops Slovak diacritics → OCCLUDED | Confirmed: `looseForm` folded case and punctuation only. | NFD fold of combining marks in the UNREAD guard, AND an OCR-only, marks-only difference at the drift comparison becomes a note instead of a finding (review round 1: folding only the guard turned OCCLUDED into a phantom copy-drift FAIL). Tree readings stay exact; reported strings stay verbatim. |
| b9 | iOS "Save Password?" sheet | Not averi (faithful measurement of the sheet). | none |
| B2 | code hook for SMS 2FA | Feature request; out of scope here. | none |

Asks not taken: B3-2 "log before running" (the `✗` line covers it without doubling every line); B3-4 second half (b6, above).

## Review round 1 (Opus 5, 2026-09-18) — what it found and what changed

BLOCKER: `isAppRunning` keyed on `ExecError.stderr === ''`, which `exec.ts` never produces (it substitutes
`err.message`) — Android crash detection would have reported `unknown` for every dead app. Fixed with
`pidof <pkg> || true` (verified live on `emulator-5554`: rc 0 with and without a match); fixtures rebuilt in the
shape `exec.ts` emits. MAJOR ×4: diacritics fold turned OCCLUDED into a phantom FAIL (fixed at the drift comparison,
OCR-only); WDA restart fired on a `/source` TIMEOUT and would have killed a live server (fixed: re-probe `/status`
first); width-bias note fired on an INFERRED frame width (gated on `frameWidthDeclared`); masked `>=` passed typing
over a pre-filled field (exact sum). MINOR: `✗` leaked through `optional → branch` (`swallowDepth`); `did you mean`
not copy-pasteable past two words (whole remainder, JSON-escaped); null-root retry taxed every poller (`settle`
opt-in for one-shot tools); dump timeouts bypassed the diagnosis (routed); `appAlive: unknown` hint was Android-only
(per platform); `stepSummary` re-derived `describeElementSpec` (delegates); WDA guard tautology and dead ternary
(gone with the restructure); ARCHITECTURE.md §8 `appAlive: bool` (three states); several-devices `adb get-state`
message (prescribes `select_device`); trace `action` redacted like `detail`. Every fix has a test that fails when the
fix is reverted (seven mutations checked). Not taken: "log the step before running it" (the `✗` line covers it).

## Review round 2 (Opus 5, 2026-09-18)

Seven of eight round-1 findings validated as resolved. New: the exact-sum masked rule failed two correct fills
(autofill on focus → "held 0", re-entry clear on focus → "held 20" for a flawless 16), and the prose around it
claimed it caught typing over an autofilled password, which no length rule can. Fixed: pre-fill re-read after focus,
short-direction-only comparison, a `⚠ fill … typing APPENDS` warning for the case the rule cannot see; test renamed to
what it tests, dead fixture removed. Also: every `ExecError` from the dump (not only timeouts) now goes through the
device diagnosis with `{ cause }`; one `✗` per failure (innermost step; a `WeakSet` marks logged errors); the
quote-in-value hint says the grammar cannot express it instead of suggesting an unparseable string; WDA probes
`/status` twice before deciding a server is dead; iOS `uiTree` documents that `settle` is a no-op there.

## Review round 3 (Opus 5, 2026-09-18) — APPROVED

All round-2 items validated (eight fill scenarios re-run, hard-offline dump live on a bogus serial, every selector
hint round-tripped through the parser). One MINOR left: the clear-on-focus fill test could not fail because
`tests/helpers/fake.ts` handed out its LIVE screen object from `uiTree()`, so a later fake `tap` rewrote what an
earlier read had "seen". `FakeAdapter.uiTree()` now returns a `structuredClone` (what both real adapters do) and
`tap` hit-tests the live screen so `typeText`/`clearText` still mutate the real field. The reviewer's mutation
(`preLen` may only grow after the re-read) now fails exactly that test. Reviewer's answer to the cost question:
keep the post-focus re-read (+1 dump, ~2.5 s Android-only, ~170 ms iOS) and do not narrow it — no cheaper predicate
separates "held 20, 4 dropped" from "cleared on focus". Suite: 613/613.

## Architecture review round 1 (fresh Opus 5 reviewer, 2026-09-18)

MAJOR: the selector quoting rule had been appended to the always-on part of the error, so `bogus:x` got a
lecture about spaces — the same mis-prescription a3 was about, for a different input. Now only
`unquotedSpaceHint` emits it. MINORs taken: `loggedFailures`/`swallowDepth` moved into the engine's field block
(the WeakSet had orphaned `headline`'s JSDoc); the dispatch-chain comment moved onto `dispatchStep`; `type_text`'s
poller `refetch` no longer passes `settle`, and `tapElement` takes `settle` from its caller instead of deciding it;
`SELECTOR_FIELDS` + `selectorOnly` in `element-spec.ts` are the one owner of the field list (`hasSelector` and
`stepSummary` use them); `isMaskedValue` moved to `ui-tree/masked-value.ts` (tree vocabulary, ARCHITECTURE §3);
`app.android.package` is format-checked in `configSchema` so a YAML typo fails as config, not as `appAlive: unknown`;
`explainDumpFailure` → `diagnoseDumpFailure` (it spends device time); the SKILL bullet split into device-state and
trace-reading bullets. NITs taken: adapter comment no longer enumerates call sites; the parity header marks an
inferred frame width; `foldMarks` declared before its users, `marksOnly` → `ocrDroppedMarks`, note wording no longer
asserts direction; two unreachable `stepSummary` cases dropped; ARCHITECTURE §3 sketch shows `uiTree(opts?)`.
Deferred: moving the retry + diagnosis into `read-tree.ts` as a typed transient error (reviewer: bigger than the
bug it cleans; agreed — the eager `adb get-state` on a poll miss is a host-side query, ~tens of ms); test-scaffold
consolidation in `android.test.ts` (the tests are honest; the churn would not buy behaviour).

## Architecture review round 2 (2026-09-18) — APPROVED

Every round-1 item validated. New MINOR taken: `SELECTOR_FIELDS` is now derived from `elementSpecObject.shape`
instead of a literal list with `satisfies` — the literal guard only proved the listed names were keys, not that
every key was listed; the derived form fails to compile when the schema gains a field the type lacks (verified).
NITs taken: the inferred-frame header prose is pinned in the existing rect-parity test; the "ExecError shaped like
exec.ts emits it" fixture builder moved to `tests/helpers/exec-error.ts` as the one executable statement of that
invariant. Deferred with the reviewer's agreement: `TreeNotReadyError`/diagnosis in `read-tree.ts`; scaffold
consolidation in `android.test.ts`. Final: lint clean, build compiles, 612 tests.
