# Troubleshooting averi output

Find the line or error you see, then act on it. Each entry gives the meaning, then the action.

## Traces and the ladder

- **`✗ <step> — failed — <reason>`**: the step that failed. Steps log only on success, so the line before it is the last step that worked, not the culprit.
- **`✗` followed by `⚠ reach <flow>`** inside an `ensure_state`: that rung failed and the ladder went on to the next one. It is not the headline error. Fix the rung anyway, because it only costs time.
- **`⚠ reach <flow>: this rung is DESTRUCTIVE`**: averi is about to wipe the app's data. **`⚠ clearState` + count**: it did. A count that climbs while you debug means stop re-running.
- **`⛔ reach <flow>` / `Refused to run reach flow …`**: averi refused a destructive rung because the screen was unreadable or still bare after a ~20 s second look. Nothing was wiped. Take a `screenshot` and retry once the screen has rendered. If the screen shows only unlabeled icons, it reads as bare too; `run_flow` the rung yourself if you mean it.
- **`⚠ detect: <condition> treated as not detected — …`**: a probe that read nothing usable (`(second look over 20 s)` on the second look). It is a diagnostic, not the failure.
- **`↻ recovery <state>`**: the earlier safe rungs ran once more because a late screen beat the ladder. **`↻ no recovery`**: the call's one pass was already spent. **`⚠ recovery` / `⚠ salvage`**: the pass reporting its own stumbles, never the cause.
- **`could not be checked`**: a state with no reach flows met an unreadable tree. Take a `screenshot` first.

## The tree is empty, bare or unreadable

- **`ui_snapshot` returns `[]` plus `0 matches for … in a tree of N nodes`**: the tree has content and none of it matches. If the screen may still be loading (a spinner, an overlay), confirm with an `assert` with a `timeout`, or with a `screenshot`.
- **`[]` plus `⚠ … the tree is bare`**: the tree is empty or unrendered. Take a `screenshot`. If the screen is rendered, the tree source is stuck; do not read the element as absent.
- **iOS `idb returned an empty accessibility tree …`** (a lone 0×0 `Application`): a stuck idb, or the first second after `launch_app`. If it says `retried once after 1 s`, it is still stuck. Recover in this order:
  1. `terminate_app`, then `launch_app` (only a new process recovers);
  2. the simulator reboot the error names;
  3. or `app.ios.treeSource: wda` as an alternative source.
- **Android `device <id> is not reachable: adb get-state says "device offline"`**: recover the emulator (wait for `adb devices` to show `device`, else `adb kill-server && adb start-server`). Do not call `ensure_state` meanwhile: its probes read nothing.
- **Android `is still settling`** (uiautomator's null root right after a launch): take a `screenshot` (it waits for stability), then retry.
- **Android `is reachable but SLOW`**: the host is under load. The app is not dead.
- **`absent` assert fails with "could not verify"**: the tree was bare. Absence is never passed on an empty screen.

## iOS: an `id:` misses an element that is on screen

Under the default `treeSource: idb`, this is expected:
- React Native `testID` on a static `Text` or a container is invisible, because idb returns only accessibility elements;
- the same applies to a SwiftUI identifier on an `.accessibilityElement(children: .contain)` container.

Do not restructure app code (a `Pressable` wrapper, blanket `accessible={true}`) to please the tool. Set `app.ios.treeSource: wda` in `averi.yaml`:
- `id:` then resolves on static text and containers, as on Android;
- taps, typing and install stay on idb/simctl;
- tree reads are ~2× slower, and the first WebDriverAgent build per Xcode version takes minutes and needs `xcodebuild`.

WDA comes from `appium-webdriveragent`, an optional dependency of averi. If an install skipped it (`--omit=optional`), the error names the package.

Alternatively, detect on a button or row id.

## Typing and fields

- **`⚠ fill … typing APPENDS`**: the field already held text and `clear` was off. The length check passed, but the content may be wrong. Add `clear: true`, unless a pre-filled value must survive.
- **A later step fails after any `⚠ tap` / `⚠ fill` line** (an unexpected value, a submit that never happened): suspect that tap first. Check the field values with `ui_snapshot`.
- **Placeholders** exist only while the field is EMPTY on iOS. Assert them before typing.

## Soft keyboard

### Android

Success lines (the step worked):
- `the soft keyboard covered <target>; hidden before tapping`: averi pressed `back`, found the target again and tapped it. A `press_key back` before the step is not needed.
- `… could not be read` after `back`: the step also succeeded.
- `… that the input method denied; waited Nms …`: the step also succeeded.

Failure lines:
- **`⚠ … back pressed` then `✗ … back did not close it`**: nothing was tapped. Run `ui_snapshot`, then `press_key back` once more, or tap a control above the keyboard.
- **`⚠ … back pressed` then `✗ After pressing back … Timed out`**: if no keyboard was really up, `back` navigated away. Look at the screen (`ui_snapshot` / `screenshot`) before you retry.
- **`⚠ … denied; nothing sent` then `✗ … Neither back nor the tap was sent`**: Android's two keyboard sources never agreed. Look at the screen, then tap again (or `press_key back` if a keyboard is visibly up). In a flow, add a `wait:` for something that only appears once the screen has settled.

### iOS (`treeSource: wda`)

averi never presses a key, because the return key submits. A covered target is hidden by tapping the first usable `app.ios.keyboardDismiss` entry, then tapped.

Success lines:
- `hidden by tapping id:"…" before tapping`
- `gone on the second look`
- `still up … but no longer over it`

Failure lines:
- **`no dismissal, nothing sent` / `none of the configured dismissals is usable …`** (each entry is listed with its reason): nothing was tapped.
  - From the tools: tap a neutral, non-interactive element (the screen title), then tap again.
  - In a flow: add such an element to `app.ios.keyboardDismiss`. Use a title or label, never a button; for a number pad's Done toolbar, add an `accessory: true` entry.
- **`tapped id:"…" to hide it, still covered`**: the dismissal was tapped ONCE and may have changed the screen. Take a `screenshot` before you retry, and configure a dismissal that works on this screen.
- **The keyboard's return key** (`tap: { label: search }`) is tappable. Use it only while `ui_snapshot` shows the `keyboard` band. After a `fill`, the keyboard is usually parked below the screen and a tap there lands off screen.

## Screenshots, pixels and visual checks

- **`⚠ frame:` / `the screen did not settle`**: the screen kept changing (an animation, a spinner, a clock, a caret). The picture is the last capture, and `color`/`ocr` asserts and baseline creation refuse it. Wait for the animation to end (in a flow, a `wait:` for what appears after it), or hide the live content. For `color`/`ocr`, stability is judged over the element only.
- **Baselines** are created on first use under `.averi/baselines/`. Creation is refused while the screen moves. Delete the file to re-baseline.
- **`color`/`ocr` budget**: 12 s by default (tree asserts: 3 s). An assert that keeps failing spends the whole budget, so pass `timeout` when you expect a failure. An element under the soft keyboard fails closed and names both rects; hide the keyboard first. OCR is macOS-only and fails closed elsewhere.
- **`scroll_until` reply names clipped edges**: the element only intersects the viewport (a floating nav bar is a common cause). Use `fully: true` before a `rect` assert or a screenshot, or you measure the clipped box.
- **`rect` fails with `… CONTENT width`**: no trustworthy screen width was found. On iOS, set `treeSource: wda`.
- **`text` assert fails, but the hint says the string is inside a longer label**: iOS merged the labels. Use `match`, not a bug report.

## Layout contracts (`verify` with `contract:`)

- **`## rect parity`**: per-anchor deltas against the contract and android-vs-ios. The `aspect` row compares shape even for sides nobody pinned. Set `aspect: false` on an anchor only when the platforms derive a side differently by design, e.g. Android's 48 dp touch-target floor against iOS's 44 pt, and write the reason beside it.
- **`## color parity`**: android-vs-ios at `tolerance_de` (8), against the contract at 1.5×. A single-platform run gets only the looser axis and can miss a real drift (measured dE00 10.19 under 12), so set `tolerance_de: 6` in the contract for single-platform work. Strokes of 1–2 px are invisible to sampling; judge them from the screenshot.
- **`## text parity`**: the `src` column says `ocr` (what renders) or `tree` (the weaker fallback). Use `text_dynamic: true` for amounts and dates.
- **`OCCLUDED` (`UNREAD, cause not determined`)**: averi could not read the anchor. Something covers it (usually the keyboard), or it has unreadable contrast, which is a finding in itself. Open the screenshot to tell which.
- **Copy differs between platforms**: check Figma for which side is right before fixing either.

## Launch and logs

- **Launch opened LeakCanary (or another launcher)**: set `app.android.activity`.
- **`Android started no activity in <package> for this intent`**: no exported activity matches the intent, or the matching one refused it. The quoted `am start said:` line tells which.
- **`get_logs`**: always pass `grep`, a case-insensitive regex. Only the last `maxLines` (400) come back, and the header says how many matched. Narrow the regex before you widen the tail.
