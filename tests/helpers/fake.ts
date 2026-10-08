import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { KEYBOARD_ROLE, type Device, type DeviceAdapter, type Key, type KeyboardOracle, type KeyboardWitness, type LaunchOptions, type Rect, type SoftKeyboard, type UiNode } from '../../src/adapters/types.js';
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

/** The band the keyboard draws over on the measured iOS login (K1, with the AutoFill bar; docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md), in points. */
export const IOS_LOGIN_BAND: Rect = { x: 0, y: 539, width: 402, height: 335 };

/** The keyboard's band as the WDA source marks it (tests/adapters/wda-source-keyboard.test.ts pins the parser): a KEYBOARD_ROLE node over `band`, the keys inside it. */
export const bandNode = (band: Rect = IOS_LOGIN_BAND): UiNode =>
  node({ role: KEYBOARD_ROLE, rect: { ...band }, children: [node({ role: 'container', rect: { x: 0, y: 583, width: 402, height: 233 } })] });

/** The keyboard leaving: the band is gone from `live` on the next read. */
export const dropBand = (live: UiNode): void => {
  live.children = live.children.filter((c) => c.role !== KEYBOARD_ROLE);
};

/** The app as measured (K5b): a tap on `id` hides the keyboard — for `FakeAdapter.onTap`. */
export const hidesKeyboardOn =
  (id: string): FakeAdapter['onTap'] =>
  (tapped, self) => {
    if (tapped === id) dropBand(self.live());
  };

/**
 * The measured iOS login, in points: the title `login_title` above the
 * keyboard, the password field (clear of the band unless `password` moves it
 * under), `login_submit` at {36,547,141,48} (centre 107,571) under
 * IOS_LOGIN_BAND (`band: null` is the same screen with the keyboard parked),
 * on an adapter as IosAdapter: no oracle, and `keyboardAdvice` set to the
 * sentence the refusals quote. `onTap` plays the app (`hidesKeyboardOn`).
 */
export function iosLoginFake({
  band = IOS_LOGIN_BAND,
  password = { x: 90, y: 479, width: 222, height: 20 },
  keyboardAdvice = 'ADVICE',
  onTap,
}: { band?: Rect | null; password?: Rect; keyboardAdvice?: string; onTap?: FakeAdapter['onTap'] } = {}): FakeAdapter {
  const fake = new FakeAdapter(
    {
      login: node({
        role: 'container',
        rect: { x: 0, y: 0, width: 402, height: 874 },
        children: [
          node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { x: 36, y: 291, width: 330, height: 24 } }),
          node({ role: 'textfield', identifier: 'login_password', rect: { ...password } }),
          node({ role: 'button', identifier: 'login_submit', rect: { x: 36, y: 547, width: 141, height: 48 } }),
          ...(band === null ? [] : [bandNode(band)]),
        ],
      }),
    },
    'login',
    onTap,
  );
  fake.platform = 'ios';
  fake.keyboard = undefined; // as IosAdapter: no oracle
  fake.keyboardAdvice = keyboardAdvice;
  return fake;
}

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
  /**
   * Opaque bytes, not a png — enough for every caller that never decodes.
   * Not empty (2026-10-08): DeviceAdapter.screenshot never returns 0 bytes,
   * and the capture refuses an adapter that does (verify/capture.ts#screenshotOf).
   */
  nextScreenshot: Buffer = Buffer.from('fake:screen');
  logLines: string[] = [];

  constructor(
    private screens: Record<string, UiNode>,
    start: string,
    /** Reassignable, like `onKey`: a test may script the app's reaction after building the fake (a dismissal tap that hides the keyboard, stage B). */
    public onTap: (id: string, self: FakeAdapter) => void = () => {},
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

  /** The in-tree model's sentence (DeviceAdapter.keyboardAdvice), unset until a test sets it — as on IosAdapter, which has one, and AndroidAdapter, which has none. */
  keyboardAdvice: string | undefined = undefined;

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

/** The guard's settle options, fast: `first` on ambiguity, a 200 ms budget, a 2 ms poll — the two keyboard-*.test.ts files share it (fill.test.ts keeps an identical one of its own). */
export const FAST = { ambiguous: 'first' as const, timeoutMs: 200, pollMs: 2 };

/** One ordered log of everything the keyboard guard and dismissal do to the device — and ask of its keyboard oracle, when it has one: `read`, `keyboard?`, `witness?`, `key:back`, `tap:x,y`. */
export function recorded(fake: FakeAdapter): string[] {
  const events: string[] = [];
  const wrap = <T extends object, K extends keyof T>(on: T, name: K, label: (...args: never[]) => string) => {
    const real = (on[name] as (...args: unknown[]) => Promise<unknown>).bind(on);
    (on as unknown as Record<string, unknown>)[name as string] = async (...args: unknown[]) => {
      events.push((label as (...a: unknown[]) => string)(...args));
      return real(...args);
    };
  };
  wrap(fake, 'uiTree', () => 'read');
  if (fake.keyboard !== undefined) {
    wrap(fake.keyboard, 'state', () => 'keyboard?');
    wrap(fake.keyboard, 'witness', () => 'witness?');
  }
  wrap(fake, 'pressKey', (key: string) => `key:${key}`);
  wrap(fake, 'tap', (x: number, y: number) => `tap:${x},${y}`);
  return events;
}
