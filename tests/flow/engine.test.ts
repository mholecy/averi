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

const FAST = { pollMs: 5, tapTimeoutMs: 200, waitTimeoutMs: 300, ensureTimeoutMs: 300, optionalTimeoutMs: 50, assertTimeoutMs: 100, pinKeyDelayMs: 1 };

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

  it('type_pin without keypad types digit-by-digit and strips formatting', async () => {
    // Real-world case (Finshape skeleton iOS): 9-box OTP inputs auto-advance
    // focus per digit and drop bulk-typed text; the credential is formatted
    // "111-111-111" but only digits are keystrokes.
    resetLayout();
    const screens = {
      ...buildScreens(),
      otp: screen(el({ identifier: 'otp_screen' })),
    };
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  sms: \${TEST_SMS}
states:
  done:
    detect: { element: { id: dashboard_root } }
flows:
  enter_otp:
    steps:
      - type_pin: { value: $sms }
      - wait: { state: done, timeout: 1s }
`);
    process.env.TEST_SMS = '111-111-111';
    const fake = new FakeAdapter(screens, 'otp');
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      await origType(text);
      if (fake.typed.length === 9) fake.current = 'dashboard';
    };
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('enter_otp');
    expect(fake.typed).toEqual(['1', '1', '1', '1', '1', '1', '1', '1', '1']);
    expect(trace).toContainEqual({ action: 'type_pin', detail: '9 digits' });
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

describe('scroll_until step', () => {
  const cfg = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  to_submit:
    steps:
      - scroll_until: { element: { id: submit_button }, maxSwipes: 4, timeout: 2s }
`);

  /** Fake whose target starts below the fold and moves up per swipe. */
  function scrollingFake(startY: number, perSwipe = 600) {
    resetLayout();
    const target = node({
      role: 'button',
      identifier: 'submit_button',
      rect: { x: 0, y: startY, width: 100, height: 40 },
    });
    const form = screen(el({ identifier: 'form_root' }), target);
    class ScrollingFake extends FakeAdapter {
      override async swipe(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
        await super.swipe(from, to);
        target.rect = { ...target.rect, y: target.rect.y - perSwipe };
      }
    }
    return new ScrollingFake({ form }, 'form');
  }

  it('swipes until the element intersects the viewport', async () => {
    const fake = scrollingFake(3100); // needs 2 swipes to get under y=2000
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('to_submit');
    expect(fake.swipes).toHaveLength(2);
    // content below → finger moves up
    expect(fake.swipes[0].to.y).toBeLessThan(fake.swipes[0].from.y);
    expect(trace).toContainEqual({ action: 'scroll_until', detail: 'id:"submit_button" visible after 2 swipes' });
  });

  it('passes with 0 swipes when the element is already visible (fast path)', async () => {
    const fake = scrollingFake(500);
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('to_submit');
    expect(fake.swipes).toHaveLength(0);
    expect(trace).toContainEqual({ action: 'scroll_until', detail: 'id:"submit_button" visible after 0 swipes' });
  });

  it('fails after maxSwipes with a diagnosis of the last tree', async () => {
    const fake = scrollingFake(50_000, 10); // never gets there in 4 swipes
    await expect(new FlowEngine(cfg, fake, FAST).runFlow('to_submit')).rejects.toThrow(
      /scroll_until id:"submit_button" failed after 4 swipes \(maxSwipes\) — element in tree but never intersected/,
    );
  });

  it('reports when the element never appeared at all', async () => {
    resetLayout();
    const fake = new FakeAdapter({ form: screen(el({ identifier: 'form_root' })) }, 'form');
    await expect(new FlowEngine(cfg, fake, FAST).runFlow('to_submit')).rejects.toThrow(
      /element never appeared in the tree/,
    );
  });
});

describe('fill step', () => {
  function formFake(amountValue: string | null = null) {
    resetLayout();
    return new FakeAdapter(
      {
        form: screen(
          el({ role: 'textfield', identifier: 'amount_input', value: amountValue }),
          el({ role: 'button', identifier: 'submit_button' }),
        ),
      },
      'form',
    );
  }
  const cfg = (fill: string) =>
    parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - fill: ${fill}
`);

  it('taps the field then types; no clearing by default (pre-filled login fields must survive)', async () => {
    const fake = formFake('9.99');
    const trace = await new FlowEngine(cfg('{ id: amount_input, value: "2.50" }'), fake, FAST).runFlow('f');
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['2.50']);
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" = 2.50' });
  });

  it('clear: true deletes the existing value length before typing', async () => {
    const fake = formFake('2.50');
    await new FlowEngine(cfg('{ id: amount_input, value: "7", clear: true }'), fake, FAST).runFlow('f');
    expect(fake.deletes).toEqual([4]); // "2.50".length
    expect(fake.typed).toEqual(['7']);
  });

  it('clear on an empty field skips deleting', async () => {
    const fake = formFake(null);
    await new FlowEngine(cfg('{ id: amount_input, value: "1.00", clear: true }'), fake, FAST).runFlow('f');
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['1.00']);
  });

  it('verifies the typed value landed and retries a clear-fill whose input was dropped', async () => {
    // Compose async state can swallow synthetic input (measured 2026-08-05:
    // bulk typing landed 3 of 11 chars). First typeText drops chars; the
    // verify pass must wipe and retype.
    const fake = formFake('9.99');
    let drops = 1;
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      if (drops-- > 0) return origType(text.slice(-1)); // only the last char lands
      return origType(text);
    };
    await new FlowEngine(cfg('{ id: amount_input, value: "12.34", clear: true }'), fake, FAST).runFlow('f');
    // cleared prefill (4), dropped attempt left "4", verify wiped it (1) and retyped
    expect(fake.deletes).toEqual([4, 1]);
    expect(fake.typed).toEqual(['4', '12.34']);
  });

  it('re-clears once when the first clear leaves content behind', async () => {
    const fake = formFake('2.50');
    let swallow = 1;
    const origClear = fake.clearText.bind(fake);
    fake.clearText = async (count: number) => {
      if (swallow-- > 0) return origClear(Math.max(0, count - 2)); // 2 deletes dropped
      return origClear(count);
    };
    await new FlowEngine(cfg('{ id: amount_input, value: "7", clear: true }'), fake, FAST).runFlow('f');
    expect(fake.deletes).toEqual([2, 2]); // first pass left "2.", second cleared the remainder
    expect(fake.typed).toEqual(['7']);
  });

  it('fill WITHOUT clear never wipes the field when verification mismatches — it fails instead', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text); // drop everything: value never changes
    };
    await expect(
      new FlowEngine(cfg('{ id: amount_input, value: "12.34" }'), fake, FAST).runFlow('f'),
    ).rejects.toThrow(/typed 5 characters but the field shows 4/);
    expect(fake.deletes).toEqual([]); // clear stays opt-in even during verification
  });

  it('redacts credential values in the fill trace', async () => {
    process.env.TEST_PIN = '4321';
    const cfgSecret = parseConfig(`
app: { android: { package: md.bank.app } }
credentials:
  pin: \${TEST_PIN}
flows:
  f:
    steps:
      - fill: { id: amount_input, value: $pin }
`);
    const fake = formFake();
    const trace = await new FlowEngine(cfgSecret, fake, FAST).runFlow('f');
    expect(JSON.stringify(trace)).not.toContain('4321');
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" = ***' });
  });
});

describe('assert step', () => {
  const cfg = (assert: string) =>
    parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - assert:
${assert}
`);

  it('passing asserts are logged in the trace and the flow continues', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const trace = await new FlowEngine(cfg('          - { element: { id: dashboard_root } }'), fake, FAST).runFlow('f');
    expect(trace).toContainEqual({ action: 'assert PASS', detail: 'element id:"dashboard_root" exists' });
  });

  it('a failing assert fails the FLOW with the diff in the error', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await expect(
      new FlowEngine(cfg('          - { element: { text: "No such text" } }'), fake, FAST).runFlow('f'),
    ).rejects.toThrow(/1\/1 flow asserts failed:[\s\S]*FAIL.*No such text/);
  });
});

describe('absent detect conditions', () => {
  // The transactions_list ambiguity: Card Detail embeds the same list, so
  // "row present" alone matches both screens; "row present AND card face
  // absent" is the discriminator that was previously inexpressible.
  const cfg = parseConfig(`
app: { android: { package: md.bank.app } }
states:
  transactions_only:
    detect:
      all:
        - element: { id: row_0 }
        - element: { id: card_face }
          absent: true
`);

  function fakeOn(screenName: 'transactions' | 'cards' | 'cards_offscreen') {
    resetLayout();
    const screens = {
      transactions: screen(el({ identifier: 'row_0' })),
      cards: screen(el({ identifier: 'card_face' }), el({ identifier: 'row_0' })),
      // iOS-style: card face still in the tree but pushed off-viewport → counts as absent
      cards_offscreen: screen(
        node({ identifier: 'card_face', rect: { x: 0, y: -300, width: 100, height: 100 } }),
        el({ identifier: 'row_0' }),
      ),
    };
    return new FakeAdapter(screens, screenName);
  }

  it('matches when the discriminator element is gone', async () => {
    const trace = await new FlowEngine(cfg, fakeOn('transactions'), FAST).ensureState('transactions_only');
    expect(trace).toEqual([{ action: 'state transactions_only', detail: 'already active' }]);
  });

  it('does not match while the discriminator is visible', async () => {
    await expect(new FlowEngine(cfg, fakeOn('cards'), FAST).ensureState('transactions_only')).rejects.toThrow(
      /no reach flows/,
    );
  });

  it('treats an off-viewport node as absent (portable across the platform tree semantics)', async () => {
    const trace = await new FlowEngine(cfg, fakeOn('cards_offscreen'), FAST).ensureState('transactions_only');
    expect(trace).toEqual([{ action: 'state transactions_only', detail: 'already active' }]);
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
