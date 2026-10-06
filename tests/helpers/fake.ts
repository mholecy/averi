import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import type { Device, DeviceAdapter, Key, KeyboardOracle, KeyboardWitness, LaunchOptions, SoftKeyboard, UiNode } from '../../src/adapters/types.js';
import type { RgbaImage } from '../../src/verify/capture.js';

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

/**
 * A decoded image of a given size whose pixels are never read: for fixtures
 * that exercise the png SCALE or the crop (verify/capture.ts, the text
 * table's regions) and never a colour. The empty buffer makes any pixel read
 * an out-of-range index, so a test that starts reading pixels fails loudly
 * instead of measuring zeros.
 */
export const sizeOnlyPng = (width: number, height: number): RgbaImage => ({ width, height, data: Buffer.alloc(0) });

export const screen = (...children: UiNode[]): UiNode =>
  node({ role: 'container', rect: { x: 0, y: 0, width: 1000, height: 2000 }, children });

/**
 * Programmable fake device: named screens, tap-driven transitions.
 * `onTap(identifier)` mutates `current` to simulate the app reacting.
 */
export class FakeAdapter implements DeviceAdapter {
  /** Assignable: the fake stands in for both platforms (a fill's keyboard dismissal, a verify run's legs). */
  platform: 'android' | 'ios' = 'android';
  /** Assignable, like `platform`: what a bound iOS adapter would report (the flow engine's wait hint reads it). undefined = unknown. */
  treeSourceKind: IosTreeSourceKind | undefined = undefined;
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
    // A SNAPSHOT, as both real adapters return (each read parses a fresh object
    // graph). Handing out the live screen let a node mutated by a later fake
    // `tap` rewrite what an earlier read "saw", which made the clear-on-focus
    // fill test unable to fail (review 2026-09-18, round 3).
    return structuredClone(this.screens[this.current]);
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
    const target = hit(this.screens[this.current]); // the LIVE node: typeText/clearText must mutate the real field
    if (!target?.identifier) throw new Error(`FakeAdapter: nothing tappable at (${x},${y})`);
    this.taps.push(target.identifier);
    this.tapPoints.push({ x, y });
    this.focused = target.role === 'textfield' ? target : undefined;
    this.onTap(target.identifier, this);
  }

  /** Where each recorded tap landed, in step with `taps` — for tests that care about the POINT, not only the node. */
  tapPoints: { x: number; y: number }[] = [];

  /**
   * The soft-keyboard oracle (KeyboardOracle) — ABSENT until a test attaches
   * one (`attachKeyboard`), as on the real adapters: iOS has none, Android has
   * one. A fake without it behaves like IosAdapter — taps unguarded, nothing
   * queried, `dismissKeyboard` presses enter — whatever `platform` says: the
   * interact layer reads the capability, not the label. Tests of the guard
   * and of the Android dismissal attach one; until 2026-10-04 every fake
   * carried the simulation and answered `unknown`.
   */
  keyboard: FakeKeyboard | undefined;

  /** Attach the oracle, optionally with its first answers; returns it for further scripting. */
  attachKeyboard(window: SoftKeyboard = { state: 'unknown' }, witness: KeyboardWitness = 'unknown'): FakeKeyboard {
    this.keyboard = new FakeKeyboard(window, witness);
    return this.keyboard;
  }

  /** The attached oracle, for a test that scripts it — the same object as `keyboard`, typed as present so a script needs no `!`. */
  get attachedKeyboard(): FakeKeyboard {
    if (this.keyboard === undefined) throw new Error('FakeAdapter: no keyboard oracle attached — call attachKeyboard() first');
    return this.keyboard;
  }

  /** Every key pressed, in order. */
  keys: Key[] = [];
  /**
   * Runs after the fake's own reaction to a key — for a test to move a node
   * (the re-layout an adjustResize activity does when the keyboard goes) or
   * to put the keyboard back (one that `back` does not hide).
   */
  onKey: ((key: Key, self: FakeAdapter) => void) | undefined;

  /**
   * Where `back` NAVIGATES when no keyboard is up, as on a device — the
   * hazard the keyboard guard's race ends in. Unset: back with no keyboard
   * does nothing (most tests have nowhere to go back to).
   */
  backTo: string | undefined;

  /** `back` hides a shown keyboard, as on a device; with none shown it navigates to `backTo` when that is set. */
  async pressKey(key: Key): Promise<void> {
    this.keys.push(key);
    if (key === 'back') {
      if (this.keyboard?.windowAnswers.current.state === 'shown') this.keyboard.windowAnswers.current = { state: 'hidden' };
      else if (this.backTo !== undefined) this.current = this.backTo;
    }
    this.onKey?.(key, this);
  }

  /** The live screen object, for a test's onKey/onTap to mutate (uiTree hands out snapshots). */
  live(): UiNode {
    return this.screens[this.current];
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
  /** When set, dispose() returns this — models an adapter whose release is asynchronous (the iOS wda variant). */
  onDispose: (() => Promise<void>) | undefined;

  dispose(): void | Promise<void> {
    this.disposed++;
    return this.onDispose?.();
  }

  // Unused by tests:
  async listDevices(): Promise<Device[]> { return []; }
  async install(_path: string): Promise<void> {}
  async terminate(): Promise<void> {}
  async openDeepLink(): Promise<void> {}
  async longPress(): Promise<void> {}
  async swipe(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
    this.swipes.push({ from, to });
  }
  async setClipboard(): Promise<void> {}
}

/**
 * One scripted source: a standing answer, a queue of answers for the NEXT
 * queries (for a state that changes between queries with no key pressed — a
 * stale window state clearing by itself; each one also becomes the standing
 * answer), and a count of how often it was asked (the cost the guard is
 * pinned to).
 */
export class ScriptedAnswer<T> {
  queue: T[] = [];
  queries = 0;
  constructor(public current: T) {}

  next(): T {
    this.queries++;
    const queued = this.queue.shift();
    if (queued !== undefined) this.current = queued;
    return this.current;
  }
}

/**
 * The fake's keyboard oracle: the two sources Android has, scripted alike —
 * the window state (with a frame) and the input method's own word.
 */
export class FakeKeyboard implements KeyboardOracle {
  /** What the "device" says about its soft keyboard — the window state. `unknown`: cannot tell. */
  readonly windowAnswers: ScriptedAnswer<SoftKeyboard>;
  /** The independent second opinion. `unknown` by default — "cannot tell" — so a test that does not set it gets the decision the window state alone makes. */
  readonly witnessAnswers: ScriptedAnswer<KeyboardWitness>;

  constructor(window: SoftKeyboard = { state: 'unknown' }, witness: KeyboardWitness = 'unknown') {
    this.windowAnswers = new ScriptedAnswer(window);
    this.witnessAnswers = new ScriptedAnswer(witness);
  }

  async state(): Promise<SoftKeyboard> {
    return this.windowAnswers.next();
  }

  async witness(): Promise<KeyboardWitness> {
    return this.witnessAnswers.next();
  }
}
