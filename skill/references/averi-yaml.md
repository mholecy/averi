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
- A bare tree (a cold launch's decor or splash; on iOS also SpringBoard's status bar and the launching app's icon) decides no condition. An `absent:` check there is not satisfied, `ensure_state` looks again for up to ~20 s, and `wait:`/`branch:` keep polling. On iOS with the default idb tree source, a `launch_app` or `launch:` also waits (up to 3 s) until the tree is the launched app's, not the app it covered. It is therefore safe to call `ensure_state` right after `launch_app` there. With `treeSource: wda` the launch does not wait (unmeasured there): after switching apps, `assert` the launched app's own screen before you trust an absence.
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
| `scroll_until` | `{ element, direction?, maxSwipes?, timeout?, fully? }` | `fully: true` before you measure the element, since by default "visible" means it only overlaps the viewport. With the soft keyboard up, the viewport is the screen above it. |
| `assert` | a LIST of element asserts: `assert: [ { element: { id: x }, text: "…" } ]` | A failure fails the flow, with the diff in the trace. |
| `wait` | `{ element: … }` or `{ state: … }`, `timeout:` | |
| `branch` | list of `{ when: <condition>, do: [steps] }` | The first matching arm runs. With no matching arm the step times out and fails, so cover every outcome. |
| `optional` | `[steps]` | A step whose element is absent is skipped, and so are the failures listed below. A config refusal, and a tap refused on a present element, fail the flow (see below). |

For platforms that need different steps, a step can be `{ android: <step>, ios: <step> }`. Either side may be left out, and the step is then skipped on that platform.

## `optional:` semantics

- An optional `tap` gives its element ~1.5 s to appear, then skips. Add `timeout:` to widen that window for interstitials that wait on the network. The full window is spent on every run where the interstitial never shows, so prefer a gate state (see SKILL.md) when the alternative screen is detectable.
- An optional step is skipped when its element is absent: the trace reads `skipped … (not present)`, meaning the element was never found on a readable screen.
- It is also skipped, with its own failure in the parentheses instead of `(not present)`, in exactly these cases:
  - **After averi acted on the keyboard:** a soft keyboard failure after averi pressed `back` (`Pressed back to hide the soft keyboard …`) or tapped a configured dismissal (`Tapped … to hide the soft keyboard …`). averi cannot know the element is still there.
  - **Lost on the second look:** the keyboard guard saw the element on a first look, and it did not resolve again on the second (`… the second look failed …`).
  - **An optional `scroll_until` that found its element but could not stop on it:** still clipped, covered, or under the status bar when the content ran out; under a soft keyboard that leaves nothing to judge; or out of swipes or time with the element seen.
  - **A tap (or a `type_pin` key) whose element never held still:** `Timed out … to hold still (found, but never at the same position in two consecutive reads)`.
  - **A tap whose element the presence check saw, then left:** `Timed out … to appear` from the tap itself, after the ~1.5 s presence check had found it. It WAS there.
  - **A `fill` whose field was found and tapped, but the text did not land:** `fill: typed N characters but the field shows M …`, `fill: field still shows … after clearing twice`, or the field could not be read back.
  - **A `fill` refused for a control character** before anything was tapped: `cannot type U+000A …`.
  - **A tap or typing command the device refused** (an `adb` or WDA error) on a found element.
  - **A failed `assert`:** `N/M flow asserts failed`.
  - **A step with no element of its own:** a `wait:` or `branch:` that timed out (the text names what it waited for); a `swipe` or a `type` that failed; a `launch` the device refused (not one with no `app.<platform>` section: that is a config refusal).
  - **A malformed `timeout:` on a nested step** (a `wait:`, `scroll_until`, or a tap inside a `branch:` or platform override): `Invalid duration "…"`. The optional `tap`'s own malformed `timeout:` is a config refusal.
  - **A dead device:** `(last UI tree read failed: …)`. The device could not be read, which is not the same as the element being missing.

  The first three are skipped deliberately. Each of the others means the step got further than "the interstitial is absent": the element was found, or the step failed on something other than an element. Read such a skip as a descriptor or app bug, not a missing interstitial.
- Everything else fails the flow even inside `optional:`:
  - A config refusal: an undeclared or empty credential, an unset `${VAR}`, a PIN with no digits, a `launch` with no `app.<platform>` section in averi.yaml, a malformed `timeout:` on the optional `tap` itself.
  - A tap (or a `fill`'s focus tap) on an element that IS on screen but that averi refuses to tap. The interstitial the step was written for is there. Refused means one of:
    - the element's centre is off screen, or under another node drawn over it with too little of the element showing;
    - on iOS, the element's centre is under the status bar (the top safe-area inset, 62 pt on a 402x874 iPhone). This counts as off screen even though the centre lies inside the rect you see on screen, because a tap there goes to the status bar. A target PINNED there, in no scroll view (a layout that ignores the safe area, such as a close button drawn at the very top), is refused every time, and no scroll moves it: the refusal says `it is pinned under the status bar`. Under `optional:` it fails the flow like any other refusal;
    - a soft keyboard covers it and averi sent nothing: on iOS no usable `keyboardDismiss` entry, on Android the window state and the input method disagree about the keyboard.

    The `✗` line reads `optional step not skipped: its element is present, but the tap was refused — …`. Inside a `reach:` ladder averi then checks `detect` once more: if the rung already reached the state, the call passes. Otherwise the ladder stops there and does NOT escalate to the next rung, even when a later rung might have cleared the screen, because that rung may be the destructive one. Fix the step (`scroll_until` the element first, configure a dismissal, or hide the keyboard in an earlier step) or the screen. For a target pinned under the status bar only the screen's layout can be fixed.
- Since 2026-10-08 a `tap:` or `fill:` on an element whose centre is off screen FAILS the flow, and since 2026-10-09 inside `optional:` too. Before, the tap went to a point off the screen and the step passed; the failure surfaced steps later. Add a `scroll_until` before such a step (`fully: true` if the element sits at a screen edge).

## `dismissKeyboard` on `fill`

- **Android:** presses `back` unless averi can see the keyboard is already hidden. If the input method says a keyboard is up but the window gives it no area (a keyboard still coming up, for example), it presses nothing and the trace has a `⚠ fill` line saying so. A floating Gboard is pressed `back` for like a docked one (measured on Android 13).
- **iOS (`treeSource: wda`):** taps the first usable `keyboardDismiss` entry when the keyboard is up, and otherwise does nothing. The trace says when the keyboard was left up.
- **iOS (`treeSource: idb`):** has no effect.

No key hides the iOS keyboard without side effects: the return key submits. A flow that needs to submit taps the app's own submit control.
