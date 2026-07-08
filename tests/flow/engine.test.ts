import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Device, DeviceAdapter, Key, Selector, UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine } from '../../src/flow/engine.js';

const node = (partial: Partial<UiNode>): UiNode => ({
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
const el = (partial: Partial<UiNode>): UiNode => {
  nextY += 20;
  return node({ rect: { x: 0, y: nextY, width: 100, height: 10 }, ...partial });
};

const screen = (...children: UiNode[]): UiNode =>
  node({ role: 'container', rect: { x: 0, y: 0, width: 1000, height: 2000 }, children });

/**
 * Programmable fake device: named screens, tap-driven transitions.
 * `onTap(identifier)` mutates `current` to simulate the app reacting.
 */
class FakeAdapter implements DeviceAdapter {
  readonly platform = 'android' as const;
  current: string;
  taps: string[] = [];
  typed: string[] = [];
  launches: { appId: string; clearState?: boolean }[] = [];

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
    this.onTap(target.identifier, this);
  }

  async typeText(text: string): Promise<void> {
    this.typed.push(text);
  }

  async launch(appId: string, opts: { clearState?: boolean } = {}): Promise<void> {
    this.launches.push({ appId, clearState: opts.clearState });
  }

  // Unused by the engine tests:
  async listDevices(): Promise<Device[]> { return []; }
  async install(): Promise<void> {}
  async terminate(): Promise<void> {}
  async openDeepLink(): Promise<void> {}
  async screenshot(): Promise<Buffer> { return Buffer.alloc(0); }
  async tapElement(_s: Selector): Promise<void> {}
  async longPress(): Promise<void> {}
  async swipe(): Promise<void> {}
  async pressKey(_k: Key): Promise<void> {}
  async setClipboard(): Promise<void> {}
  async logs(): Promise<string[]> { return []; }
}

const CONFIG = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  username: \${TEST_USER}
  password: \${TEST_PASSWORD}
  pin: \${TEST_PIN}
states:
  logged_in:
    detect:
      any:
        - element: { id: dashboard_root }
        - element: { text: "Accounts" }
    reach: [login]
flows:
  login:
    steps:
      - launch: { clearState: false }
      - branch:
          - when: { element: { id: pin_keyboard } }
            do:
              - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
          - when: { element: { id: username_field } }
            do:
              - tap:  { id: username_field }
              - type: { value: $username }
              - tap:  { id: password_field }
              - type: { value: $password }
              - tap:  { text: "Log in" }
              - wait: { element: { id: pin_setup_screen }, timeout: 1s }
              - type_pin: { value: $pin, keypad: { id_pattern: "setup_key_{digit}" }, twice: true }
      - optional:
          - tap: { id: promo_close }
      - wait: { state: logged_in, timeout: 2s }
  goto_transfers:
    requires: logged_in
    steps:
      - tap: { id: tab_payments }
`);

const FAST = { pollMs: 5, tapTimeoutMs: 200, waitTimeoutMs: 300, ensureTimeoutMs: 300, optionalTimeoutMs: 50 };

function buildScreens() {
  nextY = 0;
  const pinKeys = ['1', '2', '3', '4', '7'].map((d) =>
    el({ role: 'button', identifier: `pin_key_${d}`, label: d }));
  const setupKeys = ['1', '2', '3', '4', '7'].map((d) =>
    el({ role: 'button', identifier: `setup_key_${d}`, label: d }));
  return {
    pin_login: screen(el({ identifier: 'pin_keyboard', role: 'container' }), ...pinKeys),
    fresh_login: screen(
      el({ role: 'textfield', identifier: 'username_field' }),
      el({ role: 'textfield', identifier: 'password_field' }),
      el({ role: 'button', identifier: 'login_submit', label: 'Log in' }),
    ),
    pin_setup: screen(el({ identifier: 'pin_setup_screen' }), ...setupKeys),
    promo: screen(
      el({ role: 'button', identifier: 'promo_close' }),
      el({ identifier: 'promo_banner' }),
    ),
    dashboard: screen(
      el({ identifier: 'dashboard_root' }),
      el({ role: 'text', label: 'Accounts' }),
      el({ role: 'button', identifier: 'tab_payments' }),
      el({ role: 'button', identifier: 'transfer_form' }),
    ),
  };
}

beforeEach(() => {
  process.env.TEST_USER = 'alice@bank.md';
  process.env.TEST_PASSWORD = 'hunter2secret';
  process.env.TEST_PIN = '1234';
});

afterEach(() => {
  delete process.env.TEST_USER;
  delete process.env.TEST_PASSWORD;
  delete process.env.TEST_PIN;
});

describe('ensureState', () => {
  it('is a no-op when the state is already active', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const trace = await new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in');
    expect(fake.taps).toEqual([]);
    expect(trace).toEqual([{ action: 'state logged_in', detail: 'already active' }]);
  });

  it('returning user: PIN branch taps the keypad and reaches the dashboard', async () => {
    let entered = '';
    const fake = new FakeAdapter(buildScreens(), 'pin_login', (id, self) => {
      const digit = id.match(/^pin_key_(\d)$/)?.[1];
      if (digit) {
        entered += digit;
        if (entered === '1234') self.current = 'dashboard';
      }
    });
    const trace = await new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in');
    expect(fake.taps).toEqual(['pin_key_1', 'pin_key_2', 'pin_key_3', 'pin_key_4']);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached' });
  });

  it('fresh install: full login branch with PIN set + confirm', async () => {
    let setupTaps = 0;
    const fake = new FakeAdapter(buildScreens(), 'fresh_login', (id, self) => {
      if (id === 'login_submit') self.current = 'pin_setup';
      if (id.startsWith('setup_key_')) {
        setupTaps++;
        if (setupTaps === 8) self.current = 'dashboard'; // 4 digits × 2 rounds
      }
    });
    await new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in');
    expect(fake.typed).toEqual(['alice@bank.md', 'hunter2secret']);
    expect(setupTaps).toBe(8);
  });

  it('dismisses the optional interstitial when present', async () => {
    let entered = '';
    const fake = new FakeAdapter(buildScreens(), 'pin_login', (id, self) => {
      const digit = id.match(/^pin_key_(\d)$/)?.[1];
      if (digit) {
        entered += digit;
        if (entered === '1234') self.current = 'promo';
      }
      if (id === 'promo_close') self.current = 'dashboard';
    });
    await new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in');
    expect(fake.taps).toContain('promo_close');
  });
});

describe('runFlow', () => {
  it('requires: runs ensureState first, then the flow steps', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await new FlowEngine(CONFIG, fake, FAST).runFlow('goto_transfers');
    expect(fake.taps).toEqual(['tab_payments']);
  });
});

describe('secrets', () => {
  it('never leaks credential values into the trace', async () => {
    let entered = '';
    const fake = new FakeAdapter(buildScreens(), 'fresh_login', (id, self) => {
      if (id === 'login_submit') self.current = 'pin_setup';
      if (id.startsWith('setup_key_') && (entered += 'x').length === 8) self.current = 'dashboard';
    });
    const trace = await new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in');
    const dump = JSON.stringify(trace);
    expect(dump).not.toContain('alice@bank.md');
    expect(dump).not.toContain('hunter2secret');
    expect(dump).not.toContain('1234');
    expect(dump).toContain('***');
  });

  it('redacts secrets from error messages', async () => {
    const screens = buildScreens();
    const fake = new FakeAdapter(screens, 'fresh_login', (id, self) => {
      if (id === 'login_submit') self.current = 'pin_setup';
      // PIN setup never completes → wait for logged_in times out after typing secrets
    });
    await expect(new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in'))
      .rejects.toThrow(/Timed out/);
    // and the message must not contain any secret
    await expect(new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in'))
      .rejects.not.toThrow(/hunter2secret/);
  });

  it('missing env var error names the variable and the credential', async () => {
    delete process.env.TEST_PIN;
    const fake = new FakeAdapter(buildScreens(), 'pin_login');
    await expect(new FlowEngine(CONFIG, fake, FAST).ensureState('logged_in'))
      .rejects.toThrow(/TEST_PIN is not set \(needed for credential "pin"\)/);
  });
});

describe('failure modes', () => {
  it('branch with no matching arm times out with the tried conditions', async () => {
    nextY = 0;
    const fake = new FakeAdapter({ blank: screen(el({ identifier: 'something_else' })) }, 'blank');
    await expect(new FlowEngine(CONFIG, fake, FAST).runFlow('login'))
      .rejects.toThrow(/any branch condition.*pin_keyboard.*username_field/);
  });

  it('unknown state and flow names produce helpful errors', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const engine = new FlowEngine(CONFIG, fake, FAST);
    await expect(engine.ensureState('nirvana')).rejects.toThrow(/Unknown state "nirvana" — known: logged_in/);
    await expect(engine.runFlow('fly')).rejects.toThrow(/Unknown flow "fly" — known: login, goto_transfers/);
  });
});
