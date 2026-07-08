# Agent Mobile Verify — Architecture & Design Doc

*A subscription-based MCP server that lets coding agents verify their work on iOS Simulators and Android Emulators, including apps that require a login step.*

Working name: **`averi`** (Agent VERIfier). Rename freely.

---

## 1. Problem & positioning

Coding agents (Claude Code, Cursor, etc.) can now write native mobile code, but they can't close the loop: build → install → **get past login** → navigate → verify. Generic tools exist, but none of them solve the *stateful app* problem:

| Tool | Strength | Gap for us |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | Generic taps/screenshots via accessibility tree, iOS+Android | No app knowledge: agent must rediscover login every session; free/OSS, no revenue model |
| [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) | Agent writes/repairs Maestro YAML tests | Oriented at producing test suites, heavy dependency; login state still the agent's problem each run |
| Appium | Mature drivers | Per-project setup, slow, overkill for "verify my change" |

**Differentiator:** the tool is *app-aware*. Teams check an `averi.yaml` descriptor into the repo that declares how to reach known states (logged-in, specific screens). The agent calls one high-level tool — `ensure_state("logged_in")` — instead of fumbling through a PIN keyboard with 15 tap calls. That determinism + cross-platform parity + verification helpers is the paid product.

---

## 2. High-level architecture

```
┌────────────┐   MCP (stdio)   ┌──────────────────────────────┐
│ Coding     │◄───────────────►│  averi MCP server (local)     │
│ agent      │                 │  ┌─────────┐  ┌────────────┐ │
│ + skill    │                 │  │ Flow    │  │ Verification│ │
└────────────┘                 │  │ Engine  │  │ Engine      │ │
                               │  └────┬────┘  └─────┬──────┘ │
                               │  ┌────▼──────────────▼─────┐ │
                               │  │ Device Adapter interface │ │
                               │  └───┬─────────────────┬───┘ │
                               │ ┌────▼─────┐   ┌───────▼───┐ │
                               │ │ Android  │   │ iOS       │ │
                               │ │ adapter  │   │ adapter   │ │
                               │ │ (adb +   │   │ (simctl + │ │
                               │ │ uiauto)  │   │ idb/WDA)  │ │
                               │ └──────────┘   └───────────┘ │
                               │  ┌──────────────────────────┐│
                               │  │ License client → cloud   ││
                               └──┴──────────────┬───────────┴┘
                                                 ▼
                                        License/API service
                                        (subscription check)
```

Clean separation of concerns:

- **Device Adapter** — the only layer that knows platform commands. One interface, two implementations. Everything above is platform-agnostic.
- **Flow Engine** — interprets `averi.yaml` descriptors (login, navigation recipes), maintains a state model of "where the app is".
- **Verification Engine** — screenshots, accessibility-tree assertions, diffing.
- **MCP layer** — thin; exposes tools, no logic.
- **License client** — validates subscription; degrades gracefully offline.

Runs locally on the dev machine (device access requires it); only licensing talks to the cloud.

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
    tap(x, y) / tapElement(selector): void
    longPress, swipe(direction|coords), typeText, pressKey(back/home/enter)
    setClipboard, openDeepLink(url)
    logs(since): string[]           // logcat / os_log for crash detection
}
```

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
  - **WebDriverAgent** fallback for cases where idb's AX output is insufficient.
  - Design decision: hide this entirely behind the adapter so we can swap later.

**Normalized UI tree** is the key abstraction: `{role, label, identifier, value, rect, children}` identical on both platforms. Selectors like `id:login_pin_field`, `text:"Continue"`, `role:button label~"Pay.*"` resolve against it on either OS. This is what makes flow descriptors cross-platform.

---

## 4. Flow descriptors (`averi.yaml`)

Checked into the app repo. Describes app states and how to reach them. Example for a PIN-login banking app:

```yaml
app:
  android: { package: md.victoriabank.myvb.dev, apk: app/build/outputs/apk/dev/debug/app-dev-debug.apk }
  ios:     { bundleId: md.victoriabank.myvb.dev, app: build/Debug-iphonesimulator/MyVB.app }

credentials:              # values come from env / OS keychain, never from YAML
  username: ${AVERI_USER}
  password: ${AVERI_PASSWORD}
  pin:      ${AVERI_PIN}

states:
  logged_in:
    detect:                       # how to recognize we're already there
      any:
        - element: { id: dashboard_root }
        - element: { text: "Accounts" }
    reach: [login]                # flows that get us there

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
- **`branch` + `optional`** absorb the two realities of real apps: different login paths (fresh vs. returning) and random interstitials (rating prompts, promos, biometric sheets).
- **Secrets** are referenced (`${ENV}` or `keychain:` URIs), never stored. Server redacts them from logs and from anything echoed back to the agent — the agent never sees the actual PIN, it just calls the flow.
- Platform overrides per step where needed: `ios: { tap: {...} }`.
- Same file doubles as documentation of the app's navigation for humans.

---

## 5. MCP tool surface

Small, high-level surface — agents perform better with fewer, smarter tools:

| Tool | Purpose |
|---|---|
| `list_devices()` | Booted simulators/emulators, platform, OS version |
| `install_app(platform, path?)` | Uses `averi.yaml` defaults |
| `ensure_state(state, platform)` | The killer tool: detect → run flows → confirm. Returns final screenshot |
| `run_flow(flow, params?)` | Any named flow |
| `screenshot(platform, label?)` | PNG returned as MCP image content (agent's vision verifies it) |
| `ui_snapshot(platform, filter?)` | Normalized AX tree as JSON — cheap, text-based verification |
| `tap / swipe / type_text / press_key` | Low-level escape hatch for ad-hoc exploration |
| `assert(spec)` | Declarative check: element exists/absent, text matches, screenshot-diff vs. baseline < threshold |
| `verify_both(state, flow?, asserts)` | Runs the same sequence on iOS **and** Android, returns paired screenshots + assert results |
| `get_logs(platform, since)` | Crash/exception scan (logcat, os_log) |
| `record_flow(name)` *(v2)* | Watch manual/agent interaction, emit a draft flow YAML |

Verification philosophy: three tiers, cheapest first — (1) AX-tree asserts (fast, deterministic), (2) screenshot to the agent's own vision (semantic judgment), (3) pixel-diff vs. stored baseline (regression). The tool provides all three; the skill teaches when to use which.

---

## 6. Subscription & licensing

- Server requires `AVERI_API_KEY`. On startup it exchanges the key for a short-lived signed license token (JWT, ~24 h) and caches it — so flaky network doesn't block work; hard fail only after grace expiry (e.g. 7 days).
- Entitlements in the token gate features by plan: e.g. **Solo** (1 device at a time, core tools), **Team** (parallel `verify_both`, baseline storage, seats), **CI** (headless, usage-based minutes).
- Anonymous usage pings (tool-call counts only, no screenshots/secrets) for billing and abuse detection. Screenshots and UI trees never leave the machine — an easy compliance story for banking clients.
- Distribution: `npm i -g @averi/mcp` or brew; binary checks license at runtime, so piracy pressure is on the API, not the binary.

---

## 7. The skill

Ships with the subscription (`averi` skill). SKILL.md teaches the agent the workflow, not the plumbing:

1. **Golden path**: build app → `install_app` → `ensure_state("logged_in")` → `run_flow`/low-level navigation to the changed screen → `screenshot` + `assert` → report with paired iOS/Android images.
2. **Rules**: always `ensure_state` instead of manual login; prefer `ui_snapshot` asserts over screenshots for text checks; use `verify_both` before declaring a cross-platform task done; on unexpected screen, take screenshot + `ui_snapshot`, try `optional` dismissals, else surface to the human; never ask the user for credentials — if a `${VAR}` is missing, tell them which env var to set.
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
3. **Weeks 7–8 — Verification + skill**: `assert`, `verify_both`, log scan; write SKILL.md; dogfood with Claude Code on a real feature task.
4. **Weeks 9–10 — Licensing + packaging**: key service, npm package, docs site; pilot with 2–3 friendly teams.
5. **v2**: `record_flow`, baseline image storage (cloud, per-plan), real devices, CI mode (GitHub Action).

## 10. Risks

- **Compose/SwiftUI semantics gaps** → AX tree may be sparse; mitigation: coordinate-tap fallback + a lint tool that reports missing `testTag`/`accessibilityIdentifier` (also a selling point: it pushes teams toward accessible apps).
- **idb maintenance risk** (Meta's investment fluctuates) → adapter abstraction keeps WDA as swap-in.
- **OSS squeeze** (mobile-mcp is free) → moat is the flow-descriptor layer, cross-platform parity, and the maintained skill, not raw taps.
- **Secrets in a banking context** → local-only processing, redaction, and keychain integration must be in v1, not later.
