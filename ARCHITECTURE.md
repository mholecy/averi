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
- **UI tree** (`ui-tree/`) — the normalized tree and everything asked OF it: selector resolution, `ElementSpec`, screen width, per-id rects, tap points. Knows no platform commands and no averi.yaml.
- **Flow Engine** (`flow/`) — interprets `averi.yaml` descriptors (login, navigation recipes), maintains a state model of "where the app is".
- **Verification Engine** (`verify/`) — asserts, the layout contract, rect/color/text parity, OCR, screenshot diffing.
- **Orchestration** (`run/`) — composes the two engines into one `verify` run: per-platform legs, error containment, the parity tables. It is its own layer precisely because it needs BOTH engines and neither may depend on the other.
- **MCP layer** (`mcp/`) — thin: tool schemas, descriptions, and one-line delegations. No logic.

**The rule that keeps this honest: dependencies point one way only** — `mcp → run → flow → verify → ui-tree → adapters`, with `util/` a leaf. Nothing below a layer may import from above it. That is checkable in one command, and it is what makes each layer independently testable:

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
    uiTree(): UiNode                // normalized accessibility tree
    tap(x, y): void
    longPress, swipe(direction|coords), typeText, pressKey(back/home/enter)
    setClipboard, openDeepLink(url)
    logs(since): string[]           // logcat / os_log for crash detection
}
```

Selector-based tapping is deliberately NOT on this interface: `tapElement(adapter,
selector)` (`ui-tree/tap-element.ts`) resolves the selector against the normalized
tree and calls `tap(x, y)`. Nothing in it is platform-specific, and both adapters
had implemented it identically — which forced the platform layer to import the
selector layer above it, inverting exactly the direction this section describes.

**Android implementation** — pure `adb`:
- screenshot: `adb exec-out screencap -p`
- UI tree: `adb shell uiautomator dump` (XML → normalized JSON). Fallback for Compose apps with poor semantics: coordinate taps from screenshots.
- input: `adb shell input tap/swipe/text/keyevent`
- install/launch: `adb install -r`, `adb shell am start` / `pm clear`
- logs: `adb logcat`

**iOS implementation** — `xcrun simctl` + one helper:
- screenshot: `xcrun simctl io booted screenshot`
- install/launch: `simctl install/launch/terminate`, `simctl get_app_container`, deep links via `simctl openurl`
- input & UI tree: `simctl` cannot tap. Two options:
  - **idb** (`idb ui tap/swipe/text`, `idb ui describe-all` for the AX tree) — lighter, recommended default.
  - **WebDriverAgent** fallback for cases where idb's AX output is insufficient — **implemented 2026-08-12** (React Native host-view identifiers): config-driven via `app.ios.treeSource: idb (default) | wda` in `averi.yaml`; new modules `src/adapters/wda.ts` (WDA server lifecycle) and `src/adapters/wda-source.ts` (nested-tree normalization into the same `UiNode` shape).
  - Design decision: hide this entirely behind the adapter so we can swap later. The abstraction held in practice: only `uiTree()` dispatches on the configured source; input and lifecycle stayed idb/simctl, and nothing above the adapter changed.

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
# Values resolve from process.env; a `.env.averi` file next to averi.yaml
# (gitignore it) is auto-loaded first, existing env vars taking precedence —
# so the project is self-contained and CI can still inject via real env.

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
- **`reach:` is an escalation ladder, not a script.** `detect` is re-checked after *each* flow in the list and the rest are skipped once it is satisfied, so `reach: [dismiss_post_login_prompts, login]` means "try the cheap idempotent one; escalate only if it did not work". "Did not work" covers both ways a rung can fail to deliver: completing without reaching the state, and *throwing* — a cheap prelude typically fails by timing out on a `tap:` for an interstitial that was not there, and aborting the ladder on that would leave the prelude working only on the runs that did not need it. A thrown rung is never swallowed: it is logged as `⚠ reach <flow>` with the reason, and the last rung's failure still fails the call. This is load-bearing, not a nicety: before it, listing a cheap flow ahead of a destructive one *guaranteed* the destructive one also ran — a `launch { clearState: true }` login burning a device registration on a session that was already alive, because one post-login interstitial defeated `detect` for a single probe (2026-08-26). Order the list cheapest-first.
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
| `tap / swipe / type_text / press_key` | Low-level escape hatch for ad-hoc exploration |
| `assert(spec)` | Declarative check: element exists/absent, text matches, rect geometry vs Figma-frame values (`rect` spec — deltas in % of screen width, `y` measured but never failed), fill color vs an expected hex (`color` spec — CIEDE2000 over the element's sampled region, default dE 8; hex only, token names resolve upstream), screenshot-diff vs. baseline < threshold |
| `verify(platforms?, state?, flow?, asserts, contract?)` | Runs the same sequence on the requested platforms (default: iOS **and** Android; legs always android-then-ios), returns per-platform screenshots + assert results; `contract` (layout-contract JSON) appends a per-anchor `## rect parity` geometry table, anchors carrying `bg`/`bg_dark`/`sample` add a `## color parity` table sampled from the legs' own screenshots (CIEDE2000: android-vs-ios primary at `tolerance_de` 8, vs-contract at 1.5×), and anchors carrying `text`/`text_dynamic` add a `## text parity` table reading the RENDERED copy and ink height back off those same screenshots with OCR (`tolerance_size_pct` 10) — numbers over impressions |
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

- **Waits, not sleeps**: every action polls the AX tree for the expected postcondition (configurable timeout); screen-stability heuristic (two identical consecutive screenshots) before `screenshot` returns.
- **Login edge cases**: wrong-PIN lockout protection (max 1 auto-retry, then stop and report — never brute-force a real backend), OTP steps supported via `prompt_human` step type or a test-backend hook (`otp: { source: "http://localhost:9090/last-otp" }`).
- **Determinism aids**: `clearState` per launch, `simctl status_bar override` / adb demo mode for clean screenshots, fixed locale/timezone options.
- **Crash detection**: every tool response includes `appAlive: bool`; flows fail fast with the relevant log excerpt.

---

## 9. MVP roadmap

1. **Weeks 1–3 — Adapter core**: adb + simctl/idb adapters, screenshot, tap/type/swipe, normalized `ui_snapshot`; MCP wiring; manual smoke test on your banking app.
2. **Weeks 4–6 — Flow engine**: YAML schema, `ensure_state`, branch/optional/wait, secret injection; login works end-to-end on both platforms after reinstall.
3. **Weeks 7–8 — Verification + skill**: `assert`, `verify`, log scan; write SKILL.md; dogfood with Claude Code on a real feature task.
4. **Weeks 9–10 — Packaging**: npm package, docs site; pilot with 2–3 friendly teams.
5. **v2**: `record_flow`, real devices, CI mode (GitHub Action).

## 10. Risks

- **Compose/SwiftUI semantics gaps** → AX tree may be sparse; mitigation: coordinate-tap fallback + a lint tool that reports missing `testTag`/`accessibilityIdentifier` (also a selling point: it pushes teams toward accessible apps).
- **idb maintenance risk** (Meta's investment fluctuates) → adapter abstraction keeps WDA as swap-in. Exercised 2026-08-12: the WDA tree source landed behind `app.ios.treeSource` with only `uiTree()` dispatching — the swap-in path is proven for the tree read, not hypothetical.
- **Overlap with mobile-mcp** → averi's value over raw taps is the flow-descriptor layer, cross-platform parity, and the maintained skill.
- **Secrets in a banking context** → local-only processing, redaction, and keychain integration must be in v1, not later.
