---
name: averi
description: Verify mobile app changes on iOS Simulators and Android Emulators through the averi MCP server — install, get past login with ensure_state, navigate, assert, and compare both platforms. Use it whenever you changed iOS/Android/React Native app code and need to confirm it works on a device, reproduce a mobile bug, write or fix the repo's averi.yaml (states, flows, login), or make sense of a failing averi trace (ensure_state, run_flow, verify, ⚠/✗ lines).
---

# averi — verify your mobile work on simulators

The averi MCP tools drive booted iOS Simulators and Android Emulators. The repo's `averi.yaml` declares the app's states (logged in, a given screen) and the flows that reach them, so you never log in tap by tap. The tool descriptions cover each tool's arguments and limits. This skill covers how to use the tools together, and what they do not tell you.

## Golden path (verify a change)

1. Build the app with the project's usual command.
2. `install_app(platform)` installs the build from the path in `averi.yaml`.
3. `ensure_state("logged_in", platform)` logs in only if needed (~1 s when already there).
4. Navigate to the changed screen: `run_flow` if a flow exists, else `tap` / `scroll_until` with selectors.
5. Check, cheapest first:
   - an element `assert` (`text`, `match`, `absent`, `error`): deterministic, no vision;
   - an `ocr` assert for what the element visibly renders;
   - `rect` / `color` asserts for geometry and fills;
   - a `screenshot` for your own visual judgment;
   - a screenshot baseline for regressions.
6. Close with `verify(state?, flow?, asserts)`. It runs on **both** platforms by default, so a cross-platform change is not done until it passes. Pass `platforms: ["android"]` or `["ios"]` only when the work is single-platform.

## Rules

- **Use `ensure_state`, never a manual login.** It is idempotent, so call it freely.
- **Never ask for credential values.** If a `${VAR}` is missing or empty, the error names it. Tell the user to export it or add `VAR=value` to the gitignored `.env.averi` next to `averi.yaml`. Traces show values as `***`.
- **"User does not exist" right after a correct-looking username usually means the wrong backend.** The trace names the active environment. Pick another with the `environment` argument (or `$AVERI_ENV`).
- **Numbers, not impressions.** Check margins with a `rect` assert in Figma-frame units, e.g. `{"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}}`, and fills with a `color` assert. Never eyeball them from a screenshot.
- **`text:` is exact, and iOS merges labels.** `.accessibilityElement(children: .combine)` turns a tile into one node, e.g. `"Select transaction type, 1 of 13 selected"`. An assert that must hold on both platforms uses `match` (an unanchored regex). The tree carries what accessibility is told; `ocr` checks what is rendered.
- **A field's `error` (the validation message paired to an input) exists on iOS only.** On Android, assert the message's own `text`. Disappearance (`absent: true`) is portable.
- **Quote selector values that contain spaces:** `text:"Sign in"`. `~` is an unanchored regex, so `text~"Sign in"` also matches `Sign in later`. Regexes in selectors, `match` and `grep` are JavaScript regexes, so inline flags such as `(?i)` are refused; `grep` is already case-insensitive.
- **A failed run has no `appAlive` line.** Before blaming a selector, run `get_logs(platform, grep: "fatal|exception|crash")` and take a `screenshot`. `appAlive: false` is a crash: report it with the log lines and do not retry blindly. `appAlive: unknown` means the device could not be asked; it is not a crash.
- **An unreadable or bare tree is not absence.** Take a `screenshot`. If the screen is rendered, the tree source is stuck, not the app, and nothing it says about absence counts. Follow the error's recovery order.
- **Read the `✗` line.** A failing trace ends with `✗ <step> — failed — <reason>`, which names the step that failed. The `⚠` lines before it are context.
- **Watch the wipe count.** `⚠ clearState` lines count app-data wipes, and on many apps each wipe is a backend re-registration. If the count climbs while you debug, stop re-running and read the trace.
- **Unexpected screen?** Take a `screenshot` and a `ui_snapshot`, then re-run `ensure_state`. If you are still stuck, show both to the user.
- **Several devices booted?** Run `list_devices`, then `select_device(platform, device)`. Otherwise tools use the first booted device.
- **`averi.yaml` is code.** When your change alters navigation and a flow breaks, fix the descriptor in the same change. Keep selectors on stable `id:`s.
- **A `⚠`/`✗` line or error you do not understand?** Read [references/troubleshooting.md](references/troubleshooting.md) before guessing.

## averi.yaml: states and the reach ladder

```yaml
app:
  android: { package: com.example.dev, apk: path/to.apk }      # paths relative to this file
  ios: { bundleId: com.example.dev, app: path/to.app }
credentials:
  pin: ${APP_PIN}                    # env refs only; the value comes from env or .env.averi
states:
  session_expired:                   # a recoverable logged-out screen
    detect: { element: { id: session_expired_title } }
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompts, pin_login, login]   # cheapest first, destructive last
flows:
  dismiss_prompts:
    steps:
      - optional: [ { tap: { text: "Not now", timeout: 10s } } ]
  pin_login:
    steps:
      - wait: { state: session_expired, timeout: 3s }   # fails fast elsewhere → next rung
      - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
      - wait: { state: logged_in, timeout: 20s }
  login:
    steps:
      - launch: { clearState: true }   # wipes the app's data
      - tap: { id: login_start }
      - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
      - wait: { state: logged_in, timeout: 20s }
```

- **`reach:` is a ladder.** averi tries the flows in order and re-checks `detect` after each one. A rung that fails escalates to the next and shows up as `⚠ reach <flow>`: fix that flow, because it only costs time. averi never reorders the ladder, so the order is your cost preference.
- **Destructive rungs go last.** `launch { clearState: true }` deletes the app's data. Mark a flow `destructive: true` when it wipes something averi cannot see: a logout, a one-shot code, server-side state.
- **Model every recoverable screen as a state with a cheap rung,** such as an inactivity logout with a PIN pad or a "welcome back" screen. If that screen is not declared, `logged_in` correctly reads "not logged in" and the ladder correctly escalates to the most expensive rung.
- **Late interstitials** (a biometrics or notifications offer that waits on the network) outlast an `optional:` tap's ~1.5 s window. Give the tap a `timeout:` or, better, wait on a gate state that detects either outcome:

  ```yaml
  states:
    post_login_gate:
      detect: { any: [ { element: { text: "Not now" } }, { state: logged_in } ] }
  # in the flow:
      - wait: { state: post_login_gate, timeout: 30s }
      - branch:
          - when: { element: { text: "Not now" } }
            do: [ { tap: { text: "Not now" } } ]
          - when: { state: logged_in }   # cover every outcome: a branch with no
            do: []                       # matching arm fails the flow
  ```

- **`↻ recovery` in a passing trace** means a late screen beat the ladder, and averi re-ran the earlier rungs that are safe to repeat, once. It is a safety net, not a design: fix the flow as above. `⚠ recovery` / `⚠ salvage` lines are diagnostics, never the cause of a failure.
- **Config mistakes stop the ladder.** An undeclared credential, an unset `${VAR}` or a PIN with no digits fails the call at once instead of escalating to a wipe.

For every step kind, the remaining schema keys and the semantics of `optional:`, `branch:` and `detect`, see [references/averi-yaml.md](references/averi-yaml.md).
