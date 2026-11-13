# 46. The iOS tree source is WebDriverAgent when it comes up

Status: accepted 2026-11-12 (performance backlog rows A41, decided by the owner, and A41a,
docs/plans/2026-10-30-performance-backlog.md). Golden unchanged: every recording pins its source. The next Gate C
checks the default block (see Acceptance).
Amended 2026-11-12 (A41b: a launch pre-warms WebDriverAgent just after `simctl launch`, never awaited, and only with
its build cached) — see the amendment below. Amended 2026-11-12 (A44: the probe's cadence before auto-tap, its
`clearState` launch last; an unproven required part makes the report INCONCLUSIVE) — its section. Amended 2026-11-13
(A40: residual 4 is kept; idb gets no non-ASCII path) — its section. Amended 2026-11-13 (A41d: a launch awaits
WebDriverAgent's bring-up before `simctl launch`, replacing A41b's background pre-warm) — the last section.

## Context

- Under idb, on scroll-bounded and scroll-bounded-footer, averi says Tapped (S sliver, O outside the scroll view,
  footer O) while the app logged nothing. That is a false success claim. ADR 0010 accepted it as residual 5 because
  idb lists no scroll-view clip. idb also lists no presented layer under blur-menu-stacked/-grouped (A38). A38
  recorded what is left as KNOWN, with the same way out every time: `treeSource: wda`.
- The golden's unsafe residue is idb 42 against WDA 6.
- Closing the gap on idb alone would need a screenshot check per idb tap (rejected on cost in ADR 0010), or a hybrid
  that reads both trees and cross-checks them. The hybrid was rejected: it reconciles two trees, and the signals are
  incomplete either way.
- The reason idb was the default was cost: the server instructions said WDA was "~2x slower". On the lab that is no
  longer true for warm use. Warm WDA reads and taps are no slower than idb's (A41's D0 table). Gate C on 2026-11-12
  took 1 707 s on WDA against 1 869 s on idb.
- WDA's remaining costs are its cold start (3–23 s on the first read), fill +0.7 s, ensure cold +2.7 s, and the need
  for Xcode and the `appium-webdriveragent` optional dependency.

## Decision

**`app.ios.treeSource` takes `auto`, `idb` or `wda`, and `auto` is the default. Under `auto` the adapter's first tree
read asks WebDriverAgent to come up. If it does, every call is WDA's for the adapter's life. If it does not, every
read is idb's for the adapter's life, and every reply that claims what it read carries one `⚠` line saying so.**

- ONE source per adapter (ADR 0032): `auto` picks one and never reconciles two trees. A later WDA failure is WDA's
  error, as under `treeSource: wda`, never a switch to idb.
- "Can be brought up" is `WdaTreeSource.bringUp`, which is `WdaServer.ensureRunning` within its own bounds: the
  package is present, the first build succeeds, and /status answers within its readiness bound. It is decided once,
  lazily, at the first tree read, and kept. There is no probe at startup or at `launch_app`. Pre-warming is A41b.
- The fallback is said twice. averi's stderr gets one line with WDA's whole error. Each claiming reply gets
  `⚠ read through idb: WebDriverAgent did not come up (<reason>; select_device again to retry) and idb lists no
  presented layer or scroll clip — a layer over the target or a clip cutting it was not judged`
  (`adapters/auto-tree-source.ts#idbFallbackNote`, carried by `DeviceAdapter.claimNote`). `<reason>` is the first
  clause of WDA's error, at most 80 characters (`fallbackReason`): `WebDriverAgent requires the appium-webdriveragent
  package`, `A WebDriverAgent answers /status on port 8100`, `WDA build failed`. The agent cannot read averi's stderr,
  so the reason travels in the reply. The claiming replies are `tap` with a selector, `type_text` with a selector (a
  fill), `scroll_until`, `assert`, `run_flow`, `ensure_state` and `verify`. The line is added in the run layer
  (`run/claims.ts#claimed`, `claimedError`): by the compositions for `assert`, `ensure_state`, `run_flow` and
  `verify`, and around the interaction's reply for `tap`, the fill and `scroll_until`. A failed engine run's error
  (`run_flow`, `ensure_state`) carries it too, as a new error with the caught one as its cause: it lists the ✓ lines
  of the taps and fills before the step that failed. A failed flow inside `verify` is a section of its reply, which
  the line closes. The refusal of a value only WDA types after a fallback carries the line as well (Typing, below).
  Any other refusal claims nothing and gets no note. Nothing is refused for the fallback itself.
- The retry is `select_device` of the same simulator. `registry.ts#select` drops a cached adapter that fell back
  (`DeviceAdapter.fellBack`, the one signal: `claimNote` is its words), so the next call builds a fresh `auto` adapter
  that asks WDA again. A re-select keeps every other adapter, as before.
- With the package missing, `WdaServer` now says so before the "first WDA build … takes minutes" line, not after it,
  and its refusal opens `WebDriverAgent requires the appium-webdriveragent package` (it opened `treeSource: wda
  requires`, which named a setting the `auto` user never wrote).
- Before the choice, what is asked without a tree read is idb's. The launch's application label comes from idb, as
  it did under the old default; WDA would answer `declined`, since it is not up. `kind` reads `idb` for the label's
  wording, and there is no settle cadence (the default 500). After the choice, `kind`, the settle cadence
  (ADR 0040), the system alert and the label are the chosen source's.
- Typing follows the choice (ADR 0037). `IosAdapter.typeable` is asked of the source per call. It is WDA_TYPEABLE
  until a fallback, and IDB_TYPEABLE after one, so a later value idb cannot type is refused before anything is sent.
  - A fill checks the value twice: before resolving the field, as always, and again after the resolution's read,
    before the focus tap (`interact/fill.ts#fillField`). If that read was the one that fell back, a value only WDA
    types is refused there with ADR 0037's refusal. There is no focus tap, no clear and no typing. The resolution
    before it may have run the keyboard guard, but a fallback reads idb's tree, which marks no keyboard, so that
    guard dismisses nothing there. ADR 0037's own sentence ("nothing tapped, cleared or typed") is the refusal's,
    unchanged.
  - A text that needs WDA, typed before any read (`type_text` without a selector, a flow's `type:`), makes the choice
    itself. If WDA does not come up, it is refused as idb refuses it. Nothing is typed.
  - `IosAdapter.typeText` is the backstop: a text only WDA types, reaching it over a source that fell back
    (`IosTreeSource.fellBack`), gets the same refusal instead of idb's trace. idb and the recorded source never fall
    back, so `treeSource: idb` is unchanged.
  - Each of these refusals, and any `typeable` refusal on an adapter that fell back
    (`interact/type-text.ts#assertTypeableOn`), ends with the claim note's line, so it is grep-able as `read through
    idb` and names the reason and the retry. One wording for idb's refusal: `adapters/ios-typing.ts#idbTypingRefusal`.
- `treeSource: idb` behaves as before, byte for byte. So does `treeSource: wda`, with one exception: a missing
  `appium-webdriveragent` package is now said before the first-build line, and its refusal opens `WebDriverAgent
  requires …` instead of `treeSource: wda requires …` (above). The registry caches per setting, so `auto`, `idb` and
  `wda` are three adapters.
- `app.ios.keyboardDismiss`'s load-time note (`flow/config.ts#inertKeyboardDismissNote`) is printed only for a
  project that pins `idb`. Under `auto` the list applies whenever WDA comes up.

## Residuals

1. Under a fallback, idb's blind spots stay: the false Tapped of ADR 0010 residual 5, and the presented layers A38
   left KNOWN. They are now said on the reply instead of hidden. A41c's hit test is the planned guard.
2. The first read of an `auto` adapter pays WDA's cold start: 3–23 s warm-built, minutes for the first build per
   Xcode. The worst case is a fresh machine. There the first read can block for more than 10 minutes before it
   either reads through WDA or falls back: the build's bound is 600 s, and the readiness bound (60 s for /status)
   comes after it. Pre-warming WDA at `select_device` / `launch_app` is A41b's.
3. A fallback leaves `app.ios.keyboardDismiss` inert without a load-time note, because the config cannot know the
   choice. The claim note does not name the keyboard.
4. After a fallback, a value only WDA types is refused before anything is sent: by the fill's second check, or by
   `type_text`'s own check. That refusal is ADR 0037's idb wording, and its remedy names `treeSource: wda`, which fails
   on this machine for the reason the note line after it gives. The way out is to fix that reason, then
   `select_device` again. That refusal is kept: idb has no path for such a value (A40, the last section).
5. Two adapters of one simulator, `auto` and `wda` (two projects, one server), each own a WdaServer on the same
   per-UDID port. That is the D41 situation of ADR 0032, unchanged.

## Acceptance

Golden Changed 0, because golden pins its source. Unit tests cover the choice, its caching, the fallback note and
typing. At the next Gate C (owner): the default block has ≤ 6 known unsafe, and its wall time is ≤ the idb block
+ 10 %.

## Amendment: A41b — WebDriverAgent pre-warmed, never awaited (2026-11-12)

**Measured first** (A41 probe, docs/truth/live-records/a41-probe/, main 7ca241d5): under `auto` the catalog's first tap
after `launch_app` took 4 333 ms against 1 157 for the same tap warm. WDA's bring-up inside it cost +3 131 ms. WDA's
cold start alone, first read, was 3 151 ms (n 5), the read after it 30 ms.

**Decision.** `IosTreeSource.prewarm?(): void` starts, in the background, what the first tree read would otherwise
start, and returns at once. It never throws and never rejects. Nothing awaits it.

- **Where: one place.** `IosAdapter.launch` asks it just after `simctl launch` returns, before the foreground wait,
  never before the launch: WDA's start racing the app's own launch is unmeasured. A launch on an adapter whose WDA is
  not up starts it there, beside the wait. A flow's `launch:` goes through the same method. Nothing else asks it, and
  `DeviceAdapter` has no such member: the tree source is iOS's, and the adapter's own launch is its one caller.
- **The departure from the row.** Backlog A41b said "pre-warm WDA at select_device / launch_app". There is no pre-warm
  at `select_device`, nor when the registry builds an adapter:
  - `select_device` takes no `configPath`, so it does not know the project's tree source (D41). A guess of `auto`
    would build an adapter of the wrong kind in a `wda` project: a second WdaServer on the same per-UDID port
    (Residual 5). Whichever started first would make the other's start fail with "A WebDriverAgent answers /status …
    but this session did not start it".
  - A pre-warm when the registry builds the adapter (tried in review round 1, removed after the code review) runs
    before `simctl launch` whenever `launch_app` is the session's first device call, the very case the probe
    measures. Under `auto` a start that fails in that race would pin idb for the adapter's life.
- **The cost.** A session that never launches, one that reads a tree first, or one that launches through
  `open_deep_link` alone, pays WDA's start at its first read, as it did before A41b.
- **`auto`.** `AutoTreeSource.prewarm` starts the choice itself (`source()`), the same single attempt the first read
  would start. The first read finds it made or joins it in flight. One bring-up, chosen once, and the outcome is the one
  that read would have met: WDA if it came up, else idb with the stderr line and the claim note (Decision, above). A
  failed pre-warm is no error of the launch that started it. It is the fallback, and its reason is the note's. A
  release during the choice is still the read's released error (`AutoTreeSource.choose`). Nothing is asked once a
  choice was started (`choiceStarted`) or the source released.
- **`wda`.** `WdaTreeSource.prewarm` calls `WdaServer.ensureRunning`, which is single-flight, so a read joins the start
  in flight. With WDA already up (`WdaServer.upGeneration`) it asks nothing, so a launch sends no `/status` probe. A
  failed pre-warm is dropped. The next read starts WDA again and fails in its own words, as every read on `wda` did.
- **`idb`**, and the differential harness's recorded source, have none: nothing is started.
- **Only with WDA's build cached** (`WdaTreeSource.buildCached`, `WdaServer.isBuilt`: an xctestrun under DerivedData's
  Build/Products, a directory listing). Without one, a pre-warm starts nothing, and the first read builds. The
  reasons:
  1. The build is `xcodebuild build-for-testing`, bounded at 10 minutes and CPU-bound. A pre-warm would run it beside
     the agent's own work, unasked, and possibly in a session that never reads a tree.
  2. What it saves is seconds: the time between the launch and the first read, against a build of minutes.
  3. Under `wda` a failed background build is dropped and the first read builds again: two builds where there was one.
  4. The "first WDA build … takes minutes" line would reach stderr during an unrelated tool call.
- The rule (cached build, run in the background, never reject, nothing once released) is one function,
  `adapters/prewarm.ts#startInBackgroundIfBuilt`, which both sources call.

**Behaviour that moves.**
- Under `auto`, a launch may see the choice made during its foreground wait. The wait asks idb's label until then and
  WDA's active app after it (both are answers the wait already handles). Its `source`, which words a deadline note's
  lag, is read when the wait starts, so it says idb's.

**Acceptance, restated (review r1, the orchestrator's decision; the owner re-runs `npm run truth:lab:ios:a41`).**
- *WDA tap no more than 100 ms slower than idb's*: plausible. The 300 ms cadence (ADR 0040's A41b amendment) takes
  about 200 ms off a WDA tap's settle, from 687 to about 490 ms against idb's 476.
- The first tap after `launch_app` is measured in two legs (scripts/perf/a41.ts, its summary), each with "first tap
  ok n/n" (the catalog's tap claimed: the app in front). Only leg (b) is judged:
  - *(a) as the probe ran, information only:* `select_device`, `simctl terminate`, `launch_app`, the tap at once. The
    summary prints first − warm and WDA's cold start against launch_app, with no verdict. The pre-warm overlaps only
    the launch's foreground wait, which the probe cannot time apart from the rest of launch_app, so any allowance
    would be a guess (review 2, the orchestrator's decision). The original "first ≤ warm + 500" is not reachable in
    this order while WDA's cold start exceeds the launch's foreground wait.
  - *(b) the acceptance:* a fresh session whose tap starts `WAITED_GAP_MS` (4 s: WDA's cold start, 3.1–3.6 s, and a
    margin) after `launch_app` replied, with no read before it: first ≤ warm + 500 ms, judged only when every gap from
    the reply was at least 3.5 s and no step fell back to idb (else unproven). The gap is counted from the reply, not
    the call: the pre-warm starts once `simctl launch` returned, before the reply, so WDA gets at least its whole
    measured cold start. Plausible: WDA is up by then, and the tap with WDA up measured 1 202 against 1 157 warm.
- *Foreground after launch ok n/n:* 5 fresh sessions, the last a `clearState` launch, each reading at once after
  `launch_app`: the read's root label is the lab app's (AveriLab) and WDA's active bundle is `dev.averi.lab`. It
  measures what is left of the overlap: WDA's start beside the launch's foreground wait.
- The `auto-tap` child grows by two short sessions a repeat (~20 s), about 86 → ~200 s, its expected length already;
  the probe stays about 25 minutes, under 30.

**Residuals of the pre-warm.**
- **The overlap with the foreground wait is unmeasured.** WDA's start (xcodebuild test-without-building, the runner's
  install and start) runs beside the launch's foreground wait. The A41 probe saw WDA start only after a launch had
  returned. Whether the app stays in front is proven only by the owner's re-run: the foreground leg (n ≥ 5, one
  `clearState`) and "first tap ok n/n" in both legs.
- **A failure while the launch settles pins idb.** Under `auto`, a bring-up that fails while the launch is still
  settling is the choice: idb for the adapter's life (a `select_device` retries). The probe's fellBack count shows it.
- **The D21 analog.** D21 found that an AX query too soon after a simulator boot wedges the simulator until a reboot.
  A pre-warm at a session's first `launch_app` can start XCTest automation (WebDriverAgent's runner) seconds after a
  boot, earlier than a first read would have. Whether that wedges AX the same way is unmeasured. Gate C boots and
  resets the lab simulator, so it would show there first.

**Residual 2, now.** A warm-built machine's first read after a launch pays only what is left of WDA's cold start after
`simctl launch`. A first read with no launch before it pays the whole start, and a fresh machine still pays the whole
first build at the first read.

## Amendment 2026-11-12 (A44): the probe cannot pass an unproven part, and its wipe comes last

Probe-2 (6f80d529) recorded no cadence trial. The foreground leg's `clearState` launch, on `auto-tap`'s first repeat,
removed the lab app's Documents/ (ADR 0047). The `cadence` child ran after it, and the lab app could not write its
state file. Yet the cadence child exited 0, and the report block said PASS, because it judged only missing files. The
300 ms cadence rests on probe-1's replay (0 wrong in 60).

- **Order.** The WDA block's children are baseline-wda, wda-cold, cadence, auto-tap (`A41_CHILDREN` in
  scripts/perf/a41.ts). The foreground leg wipes on auto-tap's last repeat (`clearsStateOn`). So the wipe is the
  block's last launch, and no later session runs on a wiped app. auto-tap is marked `wipes`, and a test fails if any
  child follows a child that wipes.
- **No trial is no measurement.** `a41-probe.ts --mode cadence` still writes its file with its errors. It exits
  `PROBE_UNPROVEN_EXIT` (3, the standing exit for unproven) when no trial was recorded (`cadenceExit`). The WDA block
  then says INCONCLUSIVE, naming it. A run with some trials and some errors exits 0. The report catches it instead:
  too few trials leave `cadenceJudgement` unproven, so the cadence part is unproven and the report block INCONCLUSIVE.
- **An unproven required part is INCONCLUSIVE.** The report now carries `unproven` (`unprovenOf`), each with its why:
  the cadence judgement `unproven`; leg (b) of the first tap unproven or not measured; the foreground leg on under 5
  launches or none with `clearState`. The summary prints `UNPROVEN: …` beside `MISSING: …`. lab-a41-ios.ts's report
  block is PASS only when nothing is missing and nothing is unproven. A measured no, such as a `keep` cadence, a leg
  (b) `no` or a launch not in front, is still a measurement.

Tests: tests/perf/a41.test.ts (the order and the `wipes` rule, the wiping repeat, `cadenceExit` and its code equal to
the standing one, `unprovenOf` over every leg-(b), foreground and cadence outcome, the UNPROVEN line, reportOf's
`unproven`); tests/perf/a41-report.test.ts (a trace with a few trials and errors, and one with none, read from files:
both unproven); tests/truth/batch/lab-a41-ios.test.ts (the new order, a cadence exit 3, the report block on unproven
alone and with missing). Hand mutants, each killed.

## Amendment: residual 4 is kept; idb gets no non-ASCII path (2026-11-13, A40)

Gate C on main 8e60cb2b read form-basic's b1d (a name with diacritics) and b7 (’ “ ” – …) LOUD on the idb block,
`loud-untouched` (docs/truth/live-records/a36-gate-c/ios-idb-forms.rejudge.log.txt): refused before anything was
sent, as residual 4 says. WDA fills both. A40 asked whether idb could
enter such a value without breaking the fill's landing rule (ADR 0023, interact/fill-landing.ts). It cannot, at an
acceptable cost, so the refusal stays. This is an analysis without a device run, and nothing in `src/` changes.

- **When it matters.** Only under `auto` after WDA did not come up (the package missing, its build failed, /status
  unanswered), or in a project that pins `treeSource: idb`. In both, the refusal is sent before any device call, and
  under `auto` it ends with the claim note's line, naming the reason and the retry. Fixing that reason and calling
  `select_device` again gives a WDA adapter that types the value. A second typing path would serve only the case where
  that fix is not made.
- **`idb ui text` cannot carry it.** idb maps the whole string through its KEY_MAP (U+0020–U+007E and `\n`) before
  it sends a key, and any other character fails the call (`adapters/ios-typing.ts#IDB_TYPEABLE`).
- **HID keys cannot either.** idb sends USB HID usage codes of a US layout. No code is `Š` or `’`. A dead-key or
  Option sequence depends on the simulator's keyboard layout, so each would need its own measurement.
- **The pasteboard stays rejected** (ADR 0037, Rejected, where its reasons and the bar for reopening it are written).

The refusal is ADR 0037's idb wording (`adapters/ios-typing.ts#idbTypingRefusal`), unchanged.
scripts/truth/live-known.ts keeps b1d and b7 KNOWN on `ios idb` as `loud-untouched` on `refused`. The bug note
docs/bugs/2026-10-15-lab-ios-type-text-cannot-type-non-ascii.md stays as ADR 0037 left it. No test changes: the rule
was already pinned.

## Amendment: A41d — a launch awaits WebDriverAgent before it launches (2026-11-13)

Supersedes the A41b amendment's mechanism (`IosTreeSource.prewarm`, `adapters/prewarm.ts`, both removed). Its
measurements, the restated acceptance and the A44 rules stand.

**Measured first.** Under `auto`, a session pays WDA's bring-up in its first tap right after `launch_app`. On an idle
machine (probe-2, 6f80d529, docs/truth/live-records/a41-probe-2/): launch_app 1 993 ms, the first tap 5 180 against
1 202 with WDA up, total 7 173 ms; WDA's cold start alone 3 101 ms. Under load (probe-3, 27ac6a68,
docs/truth/live-records/a41-probe-3/): launch_app 3 053, the first tap 7 245, total 10 298; cold start 3 595. The
background pre-warm hid little of the start. In probe-3, WDA's bring-up (+5 038 ms) outlasted leg (b)'s 4 s wait, and
leg (b) failed.

**Decision (the owner, 2026-11-13).** Trade launch_app latency, about +3 s (WDA's cold start), for the first tap's.
`IosTreeSource.startBeforeLaunch?(): Promise<void>` brings up what the first read would otherwise start. `IosAdapter.
launch` awaits it first, before `clearState`'s wipe, the accessibility defaults writes and `simctl launch`. A flow's
`launch:` goes through the same method. Nothing else asks it: no start at `select_device` (no `configPath`, D41) and
none when the registry builds an adapter.

- **`auto`** (`AutoTreeSource.startBeforeLaunch`) makes the choice, the same single attempt the first read would make
  (`source()`), and resolves once it is made. A choice in flight is joined. Once WDA was chosen, the start is WDA's
  own (below): nothing while WDA is up, and a WDA that died since is started again before the launch. Its failure is
  WDA's error and fails the launch, because a later WDA failure is never a switch to idb (Decision). Once idb was
  chosen, nothing is asked: a fallback is not retried (`select_device` is the retry). A WDA that does not come up at
  the choice is the fallback, exactly as at a first read: the stderr line, idb for the adapter's life, and the claim
  note on every claiming reply. The start resolves and the launch goes on over idb. The launch_app reply itself
  deliberately carries no note (the owner, 2026-11-13): launch_app claims nothing it read, and the next claiming reply
  carries the note.
- **`wda`** (`WdaTreeSource.startBeforeLaunch`) calls `bringUp` (`WdaServer.ensureRunning`, single-flight). WDA
  already up (`upGeneration`) asks nothing. A failure rejects with WDA's own error, as a read on `wda` fails. The
  launch fails before anything is wiped or launched (the owner, 2026-11-13), as `WebDriverAgent did not come up before
  launching <bundle> — nothing was wiped or launched: <WDA's error>`, with WDA's error as its `cause`. The failed start
  is not kept, so the next call tries again.
- **Bounded** by WDA's own bounds. With the build cached, a start is `xcodebuild test-without-building` and /status
  within the ready timeout (60 s, `WdaServer`'s `readyTimeoutMs`). There is no second timer.
- **Only with WDA's build cached** (`wda-tree-source.ts#mayStartBeforeLaunch`, both sources' one guard; a check that
  throws counts as not cached). Without one, the launch
  starts nothing and waits for nothing. The first read builds and chooses, as before A41b. The reasons are the A41b
  amendment's: a build is minutes of `xcodebuild`, and it should not run inside an unrelated `launch_app`.
- **idb**, and the differential harness's recorded source, have none: nothing is started.
- **Released** (a `select_device` mid-call): nothing is started. If the release comes while the choice is in flight,
  the start rejects with the released error, as a read would.

**Why this order does not race.** A pre-warm when the registry built the adapter (2cfce947, removed in 071de5ec)
started WDA *before* `clearAppData` and `simctl launch`, and ran beside them. A failure in that window was the
choice, and pinned idb for the adapter's life. Here, the start completes or fails before the wipe and the launch
begin. Nothing of the launch runs beside it, and its outcome is the outcome the first read would have met. The
accessibility defaults writes (ios.ts#prepareForOpen) come after WDA's start and before `simctl launch`, so they
still precede every launch.

**Behaviour that moves.**
- launch_app under `auto` and `wda`, with a cached build and WDA not up, takes WDA's start longer (about 3.1 s idle,
  3.6 s loaded). The first read or tap after it no longer pays it.
- Under `auto`, the launch's foreground wait now asks WDA's active app (`/wda/activeAppInfo`, D48) from the first
  launch on, not idb's label, because the choice is made before the wait. Both are answers the wait already handles.
- Under `wda` (and under `auto` once WDA was chosen), a WDA that cannot come up fails `launch_app` (or a flow's
  `launch:`) with the wrapped error above, and nothing is launched. Before, the launch succeeded and the first read
  failed with WDA's error.
- launch_app's tool description says it: with WebDriverAgent and its build cached, the first launch on a simulator
  first brings WDA up (seconds, at most 60 s, `WdaServer`'s ready timeout), and under `wda` a WDA that cannot come up
  fails the launch before anything is wiped or launched.

**Acceptance (the owner's `npm run truth:lab:ios:a41`).** scripts/perf/a41.ts judges two legs.
- *Leg (a), now judged on two bars (`legAAnswer`), both from the same run:*
  - The total: the median, per session, of launch_app + the first tap at once after it is ≤ launch_app with WDA up
    (`relaunch`) + WDA's cold start (`wda-cold`'s first read) + the first tap with WDA up + 500 ms. The bar is built
    from the same run's parts, not from a fixed figure: load moves them together, and the same total was 7 173 ms on
    probe-2 and 10 298 on probe-3. A pass means the bring-up costs no more than its serial parts + 500. Before A41d,
    both recorded runs exceeded that bar: probe-2 1 949 + 3 101 + 1 202 + 500 = 6 752 against 7 173, and probe-3
    2 839 + 3 595 + 2 207 + 500 = 9 141 against 10 298. The 500 ms is leg (b)'s allowance (noise, and the cold read's
    own ~100 ms read).
  - The tap: the first tap at once after launch_app is ≤ the first tap with WDA up + 500 ms, since WDA is up when
    launch_app replies. The summary prints 7 173 (`LEG_A_BEFORE_A41D_MS`) for information. Leg (a) is unproven
  when a step fell back to idb, or when a part is not measured (wda-cold's file included).
- *Leg (b), unchanged:* the tap `WAITED_GAP_MS` after launch_app replied is ≤ warm + 500, on 5 of 5 first taps ok. It
  is judged only with every gap ≥ 3.5 s and no fallback. WDA is now up at the reply, so the leg no longer depends on
  the margin probe-3 lacked.
- The waited leg's launch_app is kept per repeat in a41.json (`autoTap.waitedLaunches`, `waitedLaunch`), and the
  summary prints WDA's bring-up in launch_app (launch_app − relaunch) beside the bring-up in the first tap.
- A44's rules stand: any unproven required part, leg (a) now included, makes the block INCONCLUSIVE.

**Residuals.**
- **A session that launches and never reads pays the bring-up**, about 3 s per first launch on an adapter. So does a
  session that only launches and screenshots. A session that reads with no launch pays it at its first read, as
  before.
- **The D21 analog, unchanged and still unmeasured.** WDA's runner (XCTest automation) now starts before `simctl
  launch`, at the session's first launch_app, possibly seconds after a boot. That is earlier than A41b's pre-warm
  started it. Gate C boots and resets the lab simulator, so a wedge would show there first.
- **An uncached build** still pays the whole first build at the first read, as Residual 2 says.

Tests: tests/adapters/ios.test.ts (the start is awaited before any wipe, write or `simctl launch`; `wda`'s failure
fails the launch with nothing touched, in the wrapped words and with its cause; under `auto`, WDA is chosen before `simctl launch` and the first read and a
second launch start nothing; the fallback goes on over idb with the note; an uncached build waits for nothing; idb
has no start); tests/adapters/auto-tree-source.test.ts (awaited, single-flight with a read and with a second start,
fallback resolves with its note, uncached, a throwing build check, nothing after a fallback, WDA chosen and since gone
started again with its failure WDA's error, the ready-timeout bound through a real WdaTreeSource, released and
released mid-choice); tests/adapters/wda-tree-source.test.ts (up then reused, joins a read's start, bounded by the ready
timeout, a failure rejects and is not kept, uncached, already up asks nothing, released); tests/perf/a41.test.ts
(leg (a)'s two bars, each at its edge and 1 ms over, not measured without any part, unproven on a fallback;
`waitedLaunches`); tests/mcp/tool-descriptions.test.ts (launch_app's new sentence).
Each was hand-mutated and killed.
