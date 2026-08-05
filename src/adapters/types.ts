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

/** Normalized accessibility tree node — identical shape on both platforms. */
export interface UiNode {
  role: string; // normalized: button, text, textfield, image, container, ...
  label: string | null; // visible text / content description
  identifier: string | null; // resource-id / accessibilityIdentifier
  value: string | null; // current value (text field contents, toggle state)
  /** Validation message associated with an input, when the platform exposes one. */
  error?: string;
  rect: { x: number; y: number; width: number; height: number };
  children: UiNode[];
}

/**
 * Selector strings resolved against the normalized tree, e.g.
 *   id:login_pin_field | text:"Continue" | role:button label~"Pay.*"
 */
export type Selector = string;

export type Key = 'back' | 'home' | 'enter';

export interface DeviceAdapter {
  readonly platform: Platform;

  listDevices(): Promise<Device[]>;

  /** Reinstall triggers the app's login requirement — intentional. */
  install(appPath: string): Promise<void>;
  launch(bundleId: string, opts?: { clearState?: boolean }): Promise<void>;
  terminate(bundleId: string): Promise<void>;
  openDeepLink(url: string): Promise<void>;

  screenshot(): Promise<Buffer>; // PNG bytes
  uiTree(): Promise<UiNode>;

  /**
   * Visible screen size in the SAME units as uiTree rects (Android: pixels,
   * iOS: points) — the reference frame for viewport-visibility checks.
   */
  viewport(): Promise<{ width: number; height: number }>;

  tap(x: number, y: number): Promise<void>;
  /** Returns a disambiguation note when the selector matched multiple nodes. */
  tapElement(selector: Selector): Promise<string | undefined>;
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
  setClipboard(text: string): Promise<void>;

  /** logcat / os_log excerpt for crash detection. */
  logs(sinceMs: number): Promise<string[]>;

  /** Is the app process currently running? Used for appAlive crash detection. */
  isAppRunning(appId: string): Promise<boolean>;
}
