# averi.yaml reference

Read this when you write or change `averi.yaml`. The schema is strict: an unknown key is refused with an error that names it.

If the config is not in the working directory, pass `configPath:` to the tools. Paths inside the yaml resolve against the yaml file itself.

## Top-level keys

```yaml
app:
  android:
    package: com.example.dev
    apk: path/to.apk
    activity: .MainActivity     # pins the launch activity (e.g. when LeakCanary adds a second launcher)
  ios:
    bundleId: com.example.dev
    app: path/to.app
    treeSource: wda             # optional, default idb; see troubleshooting.md
    keyboardDismiss:            # optional, ordered; acts only with treeSource: wda
      - tap: { id: screen_title }   # a NON-interactive element whose tap does not submit
      - accessory: true             # the Done button on a number pad's accessory toolbar
credentials:                    # ${ENV} references only; never literal values
  username: ${APP_USERNAME}
  pin: ${APP_PIN}
environments:                   # optional: per-backend overrides of `credentials`
  staging:
    credentials: { username: ${STAGING_USERNAME} }   # declare only what differs
defaultEnvironment: staging     # optional; otherwise the `environment` argument or $AVERI_ENV
states: { … }
flows: { … }
```

Values come from the environment or from the gitignored `.env.averi` beside the yaml; real environment variables win. A flow refers to a credential as `$name`.

## States

```yaml
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompts, login]
```

- `detect` takes `element`, `state`, `any` and `all`. An element condition can carry `absent: true`, so "row visible AND card face gone" is expressible.
- A bare tree (a cold launch's decor or splash) decides no condition. An `absent:` check there is not satisfied, `ensure_state` looks again for up to ~20 s, and `wait:`/`branch:` keep polling. It is therefore safe to call `ensure_state` right after `launch_app`.
- A state with no `reach:` can only be detected. `ensure_state` on it fails if it is not already on screen.

## Flows

```yaml
flows:
  login:
    destructive: true        # optional; inferred from launch { clearState: true }
    requires: some_state     # optional; ensured before the first step
    steps: [ … ]
```

The recovery pass never re-runs a destructive flow, one whose `requires:` chain wipes, or the ladder's last rung.

## Steps

| Step | Shape | Notes |
|---|---|---|
| `launch` | `{ clearState: bool }`; Android: `activity`, `intent: { action, mimeType, extras }` | `clearState: true` wipes the app's data. An `intent` without an `activity` goes to the activity whose intent filter matches, and `app.android.activity` is not applied. iOS has no intents; use deep links. |
| `tap` | element spec, optional `timeout:` | Waits for the element to appear and hold still. |
| `type` | `{ value }` | Types into the focused field. |
| `fill` | element spec + `value`, optional `clear`, `dismissKeyboard` | Typing APPENDS: pass `clear: true` whenever the field may already hold text. |
| `type_pin` | `{ value, keypad: { id_pattern: "pin_key_{digit}" } }` or `text_pattern: "{digit}"`; optional `twice: true` | Only the digits are used; a value with no digits is refused. `twice` covers set + confirm. |
| `swipe` | `{ direction, times }` | |
| `scroll_until` | `{ element, direction?, maxSwipes?, timeout?, fully? }` | `fully: true` before you measure the element, since by default "visible" means it only overlaps the viewport. |
| `assert` | a LIST of element asserts: `assert: [ { element: { id: x }, text: "…" } ]` | A failure fails the flow, with the diff in the trace. |
| `wait` | `{ element: … }` or `{ state: … }`, `timeout:` | |
| `branch` | list of `{ when: <condition>, do: [steps] }` | The first matching arm runs. With no matching arm the step times out and fails, so cover every outcome. |
| `optional` | `[steps]` | A failing step is skipped (see below). |

For platforms that need different steps, a step can be `{ android: <step>, ios: <step> }`. Either side may be left out, and the step is then skipped on that platform.

## `optional:` semantics

- An optional `tap` gives its element ~1.5 s to appear, then skips. Add `timeout:` to widen that window for interstitials that wait on the network. The full window is spent on every run where the interstitial never shows, so prefer a gate state (see SKILL.md) when the alternative screen is detectable.
- A config refusal (an undeclared or empty credential, an unset `${VAR}`, a PIN with no digits) fails the flow even inside `optional:`.
- How to read the trace line of a skipped step:
  - `skipped … (not present)`: the element was never found on a readable screen.
  - Any other text in the parentheses is the step's own failure. For example, `Timed out … to appear` after the presence check saw the element means it WAS there and the step failed on it. That is a descriptor or app bug, not a missing interstitial.
  - `(last UI tree read failed: …)`: the device could not be read, which is not the same as the element being missing.

## `dismissKeyboard` on `fill`

- **Android:** presses `back` unless averi can see the keyboard is already hidden.
- **iOS (`treeSource: wda`):** taps the first usable `keyboardDismiss` entry when the keyboard is up, and otherwise does nothing. The trace says when the keyboard was left up.
- **iOS (`treeSource: idb`):** has no effect.

No key hides the iOS keyboard without side effects: the return key submits. A flow that needs to submit taps the app's own submit control.
