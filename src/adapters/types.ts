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

  tap(x: number, y: number): Promise<void>;
  tapElement(selector: Selector): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs?: number,
  ): Promise<void>;
  typeText(text: string): Promise<void>;
  pressKey(key: Key): Promise<void>;
  setClipboard(text: string): Promise<void>;

  /** logcat / os_log excerpt for crash detection. */
  logs(sinceMs: number): Promise<string[]>;

  /** Is the app process currently running? Used for appAlive crash detection. */
  isAppRunning(appId: string): Promise<boolean>;
}
