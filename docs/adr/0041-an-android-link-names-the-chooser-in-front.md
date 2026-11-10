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
Amended 2026-11-05 (D55d: batch-13's with_default trees committed as fixtures and the fail-open pinned on them;
implemented on `test/d55d`).
Amended 2026-11-06 (A10: the chooser goes up as a fact, on both verbs, and its words move above the adapters; replies
byte for byte; implemented on `arch/a10-app-holder`).
Amended 2026-11-06 (D73: monkey's `** SYS_KEYS` line is why it stopped, not a warning; monkey starts over the chooser.
This corrects D55b; implemented on `fix/d73-monkey-syskeys`).

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
  tree in a later change (backlog D55c), once the next batch's E2 has captured the chooser's real tree. See the D55c
  amendment below.
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
  ui tree). See the D55c amendment below.

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

**Corrected by the D73 amendment below**: everything here about monkey's refusal rested on reading `** SYS_KEYS` as an
emulator warning, and the chooser was not its cause (measured on API 33). The `-p` half stands. Kept as written, as the record of what was
decided then.

**Context.** Batch-10's E4 and batch-11's D55b (2026-11-03, averi_lab emulator, API 33; batch-11 on main a5fefd32)
measured the residual above. From the launcher, `launch_app {intent: VIEW averilab://shared/x}` (no activity, so `am
start -p dev.averi.lab …`) raised the chooser 10 of 10: two activities of the package (`.MainActivity` and its alias
`.Twin`) handle the intent and none is preferred. `am start` printed `Starting: Intent { act=android.intent.action.VIEW
dat=averilab://shared/... pkg=dev.averi.lab }` and averi replied `Launched dev.averi.lab on android` 10 of 10 with the
chooser up. A focus read with `CHOOSER_FOCUS_COMMAND` at the start's return named ResolverActivity as `mFocusedApp` 10
of 10; `mCurrentFocus` was `null` in 7 and the chooser's own window in 3. With the chooser up, a plain `launch_app
dev.averi.lab` (monkey) exited 251 3 of 3: its stdout only its `bash arg:` echoes, its stderr its arguments and `**
SYS_KEYS has no physical keys but with factor 2.0%.`, an emulator warning. averi failed with "monkey started nothing in
dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity … monkey said: ** SYS_KEYS has no
physical keys but with factor 2.0%.": the wrong cause, and a warning quoted as the reason.

**Decision.**
- After a `started` `-p` start, `launchApp` reads the focus once (`chooserInFront`, D55's read: the same command, 2 s
  bound, `chooserInFocus` and fail-open). When it names the chooser, the launch returns `{ note }`: the headline
  stays `Launched`, and the reply's ⚠ line and the flow's `⚠ launch` line carry
  `launchChooserNote`, then in `adapters/android-chooser.ts` (since A10 `interact/app-holder-text.ts#appHolderText`):

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
  names the chooser and monkey gave no reason of its own (`refusalReasons`, android-start.ts: its `** ` lines without
  the emulator's `** SYS_KEYS …` warning, from the line's start, are none), the chooser is the cause:
  `monkeyChooserRefusal`, the ExecError still the error's cause:

  > monkey started nothing in dev.averi.lab: Android's chooser (android/com.android.internal.app.ResolverActivity) is
  > in front, and monkey starts nothing over it (it exited 251). Take a ui_snapshot, tap the app you mean, then its
  > "Just once" button if it shows one (never "Always": it changes the device's default for the intent it answers);
  > press_key back drops the chooser. averi taps nothing itself. Then launch again.

  The exit code is monkey's own (the ExecError's; batch-10's refusal was recorded as 252), left out when there is
  none. Its meaning was not traced in Monkey.java, so nothing depends on it beyond the observation.
- When the chooser is named beside a real reason of monkey's (code review), the chooser is not claimed as THE cause.
  monkey's reason leads: the old error, quoting its real lines only (the warning left out), then `chooserAlsoInFront`:

  > monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity, or
  > name the activity to start: `activity:` on the launch step / launch_app, or app.android.activity in averi.yaml —
  > or monkey itself could not run; its line says which. monkey said: ** No activities found to run, monkey aborted.
  > Android's chooser (android/com.android.internal.app.ResolverActivity) is also in front. Take a ui_snapshot, …
  > press_key back drops the chooser. averi taps nothing itself.

- The advice after a launch says "press_key back drops the chooser", not "drops the launch" (review round 1): the
  chooser in front may be another app's link's, left up, and then BACK drops that one; what one BACK drops is the
  chooser either way (batch-9, batch-11).
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
expects the note and the focus read after the start; E4c expects the chooser error, on batch-11's real exit-251 output
(its stdout and stderr kept as fixtures) as well as batch-10's quoted line. New: batch-11's `-p` stdout and averi's
own read at its return (the window `null`, and the chooser's), the one-handler control read, each fail-open answer, a
refused `-p` start, `clearState`'s order, `-n` with the intent, monkey's success, monkey refused with no chooser named
(the warning quoted whole, as before), monkey refused with a real reason and the chooser in front (the reason leads,
the warning unquoted, the chooser also in front), a monkey failure with no diagnosis; `startSaid` and
`refusalReasons` in android-start.test.ts; `tests/mcp/android-chooser-replies.test.ts` runs a real adapter through
`launch_app`'s reply, the flow's `⚠ launch` line and `open_deep_link`'s unchanged reply. Hand mutants, each killed: on
`android.ts`, the `-p` read dropped, a read on `-n`, a read before the refusal check, the fail-open dropped, monkey
ignoring the chooser, a read after monkey's success or on its thrown failure, the cause dropped, the wrong activity
hint; on the wording, the advice arguments, the note's old claim, monkey's old advice, a fixed exit code, a `null`
exit printed; on the code review's split, the warning kept or matched unanchored, am's lines filtered, `startSaid`
ignoring the lines given, the chooser always THE cause, the also-in-front sentence or its advice dropped, the warning
quoted beside a real reason, the warning dropped when no chooser is named. `npm run mutate` (cold, after the code
review): android-chooser 100 % (floor 98; 70 mutants, 0 survived; 79 after review round 1, 64 before it), every other
module's score unchanged, floors unchanged. Golden Changed 0 (it replays tree reads, not focus reads).

Residuals, stated:
- One read, so D55's race: batch-11 named the chooser 10 of 10 at the start's return, through `mFocusedApp`. No `-p`
  one-handler control was run; the read's specificity rests on E1's control (10 of 10 `Opened`) and the package rule.
- A chooser already up before a `-p` launch is named, even if the launch alone would have opened one handler (the
  same as the link's residual above). It IS in front at the read.
- `** SYS_KEYS` still counts as a monkey diagnosis (a non-zero exit with it is `refused`, so the read can ask why),
  and with no chooser named it is still quoted, beside a real line or alone: the fail-open keeps today's reply byte for
  byte, and a refusal with no chooser whose only line is the warning is unmeasured. Dropping it there is a separate
  row if wanted.
- With a chooser and a real reason both seen, which of them stopped monkey is not known; the reply names both, the
  reason first. A chooser named with no reason of monkey's is called the cause, as batch-11 measured (3 of 3).
- The note names the chooser by its component only; its labels and centres stay D55c's. See the D55c amendment below.
- Device check: the live cases proposed here are built as T7b's chooser group (see the T7b amendment below): lc1
  `launch_app {intent: VIEW averilab://shared/x}` names the chooser; lc2 the one-handler `averilab://cell/x`, no note;
  lc3 `activity: .Twin` with the same intent, no note (its "one start" cannot fail on this lab: `.MainActivity` is
  singleTop). The lc4 proposed here (the chooser raised by `open_deep_link averilab://shared/open`, then `launch_app
  dev.averi.lab` (monkey), the error naming the chooser) is void since D73; lc4' and lc4'' replace it.

## Amendment: the chooser's own tree is quoted, from one dump on the chooser path (2026-11-03, D55c)

**Context.** The replies above name the chooser by its component and send the agent to a `ui_snapshot` to find its
apps. Batch-10's E2 captured the fresh layout's tree (`tests/fixtures/uiautomator-lab-resolver.xml`, 27 nodes, all
package `android`): `title` "Open with"; `resolver_list` with one direct-child row per app, its label `text1` and,
when Android tells two targets of one app apart, `text2` (both rows say "AveriLab", the alias's `text2` "AveriLab
twin"); `button_once` "Just once" and `button_always` "Always", both `enabled="false"`, so `disabled: true` since D66
(ADR 0042). Batch-11's E2 (main a5fefd32) tapped row 2's centre (540,1881), a point outside every text node: the
chooser stayed, and the only change in the tree was both buttons enabled
(`tests/fixtures/uiautomator-lab-resolver-selected.xml`, committed with this change); "Just once" at (723,2058) then
started `.Twin`, row 2's app. Its three dumps on the chooser took 2514, 2020 and 2054 ms.

**Decision.**
- Only `openDeepLink` and the `-p` launch read the tree, and only after `chooserInFront` named the chooser: one
  `uiautomator dump /dev/tty` (`AndroidAdapter#chooserSheetInFront`) with its own 5 s bound
  (`CHOOSER_TREE_TIMEOUT_MS`, twice the measured 2.5 s). The happy path stays two calls; `-n`, monkey's success and
  monkey's refusal never dump (monkey's is an error path whose chooser predates the call, and its strings stay
  pinned as they are).
- Not `uiTree()`: its 15 s bound, its "null root node" retry and its diagnosis (an extra `adb get-state`, 5 s) are
  the costs of a read the caller needs, not of an optional enrichment. The XML slice and parse are one helper both
  use (`dumpedTree`).
- The pure judge is `adapters/android-chooser.ts#chooserSheet`, the counterpart of `alertInWda` (D54), by resource id
  alone. Its guard accepts only the measured shape: exactly one `resolver_list`; at least one row, each a direct
  child holding exactly one labelled `text1` and at most one `text2`; exactly one labelled `button_once` and one
  labelled `button_always`; no `icon` and no `text1` outside the list. The last rule is the
  `resolver_list_with_default` guard. AOSP android13's `core/res/res/layout/resolver_list_with_default.xml`, read at
  build time, confirms what it guards against: that layout heads the sheet with an `@+id/icon` ImageView and an
  `@+id/title` TextView (the last-chosen app) in a LinearLayout above the TabHost that holds the list, with
  `button_bar` in the same header; its `profile_button` (`icon` and `text1`) is `gone`. So its header `icon` lies
  outside `resolver_list` and the guard fails open on it. Quoting the list's rows alone there would hide the
  preselected app.
- The sheet (`LinkChooser.sheet`, `ChooserSheet` in types.ts): the title when exactly one labelled `title` exists;
  each row's `text1`, its `text2` as `detail`, at the ROW's centre (the ListView takes the touch, E2); both buttons'
  labels verbatim, centres (`rectCentre`, now in `adapters/types.ts` beside `Rect`, re-exported by
  `ui-tree/geometry.ts`; the alert judge uses it too) and `disabled`. Anything else, or any throw, timeout or XML-less dump, is
  no sheet, and the reply is D55's (or D55b's) byte for byte.
- The reply (`mcp/tool-text.ts`'s chooserText; `launchChooserNote`, which now takes the `LinkChooser`; both since A10
  `interact/app-holder-text.ts#appHolderText`) keeps D55's or
  D55b's first sentence and replaces the advice with the sheet and its own advice (`chooserSheetText`:
  `chooserSheetSays`, then `sheetAdvice`, beside `chooserAdvice`, whose ending both share). On the fixture:

  > Android has not opened averilab://shared/open yet: its chooser (android/com.android.internal.app.ResolverActivity)
  > is in front, asking which app opens it. Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab"
  > ("AveriLab twin") at (540, 1881) and the buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058)
  > (disabled). Tap the app's row at its x and y (one tap only selects it and enables the buttons), then tap
  > id:button_once (never id:button_always: it changes the device's default for such links); press_key back drops the
  > link. averi taps nothing itself.

  and after a `-p` start:

  > Android has not brought dev.averi.lab forward yet: its chooser
  > (android/com.android.internal.app.ResolverActivity) is in front, and dev.averi.lab is not. Its sheet "Open with"
  > lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and the buttons "Just once"
  > at (723, 2058) (disabled), "Always" at (936, 2058) (disabled). Tap the app's row at its x and y (one tap only
  > selects it and enables the buttons), then tap id:button_once (never id:button_always: it changes the device's
  > default for the intent it answers); press_key back drops the chooser. averi taps nothing itself. Naming the
  > activity (`activity:` on the launch step / launch_app) starts it without the chooser.

  "and enables the buttons" only while a button is marked disabled: on batch-11's selected tree neither is, and the
  clause is left out with the "(disabled)" marks.
  Coordinates, not `text:`, for the row: the lab's two rows share "AveriLab". The button by id: `id:button_once` is
  language-free and hits (723,2058) (tests/mcp/android-chooser-replies.test.ts); the labels are quoted, never
  matched. "(disabled)" only on a node marked so (in the selected tree it is absent).
- No tap, no poll, no tool-description change.

**Consequences.** The reply's latency on the chooser path moves from about 127 ms (batch-11 E1) to about 2–2.5 s, the
dump's measured cost. It is paid on the chooser path only, and it saves a round trip rather than adding one: the
advice it replaces made the agent's next call a `ui_snapshot`, the same dump. A hung dump adds up to the 5 s bound,
then fails open.

**Tests.** android-chooser.test.ts: the exact sheet from batch-10's fixture (2057.5 rounds to 2058) and batch-11's
selected tree (no `disabled`); the title absent, empty or doubled; one row; an empty `text2`; every fail-open shape
(no or two `resolver_list`s, no rows, a row with no, an empty, an unlabelled or two `text1`s or two `text2`s, a
button missing, doubled or unlabelled, an `icon` or a `text1` outside the list, the lab's own screen); the sheet text,
both advice variants (with and without "and enables the buttons") and the note pinned whole; the two advices'
shared ending. android.test.ts: the chooser cases' pins changed on purpose to
`[START, FOCUS, DUMP]` with the dump's 5 s; the happy path and a failed focus read stay two calls; each dump failure
(a failed or timed-out exec, a throw, no XML, `Killed`, "null root node", an empty hierarchy, another layout) is `{
chooser: { component } }` exactly, one dump, no sleep, no `get-state`; the same for `-p`; `-n`, monkey's success and monkey's
refusal never dump. tests/mcp/android-chooser-replies.test.ts runs a real adapter through `open_deep_link`'s reply,
`launch_app`'s and the flow's `⚠ launch` line on both fixtures, and each fail-open dump gives the old replies byte for
byte. Hand mutants on `android.ts`, each killed: a dump on the happy path (link and `-p`), before the focus read, on
`-n`, on monkey's refusal; `uiTree()` reused; the 15 s bound; the fail-open's catch dropped; the sheet dropped from
the outcome or the note; on the pure code, the with_default rule removed, the sheet ignored by `chooserText` or by
`launchChooserNote`. Review round 1's hand mutants, each killed: "and enables the buttons" always, or only when both buttons are
disabled; a dump after monkey's success; the sheet dropped in `linkChooserInFront`; `rectCentre` flooring; `labelOf`
taking an empty label; `chooserAdvice` ending with the id. `npm run mutate` (cold, after review round 1):
android-chooser 100 % (floor 98; 204 mutants, 0 survived; 221 before the round, after a test pinned that a row with
no `text2` has no `detail` key — the first run's one survivor); geometry 95.30 % (floor 93; the same 55 survivors,
`rectCentre`'s 6 mutants now in types.ts, outside the mutated files); every other module's score and floor unchanged. Golden Changed 0 (no Android deep-link seam in the corpus).

Residuals, stated:
- The `resolver_list_with_default` layout is unmeasured on a device; the guard rests on AOSP's layout file. The lab
  AVD's last-chosen `.Twin` entry for `shared` (the lab plan's device fact 5) should show it; batch-12 captures it.
- A scrolled list quotes only the rows on screen (the dump lists what is drawn).
- Row 1's tap is unproven: E2 tapped row 2 only. The lab gains `averilab://pair` (the same two handlers, no
  last-chosen entry) for a fresh chooser to tap it on.
- An OEM's own chooser layout, or another resource-id set, fails open to D55's reply.
- monkey's refusal is unchanged.
- The dump starts about 70 ms after `am start` returns, while `mCurrentFocus` may still be `null` (fact 12).
  uiautomator's idle wait should cover the window being drawn; if it dumps the launcher instead, the guard fails open.
  Unmeasured.
- Device check: none yet. Proposed for batch-12 (E5): the with_default fail-open on `shared`, then `open_deep_link
  averilab://pair/open` × 10 and `launch_app` `-p` × 5 from the launcher (the sheet quoted n/10, the latency), then a
  tap at row 1's quoted centre and `tap id:button_once`, `.MainActivity` expected.

**Live check (batch-12, 2026-11-04).** Main f7ea6e07 on the averi_lab AVD (API 33), E5 as proposed above; PASS. (a)
`averilab://shared/open` × 3, its last-chosen `.Twin` entry in place: the chooser was the `resolver_list_with_default`
layout, 25 nodes, every node package `android` — a header LinearLayout with `icon` and `title` "Open with AveriLab",
then `button_bar` in the same header with "Just once" at (723, 1723) and "Always" at (936, 1723), both enabled; then a
"Use a different app" text; then `resolver_list` with one row at (540, 2074), its `text1` "AveriLab", no `text2`; no
node selected or checked. So the AOSP reading above holds: the header with its `icon` lies above the list and holds
the buttons, enabled; the preselected app is the header's (the tree does not say which target it is: both labels read
"AveriLab"), not a marked row, and the list holds the other one. The guard failed open on it: averi's reply was
byte-identical to D55's 3/3 (2012–2124 ms). (c) after the lab's reinstall, `averilab://pair/open` × 10 and
`launch_app` `-p` × 5 from the launcher: the sheet quoted 15/15 (links median 2022 ms, launches median 2041 ms), the
quoted centres and "(disabled)" marks equal to the probe's own dump, the fresh tree byte-identical to
`tests/fixtures/uiautomator-lab-resolver.xml`. averi's dump, started right after `am start` (38–60 ms) and the focus
read (24–35 ms), took about 1.94–2.05 s (19 dumps, median 1.94 s, exit 0 every time, no timeout, never the launcher's
tree). (d) a tap at row 1's quoted centre (540, 1727) only selected (both buttons enabled, no node marking the row),
then `tap id:button_once` brought `.MainActivity` to the front, leaving a last-chosen `pair` entry (`mAlways=false`,
not a default). The cost is therefore about 2.0 s against the ≈ 127 ms before, at the low end of the 2–2.5 s stated in
Consequences; the 5 s bound is about 2.4 times the slowest dump. Residuals now measured: the with_default layout
(fails open), row 1's tap (works), the dump's timing right after `am start` (no timeout in 19). Still open: a scrolled
list, an OEM's layout, monkey's refusal, a hung dump's bound never seen live; the with_default tree is not yet a
committed fixture (backlog D55d). "Device check: none yet" above is superseded by this paragraph, and the lab AVD now
has no fresh chooser left (`shared` and `pair` both keep a last-chosen entry): a later fresh-chooser check needs a new
two-handler host.

## Amendment: the with_default chooser's real trees are fixtures, the fail-open pinned on them (2026-11-05, D55d)

**Context.** The D55c live check above saw `resolver_list_with_default` fail open, but its tree was not kept as a
fixture. Batch-13 rerun 1 (2026-11-05, averi_lab emulator, API 33, main 73f5ad0d) raised both two-handler links with
their last-chosen entries in place, 3 times each: `averilab://shared/open` (last chosen `.Twin`) and
`averilab://pair/open` (last chosen `.MainActivity`). Every reply was byte-identical to D55's pre-D55c text, 3/3 per
link, and the batch's own safeTap refused row 1 and "Just once" as `no-sheet` on every tree, 8/8, no tap sent. The
probe's own `uiautomator dump` and averi's were byte-identical. Shared's tree has 25 nodes, as batch-12's had. A
header holds `icon`, `title` "Open with AveriLab" and `button_bar` with "Just once" at (723, 1723) and "Always" at
(936, 1723), both enabled. Below it are a "Use a different app" text and `resolver_list` with one row at
(540, 2074) whose `text1` is "AveriLab". Pair's tree has 26 nodes: the same, except that its row also holds `text2`
"AveriLab twin" and the dump marks it not clickable (shared's row is marked clickable).

**Decision.** Tests and documents only; no reply and no code path changes.
- Both trees are committed whole, as the device wrote them, with one XML comment after the prolog naming their source:
  `tests/fixtures/uiautomator-lab-resolver-with-default-shared.xml` and `…-pair.xml`.
- android-chooser.test.ts pins `android-chooser.ts#chooserSheet` as undefined on each, with the facts that decide it.
  These are: one `resolver_list` whose only row is its direct child, an `icon` outside it, no `text1` outside it,
  and the title. A counterfactual pins the deciding node: with the header's `icon` removed, each tree reads as a
  one-row sheet, pair's row with its `text2` as `detail`. Rows are chosen by structure, and `clickable` is never
  read, so pair's non-clickable row changes nothing.
- android-chooser-replies.test.ts adds both trees to its fail-open dumps, so `open_deep_link`'s reply and
  `launch_app`'s `-p` note stay D55's and D55b's byte for byte. It also pins each link's own reply as batch-13
  recorded it. The pre-D55c text is now one literal in that file, shared by every fail-open case.
- lab-chooser.test.ts pins `safeTap`'s live verdicts (scripts/truth/batch/lab-chooser.ts) on each tree: row 1 and
  "Just once" give `no-sheet`.

**Consequences.**
- Residual: on the real layout the with_default rejection rests on one node, the header's `icon`. The header holds
  `title`, not `text1`, so the `text1` half of the rule never applies there; only the synthetic case kills a mutant
  of it. A with_default layout without that icon (an OEM's, a later API's) would be quoted as a one-row sheet titled
  "Open with <app>". The title would still name the app, but the reply would not say it is preselected. A second
  signal is a future item, needed only if a live tree ever lacks the icon.
- The real trees kill no mutant that the synthetic `icon` case misses. They pin the measured layout, not a new
  rule.
- The D55c live check's "the with_default tree is not yet a committed fixture (backlog D55d)" is superseded by this
  amendment.

## Amendment: the chooser is a fact of one closed answer, worded above the adapters (2026-11-06, A10)

**Context.** After a link the chooser went up as `{ chooser }`, after a `-p` start as a `{ note }` sentence, and
`mcp/tool-text.ts` imported `adapters/android-chooser.ts` for the words, against ARCHITECTURE.md §2 (the architecture
review of 2026-11-05). D55b's "No type, `launchText` or engine change" was what let the shapes differ.

**Decision.** No reply, device call or order changes. The title stays `Launched`: a launch never fails for what holds
it.
- `launch` and `openDeepLink` answer one closed type, `adapters/types.ts#AppHolder` (ADR 0032's A10 amendment has the
  iOS half): the chooser is `{ holder: 'chooser', chooser }` on both verbs, with its sheet when read. The focus read and
  the dump (D55, D55c) stay in `AndroidAdapter`: they are device reads, and `chooserInFocus` and `chooserSheet` stay
  the pure judges.
- `CHOOSER_ADVICE`, `chooserAdvice`, `sheetAdvice`, `chooserSheetSays`, `chooserSheetText` and `launchChooserNote` are
  gone from `android-chooser.ts`, their sentences now `interact/app-holder-text.ts#appHolderText`'s.
- One thing stays worded in the adapter, on purpose: monkey's refusal (`monkeyChooserRefusal`, gone since D73, and
  `chooserAlsoInFront`).
  It is a thrown error, not an answer: its message is built where the refusal is read and may not import upward
  (ARCHITECTURE.md §2), and `tests/adapters/android.test.ts` pins it there. So its advice, `REFUSAL_ADVICE`, repeats the
  bytes of a launch's advice in `appHolderText`, each side pinned whole.

**Tests.** The byte pins moved with the words to `tests/interact/app-holder-text.test.ts`, literally the same strings;
`android.test.ts` pins the adapter's answer as the same notes through `appHolderText`, and
`tests/mcp/android-chooser-replies.test.ts` is unchanged.

`npm run mutate -- --force` (both groups, cold, at f90086a8): `interact/app-holder-text.ts` joins the run at 96.80 % (floor
95; 125 mutants, 0 survived, 4 without coverage: the two `never` defaults, unreachable while the types hold); `android-chooser.ts` 100 % (152 mutants); every other score unchanged. Golden
Changed 0 (it replays tree reads, no launch or link seam).

Residual: two wordings are written on both sides of the seam, for the same reason (thrown errors built in the adapter): a
launch's chooser advice (the words module and `REFUSAL_ADVICE`) and the "`activity:` on the launch step / launch_app" hint
(the words module and `android.ts`'s `NAME_THE_ACTIVITY`, one constant until A10). The guard is
`tests/adapters/android.test.ts`: its one `ADVICE` and one `NAME_THE_ACTIVITY` constant each feed both the note's and
monkey's expected text, so changing only one side fails there.

## Amendment: monkey's `** SYS_KEYS` line is why it stopped, and monkey starts over the chooser (2026-11-06, D73)

**Context.** D55b read `** SYS_KEYS has no physical keys but with factor 2.0%.` as an emulator warning printed whatever
the outcome, and exit 251 under the chooser as the chooser's doing. Both were wrong. D55b never ran monkey with no chooser
up. The A10 code review's reading of AOSP pointed at it, and backlog row D73 measured it: on the lab AVD every launch
through monkey refused, chooser or not.

Measured 2026-11-06, emulator-5554 (averi_lab, API 33):

| Run | Result |
| --- | --- |
| `--pct-syskeys 0`, `shared`'s chooser up, `dev.averi.lab`, × 3 | exit 0, `Events injected: 1`, no `** ` line, `.MainActivity` in front |
| the same, `pair`'s chooser, × 1; `dev.averi.lab.rn` under `shared`'s, × 1 | the same, each app's `.MainActivity` in front |
| the same as the first row, × 5, read at monkey's return | the app already `mFocusedApp` and `mCurrentFocus`, no `ResolverActivity` record left |
| no flag, `shared`'s chooser up, × 2 (control) | exit 251, `** SYS_KEYS …` on stderr, the chooser still in front |
| `--pct-syskeys 0`, the launcher in front, each lab app × 3 | exit 0, its `.MainActivity` in front |
| `--pct-syskeys 0`, `no.such.pkg`, with and without the chooser, × 1 each | exit 252, stdout `** No activities found to run, monkey aborted.`; the chooser stays in front when up |
| `-v -v --pct-syskeys 0`, × 1 | factor 8 at 0, `:Switch:`, `Events injected: 1`, `:Dropped: keys=0` |
| `-v -v --pct-syskeys 0 --pct-nav 0 --pct-majornav 0`, each lab app × 3 from the launcher, × 3 over `shared`'s chooser | 12 of 12: exit 0, no `** ` line, factors 6, 7 and 8 at 0, `:Switch:` to the app's `.MainActivity`, `Events injected: 1`, `:Dropped: keys=0`, the app `mFocusedApp`, no `ResolverActivity` record |
| the three flags, `no.such.pkg`, × 1 | exit 252, stdout `** No activities found to run, monkey aborted.` |

AOSP, read at android-5.0.0_r1 (Monkey.java, MonkeySourceRandom.java): `--pct-syskeys` sets the system-key factor;
`run()` returns -5 when `validate()` fails, which is the exit 251 D55b left untraced, and it does so before any event;
`validateKeys` checks NAV_KEYS, MAJOR_NAV_KEYS and SYS_KEYS in that order; `validateKeyCategory` passes a factor under 0.1
without looking at the keys;
`run()` calls `generateActivity()` before `validate()` and injects only after it, in `runMonkeyCycles()`, whose loop the
count bounds; `--pct-nav` and `--pct-majornav` set FACTOR_NAV and FACTOR_MAJORNAV as `--pct-syskeys` sets FACTOR_SYSOPS. The
device's own `/system/framework/monkey.jar` holds the three category names and the three flags. That is one old tag
and API 33's jar: the source of no other release was read.

**Decision.**
- The launch sends `monkey -p <package> --pct-syskeys 0 --pct-nav 0 --pct-majornav 0 -c android.intent.category.LAUNCHER 1`.
  Only SYS_KEYS has been seen to abort. The other two flags are there on the same argument (review round 1): the one event
  is the launch, so no key category has a part in it, and "not seen" is what hid SYS_KEYS.
- Gone, resting on the warning reading: `MONKEY_EMULATOR_WARNING_RE`, `refusalReasons`, `startSaid`'s lines parameter and
  `monkeyChooserRefusal`. A `** SYS_KEYS` line reaching a refusal is now news (a device the flag did not help), so it is
  quoted like any other `** ` line.
- Kept, confirmed by the measurement: the one focus read on a refusal and `chooserAlsoInFront`. A real refusal leaves the
  chooser in front, so "also in front" is true and still claims no cause. `REFUSAL_ADVICE` stays with it, so the A10
  residual about wording on both sides of the seam stands.
- monkey's success reads nothing, as before: the app was already in focus at its return, 5 of 5, and the chooser was gone.

**Replies that change, on purpose.** Each is pinned whole in `tests/adapters/android.test.ts` or
`tests/mcp/android-chooser-replies.test.ts`.

1. `launch_app dev.averi.lab` with no activity, no chooser, on the lab AVD. Before, an error:

   > monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity, or name
   > the activity to start: `activity:` on the launch step / launch_app, or app.android.activity in averi.yaml — or monkey
   > itself could not run; its line says which. monkey said: ** SYS_KEYS has no physical keys but with factor 2.0%.

   After: `Launched dev.averi.lab on android`.
2. The same call with the chooser up. Before, an error:

   > monkey started nothing in dev.averi.lab: Android's chooser (android/com.android.internal.app.ResolverActivity) is in
   > front, and monkey starts nothing over it (it exited 251). Take a ui_snapshot, tap the app you mean, then its "Just
   > once" button if it shows one (never "Always": it changes the device's default for the intent it answers); press_key
   > back drops the chooser. averi taps nothing itself. Then launch again.

   After: `Launched dev.averi.lab on android`, the chooser gone.
3. A device that still refuses on `** SYS_KEYS` alone, the chooser up (pinned on batch-11's real output; no such device
   measured). Before: reply 2's error. After, the line quoted and the chooser no longer the cause:

   > monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity, or name
   > the activity to start: `activity:` on the launch step / launch_app, or app.android.activity in averi.yaml — or monkey
   > itself could not run; its line says which. monkey said: ** SYS_KEYS has no physical keys but with factor 2.0%.
   > Android's chooser (android/com.android.internal.app.ResolverActivity) is also in front. Take a ui_snapshot, tap the
   > app you mean, then its "Just once" button if it shows one (never "Always": it changes the device's default for the
   > intent it answers); press_key back drops the chooser. averi taps nothing itself.

4. `** SYS_KEYS` beside another `** ` line, the chooser up (synthetic). Before: the other line alone. After: `monkey said:
   ** No activities found to run, monkey aborted. / ** SYS_KEYS has no physical keys but with factor 2.0%.`, the rest as
   before.

5. A thrown monkey failure with no `** ` line, whose message `ExecError` builds from the argv (`adapters/exec.ts`) and
   `launch_app`'s reply carries unchanged, so it now shows the flags. Read live on an unreachable serial, base 2f6ba8b6:

   > Command failed (exit 1): adb -s emulator-9998 shell monkey -p dev.averi.lab -c android.intent.category.LAUNCHER 1
   > adb: device 'emulator-9998' not found

   This branch:

   > Command failed (exit 1): adb -s emulator-9998 shell monkey -p dev.averi.lab --pct-syskeys 0 --pct-nav 0 --pct-majornav 0 -c android.intent.category.LAUNCHER 1
   > adb: device 'emulator-9998' not found

   The same insertion in `Command timed out: adb -s <serial> shell monkey …` and in a non-zero exit with no `** ` line
   (pinned, not seen live). Raw exec text in a reply is D70's and D65's to deal with, not this change's.

Unchanged byte for byte: a refusal with no chooser named, and a refusal with a real line alone and the chooser up.

**The flow and ensure_state.** Both go through the same launch. Before, over the recorded refusal (base 2f6ba8b6, a real
adapter and engine over batch-11's exit-251 output, `<R>` being reply 1, or reply 2 with the chooser named), a flow's
`launch` step failed the run with:

> <R>
>
> Steps that ran before the failure:
> flow open: start
> ✗ launch: failed — <R>

and `ensure_state` with the same and one more line, `⚠ reach open: failed — <R>`. After, the traces pinned in
`tests/mcp/android-chooser-replies.test.ts`, with a focus read that would name the chooser and the chooser's tree until
monkey starts. The flow's:

> flow open: start
> launch: dev.averi.lab
> flow open: done

and `ensure_state`'s, the same three lines and then:

> state lab: reached after open

**Live, through the MCP layer** (a throwaway script over a real registry and the in-memory transport, not kept: the live
golden launches its cells itself and judges the app's model, so a `launch_app` case would need a new group and a focus
oracle). `launch_app` with no activity on `dev.averi.lab` and `dev.averi.lab.rn`, × 3 each, under no chooser and under
`shared`'s chooser. Base 2f6ba8b6: refused 12 of 12, replies 1 and 2, the launcher or the chooser still in front. This
branch: `Launched` 12 of 12, the app's `.MainActivity` in front 12 of 12, 141–157 ms with the one flag and 138–167 ms with
the three.

**Tests.** `labMonkey` in `tests/mcp/android-chooser-replies.test.ts` answers as the AVD measured: exit 251 without the flag,
exit 0 with it, and the reply over it is exactly `Launched …`. With a focus read that would name the chooser, it proves
monkey's success reads none and adds no note; that monkey starts over the chooser is the device's, measured above.
`tests/fixtures/monkey-api33-d73-started-stdout.txt` is the started stdout under the three flags, a shape record:
`runStart` reads nothing on exit 0, so its bytes guard no averi code. batch-11's exit-251 fixtures stay, as
what a refusing device prints.

`npm run mutate -- --force` (both groups, cold, at 8f9286d6): `android-chooser.ts` 100 % (floor 98; 143 mutants, 0
survived, down from 152 with `monkeyChooserRefusal` gone); every other score unchanged; floors unchanged. `android.ts` and
`android-start.ts` are not in the mutation scope, so hand mutants, each killed: the flag dropped (12 tests fail), its value
`1` (12), `chooserAlsoInFront` dropped (5), the `** SYS_KEYS` line filtered from the quote again (5), `startSaid`'s separator (3).
Review round 1's hand mutants, each killed: `--pct-syskeys` dropped (12 tests fail), `--pct-nav` dropped (10),
`--pct-majornav` dropped (10). The code review's, on the new pins in
`tests/mcp/android-chooser-replies.test.ts`, each killed: `--pct-syskeys` dropped (7 tests fail), `--pct-majornav` dropped
(3), a focus read and a chooser answer after monkey's success (3), monkey's stdout tail dropped (1), the flow's `launch`
line dropped (4). The rounds changed only comments in `android-chooser.ts`; `npm run mutate -- --force` was repeated, both
groups, cold, at ae47ab69: `android-chooser.ts` still 100 % (143 mutants, 0 survived), all 34 scores as at 8f9286d6, floors
unchanged, so `scope.json` is unchanged.

Golden Changed 0 at 8f9286d6, before the review rounds' two more flags (it replays tree reads, no launch seam), so it is
no evidence either way.

Residuals, stated:
- Only API 33 on one AVD is measured. The three flags were read in android-5.0.0_r1's source and found in API 33's jar, and
  no older or newer device was run. An AVD or a device that has those keys is unmeasured; by AOSP's reading the flags only
  set shares of events that a count of 1 never reaches, so they should be harmless.
- If monkey ever exits 0 with the chooser still in front (API 34 and later's `com.android.intentresolver`, unmeasured), the
  reply is a bare `Launched`, no ⚠. Not reading the focus after monkey's success is a choice: the app was in focus and the
  chooser gone at monkey's return 5 of 5, and it saves about 70 ms on every such launch. Live case lc4'' covers the lab
  side; the T7b amendment below corrects "the chooser gone" for a force-stopped lab: its record lingers about 1.3 s.
- No permanent check ran this path on a device when this amendment was written: the lab launches with `am start -W -n`
  (`lab-device.ts`), the perf baseline names `.MainActivity`, and the differential has no Android launch. Backlog T7b's
  lc4' (`launch_app` with no activity from the launcher answers `Launched`, the app `mFocusedApp`) and lc4'' (the same
  over `open_deep_link averilab://shared/open`'s chooser, no `ResolverActivity` left), since built (the T7b amendment
  below), are D73's net, run on demand with `live.ts --groups chooser` (lab, API 33); no recurring run includes it yet
  (backlog T20b, a standing lab batch, and T20c, its schedule; T20a, the premise read before the cases, below). Since
  T20b the standing batch exists (`npm run truth:lab`, the T20b amendment at the end); scheduling it is T20c.
- D55b's proposed live case lc4 (the error naming the chooser) is void: monkey under the chooser now answers `Launched`.
  lc4' and lc4'' take its place.
- ADR 0041's "The reply does not say what `launch_app` does with the chooser up, because that is unmeasured" is answered
  for monkey: it brings the app forward, and the chooser goes.

## Amendment: the chooser group, live; the ResolverActivity record outlives monkey's return (2026-11-09, T7b)

**Context.** The cases proposed above (D55b's lc1–lc3, D73's lc4' and lc4'') are built as the live truth harness's
chooser group (backlog T7, `live.ts --groups chooser`, `scripts/truth/live-chooser.ts`; ADR 0044's T7b amendment). Its
oracle is the device's own `mFocusedApp` and the `Hist` records of `dumpsys activity activities`, read by the harness's own
grep and parser, not this ADR's `chooserInFocus`. Runs on emulator-5554 (averi_lab, API 33):
docs/truth/live-records/t7b-chooser.

**What the device showed, against the D73 amendment above.** D73 says "the app was in focus and the chooser gone at
monkey's return 5 of 5" and "no ResolverActivity record left". For a force-stopped lab started by monkey over the chooser
(lc4''), and from the launcher (lc4'), that holds only in part:
- `mFocusedApp` is already the lab's `.MainActivity` at the first read, about 800 ms after averi replied: 6 of 6 reads
  in review round 1's three runs (lc4' and lc4'' each, their `firstWindow`), and in the first run's (`unsettled-1.json`)
  too — there its single, unwaited `window` read, taken before the harness waited at all, not a `firstWindow`.
- `mCurrentFocus` is still `null` there (the window transition), and in the first run the ResolverActivity record was
  still on the stack under the lab's. By hand right after (a raw `am start` of the link, then monkey, polled every
  ~0.4 s): the null focus and the record both lasted about 1.3 s and went together; every read after had neither.
  D73's 5 of 5 were most likely runs with the lab's process alive (not measured); a cold start draws later.

**Why "Launched" still holds.** averi's reply claims the launch, and the app is the focused activity when it replies;
the chooser is no longer in front. A ResolverActivity record below the lab, finishing, holds nothing: it is gone once
the transition ends, with no input. So the reply stays a bare `Launched`, and no focus read after monkey's success is
added. The group judges `mFocusedApp === .MainActivity` on the first read (`FocusRead.settle.firstWindow`) and "no
chooser left on the stack" only on the settled read (the harness waits while `mCurrentFocus` is null, 300 ms polls, 5 s
at most). A read whose wait runs out with a chooser record still listed is a MISMATCH (5 s, well past the ~1.3 s
measured); with none listed, or an old record's unwaited read, what is left is unread (SKIP). Review round 1's three
runs: 5 of 5 ok each. lc4' and lc4'' are D73's net, run on demand with `live.ts --groups chooser` (lab, API 33); no
recurring run includes it yet (backlog T20b, a standing lab batch, and T20c, its schedule). Since T20b the standing
batch exists (the T20b amendment at the end); scheduling it is T20c.

**Consequences.** The residual above, a monkey that exits 0 with the chooser still in front (API 34 and later,
unmeasured), stands: the group runs on API 33 only. lc3's "one start" is not a check on this lab (`.MainActivity` is
singleTop: the alias's start is delivered to the top instance); what catches a `-p` start there is the chooser on the
stack.

## Amendment: the chooser group's premise, read before its cases (2026-11-10, T20a)

**Context.** The chooser group's cases rest on the lab's state, not on averi: lc1 and lc4'' need a chooser to rise
for `averilab://shared/…`, which a lab default (`mAlways=true`) or a missing `.Twin` (one handler) prevents; lc1 and
lc3 need none on the stack before their calls; lc4' and lc4'' start from the HOME activity the device resolves. When
one of these did not hold, the case SKIPped ("no chooser raised and none named", "the link raised no chooser") and
nothing said why, so a run on a stale lab read as a run with nothing to judge. The device batches read the same state
(`lab-chooser.ts`, `--check`), but live.ts must not import the owner-run batch layer, and a batch must not load the
live golden's modules.

**Decision.** A run on Android with a chooser case among the cases selected reads the premise once, before the cases
and before anything else touches the device, read only (`readPremiseInto` in `scripts/truth/chooser-premise.ts`, after
the lab's guard): `dumpsys package preferred` (no lab default for `dev.averi.lab`), `cmd package query-activities
--brief -a android.intent.action.VIEW -d averilab://shared/open` (two handlers, the lab's `.MainActivity` and
`.Twin`), `AndroidLab.focus` (no ResolverActivity or ChooserActivity record on the stack), and HOME_COMMAND (HOME
neither the platform's chooser — two Home apps, none chosen — nor the lab). The HOME rule is negative on purpose: it
is the judges' own (`launcherPremise` in `live-chooser.ts` wants the HOME activity in front and no lab or chooser
record on the stack, so a HOME that is the lab or the chooser always SKIPs there), so the premise never disagrees
with the cases, and a positive list of launchers would be a guess. Fresh but wrong for both alike: Settings'
FallbackHome (`com.android.settings/.FallbackHome`, HOME while the device is still locked after a boot). Each fact is
fresh, stale (with the owner's hand line) or unread; the record keeps them with the summary's lines
(`chooserPremise`), and the lines are said on stderr at once, so the owner can stop a run on a stale lab before its
cases.
- A stale fact: `CHOOSER PREMISE: stale — <every fact> — the run fails`, a hand line per stale fact under it, exit 1.
  The default's is the batches' own (`defaultHand`, given its cause: it "predates this run", and the APK is the
  checkout's build, `APK_PATH` in `lab-device.ts`, built first from the checkout root with `gradlew assembleDebug`
  under JDK 17, as no APK was pulled; a batch's line is unchanged, "predates the batch"). The handlers', the stack's
  and HOME's are new, each ending `then:` with the command that reads the premise again. The cases still run and are
  judged as before: a stale premise explains a SKIP, it does not replace it.
- A `--side` run fails on a stale premise too: the premise is the lab's state, the same whichever averi drives it, so
  a calibration on a stale lab proves no more than a run of this checkout.
- A last-chosen entry (`mAlways=false`, "Just once"'s, which no reinstall clears): a `Chooser premise: WARN` line only,
  as `--check`'s exit 6 is a warning.
- A read that fails, or proves nothing (no `Preferred Activities User N:` block, a lab entry with no mAlways line, no
  `N activities found:` line, no HOME component): that fact unread with adb's words, the premise `unread` when no
  fact is stale, never a throw, the exit code untouched.
- `--rejudge` prints the record's lines as they are and reads no device, and only when a chooser case is among the
  cases it judges (`--groups forms` over a chooser record prints no premise and fails on none). A record without the
  key prints nothing, so every record committed before T20a rejudges byte for byte as before (checked over all 699
  records under docs/ and tests/fixtures, with `--groups forms` and with every group, against 0b9cfbb0). A run and its
  rejudge read the record's labels in one place (`summarizeRecord` in `live-cases.ts`).

The readers both sides need moved, not copied, into `scripts/truth/chooser-readers.ts`, a leaf that imports nothing of
batch/ and nothing live-*: the preferred block's parse (`preferredIn`), the leak rule (`leaksOf`, `unflaggedOf`,
`lastChosenOf`), the handler query and its count (`handlersArgv`, `handlersIn`), the unread reads' words
(`preferredUnread`, `handlersUnread`), an entry as a line quotes it (`ENTRY_CHARS`, `entryText`), and the hand lines'
parts (`adbLine`, `defaultHand`, `checkHand`, `HAND_PREFIX`, `LAB_PACKAGE`, `PREFERRED_ARGV`). `lab-chooser.ts`
re-exports what it exported before and keeps its CallResult wrappers (`preferredOf`, `handlersOf`: a failed call
unread), behaviour unchanged. The
premise itself (its facts, lines and new hand lines) is live-side, in `chooser-premise.ts`, which no batch imports; it
reads the stack and HOME with `frontOf`, `homeOf` and `isChooser` in `live-chooser.ts`, the judges' own readers.

**Consequences.** A stale lab is now a named failure with its remedy, not a quiet SKIP. Not done here: nothing clears
the state (no reinstall, no key, no setting — the owner's hand lines do that), and no recurring run includes the group
yet (backlog T20b, a standing lab batch, and T20c, its schedule; since built, the T20b amendment below). Not run on a
device: the emulator was down when this was built, so the premise's lines are pinned on batch-10's API 33 reads and T7b's recorded launcher reads, through a
fake adb (tests/truth/chooser-premise.test.ts). What the tests pin is `readPremiseInto` (read, record, echo) and
`summarizeRecord` (the record's labels into the summary, shared with `--rejudge`); live.ts's own two call lines are
not pinned — its `readPremiseInto` call and the record it hands `summarizeRecord` (live.ts:264 and :288). Pinning them
would take a test that runs live.ts in its run mode. T16's device reads are in the same place: ADR 0044's T16
amendment pins device-state.ts's read over a fake exec, not live.ts's calls of it.

## Amendment: the standing lab batch (2026-11-11, T20b)

**Context.** The chooser group, D73's net (lc4', lc4'') among it, ran only when someone asked for it
(`live.ts --groups chooser`). The composition a device run needs around it lived in numbered batches kept outside the
repo (batch-11 to batch-13), each copying it: the lab build, the lab emulator's need, the handler counts, the chooser's
dirty window and its cleanup.

**Decision.** The composition has an in-repo home: `scripts/truth/batch/lab-run.ts`, run by
`npm run truth:lab -- --out <dir> --serial <lab emulator>`. It is built from the lab plumbing's blocks only and does
nothing to a device that the numbered batches did not do. Its run, through `runBatch`:

- the `lab` block (`labBlock` in lab-build.ts): this checkout's lab APK built, installed with `-r`, and proven to
  hold main's catalog;
- the `chooser` block. Its needs are the android need and the handler counts it rests on (`handlersNeed`: shared 2,
  cell 1). Its run: `--check` before (`readCheck` in lab-emu.ts, read only), then `live.ts --groups chooser` inside the
  chooser's dirty window, then the window's cleanup, which is `--check` after (`chooserStretch` in android-lab.ts,
  `cleanUp` in lab-emu.ts);
- the `forms` block: `live.ts --groups forms`.

`--groups chooser|forms|chooser,forms` picks the live blocks; the default is both. A run with no serial is refused
before anything is done (exit 2). A serial that is not the lab AVD is refused by the lab guard, as in every batch: each
block is INCONCLUSIVE, nothing is done to the device, and the run exits 2. Everything the run writes is under `--out`.

- A `--check` before that does not prove the lab clean (a lab default, a chooser in front, a read that failed) leaves the
  chooser group not run. Its line is a verdict, and its hand lines go to RESTORE, because the premise is not the batch's
  to fix.
- A default (`mAlways=true`) that `--check` after finds, where the `--check` before found none, is the run's own. It
  fails the batch by name, `chooser left a default: FAIL`, beside the cleanup's own FAIL line. The cleanup clears it by
  reinstalling the pulled APK (`clearLabEntry` in lab-emu.ts). That reinstall is why the batch is owner-run.
- The chooser block has a state file (`state.json`, run-dir.ts's protocol): the window marks it dirty when it opens.
  No probe keeps lab data here, so putting the state back is writing the file clean: at the run's end once the cleanup
  proved the lab, after a proven reinstall, or in the abort's window restore (which writes it before its own
  `--check`, as for a probe; a check that fails there still leaves RESTORE). A cleanup that does not prove the lab
  leaves the file dirty, and the next run is refused naming it.
- Each live block's verdict is main's rejudge exit code: 0 is PASS, 1 is FAIL. That covers an unknown MISMATCH, a stale
  chooser premise (T20a) and a SKIP that proves nothing (`summarize` in live-cases.ts). The block is judged only once
  its run is complete; an incomplete one gets the runner's backstop line.

**Consequences.** The net has a stable home and one command. Not done: no schedule (backlog T20c: a launchd job on the
owner's Mac, out of an agent's reach). It has not been run on a device: the emulator was down when it was built. Its
tests run it under runBatch over the shared fake lab (tests/truth/batch/lab-run.test.ts, lab-fakes.ts). An agent never
starts it, because its cleanup may uninstall and reinstall the lab app.
