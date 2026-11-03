# 41. An Android link names the chooser in front, from one focus read after the start

Status: accepted 2026-11-03 (performance backlog row D55, docs/plans/2026-10-30-performance-backlog.md). One reply
changes on purpose: `open_deep_link` on Android, when the platform's chooser is in front after the start. Every other
reply is byte-identical, D54's iOS alert text included. The `DeviceAdapter` contract gains one optional field,
`DeepLinkOutcome.chooser`.
Amended 2026-11-03 (D55r: `mFocusedApp` is read in API 33's shape, `<component>} t<task>}`, which the first regex
never matched; implemented on `fix/d55r-focused-app-api33`).
Amended 2026-11-03 (batch-11: D55 device-verified with D55r's fix — the last paragraph of the D55r amendment).
Amended 2026-11-03 (D55b: `launch_app`'s `-p` start and monkey's refusal read the same focus; implemented on
`fix/d55b-launch-chooser`).

## Context

- `AndroidAdapter.openDeepLink` sends `am start -a android.intent.action.VIEW -d <url>`: an implicit intent, with no
  package and no component. `runStart` (`adapters/android-start.ts`) reads `am start` only for a refusal, so anything
  else is `started`. That answer was right for its question: when two activities handle the url and neither is the
  preferred one, Android starts its resolver, which is an activity too. Nobody asked WHICH activity started.
- Batch-9 (2026-11-03, averi_lab emulator, API 33, main e734fedf) measured it. The lab's `averilab://shared/open` has
  two handlers, `dev.averi.lab/.MainActivity` and its alias `.Twin`. A raw `am start` and averi's `open_deep_link`
  each left the chooser in front: `mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}`
  and `mFocusedApp=ActivityRecord{6909a9c u0 android/com.android.internal.app.ResolverActivity} t2590}`. The dump
  showed package `android` only ("Open with", "AveriLab", "AveriLab twin", "Just once", "Always"). averi still replied
  `Opened averilab://shared/open on android` (54 ms). One BACK dismissed the chooser.
- That reply was a dishonest success. Every later selector for the app misses, and an `absent:` assert passes
  falsely, which is the same hazard as D54's iOS alert (ADR 0032's D54 amendment).
- No ADR owned Android's deep link until now. ADR 0032's amendments are iOS's: the idb helper and the D49a, D54 and
  D58 work on `simctl openurl`.

## Decision

**After a `started` outcome, `openDeepLink` reads the window manager's focus once. When the focused component is
the platform's chooser, the outcome is `{ chooser: { component } }` and the reply says the link is not opened yet.**

- The read is `CHOOSER_FOCUS_COMMAND`, `dumpsys window displays | grep -E 'Display: mDisplayId=|mCurrentFocus=|mFocusedApp='`,
  with a 2 s bound, like the adapter's other focus reads. It is a new constant beside `FOCUSED_WINDOW_COMMAND`, whose
  contract (a window TYPE for a miss) its callers keep unchanged. The dump prints one focus pair per display, so
  both lines are read from display 0's block alone (the default display, where `am start` with no `--display`
  starts the link), or the first display's when none is display 0. API 29 prints
  `mFocusedApp` as a window token, `AppWindowToken{… token=Token{… ActivityRecord{…}}}`, so the activity is read
  anywhere on that line (AOSP 10's shape, synthetic in the tests, not captured). (Both added after review round 1.)
- The judgement is pure: `adapters/android-chooser.ts#chooserInFocus`. It takes the focused activity's component
  (`mFocusedApp`), or the focused window's (`mCurrentFocus`) when no activity is named, and names it a chooser when
  the package is exactly `android` or `com.android.intentresolver` and the class is `ResolverActivity` or
  `ChooserActivity`, fully named or short. No app can own those packages, so a match is the platform's chooser, never
  an app's activity of the same name. The activity decides because `am start` returns without waiting for a window:
  the focused activity is set as the start resumes it, and the focused window follows once it is drawn (AOSP's
  reasoning, not measured). So the chooser as the activity under the launcher's or a `null` window is the link's
  chooser not drawn yet, and an app as the activity under the chooser's window is an earlier chooser on its way out,
  which is no chooser. (The code review changed this from "either line": the analysis's rule would warn for a
  chooser on its way out.)
  See the D55r amendment below: on API 33 the activity line was never read until then.
- The list's provenance is in the module: `android/com.android.internal.app.ResolverActivity` was measured (batch-9,
  API 33). `ChooserActivity` and the `com.android.intentresolver` package (the IntentResolver module of later
  releases) are AOSP's, not measured.
- It fails open. A failed call (grep finds neither line, adb is gone, a timeout), an unreadable answer, or a focus
  that is not yet the chooser all give `{}`, which is today's reply byte for byte. averi never warns without a
  positive match.
- The reply (`mcp/tool-text.ts#deepLinkText`, checked before `alert`) replaces the headline, as D54's does:

  > Android has not opened <url> yet: its chooser (<component>) is in front, asking which app opens it. Take a
  > ui_snapshot, tap the app you mean, then its "Just once" button if it shows one (never "Always": it changes the
  > device's default for such links); press_key back drops the link. averi taps nothing itself.

  The advice is one constant, `CHOOSER_ADVICE`, in the new module. averi taps nothing: "Always" writes a preferred
  activity, a device change every later run would inherit, and which handler is meant is the test's business. "If it
  shows one": a ResolverActivity asks for the app and then "Just once" or "Always" (batch-9), while a ChooserActivity
  opens the app that is tapped (AOSP, not measured). The reply does not say what `launch_app` does with the chooser
  up, because that is unmeasured.
- Not done here: no `am start -W` (it would make every happy-path reply wait for the app's first frame), no
  `cmd package resolve-activity` (it predicts the chooser and does not see it), and no tree read on the happy path (at
  least 1 s per link). No tap.

## Consequences

- Cost: the happy path goes from one adb call to two. It is estimated at about +20–26 ms (54 ms to about 80 ms), from
  the measured cost of `dumpsys window windows` (21–23 ms) and `FOCUSED_WINDOW_COMMAND` (25–26 ms; android.ts). The
  repo's perf scripts have no deep-link seam and no device was used, so the filtered command itself is not measured.
  The next batch's E1 control measures it. The worst case is a hung adb: the read then adds up to its 2 s bound to a
  link that has already started, and the reply falls back to `Opened`.
- The `-p` start of `launch_app` (an intent with no activity) is unchanged and unchecked, and so is the `-n` start.
  The monkey start is unchanged too, and neither `-n` nor monkey can raise the chooser. See the D55b amendment below.

Residuals, stated:
- Measured on API 33 only, one emulator. The focus lines are expected in `dumpsys window displays` on API 29 and
  later. On API 28 and earlier they may not print there, and the read then fails open. The repo has no such device.
- The race: if neither focus line names the chooser yet at the one read, the reply is `Opened` as before. Batch-9's
  read found both lines naming it. The next batch's E1 runs it 20 times, with a one-handler control.
  Batch-10's E1 ran it: see the D55r amendment below.
- The reply names the chooser by its component only. Its title, its apps' labels and their centres come from the ui
  tree in a later change (backlog D55c), once the next batch's E2 has captured the chooser's real tree.
- `launch_app` with `intent:` and no `activity` (`am start -p`) can raise the same chooser when the app itself
  declares two handlers, as the lab does (inference, unmeasured). It still answers `Launched` (backlog D55b).
- An OEM's own chooser component, outside the list, is not named. The reply is then `Opened`, as before.
- A chooser that was already up before the link (an unanswered earlier one) can still be the focused activity at the
  one read when the link's own start has not resumed yet. The reply then names it, although a one-handler link may
  open a moment later. averi does not read the focus before the start, because that would be a third call on every
  link. The chooser IS in front at the read, and the advice's `ui_snapshot` shows which.
- `adapters/android-chooser.ts` joins the mutation run (ADR 0038) with its direct tests.

## Amendment: API 33's `mFocusedApp` is read (2026-11-03, D55r)

**Context.** Batch-10's E1 (2026-11-03, averi_lab emulator, API 33, main 139256a2) ran the race:
`averilab://shared/open` 20 times from the launcher and 10 with the lab in front, and `averilab://cell/open` (one
handler) 10 times as the control. It failed: 25 of the 30 shared runs replied `Opened` with the chooser in front (17
of 20 from the launcher, 8 of 10 from the lab), no reply named a chooser falsely, and the control replied `Opened`
10 of 10. A parser bug was found: `FOCUSED_APP_RE` wanted a space after the component, which is API 36's shape
(`…NexusLauncherActivity t2}`). API 33 closes the component with a brace: `mFocusedApp=ActivityRecord{6dd03d6 u0
android/com.android.internal.app.ResolverActivity} t2641}`. So on API 33 the activity line matched in none of the 40
reads, and every reply rested on `mCurrentFocus`, which named the chooser in time in 5 of the 30 shared runs. The unit
tests missed it: their synthetic `focus()` wrote API 36's shape, and batch-9's one API 33 fixture names the chooser in
its window too, so its whole-dump test passed through the window and never read `mFocusedApp`. averi's own read was
not recorded. The probe read the same `CHOOSER_FOCUS_COMMAND` right after averi's reply: there `mFocusedApp` named the
started activity in 40 of 40 reads, while the window was still `null` in 1 of the 30 shared reads and in all 10
control reads.

**Decision.**
- `FOCUSED_APP_RE`'s component ends at a space or `}`: `…([^\s/}]+\/[^\s}]+)[ }]`. It reads both shapes, and a
  record cut right after the component (at a newline or the end of the answer) names nothing. `FOCUS_WINDOW_RE`'s
  capture is the same and keeps its `\}`, since a window record closes right after its component. Both stay literals
  (Stryker mutates only regex literals). This corrects a real parser bug: over batch-10's 40 reads taken right after
  the reply, the old regex matched 0 `mFocusedApp` lines and the fixed one 40 (the chooser in 30 of 30 shared reads,
  `dev.averi.lab/.MainActivity` in 10 of 10 control reads). It still matches the API 36 fixture.
- Those reads do not tell the two parsers apart. Over them the old parser also names the chooser in 29 of 30 shared
  runs, through the window, against the fixed one's 30 of 30. Yet averi replied `Opened` 25 times, so averi's own
  read came well before them. Whether that earlier read now names the chooser is unproven: the next E1, which records
  averi's own read, is the test.
- The rule is unchanged: the focused activity decides, the window only when no activity is named. Everything else is
  unchanged too: the one read, its command and bound, the component list, the fail-open, the reply.
- Tests: three fixtures are batch-10's reads as recorded (`dumpsys-window-focus-api33-b10-*.txt`): both lines the
  chooser; the window `null` under the chooser's activity; the window `null` under the lab's activity after
  `averilab://cell/open`. Whole-dump cases now need the activity line: batch-10's window-`null` pair gives the chooser,
  and the chooser's window over the dump's own app activity gives none. Every synthetic case runs in both the API 33
  and the API 36 shape.

**Consequences.** No added call, wait or cost: the happy path is still the start plus one focus read. On API 33 a link
whose chooser is already the focused activity but not yet the focused window is now named. The hypothesis, unproven,
is that averi's own read is such a read often enough to turn the 25 false `Opened` into chooser replies; the next E1
checks it. A one-handler link whose app is the focused activity under a `null` window stays `Opened`, as the
control did.
See the batch-11 paragraph below.

**Mutation-checked**: hand mutants on the two regexes, each killed but one. On `FOCUSED_APP_RE`'s terminator: a
space only (the old regex; 12 tests fail), a brace only (8: the API 36 shape), `[\s}]` (1: the record cut right
after the component, then a newline), negated (31), the class part admitting a brace (18), the terminator dropped or
any character (1 each, the record cut at the end of the answer). On `FOCUS_WINDOW_RE`'s: dropped (1). Equivalent:
`FOCUS_WINDOW_RE`'s `\}` as `[\s}]`, since no printed window record has whitespace after its component. `npm run
mutate` (cold): android-chooser 100 % (floor 98; 51 mutants, 0 survived); every other module's score unchanged;
floors unchanged.

**Golden.** The golden replays tree reads, not focus reads: Changed 0, which is no evidence either way. The unit tests
are the evidence.

Residuals, stated:
- The race remains for the one read, but narrower: if neither line names the chooser yet when averi reads, the reply is
  `Opened` as before. Batch-10 found `mFocusedApp` already naming the started activity in 40 of 40 reads right after
  the reply, but averi's own read was not recorded. The next batch re-runs E1 with averi's own read recorded (its raw
  output and time). It passes when all 30 shared runs name the chooser and the 10 controls reply `Opened`.
- If averi's read precedes the chooser on both lines, the fix alone leaves the false `Opened`. A follow-up must then
  add a prediction (`cmd package resolve-activity`) or a bounded poll.
- Out of scope, unchanged: D55b (`launch_app` with `intent:` and no `activity`) and D55c (the chooser's labels from the
  ui tree).

**Device-verified** (batch-11, 2026-11-03, main a5fefd32, averi_lab API 33; E1 with averi's own read recorded, its raw
output and time): PASS. averi named the chooser in 30 of 30 shared runs (20 from the launcher, 10 with the lab in
front), and the one-handler control replied `Opened` 10 of 10; every reply matched main's `chooserInFocus` of averi's
own read. That read began 0 ms after `am start` returned. In it `mCurrentFocus` was `null` in 25 of the 30 shared reads
and still the previous window in 5, never the chooser, while `mFocusedApp` named ResolverActivity in 30 of 30: the
activity line D55r reads is what names the chooser at the start's return. The first two residuals above are answered:
the one read suffices, and no `resolve-activity` prediction or bounded poll is needed. Latency: shared median 127 ms
(72–183), control 159 ms (132–202). E3, a fact only: `cmd package resolve-activity --brief` predicted 40 of 40, median
50 ms (32–57), interleaved with E1's calls.

## Amendment: `launch_app`'s `-p` start and monkey's refusal read the same focus (2026-11-03, D55b)

**Context.** Batch-10's E4 and batch-11's D55b (2026-11-03, averi_lab emulator, API 33; batch-11 on main a5fefd32)
measured the residual above. From the launcher, `launch_app {intent: VIEW averilab://shared/x}` (no activity, so
`am start -p dev.averi.lab …`) raised the chooser 10 of 10: two activities of the package (`.MainActivity` and its
alias `.Twin`) handle the intent and none is preferred. `am start` printed
`Starting: Intent { act=android.intent.action.VIEW dat=averilab://shared/... pkg=dev.averi.lab }` and averi replied
`Launched dev.averi.lab on android` 10 of 10 with the chooser up. A focus read with `CHOOSER_FOCUS_COMMAND` at the start's return named ResolverActivity as `mFocusedApp` 10
of 10; `mCurrentFocus` was `null` in 7 and the chooser's own window in 3. With the chooser up, a plain `launch_app
dev.averi.lab` (monkey) exited 251 3 of 3: its stdout only its `bash arg:` echoes, its stderr its arguments and `**
SYS_KEYS has no physical keys but with factor 2.0%.`, an emulator warning. averi failed with "monkey started nothing
in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity … monkey said: ** SYS_KEYS has no
physical keys but with factor 2.0%.": the wrong cause, and a warning quoted as the reason.

**Decision.**
- After a `started` `-p` start, `launchApp` reads the focus once (`chooserInFront`, D55's read: the same command, 2 s
  bound, `chooserInFocus` and fail-open). When it names the chooser, the launch returns `{ note }`: the headline
  stays `Launched`, and the reply's ⚠ line and the flow's `⚠ launch` line carry
  `adapters/android-chooser.ts#launchChooserNote`:

  > Android has not brought dev.averi.lab forward yet: its chooser
  > (android/com.android.internal.app.ResolverActivity) is in front, and dev.averi.lab is not. Take a ui_snapshot, tap
  > the app you mean, then its "Just once" button if it shows one (never "Always": it changes the device's default for
  > the intent it answers); press_key back drops the chooser. averi taps nothing itself. Naming the activity
  > (`activity:` on the launch step / launch_app) starts it without the chooser.

  This is D56's shape on iOS (ADR 0032's D56 amendment): the start happened, so a launch never fails for what holds
  it (`LaunchOutcome`). No type, `launchText` or engine change: `flow/launch.ts` already carries `note` to
  `launch_app`, the flow's `launch` step and the ensure_state ladder. The last sentence is the usable part: `-p`
  scopes the intent to the package, so a chooser it raises offers only that app's activities, and `-n` skips it. The
  note claims no more than the read saw (review round 1): the chooser in front and the package not. A chooser left up
  by another app's link reads the same, so the note does not say whose intent it answers.
- On monkey's refusal only (a non-zero exit with a `** ` line, `runStart`'s `refused`), the same one read. When it
  names the chooser, the error is `launchChooserNote`'s sibling `monkeyChooserRefusal`, the ExecError still its cause:

  > monkey started nothing in dev.averi.lab: Android's chooser (android/com.android.internal.app.ResolverActivity) is
  > in front, and monkey starts nothing over it (it exited 251). Take a ui_snapshot, tap the app you mean, then its
  > "Just once" button if it shows one (never "Always": it changes the device's default for the intent it answers);
  > press_key back drops the chooser. averi taps nothing itself. Then launch again.

  The exit code is monkey's own (the ExecError's; batch-10's refusal was recorded as 252), left out when there is none.
  Of monkey's `** ` lines every real reason is quoted after the exit, `monkey said: <line> / <line>`, e.g. `** No
  activities found to run, monkey aborted.`; only a line that is the emulator's `** SYS_KEYS …` warning, from its
  start, is not. The exit code's meaning was not traced in Monkey.java, so nothing depends on it beyond the
  observation.
- Fail open: a failed, timed-out or unmatched read gives today's reply byte for byte, `Launched …` or monkey's old
  error. `-n` (an activity named) reads nothing, nor does a monkey that started something, nor a thrown monkey or
  `am start` failure with no diagnosis (adb gone, a timeout), nor a refused `-p` start, which throws `launchRefused`
  as before.
- One advice builder: `chooserAdvice(defaultFor, drops)` in `adapters/android-chooser.ts`. `CHOOSER_ADVICE` is
  `chooserAdvice('such links', 'the link')`, so `open_deep_link`'s reply is byte-identical; both launch paths use
  `chooserAdvice('the intent it answers', 'the chooser')`, so monkey's error keeps the never-"Always" warning too. The
  strings live in the mutated module and are pinned whole.
- Not taken: a headline that is never `Launched` (batch-10's wording of the candidate). It would change `LaunchOutcome`,
  `launchText`, the engine's trace and iOS's D56 shape together: a cross-platform reply decision, a separate item only
  if an agent misreads the note. Also not taken: a throw (the start happened, and the ensure_state ladder would be
  pushed past the rung), `cmd package resolve-activity` before the start (it predicts the chooser, costs the same on
  every `-p` launch, and misses a chooser already up, which the monkey half needs), and `am start -W`.

**Consequences.** Cost, measured (batch-11, the focus read after the `-p` start): a median 70 ms (58–99, n = 10). This
corrects the Consequences' estimate of about 20–26 ms for the read; E1's link reads measured 59 ms (30–95, n = 30)
and 78 ms (65–100, n = 10, the control). It is paid on `-p` launches only, chooser or not, and after monkey's refusal
(about 62 ms there). `-n` and monkey's success pay nothing. A hung adb adds up to the 2 s bound, then fails open.

**Tests.** android.test.ts's known-wrong T4 pins flipped: E4d (batch-10's read 1.5 s after the `-p` launch) now
expects the note and the focus read after the start; E4c expects the chooser error, on batch-11's real exit-251
output (its stdout and stderr kept as fixtures) as well as batch-10's quoted line. New: batch-11's `-p` stdout and
averi's own read at its return (the window `null`, and the chooser's), the one-handler control read, each fail-open
answer, a refused `-p` start, `clearState`'s order, `-n` with the intent, monkey's success, monkey refused with no
chooser named, monkey refused with a real reason under the chooser (quoted, the warning not), a monkey failure with no
diagnosis; `tests/mcp/android-chooser-replies.test.ts` runs a real adapter
through `launch_app`'s reply, the flow's `⚠ launch` line and `open_deep_link`'s unchanged reply. Hand mutants on
`android.ts` (the `-p` read dropped, a read on `-n`, a read before the refusal check, the fail-open dropped, monkey
ignoring the chooser, a read after monkey's success or on its thrown failure, the cause dropped, the wrong activity
hint) and on the advice arguments: each killed. Review round 1's, the same way: the SYS_KEYS filter dropped or
unanchored, real reasons never quoted, a fixed exit code, no exit code or no lines passed from the adapter, a `null`
exit printed, monkey's old advice, the note's old claim, the launch advice in the link's wording: each killed. `npm run
mutate` (cold, after review round 1): android-chooser 100 % (floor 98; 79 mutants, 0 survived; 64 before it), every
other module's score unchanged, floors unchanged. Golden Changed 0 (it replays tree
reads, not focus reads).

Residuals, stated:
- One read, so D55's race: batch-11 named the chooser 10 of 10 at the start's return, through `mFocusedApp`. No `-p`
  one-handler control was run; the read's specificity rests on E1's control (10 of 10 `Opened`) and the package rule.
- A chooser already up before a `-p` launch is named, even if the launch alone would have opened one handler (the
  same as the link's residual above). It IS in front at the read.
- `** SYS_KEYS` still counts as a monkey diagnosis when no chooser is named: another refusal on an emulator quotes it
  beside its real `** ` line, if that prints. A separate row if wanted.
- The note names the chooser by its component only; its labels and centres stay D55c's.
- Device check: none yet for the new replies. Proposed live cases (T7's "launch and deep link" group, not built):
  lc1 `launch_app {intent: VIEW averilab://shared/x}` names the chooser; lc2 the one-handler `averilab://cell/x`, no
  note; lc3 `activity: .Twin` with the same intent, no note and one start; lc4 the chooser raised by
  `open_deep_link averilab://shared/open`, then `launch_app dev.averi.lab` (monkey), the error naming the chooser.
