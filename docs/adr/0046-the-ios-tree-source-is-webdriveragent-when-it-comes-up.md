# 46. The iOS tree source is WebDriverAgent when it comes up

Status: accepted 2026-11-12 (performance backlog rows A41, decided by the owner, and A41a,
docs/plans/2026-10-30-performance-backlog.md). Golden unchanged: every recording pins its source. The next Gate C
checks the default block (see Acceptance).
Amended 2026-11-12 (A41b: WebDriverAgent is pre-warmed when the adapter is built and at a launch, never awaited, and only
with its build cached) — see the amendment below.

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
   `select_device` again.
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

**Decision.** `DeviceAdapter.prewarm?(): void` and `IosTreeSource.prewarm?(): void` start, in the background, what the
first tree read would otherwise start, and return at once. They never throw and never reject. Nothing awaits them.

- **Where.** `mcp/registry.ts#adapterFor` asks it of each adapter it builds, once. That is the first moment averi knows
  both the device and the project's tree source. `IosAdapter.launch` asks it again just after `simctl launch` returns,
  before the foreground wait, never before the launch (review r1: a start racing the app's own launch is unmeasured).
  A launch on an adapter whose WDA is not up starts it there, beside the wait. A flow's `launch:` goes through the
  same method.
- **`auto`.** `AutoTreeSource.prewarm` starts the choice itself (`source()`), the same single attempt the first read
  would start. The first read finds it made or joins it in flight. One bring-up, chosen once, and the outcome is the one
  that read would have met: WDA if it came up, else idb with the stderr line and the claim note (Decision, above). A
  failed pre-warm is no error of the tool that started it. It is the fallback, and its reason is the note's. A release
  during the choice is still the read's released error (`AutoTreeSource.choose`). Nothing is asked once a choice was
  started, made, or the source released.
- **`wda`.** `WdaTreeSource.prewarm` calls `WdaServer.ensureRunning`, which is single-flight, so a read joins the start
  in flight. With WDA already up (`WdaServer.upGeneration`) it asks nothing, so a launch sends no `/status` probe. A
  failed pre-warm is dropped. The next read starts WDA again and fails in its own words, as every read on
  `wda` did before.
- **`idb`**, and the differential harness's recorded source, have none: nothing is started.
- **Only with WDA's build cached** (`WdaTreeSource.buildCached`, `WdaServer.isBuilt`: an xctestrun under DerivedData's
  Build/Products, a directory listing). Without one, a pre-warm starts nothing, and the first read builds as before.
  The reasons:
  1. The build is `xcodebuild build-for-testing`, bounded at 10 minutes and CPU-bound. A pre-warm would run it beside the
     agent's own install, launch and idb reads, unasked, and possibly in a session that never reads a tree.
  2. What it saves is seconds: the time between the adapter's creation and the first read, against a build of minutes.
  3. Under `wda` a failed background build is dropped and the first read builds again: two builds where there was one.
  4. The "first WDA build … takes minutes" line would reach stderr during an unrelated tool call.
- **Not at `select_device`.** `select_device` takes no `configPath`, so it does not know the project's tree source
  (D41). A guess of `auto` would build an adapter of the wrong kind in a `wda` project: a second WdaServer on the same
  per-UDID port (Residual 5). Whichever started first would make the other's start fail with "A WebDriverAgent answers
  /status … but this session did not start it". The pre-warm starts at the first device tool after `select_device`,
  which builds the adapter: in practice `install_app` or `launch_app`.
- `prewarm` is classed `reads` in `ui-tree/read-handoff.ts#ADAPTER_SURFACE`. Starting WDA changes nothing the device
  shows. The probe's first taps found the lab app in front, with WDA started after its launch.

**Behaviour that moves.**
- Under `auto`, a launch may see the choice made during its foreground wait. The wait asks idb's label until then and
  WDA's active app after it (both are answers the wait already handles). Its `source`, which words a deadline note's
  lag, is read when the wait starts, so it says idb's.

**Acceptance, restated (review r1, the orchestrator's decision; the owner re-runs `npm run truth:lab:ios:a41`).**
- *WDA tap no more than 100 ms slower than idb's*: plausible. The 300 ms cadence (ADR 0040's A41b amendment) takes
  about 200 ms off a WDA tap's settle, from 687 to about 490 ms against idb's 476.
- The first tap is judged in two legs (scripts/perf/a41.ts, its summary), each with "first tap ok n/n" (the catalog's
  tap claimed: the app in front):
  - *(a) as the probe ran:* `select_device`, `simctl terminate`, `launch_app`, the tap at once. The adapter is built by
    `launch_app`, so the pre-warm gets launch_app's ~1.9 s before a cold start of ~3.1 s. The criterion is that the
    start overlaps the launch: first − warm ≤ max(0, WDA cold start − launch_app) + 500 ms (≈ 1.2 s + 0.5 on the A41
    numbers). The original "first ≤ warm + 500" is not reachable in this order, whatever the code does.
  - *(b) the waited leg:* a fresh session whose tap starts `WAITED_GAP_MS` (4 s, WDA's cold start 3.1–3.6 s and a
    margin) after `launch_app` started, with no read before it: first ≤ warm + 500 ms. Plausible: WDA is up by then,
    and the tap with WDA up measured 1 202 against 1 157 warm.
- *Foreground after launch ok n/n:* 5 fresh sessions, the first a `clearState` launch, each reading at once after
  `launch_app`: the read's root label is the lab app's (AveriLab) and WDA's active bundle is `dev.averi.lab`.
- The `auto-tap` child grows by two short sessions a repeat (~20 s), about 86 → ~200 s, its expected length already;
  the probe stays about 25 minutes, under 30.

**Residuals of the pre-warm.**
- **The race with the launch is unmeasured.** The registry's pre-warm runs when `launch_app` builds the adapter, so
  on a session's first launch WDA's start (xcodebuild test-without-building, the runner's install and start) runs
  beside `simctl launch`. The A41 probe saw WDA start only after a launch, never during one. Moving the launch's own
  pre-warm after `simctl launch` narrows it to that first launch. Whether the app stays in front is proven only by the
  owner's re-run: the foreground leg (n ≥ 5, one `clearState`) and "first tap ok n/n" in both legs. Until then it is a
  claim.
- **The D21 analog.** D21 found that an AX query too soon after a simulator boot wedges the simulator until a reboot.
  A pre-warm at `install_app`, or at any adapter's creation, can start XCTest automation (WebDriverAgent's runner)
  seconds after a boot, earlier than a first read would have. Whether that wedges AX the same way is unmeasured. Gate
  C boots and resets the lab simulator, so it would show there first.

**Residual 2, now.** A warm-built machine's first read pays only what is left of WDA's cold start after the time since
the adapter was built. A fresh machine still pays the whole first build at the first read.

