import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine } from '../../src/flow/engine.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

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
  resetLayout();
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

  it('type_pin keypad matches digits by visible text when there are no ids', async () => {
    // Real-world case (Finshape skeleton): Compose keypad digits are text
    // nodes with no resource-id — only the label distinguishes them.
    resetLayout();
    const textKeys = ['1', '2', '3', '4'].map((d) =>
      el({ role: 'text', identifier: `key_${d}`, label: d }));
    const screens = {
      ...buildScreens(),
      text_keypad: screen(el({ identifier: 'text_keypad_screen' }), ...textKeys),
    };
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  pin: \${TEST_PIN}
states:
  done:
    detect: { element: { id: dashboard_root } }
flows:
  enter_pin:
    steps:
      - type_pin: { value: $pin, keypad: { text_pattern: "{digit}" } }
      - wait: { state: done, timeout: 1s }
`);
    let entered = '';
    const fake = new FakeAdapter(screens, 'text_keypad', (id, self) => {
      const digit = id.match(/^key_(\d)$/)?.[1];
      if (digit) {
        entered += digit;
        if (entered === '1234') self.current = 'dashboard';
      }
    });
    await new FlowEngine(cfg, fake, FAST).runFlow('enter_pin');
    expect(fake.taps).toEqual(['key_1', 'key_2', 'key_3', 'key_4']);
  });

  it('rejects a keypad with both id_pattern and text_pattern', () => {
    expect(() =>
      parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  bad:
    steps:
      - type_pin: { value: "1234", keypad: { id_pattern: "a{digit}", text_pattern: "{digit}" } }
`),
    ).toThrow(/exactly one of: id_pattern, text_pattern/);
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

describe('swipe step', () => {
  it('swipes over the screen center in the gesture direction, times N', async () => {
    const cfg = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  scroll_up:
    steps:
      - swipe: { direction: down, times: 2 }
`);
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await new FlowEngine(cfg, fake, FAST).runFlow('scroll_up');
    expect(fake.swipes).toHaveLength(2);
    const { from, to } = fake.swipes[0];
    expect(from.x).toBe(to.x); // vertical gesture
    expect(to.y).toBeGreaterThan(from.y); // finger moves down
  });
});

describe('tap stability', () => {
  it('does not tap an element while it is still moving (launch animation)', async () => {
    resetLayout();
    const positions = [100, 160, 220, 220, 220]; // animates, then settles at 220
    let poll = 0;
    const target = el({ role: 'button', identifier: 'tab_payments' });
    const dash = screen(
      el({ identifier: 'dashboard_root' }),
      el({ role: 'text', label: 'Accounts' }),
      target,
    );
    class AnimatedFake extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        target.rect = { ...target.rect, y: positions[Math.min(poll++, positions.length - 1)] };
        return dash;
      }
    }
    const fake = new AnimatedFake({ dashboard: dash }, 'dashboard');
    await new FlowEngine(CONFIG, fake, FAST).runFlow('goto_transfers');
    // tapped exactly once, at the settled position
    expect(fake.taps).toEqual(['tab_payments']);
    expect(poll).toBeGreaterThanOrEqual(4); // needed at least two identical polls after moving
  });

  it('ignores zero-area nodes as tap targets', async () => {
    resetLayout();
    const ghost = node({ role: 'other', identifier: 'tab_payments', rect: { x: 5, y: 5, width: 0, height: 0 } });
    const real = el({ role: 'button', identifier: 'tab_payments' });
    const dash = screen(el({ identifier: 'dashboard_root' }), ghost, real);
    const fake = new FakeAdapter({ dashboard: dash }, 'dashboard');
    await new FlowEngine(CONFIG, fake, FAST).runFlow('goto_transfers');
    expect(fake.taps).toEqual(['tab_payments']); // resolved via the real node's rect
  });
});

describe('failure modes', () => {
  it('branch with no matching arm times out with the tried conditions', async () => {
    resetLayout();
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
