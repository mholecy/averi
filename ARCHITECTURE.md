# Agent Mobile Verify — Architecture & Design Doc

*A free MCP server that lets coding agents verify their work on iOS Simulators and Android Emulators, including apps that require a login step.*

Working name: **`averi`** (Agent VERIfier). Rename freely.

---

## 1. Problem & positioning

Coding agents (Claude Code, Cursor, etc.) can now write native mobile code, but they can't close the loop: build → install → **get past login** → navigate → verify. Generic tools exist, but none of them solve the *stateful app* problem:

| Tool | Strength | Gap for us |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | Generic taps/screenshots via accessibility tree, iOS+Android | No app knowledge: agent must rediscover login every session |
| [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) | Agent writes/repairs Maestro YAML tests | Oriented at producing test suites, heavy dependency; login state still the agent's problem each run |
| Appium | Mature drivers | Per-project setup, slow, overkill for "verify my change" |

**Differentiator:** the tool is *app-aware*. Teams check an `averi.yaml` descriptor into the repo that declares how to reach known states (logged-in, specific screens). The agent calls one high-level tool — `ensure_state("logged_in")` — instead of fumbling through a PIN keyboard with 15 tap calls. That determinism + cross-platform parity + verification helpers is the product.

---

## 2. High-level architecture

```
┌────────────┐  MCP (stdio)  ┌──────────────────────────────────────┐
│ Coding     │◄─────────────►│  averi MCP server (local)            │
│ agent      │               │ ┌──────────────────────────────────┐ │
│ + skill    │               │ │ MCP layer (mcp/) — tool schemas  │ │
└────────────┘               │ └────────────────┬─────────────────┘ │
                             │ ┌────────────────▼─────────────────┐ │
                             │ │ Orchestration (run/)             │ │
                             │ │ one run across per-platform legs │ │
                             │ └────┬──────────────────┬──────────┘ │
                             │ ┌────▼─────┐   ┌────────▼──────────┐ │
                             │ │ Flow     │   │ Verification      │ │
                             │ │ Engine   │   │ Engine            │ │
                             │ │ (flow/)  │   │ (verify/)         │ │
                             │ └────┬─────┘   └────────┬──────────┘ │
                             │ ┌────▼───────┐          │            │
                             │ │ Interaction│          │            │
                             │ │ (interact/)│          │            │
                             │ └────┬───────┘          │            │
                             │ ┌────▼──────────────────▼──────────┐ │
                             │ │ UI tree (ui-tree/)               │ │
                             │ │ selectors, geometry, tap targets │ │
                             │ └────────────────┬─────────────────┘ │
                             │ ┌────────────────▼─────────────────┐ │
                             │ │ Device Adapter interface         │ │
                             │ └───┬──────────────────────┬───────┘ │
                             │ ┌───▼──────┐      ┌────────▼───────┐ │
                             │ │ Android  │      │ iOS            │ │
                             │ │ (adb +   │      │ (simctl +      │ │
                             │ │ uiauto)  │      │ idb/WDA)       │ │
                             │ └──────────┘      └────────────────┘ │
                             └──────────────────────────────────────┘
```

Clean separation of concerns:

- **Device Adapter** (`adapters/`) — the only layer that knows platform commands. One interface, two implementations. Everything above is platform-agnostic.
- **UI tree** (`ui-tree/`) — the normalized tree and everything asked OF it: selector resolution, `ElementSpec`, screen width, per-id rects, tap points, the viewport predicates (`geometry.ts`: intersects / absent / visible fraction / clipped edges). Knows no platform commands and no averi.yaml. Since 2026-10-04 the structured `ElementSpec` lookup is the selector grammar's own matcher over `conditionsOf(spec)` (exact match, `text` = label or value), not a second hand-written one — a differential test pins the two forms identical; the viewport predicates moved from `selectors.ts` to `geometry.ts` where the rest of the rect arithmetic is; and the "text is on screen but combined into one a11y element" hint, whose advice is assert vocabulary (`match:`), moved to `verify/text-hint.ts`.
- **Flow Engine** (`flow/`) — interprets `averi.yaml` descriptors (login, navigation recipes), maintains a state model of "where the app is". Its `tap:`/`fill:`/`scroll_until:`/`swipe:` steps are one-line callers of the interaction module; it converts the YAML vocabulary (`timeout: 2s`) before calling and owns the trace wording. Three modules since 2026-10-04: `flow/config.ts` is the schema, the types and the pure walks over them (reference validation, the container and destructive-flow rules, the launch-activity rule — parsing a payload loads no I/O); `flow/load.ts` is everything that touches the file system (which averi.yaml, where its build paths point, what the sibling `.env.averi` contributes) and returns `{ cfg, env }`; `flow/credentials.ts` turns config + env + the requested environment name into frozen credentials with the lazy `$name`/`${VAR}` expansion. Until that date credential values travelled through `process.env`: the loader wrote `.env.averi` into it (with module-level state to refresh what it had written), the resolver read `AVERI_ENV` out of it and the engine read every `${VAR}` out of it at step time — three modules on one hidden global, and `FlowEngine`'s interface silently included "construct me only after `loadProjectConfig`". Now `process.env` is read in one function (`loadProjectConfig`) and written nowhere; `EngineOptions.env` is required, so the ordering is a parameter. Because the file is no longer written into the process environment it no longer reaches child processes either: adb, xcrun and xcodebuild used to inherit the credentials; now they inherit the shell's environment only — and a name removed from `.env.averi` is gone on the next load (a removed `AVERI_ENV` used to keep running the old backend for the server's life), and one project's values no longer leak into another project loaded by the same server. The same day `stepsAreDestructive`'s safe-leaf list became a `satisfies` over every non-container, non-launch kind of `Step`: a new step kind missing from it fails `tsc` instead of silently costing a skipped recovery.
- **Interaction** (`interact/`) — since 2026-10-03, what it takes to ACT on an element, written once for the flow engine's steps and the MCP tools: ONE resolution policy (`resolve.ts`: zero-area nodes are never targets, a sole interactive match wins among several with a note, an optional rect-stable wait with a plain-ms budget, and a one-shot mode for the fill's value poller), tap, fill (focus delay, verified typing, the masked-value length rule; the post-fill keyboard dismissal is `keyboard.ts`'s, chosen by whether the adapter has a keyboard oracle), the soft-keyboard guard every tap on a resolved node goes through (`keyboard.ts`, same day; §8 — since 2026-10-04 one pure decision table judging every sample the guard and the post-fill dismissal take), scroll-until-visible with its clipped report, and the swipe vectors with the finger-vs-content meaning spelled out. Plain-ms options, no config or MCP type. The `ambiguous` mode is required on every resolution — the engine picks first (`FLOW_AMBIGUITY`), the MCP tap/type_text tools refuse with the candidate list — so the one place a policy could silently loosen is a type error. Before it, the engine held these as private methods and exported free functions, `ui-tree/tap-element.ts` held the tap, and the MCP tap/type_text tools used a second resolution policy (`resolveOne`: no zero-area filter, no wait, throw on ambiguity) for the same user operation.
- **Verification Engine** (`verify/`) — asserts, the layout contract, rect/color/text parity, OCR, screenshot diffing. `verify/capture.ts` is the one owner of three facts every pixel reading rests on: that the frame is SETTLED (two identical consecutive captures, one budget for the `screenshot` and `ensure_state` tools, the color, ocr and — since 2026-10-04 — screenshot-baseline asserts, and each `verify` leg); the png scale — derived once per frame, from the device screen first, and carried as one value with one failure wording to the color and text comparators, which keep their own fallback policy (color fails closed, text drops to the tree with a note); and the rect→png crop, one mapping with the clipped fraction beside it (the inset is the color sampler's option). Before 2026-10-02 the wait had two owners, the legs took a bare screenshot, and the scale was derived at four call sites; the screenshot-baseline assert was the one pixel reading that change missed — it took a bare screenshot until 2026-10-04, so the baseline it wrote and the frame it diffed could both be mid-animation (re-baseline any screenshot assert that was flaky under it). The pure tail of the capture — tree + png + device screen → the one measured frame — is exported as `measuredFrameFor`, and the comparator tests build their fixtures through it rather than re-spelling the scale derivation, so a change to what the capture feeds the scale cannot leave those tests green against stale fixtures. Each parity comparator's inputs are measured below the run layer — rect reads the tree, color the frame `capture.ts` measured, and text, since 2026-10-04, its own leg measurement: `verify/text-parity.ts#measureTextLeg` recognizes one leg's text anchors on that leg's own bytes and hands back the capture with its caveats — the png width travelling WITH the OCR results it normalizes (`TextOcr`), so a capture cannot carry one without the other — and `verify/ocr.ts#ocrEngineFor` is the one rule deciding whether a recognizer exists here, quoted by both the `ocr` assert and the text table. Until 2026-10-04 that measurement phase sat in `run/verify.ts` as a 50-line `runOcr` (the one measurement the run layer did itself, so it had to know OCR is keyed by anchor id and that the width is the ink normalizer, which the type did not enforce), and the engine-selection rule was written twice.
- **Orchestration** (`run/`) — composes the two engines into one `verify` run: per-platform legs, error containment, the parity tables. It is its own layer precisely because it needs BOTH engines and neither may depend on the other. Since 2026-10-03 `run/commands.ts` holds the single-platform tool compositions beside it — what one `ensure_state`, `run_flow`, `assert` or `launch_app` call does (config, engine, trace, health line, settled frame; the launch-activity lookup) — each taking a resolved adapter or an adapter-resolving callback, never the registry; and `runVerification` reads, parses and validates the layout contract itself from the path, before it resolves any adapter. Since 2026-10-04 the three parity tables are produced the same way: a fact table (`DIMENSIONS`) names, per dimension, what one leg contributes (a one-line collector — the tree, the measured frame, or the text capture via `measureTextLeg`) and what the section says when no leg could; comparing and formatting stay hand-written per dimension. A collector that throws costs its leg a note, never the run; per-leg notes print in platform order after the run-level ones (before 2026-10-04 the text table's OCR notes came first, in completion order).
- **MCP layer** (`mcp/`) — thin: tool schemas, descriptions, and one-line delegations. No logic. What a handler holds, as of 2026-10-03: its zod schema (including parsing the assert specs), its description, resolving the platform to an adapter through the registry (this layer's own state), one delegation — to an adapter method, `interact/`, `run/commands.ts` or `run/verify.ts`, with `flow/load.ts` answering the config questions (which build, which iOS tree source, where averi.yaml is) — and the response, worded by `mcp/tool-text.ts` or the callee. The `verify` handler is the widest: it loads the config, parses the specs and delegates. Until that date the handlers also wrote out the ensure_state/run_flow sequence, the assert health line, the contract file read and the install/launch config lookups. Since 2026-10-03 tool registration is a side-effect-free module (`mcp/tools.ts`: `createAveriServer({ registry, version })` builds the server and connects nothing), tested through the SDK's in-memory transport with a real client over a fake-adapter registry (`tests/mcp/tools.test.ts`); `mcp/server.ts` is the stdio entry only — real registry, shutdown handlers, connect — and is tested as a spawned process (`tests/mcp/server.test.ts`: version, tool count, exit 0 on SIGTERM). Before that the registrations sat beside a top-level `await server.connect(stdio)`, so no handler could be imported by a test.

**The rule that keeps this honest: dependencies point one way only** — `mcp → run → flow → interact → verify → ui-tree → adapters`, with `util/` a leaf. (`interact/` imports `ui-tree`, `adapters` and `util` only; it sits above `verify` in the order because `verify` must stay reachable from both engines without knowing how an element is acted on — the absent-in-viewport rule both need lives in `ui-tree/geometry.ts` for that reason.) Nothing below a layer may import from above it. That is checkable in one command, and it is what makes each layer independently testable:

```sh
grep -rn "from '\.\./" src | sed "s|:.*from '\.\./|  ->  |"
```

The rule earned its keep: the platform layer once imported the selector layer (for a `tapElement` that contained no platform code), and `flow/config.ts` had become the de-facto home of vocabulary — `ElementSpec`, `ElementAssert`, `parseDuration` — that neither flow nor config owns. Both inversions were invisible until the arrows were drawn.

Runs entirely locally on the dev machine (device access requires it); nothing talks to the cloud.

---

## 3. Device Adapter layer (raw adb + simctl/idb)

One interface, e.g.:

```
interface DeviceAdapter {
    listDevices(): Device[]
    install(appPath): void          // reinstall triggers login requirement
    launch(bundleId, clearState?): void
    terminate(bundleId): void
    screenshot(): Png
    uiTree(opts?: {settle?}): UiNode // normalized accessibility tree; `settle` = one-shot caller may wait out a "no window yet" transient (Android only; iOS ignores it)
    tap(x, y): void
    longPress, swipe(direction|coords), typeText, pressKey(back/home/enter)
    keyboard?: KeyboardOracle       // OPTIONAL capability (since 2026-10-04): present where the keyboard is a separate window `back` hides — Android; absent on iOS, where it is part of the tree. Absent = taps unguarded, nothing queried, blind dismissal is `enter`.
      state(): shown{frame} | hidden | unknown   // Android: one `dumpsys window displays`. Never throws.
      witness(): shown | hidden | unknown        // independent second opinion, asked only right before a keyboard `back`: one device-side filtered `dumpsys input_method` (the command is `INPUT_SHOWN_COMMAND` in `adapters/android.ts`). Never throws.
    setClipboard, openDeepLink(url)
    logs(since): string[]           // logcat / os_log for crash detection
}
```

Selector-based tapping is deliberately NOT on this interface: `tapElement(adapter,
selector)` (`interact/tap.ts`, formerly `ui-tree/tap-element.ts`) resolves the selector against the normalized
tree and calls `tap(x, y)`. Nothing in it is platform-specific, and both adapters
had implemented it identically — which forced the platform layer to import the
selector layer above it, inverting exactly the direction this section describes.

**Android implementation** — pure `adb`:
- screenshot: `adb exec-out screencap -p`
- UI tree: `adb shell uiautomator dump` (XML → normalized JSON). Fallback for Compose apps with poor semantics: coordinate taps from screenshots.
- input: `adb shell input tap/swipe/text/keyevent`
- install/launch: `adb install -r`, `adb shell am start` / `pm clear`. A launch names its entry point one of three ways: nothing (`monkey -c LAUNCHER`), an activity (`am start -n pkg/activity`, with the intent if one is given), or an intent alone (`am start -p pkg -a …` — scoped to the package, Android resolves the activity; since 2026-10-03). `am start` output carrying an `Error` line is thrown, not swallowed (it exits 0).
- logs: `adb logcat`

**iOS implementation** — `xcrun simctl` + one helper:
- screenshot: `xcrun simctl io booted screenshot`
- install/launch: `simctl install/launch/terminate`, `simctl get_app_container`, deep links via `simctl openurl`
- input: `simctl` cannot tap — `idb ui tap/swipe/text`, `idb describe` for the viewport.
- UI tree: behind its own seam since 2026-10-02 — `IosTreeSource` in `src/adapters/ios-tree-source.ts`, two methods (`read()` the normalized tree, `dispose()` what the source started) and two adapters at it; the node vocabulary (role map, normalizer, the kind enum) is the pure `src/adapters/ios-node.ts`, so parsing a payload or a YAML file loads no process code:
  - **idb** (`IdbTreeSource`, same file: `idb ui describe-all`, a flat AX list under a synthetic root) — lighter, the default.
  - **WebDriverAgent** (`WdaTreeSource`, `src/adapters/wda-tree-source.ts`: owns one `WdaServer` from `wda.ts`, parses `/source` through `wda-source.ts`) — **implemented 2026-08-12** for the React Native host-view identifiers idb's AX output drops; opt-in via `app.ios.treeSource: idb (default) | wda` in `averi.yaml`. The kind is one exported type (`IosTreeSourceKind`) that config, registry and adapters share; the registry keys its adapter cache on it and asks `createIosTreeSource(kind, udid)` for the matching source — which backend serves a kind is decided beside the seam, not in `mcp/`.
  - Design decision: hide this entirely behind the adapter so we can swap later. It held: only `uiTree()` ever dispatched on the source, and on 2026-10-02 the dispatch became an injected source — `IosAdapter` takes an `IosTreeSource` at construction, and `uiTree()` and `dispose()` are one delegation each. Per-node normalization (role map by own key, empty→null, rect rounding, zero rect) has one owner, `normalizeIosElement` (`ios-node.ts`), that both adapters call and one test table pins through both; before, each kept its own copy and each test file pinned its own. Input and lifecycle stayed idb/simctl, and nothing above the adapter changed.
  - **Shutdown contract (0.8.1; one hop longer since 2026-10-02):** the child WDA is owned by `WdaServer`, `WdaServer` by `WdaTreeSource`, the tree source by `IosAdapter`, adapters by `AdapterRegistry`, the process by `mcp/lifecycle.ts` — and disposal runs down that chain, never across it. `lifecycle.ts` handles SIGTERM/SIGINT/SIGHUP (Node runs no `exit` hook for a signal) and awaits `registry.shutdown()` within a 1.5 s budget; `IosAdapter.dispose` returns its tree source's `dispose()`, which for the WDA source is `WdaServer.shutdown()`: it stops the child and waits for the port to go quiet, killing the listener if xcodebuild's teardown did not reach the runner (it lives under `launchd_sim`, outside our process group). The idb source has nothing to release. After its dispose the WDA source is terminal: a read is refused, naming the deselection or shutdown, rather than starting a server nobody would dispose — reachable when a `select_device` evicts the adapter a running flow still holds. `process.exit(0)` then runs the old `exit` hook as a backstop. Not covered: SIGKILL, a second signal during the wait, a SIGTERM during the first WDA build (`docs/bugs/2026-09-18-wda-orphan-after-server-restart.md`).

**Normalized UI tree** is the key abstraction: `{role, label, identifier, value, rect, children}` identical on both platforms. Selectors like `id:login_pin_field`, `text:"Continue"`, `role:button label~"Pay.*"` resolve against it on either OS. This is what makes flow descriptors cross-platform.

---

## 4. Flow descriptors (`averi.yaml`)

Checked into the app repo. Describes app states and how to reach them. Every path it contains — the build paths below, the sibling `.env.averi`, the `.averi/baselines/` directory — resolves relative to **the descriptor's own location**, so the file is portable across working directories (nested repos, monorepos) and absolute paths stay untouched. Example for a PIN-login banking app:

```yaml
app:
  android: { package: md.victoriabank.myvb.dev, apk: app/build/outputs/apk/dev/debug/app-dev-debug.apk }
  ios:     { bundleId: md.victoriabank.myvb.dev, app: build/Debug-iphonesimulator/MyVB.app }

credentials:              # values come from env / OS keychain, never from YAML
  username: ${AVERI_USER}
  password: ${AVERI_PASSWORD}
  pin:      ${AVERI_PIN}
# Values resolve from the environment the load assembles: the real one, over
# a `.env.averi` file next to averi.yaml (gitignore it) — existing env vars
# take precedence, so the project is self-contained and CI can still inject
# via real env. The file is re-read on every tool call and never written into
# process.env (since 2026-10-04 it is a value the loader returns beside the
# config, flow/load.ts).

environments:             # optional: per-backend credential overrides
  dev:
    credentials:
      username: ${AVERI_DEV_USER}
  staging:
    credentials:
      username: ${AVERI_STAGING_USER}
# Layered ON TOP of `credentials:` per key, so shared secrets are declared once.
# Selected by the tool's `environment` argument, else $AVERI_ENV, else
# `defaultEnvironment:`. Resolved once per engine, so one run can never mix one
# environment's username with another's password, and an unknown name fails
# before the device is touched. The active environment is the first trace line:
# a wrong login name is rejected one screen AFTER it is typed, so without that
# provenance an environment mix-up is indistinguishable from a bad credential.

states:
  logged_in:
    detect:                       # how to recognize we're already there
      any:
        - element: { id: dashboard_root }
        - element: { text: "Accounts" }
    reach: [login]                # flows that get us there, cheapest first

flows:
  login:
    steps:
      - launch: { clearState: false }
      - branch:
          - when: { element: { id: pin_keyboard } }     # returning user → PIN
            do:
              # keypad matches per-digit keys by resource-id or, for keypads
              # without ids (common in Compose), by visible text:
              #   keypad: { text_pattern: "{digit}" }
              - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
          - when: { element: { id: username_field } }   # fresh install → full login
            do:
              - tap:  { id: username_field }
              - type: { value: $username }
              - tap:  { id: password_field }
              - type: { value: $password }
              - tap:  { text: "Log in" }
              - wait: { element: { id: pin_setup_screen }, timeout: 15s }
              - type_pin: { value: $pin, twice: true }   # set + confirm
      - optional:                                        # dismissable interstitials
          - tap: { text: "Not now" }        # biometrics prompt
          - tap: { id: promo_close }        # marketing popup
      - wait: { state: logged_in, timeout: 20s }

  goto_transfers:
    requires: logged_in
    steps:
      - tap:  { id: tab_payments }
      - tap:  { text: "New transfer" }
      - wait: { element: { id: transfer_form } }
```

Design points:

- **State detection before action.** `ensure_state` first checks `detect`; login runs only when needed. Handles the "reinstall wipes the session" case automatically, and is idempotent.
- **`reach:` is an escalation ladder, not a script.** `detect` is re-checked after *each* flow in the list and the rest are skipped once it is satisfied, so `reach: [dismiss_post_login_prompts, login]` means "try the cheap idempotent one; escalate only if it did not work". "Did not work" covers both ways a rung can fail to deliver: completing without reaching the state, and *throwing* — a cheap prelude typically fails by timing out on a `tap:` for an interstitial that was not there, and aborting the ladder on that would leave the prelude working only on the runs that did not need it. A thrown rung is never swallowed: it is logged as `⚠ reach <flow>` with the reason, and the last rung's failure still fails the call — after the recovery pass below. This is load-bearing, not a nicety: before it, listing a cheap flow ahead of a destructive one *guaranteed* the destructive one also ran — a `launch { clearState: true }` login burning a device registration on a session that was already alive, because one post-login interstitial defeated `detect` for a single probe (2026-08-26). Order the list cheapest-first.
- **…and it gets one pass backwards.** The mirror of the same finding, measured the same day: the ladder is one-shot and forward-only, so the LAST rung's aftermath can produce a screen an EARLIER rung exists to clear — login finishes, the biometrics interstitial arrives a network round-trip later, after that login's `optional:` windows closed — and nothing re-runs the cure. One `ensure_state` failed where an immediately repeated, identical one passed, because the second restarted the ladder from rung 1; the engine already held the cure and never applied it inside one call, which is not what "idempotent — call it freely" promises. So reaching the end of the ladder short of the state triggers at most one recovery pass (`↻ recovery` in the trace) over the earlier rungs, re-checking `detect` after each, then fails with the original error. "Reaching the end" covers both ways it happens: the final wait timing out, and the LAST RUNG THROWING. The second is the shape production configs actually have — a login flow's success criterion is written as the flow's own trailing `wait: { state: logged_in }`, so a late interstitial makes the rung throw and the final wait, where the pass would arm, is never reached. Covering only the first left the motivating incident failing exactly as it had before the fix (measured on device, `docs/bugs/2026-08-26-recovery-pass-skips-throwing-last-rung.md`). A throwing last rung also has its own `detect` to re-check — the one the ladder gives every other failed rung, for the flow that reaches the state and then dies on a later step. Both run before the throw is rethrown, and the caller still sees the ORIGINAL error; the pass is safe on a throw for the reason it is safe on a timeout, since what it re-runs is bounded by the two rules below rather than by why the ladder ended. Two bounds keep it from re-opening the hole above: the last rung is never re-run — it is the anchor the ladder climbs *to* — and every candidate must be provably non-destructive. "Provably" is a static walk (`flowIsDestructive`): `launch { clearState: true }` anywhere in a flow's steps including inside `branch`/`optional`/platform overrides, anything reachable through its `requires:`, an explicit `destructive: true`, an unknown flow, or a `requires` cycle. Every default in that walk points at "destructive", because being wrong there costs a second wipe while being wrong the other way only costs the latency this fix was already spending.
- **Failures carry their trace.** A flow that throws attaches the steps that already ran to the error message (`FlowError`). A bare "Timed out after 20000ms waiting for state logged_in" cannot tell you which reach flow ran, how far it got, or what it cost; the trace can, and it exists either way.
- **`branch` + `optional`** absorb the two realities of real apps: different login paths (fresh vs. returning) and random interstitials (rating prompts, promos, biometric sheets).
- **Secrets** are referenced (`${ENV}` or `keychain:` URIs), never stored. Server redacts them from logs and from anything echoed back to the agent — the agent never sees the actual PIN, it just calls the flow.
- Platform overrides per step where needed: `ios: { tap: {...} }`.
- Same file doubles as documentation of the app's navigation for humans.

---

## 5. MCP tool surface

Small, high-level surface — agents perform better with fewer, smarter tools:

| Tool | Purpose |
|---|---|
| `list_devices()` | Booted simulators/emulators, platform, OS version; `active` marks the current target |
| `select_device(platform, device)` | Pin the device the platform's tools target (default: first booted). A pinned device going offline is an error, never a silent fallback |
| `install_app(platform, path?)` | Uses `averi.yaml` defaults |
| `ensure_state(state, platform)` | The killer tool: detect → run flows → confirm. Returns final screenshot |
| `run_flow(flow, params?)` | Any named flow |
| `screenshot(platform, label?)` | PNG returned as MCP image content (agent's vision verifies it) |
| `ui_snapshot(platform, filter?)` | Normalized AX tree as JSON — cheap, text-based verification |
| `tap / swipe / type_text / press_key` | Low-level escape hatch for ad-hoc exploration. Since 2026-10-03 `tap` and `type_text` resolve a selector exactly as a flow step does: they wait up to the settle budget for the element to appear and hold still, so a selector matching nothing is a timeout, not an immediate "No element matches"; ambiguous matches are refused with the list; and a `type_text` whose tree cannot be re-read after typing fails rather than reporting an unverified fill |
| `assert(spec)` | Declarative check: element exists/absent, text matches, rect geometry vs Figma-frame values (`rect` spec — deltas in % of screen width, `y` measured but never failed), fill color vs an expected hex (`color` spec — CIEDE2000 over the element's sampled region, default dE 8; hex only, token names resolve upstream), screenshot-diff vs. baseline < threshold |
| `verify(platforms?, state?, flow?, asserts, contract?)` | Runs the same sequence on the requested platforms (default: iOS **and** Android; legs always android-then-ios), returns per-platform screenshots + assert results; `contract` (layout-contract JSON) appends a per-anchor `## rect parity` geometry table, anchors carrying `bg`/`bg_dark`/`sample` add a `## color parity` table sampled from the legs' own screenshots (CIEDE2000: android-vs-ios primary at `tolerance_de` 8, vs-contract at 1.5×), and anchors carrying `text`/`text_dynamic` add a `## text parity` table reading the RENDERED copy and ink height back off those same screenshots with OCR (`tolerance_size_pct` 10) — numbers over impressions; since 2026-10-03 a contract field one of those tables could not read (bad `bg`, `sample`, `text`, `text_dynamic` or `tolerance_*`) refuses the call before any leg starts, listing every such field, where it used to run both legs and print `FAILED:` in that table |
| `get_logs(platform, since, grep?, maxLines?)` | Crash/exception scan (logcat, os_log). Returns the last `maxLines` matching lines (default 400), headed by how many the grep matched and how many are shown — a `grep` alone is not a token budget |
| `record_flow(name)` *(v2)* | Watch manual/agent interaction, emit a draft flow YAML |

Verification philosophy: three tiers, cheapest first — (1) AX-tree asserts (fast, deterministic), (2) screenshot to the agent's own vision (semantic judgment), (3) pixel-diff vs. stored baseline (regression). The tool provides all three; the skill teaches when to use which.

---

## 6. Distribution & privacy

- averi is **free**: no license key, no accounts, no feature gating.
- Distribution: `npx -y averi` (or `npm i -g averi`; from a clone, `npx tsx`).
- Zero telemetry. Everything runs locally; screenshots, UI trees and secrets never leave the machine — an easy compliance story for banking clients.

---

## 7. The skill

Ships with the package (`averi` skill — copy into the app repo). SKILL.md teaches the agent the workflow, not the plumbing:

1. **Golden path**: build app → `install_app` → `ensure_state("logged_in")` → `run_flow`/low-level navigation to the changed screen → `screenshot` + `assert` → report with paired iOS/Android images.
2. **Rules**: always `ensure_state` instead of manual login; prefer `ui_snapshot` asserts over screenshots for text checks; use `verify` (default: both platforms) before declaring a cross-platform task done; on unexpected screen, take screenshot + `ui_snapshot`, try `optional` dismissals, else surface to the human; never ask the user for credentials — if a `${VAR}` is missing, tell them which env var to set.
3. **Recipes**: "verify a UI change", "reproduce a bug report", "check a flow after refactor", "update `averi.yaml` when navigation changes" (the agent maintains the descriptor as part of feature work — self-healing config).
4. Reference of tool signatures + `averi.yaml` schema.

---

## 8. Reliability details that make or break this

- **Waits, not sleeps**: every action polls the AX tree for the expected postcondition (configurable timeout); screen-stability heuristic (two identical consecutive screenshots, up to 5 re-captures 300 ms apart) before any frame is measured or returned — owned by `verify/capture.ts`, applied by the `screenshot` and `ensure_state` tools, the color, ocr and screenshot-baseline asserts, and the final frame of every `verify` leg, so a mid-animation frame is never the verdict (the legs took a bare screenshot until 2026-10-02, the screenshot-baseline assert until 2026-10-04 — that assert now pays the stability budget documented on `capture.ts`'s `STABILITY_*` constants where it took one capture; whether the frame actually settled is not reported, so a screen that never settles still yields its last frame). The same module derives the png scale once per settled frame. The tree-side wait has one owner too, since 2026-10-03: `ui-tree/read-tree.ts#pollTree` — one read per round, a failed read is a miss whose error the timeout quotes, a `PollMiss` keeps the last thing a round saw, the predicate's own errors propagate. `Verifier.poll`, `FlowEngine.pollUntil`, the state-detect probe and `interact/resolve.ts#resolveSettled` (the settle wait the flow steps and the MCP tap/type_text tools share) are its callers and own only their wording; before that they were three copies of the loop, and the probe's copy swallowed the read error, so a dead adb read as "not in state".
- **A tap on a resolved node is guarded against the Android soft keyboard** (2026-10-03; what is guaranteed, as of 2026-10-04: averi sends no `back` for keyboard reasons unless the input method does not deny a keyboard, and no tap on a point that BOTH sources place under a keyboard; when the window state is `unknown` the tap proceeds as it did before the guard, and when the witness cannot be asked `back` goes out on the window state alone): on Android the keyboard is a separate window, absent from the uiautomator tree, so a node under it resolves and settles like any other and a tap at its centre presses a key — measured on a login screen that day: a stray character in the password field, nothing submitted, the tap reported done. The adapter's keyboard oracle answers `keyboard.state()` (one `dumpsys window displays`, a few tens of ms — the measured figures are on `AndroidAdapter`'s `keyboardState` in `adapters/android.ts`; two witnesses in that dump must agree, the IME `InsetsSource` entry and `mIsImeShowing`, and anything else is `unknown` and changes nothing), and `interact/keyboard.ts#resolveClearOfKeyboard` — the one owner, behind `tapElement` and `fillField`'s focus tap — hides a covering keyboard with `back`, resolves the target AGAIN (the layout moves), checks once more and only then taps; a keyboard that stays is an error, never a loop. `back` cannot be made conditional on the keyboard still being up, so every failure after the key press says that back was pressed (it may have navigated), and the flow trace shows the `⚠` line before the `✗`. The result's note says so, and the flow trace gains one `⚠ tap` / `⚠ fill` line. `dismissKeyboard` presses `back` only when the keyboard is not reported hidden (it navigated away before). Since 2026-10-04 that `back` — the guard's and `dismissKeyboard`'s, one owner — is vetoed by an independent witness asked immediately before the key (`keyboard.witness()`: the input method's own `mInputShown`), because the window state was measured stale that day: for a few seconds after a tap that navigated away it still reported the keyboard with its full frame while `mInputShown` was already false. When the witness denies the keyboard nothing is sent on that one sample: the guard re-asks both sources every 500 ms for at most 3 s, taps once the window state stops covering the point (with a note about the wait), takes the normal dismissal if the witness turns to shown, and otherwise REFUSES (`KeyboardStateDisagreement`: neither back nor the tap was sent). Witness cannot tell → back as before the veto; the stale-window hazard remains on Android versions where `mInputShown` is not printed; measured on API 33 only. Coordinate taps are untouched; on iOS the adapter has no oracle, so nothing is queried and nothing changes there. Since 2026-10-04 (later that day) the whole decision — the window state's reading (covering the point / clear / unknown) × the input method's word × the phase (first look, re-check round, after the back, dismissal) → proceed / back / hold / refuse — is ONE pure function, `interact/keyboard.ts#keyboardAction`, tested one row per case, and the input method's word is required by the sample's type exactly when the window is covering. Every sample the guard takes (its first look, each re-check round, its look after the back) and the one `dismissKeyboard` takes (moved into keyboard.ts from fill.ts, where it had kept a second copy of the `unknown → back` rule) goes through it; each call site handles all four answers, sending the ones it has no move for to a loud error; and the one `back` goes out from ONE line in the codebase — the `pressKey('back')` inside `interact/keyboard.ts#judge`, the function that asks the witness, consults the table and presses. The two readings of `unknown` — fail open for a tap, back for a dismissal — are rows of that table, not decisions made before it. The oracle itself became an optional adapter capability the same day (§3): `tapElement` and `fillField` know nothing of witnesses, iOS implements nothing, and the test fake carries the simulation only when a test attaches it.
- **Login edge cases**: wrong-PIN lockout protection (max 1 auto-retry, then stop and report — never brute-force a real backend), OTP steps supported via `prompt_human` step type or a test-backend hook (`otp: { source: "http://localhost:9090/last-otp" }`).
- **Determinism aids**: `clearState` per launch, `simctl status_bar override` / adb demo mode for clean screenshots, fixed locale/timezone options.
- **Crash detection**: every tool response includes `appAlive: true | false | unknown` — `unknown` when the device could not be ASKED (adb/simctl timeout under load, device offline), which is deliberately not `false` (2026-09-18); flows fail fast with the relevant log excerpt.

---

## 9. MVP roadmap

1. **Weeks 1–3 — Adapter core**: adb + simctl/idb adapters, screenshot, tap/type/swipe, normalized `ui_snapshot`; MCP wiring; manual smoke test on your banking app.
2. **Weeks 4–6 — Flow engine**: YAML schema, `ensure_state`, branch/optional/wait, secret injection; login works end-to-end on both platforms after reinstall.
3. **Weeks 7–8 — Verification + skill**: `assert`, `verify`, log scan; write SKILL.md; dogfood with Claude Code on a real feature task.
4. **Weeks 9–10 — Packaging**: npm package, docs site; pilot with 2–3 friendly teams.
5. **v2**: `record_flow`, real devices, CI mode (GitHub Action).

## 10. Risks

- **Compose/SwiftUI semantics gaps** → AX tree may be sparse; mitigation: coordinate-tap fallback + a lint tool that reports missing `testTag`/`accessibilityIdentifier` (also a selling point: it pushes teams toward accessible apps).
- **idb maintenance risk** (Meta's investment fluctuates) → the tree read sits behind the `IosTreeSource` seam with two adapters, idb and WDA (§3). Exercised 2026-08-12 behind a flag; a seam since 2026-10-02 — changing the default tree backend is one constant, `DEFAULT_IOS_TREE_SOURCE` in `adapters/ios-node.ts`, not an edit to `IosAdapter` or the registry. Input (`idb ui tap/swipe/text`) is NOT behind it: a full idb exit still needs a WDA input path, which drags in session management (plan, decision 4).
- **Overlap with mobile-mcp** → averi's value over raw taps is the flow-descriptor layer, cross-platform parity, and the maintained skill.
- **Secrets in a banking context** → local-only processing, redaction, and keychain integration must be in v1, not later.
