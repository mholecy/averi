/**
 * Device Adapter — the only layer that knows platform commands.
 * One interface, two implementations (Android/adb, iOS/simctl+idb).
 * Everything above this layer is platform-agnostic. See ARCHITECTURE.md §3.
 */

export type Platform = 'android' | 'ios';

export interface Device {
  id: string; // adb serial / simctl UDID
  platform: Platform;
  name: string;
  osVersion: string;
  state: 'booted' | 'offline';
}

/**
 * Screen size in the platform's own tree units — see `DeviceAdapter.viewport`,
 * which is the one place that reads it. Named here rather than in verify/ so
 * the reading and every use of it share a definition.
 */
export interface DeviceScreen {
  width: number;
  height: number;
}

/** Integer points (iOS) or pixels (Android), as the platform reports them. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rect of a node that has none: a synthetic root, a dump without bounds,
 * an element without a frame. A factory, never a shared constant — nodes are
 * mutated downstream (field-error pairing, geometry) and two nodes must not
 * share one rect object.
 */
export const zeroRect = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 });

/** Normalized accessibility tree node — identical shape on both platforms. */
export interface UiNode {
  role: string; // normalized: button, text, textfield, image, container, ...
  label: string | null; // visible text / content description
  identifier: string | null; // resource-id / accessibilityIdentifier
  value: string | null; // current value (text field contents, toggle state)
  /** Validation message associated with an input, when the platform exposes one. */
  error?: string;
  rect: Rect;
  children: UiNode[];
}

/**
 * Selector strings resolved against the normalized tree, e.g.
 *   id:login_pin_field | text:"Continue" | role:button label~"Pay.*"
 */
export type Selector = string;

export type Key = 'back' | 'home' | 'enter';

/** See `DeviceAdapter.softKeyboardWitness`: confirmed shown / denied / cannot tell. */
export type KeyboardWitness = 'shown' | 'hidden' | 'unknown';

/**
 * What a platform can say about its on-screen (soft) keyboard — see
 * `DeviceAdapter.softKeyboard`. Three answers, not "a frame or undefined",
 * because the two callers need different things from the missing frame
 * (2026-10-03): the tap guard only asks "does it cover my point" (hidden and
 * unknown both mean "tap as before"), but `dismissKeyboard` must tell "no
 * keyboard — pressing back would NAVIGATE" from "could not tell — keep doing
 * what was always done". One `undefined` would have forced one of them to
 * guess.
 *
 * `frame` is the screen rect the keyboard covers, in the SAME units as uiTree
 * rects (Android: pixels), so a tap point can be tested against it directly.
 */
export type SoftKeyboard =
  | { state: 'shown'; frame: Rect }
  | { state: 'hidden' }
  /** The platform did not answer, or answered in a shape the adapter does not recognise. Callers behave as before the question existed. */
  | { state: 'unknown' };

/**
 * Android-only intent parameters for `am start` — how a flow exercises entry
 * points other than the launcher (share sheet, custom actions). String extras
 * only: they cover the share/deep-entry cases; typed extras can come later.
 */
export interface LaunchIntent {
  action?: string; // e.g. android.intent.action.SEND
  data?: string; // intent data URI
  mimeType?: string;
  categories?: string[];
  extras?: Record<string, string>; // --es key value
}

export interface LaunchOptions {
  clearState?: boolean;
  /**
   * Android-only: exact activity to start (`.MainActivity`, fully-qualified,
   * or full `pkg/Activity` component). Without it launch falls back to
   * `monkey -c LAUNCHER`, which picks ARBITRARILY among a package's launcher
   * activities — debug builds bundling LeakCanary have two, so monkey may
   * open LeakCanary instead of the app. iOS rejects it (single entry point).
   */
  activity?: string;
  /**
   * Android-only, see LaunchIntent. With `activity` it is sent to that
   * component; without, it is scoped to the app's package (`am start -p`)
   * and Android resolves the activity — a launch nothing in the package
   * handles throws. iOS rejects it — use openDeepLink.
   */
  intent?: LaunchIntent;
}

export interface DeviceAdapter {
  readonly platform: Platform;

  listDevices(): Promise<Device[]>;

  /** Reinstall triggers the app's login requirement — intentional. */
  install(appPath: string): Promise<void>;
  launch(bundleId: string, opts?: LaunchOptions): Promise<void>;
  terminate(bundleId: string): Promise<void>;
  openDeepLink(url: string): Promise<void>;

  screenshot(): Promise<Buffer>; // PNG bytes
  /**
   * `settle`: a one-shot caller (an MCP tool, not a poller) may ask for one
   * bounded retry when the device answers "no window yet" right after a launch.
   * Pollers leave it off — their interval already is the retry.
   */
  uiTree(opts?: { settle?: boolean }): Promise<UiNode>;

  /**
   * Visible screen size in the SAME units as uiTree rects (Android: pixels,
   * iOS: points) — the reference frame for viewport-visibility checks, and the
   * only measurement of the screen that does not come from the tree, which is
   * what the png scale is derived from (verify/scale.ts). Those units are
   * load-bearing: verify/ divides png pixels by this width, so a platform that
   * started reporting the other unit would move every crop.
   *
   * MEMOIZED per adapter, success and failure alike — the panel does not
   * change under a session — and that is part of the contract, not a detail:
   * the layers above read it freely (per captured frame, per absent check)
   * instead of caching it themselves. The Verifier and the FlowEngine each
   * carried a memo of their own until 2026-10-02; both were pass-through
   * over this one, and both are gone. An adapter that re-read the device on
   * every call would make every pixel assert poll pay a shell-out.
   */
  viewport(): Promise<DeviceScreen>;

  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<void>;
  typeText(text: string): Promise<void>;
  /**
   * Clear up to `count` characters on EACH side of the cursor in the focused
   * field (backspaces then forward-deletes). Position-independent: a tap may
   * leave the cursor anywhere in the text, and neither platform offers a
   * reliable move-to-end (measured 2026-08-05: iOS taps land the cursor at
   * the glyph, Android MOVE_END left one char behind on the amount field).
   */
  clearText(count: number): Promise<void>;
  pressKey(key: Key): Promise<void>;
  /**
   * Is a soft keyboard on screen, and which rect does it cover? (2026-10-03.)
   *
   * Platform knowledge, hence here: on Android the keyboard is a separate
   * window that is NOT in the uiautomator tree, so a node under it resolves,
   * settles and reports a rect like any other — and a tap at its centre
   * presses a keyboard key (measured 2026-10-03, finportal login: the submit
   * button at (249,1466) under an IME frame starting at y=1285; one stray
   * character went into the password field, nothing was submitted, the tap
   * was reported done). What to DO about it is interact/keyboard.ts's policy;
   * this method only answers.
   *
   * NEVER throws and never guesses: a command that fails, times out or prints
   * something unrecognised is `unknown`. iOS always answers `unknown`, without
   * running anything — there the keyboard is part of the accessibility tree
   * (its keys are nodes), the covered-target problem has a different shape,
   * and it is out of scope as of 2026-10-03.
   *
   * Not memoized (unlike `viewport`): the answer changes with every focus.
   */
  softKeyboard(): Promise<SoftKeyboard>;
  /**
   * An INDEPENDENT second opinion on "is a soft keyboard shown" — no frame,
   * a different source than `softKeyboard()` (2026-10-04). It exists because
   * the first answer can be stale: measured that day on Android 13, right
   * after a tap that navigated away the window state still read "shown" with
   * the full frame for a few seconds, while the input method itself already
   * said it was not. interact/keyboard.ts asks this immediately before it
   * presses `back` for keyboard reasons, and only then — never on an
   * ordinary tap.
   *
   * A method of its own rather than an option on `softKeyboard()`: the
   * caller needs it at a different moment (after the frame has been tested
   * against the tap point), and one call that sometimes runs two commands
   * would hide the cost the policy is pinned to.
   *
   * Never throws: a failed, timed-out or unreadable query is `unknown`. iOS
   * always answers `unknown`, without running anything.
   */
  softKeyboardWitness(): Promise<KeyboardWitness>;
  setClipboard(text: string): Promise<void>;

  /** logcat / os_log excerpt for crash detection. */
  logs(sinceMs: number): Promise<string[]>;

  /** Is the app process currently running? Used for appAlive crash detection. */
  isAppRunning(appId: string): Promise<boolean>;

  /**
   * Release device-bound resources the adapter lazily started (today: the
   * WdaServer behind the iOS wda tree source). Optional and idempotent. Two callers: the registry when it
   * evicts an adapter (a rebind must not leak a server driving the old
   * device), and the process shutdown, which AWAITS it — so a returned promise
   * must resolve when the resource is actually released, not when the release
   * was queued. It may reject; both callers swallow the rejection, since the
   * adapter is gone either way.
   */
  dispose?(): void | Promise<void>;
}
