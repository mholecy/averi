import type { Device, DeviceAdapter, Key, LaunchOptions, UiNode } from '../../src/adapters/types.js';

export const node = (partial: Partial<UiNode>): UiNode => ({
  role: 'other',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  children: [],
  ...partial,
});

/** Each element gets a distinct rect so coordinate taps map back to one node. */
let nextY = 0;
export const resetLayout = () => {
  nextY = 0;
};
export const el = (partial: Partial<UiNode>): UiNode => {
  nextY += 20;
  return node({ rect: { x: 0, y: nextY, width: 100, height: 10 }, ...partial });
};

export const screen = (...children: UiNode[]): UiNode =>
  node({ role: 'container', rect: { x: 0, y: 0, width: 1000, height: 2000 }, children });

/**
 * Programmable fake device: named screens, tap-driven transitions.
 * `onTap(identifier)` mutates `current` to simulate the app reacting.
 */
export class FakeAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
  current: string;
  taps: string[] = [];
  typed: string[] = [];
  launches: ({ appId: string } & LaunchOptions)[] = [];
  appRunning = true;
  swipes: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  screenshots: Buffer[] = [];
  nextScreenshot: Buffer = Buffer.alloc(0);
  logLines: string[] = [];

  constructor(
    private screens: Record<string, UiNode>,
    start: string,
    private onTap: (id: string, self: FakeAdapter) => void = () => {},
  ) {
    this.current = start;
  }

  async uiTree(): Promise<UiNode> {
    return this.screens[this.current];
  }

  async tap(x: number, y: number): Promise<void> {
    const hit = (n: UiNode): UiNode | undefined => {
      for (const c of n.children) {
        const found = hit(c);
        if (found) return found;
      }
      const { rect } = n;
      const inside = x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      return inside && n.identifier ? n : undefined;
    };
    const target = hit(await this.uiTree());
    if (!target?.identifier) throw new Error(`FakeAdapter: nothing tappable at (${x},${y})`);
    this.taps.push(target.identifier);
    this.focused = target.role === 'textfield' ? target : undefined;
    this.onTap(target.identifier, this);
  }

  /** Last tapped textfield — typeText/clearText mutate its value like a real field. */
  focused: UiNode | undefined;

  async typeText(text: string): Promise<void> {
    this.typed.push(text);
    if (this.focused) this.focused.value = (this.focused.value ?? '') + text;
  }

  deletes: number[] = [];

  async clearText(count: number): Promise<void> {
    this.deletes.push(count);
    if (this.focused) {
      const remaining = (this.focused.value ?? '').slice(0, Math.max(0, (this.focused.value ?? '').length - count));
      this.focused.value = remaining === '' ? null : remaining;
    }
  }

  /**
   * Overrides what the "device" reports as its screen. Leave it unset and the
   * fake derives the size from the screen it is currently showing, so it
   * cannot contradict its own tree — production code now COMPARES the two
   * (verify/scale.ts), and a fake that disagreed with itself would quietly
   * make every test exercise the mismatch note instead of the table under
   * test. A test that wants a mismatch must ask for one.
   */
  viewportSize: { width: number; height: number } | undefined;

  async viewport(): Promise<{ width: number; height: number }> {
    if (this.viewportSize !== undefined) return this.viewportSize;
    const { width, height } = this.screens[this.current].rect;
    return { width, height };
  }

  async launch(appId: string, opts: LaunchOptions = {}): Promise<void> {
    this.launches.push({ appId, ...opts });
  }

  async isAppRunning(): Promise<boolean> {
    return this.appRunning;
  }

  async screenshot(): Promise<Buffer> {
    this.screenshots.push(this.nextScreenshot);
    return this.nextScreenshot;
  }

  async logs(): Promise<string[]> {
    return this.logLines;
  }

  disposed = 0;

  dispose(): void {
    this.disposed++;
  }

  // Unused by tests:
  async listDevices(): Promise<Device[]> { return []; }
  async install(): Promise<void> {}
  async terminate(): Promise<void> {}
  async openDeepLink(): Promise<void> {}
  async longPress(): Promise<void> {}
  async swipe(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    this.swipes.push({ from, to });
  }
  async pressKey(_k: Key): Promise<void> {}
  async setClipboard(): Promise<void> {}
}
