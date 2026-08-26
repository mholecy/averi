import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError, resetClearStateCount, scrollUntilVisible } from '../../src/flow/engine.js';
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
  resetClearStateCount();
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
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after login' });
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

  // Regression: on a real Android device one uiautomator dump runs 1-3s —
  // longer than the whole optional budget. The instant FakeAdapter above can
  // never catch that, so this one makes each tree read outlast
  // optionalTimeoutMs: the presence check must still succeed (pollUntil
  // completes at least one read before checking its deadline) and the tap
  // must then run on the full tap timeout, not the optional budget.
  it('optional tap lands even when one tree read outlasts the optional budget', async () => {
    const fake = new FakeAdapter(buildScreens(), 'promo', (id, self) => {
      if (id === 'promo_close') self.current = 'dashboard';
    });
    const slowRead = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      await new Promise((r) => setTimeout(r, FAST.optionalTimeoutMs + 20));
      return slowRead();
    };
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  dismiss:
    steps:
      - optional:
          - tap: { id: promo_close }
`);
    await new FlowEngine(cfg, fake, FAST).runFlow('dismiss');
    expect(fake.taps).toEqual(['promo_close']);
  });

  it('optional tap on an absent element skips after a single slow tree read', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    let reads = 0;
    const slowRead = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      reads++;
      await new Promise((r) => setTimeout(r, FAST.optionalTimeoutMs + 20));
      return slowRead();
    };
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  dismiss:
    steps:
      - optional:
          - tap: { id: promo_close }
`);
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('dismiss');
    expect(fake.taps).toEqual([]);
    expect(reads).toBe(1);
    expect(trace.some((t) => t.action === 'optional' && t.detail?.includes('skipped'))).toBe(true);
  });

  // A network-gated interstitial can take far longer than optionalTimeoutMs
  // to exist at all. `timeout:` on the tap widens the presence window; without
  // it the same late element is (correctly, per the default budget) skipped.
  it('optional tap timeout: widens the presence window for a late interstitial', async () => {
    const lateFake = () => {
      const fake = new FakeAdapter(buildScreens(), 'promo', (id, self) => {
        if (id === 'promo_close') self.current = 'dashboard';
      });
      // Anchor the appear-deadline to the FIRST read, not construction, and
      // keep it 10x the default budget: the "defaulted" half below relies on
      // the presence poll's deadline (~50ms) firing before the element exists,
      // so the margin must absorb CI event-loop stalls between setup and poll.
      let appearAt: number | undefined;
      const realRead = fake.uiTree.bind(fake);
      fake.uiTree = async () => {
        appearAt ??= Date.now() + FAST.optionalTimeoutMs * 10;
        return Date.now() < appearAt ? screen() : realRead();
      };
      return fake;
    };
    const flow = (tap: string) => parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  dismiss:
    steps:
      - optional:
          - tap: ${tap}
`);

    const overridden = lateFake();
    await new FlowEngine(flow('{ id: promo_close, timeout: 2s }'), overridden, FAST).runFlow('dismiss');
    expect(overridden.taps).toEqual(['promo_close']);

    const defaulted = lateFake();
    const trace = await new FlowEngine(flow('{ id: promo_close }'), defaulted, FAST).runFlow('dismiss');
    expect(defaulted.taps).toEqual([]);
    expect(trace.some((t) => t.action === 'optional' && t.detail?.includes('skipped'))).toBe(true);
  });

  it('tap timeout: overrides the default tap budget for a slow-rendering element', async () => {
    const fake = new FakeAdapter(buildScreens(), 'promo');
    const appearAt = Date.now() + FAST.tapTimeoutMs + 100;
    const realRead = fake.uiTree.bind(fake);
    fake.uiTree = async () => (Date.now() < appearAt ? screen() : realRead());
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  slow:
    steps:
      - tap: { id: promo_close, timeout: 2s }
`);
    await new FlowEngine(cfg, fake, FAST).runFlow('slow');
    expect(fake.taps).toEqual(['promo_close']);
  });
});

describe('reach: is an escalation ladder, not a script', () => {
  // The 2026-08-26 finding: a cheap, idempotent prelude cannot protect a
  // destructive flow behind it if every rung runs unconditionally.
  const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompt, login]
flows:
  dismiss_prompt:
    steps:
      - tap: { id: not_now }
  login:
    steps:
      - launch: { clearState: true }
`);

  const screens = () => {
    resetLayout();
    return {
      biometrics_prompt: screen(el({ role: 'button', identifier: 'not_now' })),
      dashboard: screen(el({ identifier: 'dashboard_root' })),
    };
  };

  it('stops at the first reach flow that satisfies detect — the destructive one never runs', async () => {
    const fake = new FakeAdapter(screens(), 'biometrics_prompt', (id, self) => {
      if (id === 'not_now') self.current = 'dashboard';
    });
    const trace = await new FlowEngine(cfg, fake, FAST).ensureState('logged_in');
    expect(fake.taps).toEqual(['not_now']);
    expect(fake.launches).toEqual([]); // no clearState → no burned device registration
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after dismiss_prompt' });
  });

  it('escalates to the next flow when the cheap one did not get there', async () => {
    const fake = new FakeAdapter(screens(), 'biometrics_prompt'); // tapping changes nothing
    const engine = new FlowEngine(cfg, fake, { ...FAST, reachRecheckMs: 20 });
    await expect(engine.ensureState('logged_in')).rejects.toThrow(/Timed out/);
    expect(fake.taps).toEqual(['not_now']);
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: undefined, intent: undefined },
    ]);
  });

  it('escalates when the cheap flow THROWS, and says so in the trace', async () => {
    // The everyday shape: the prelude taps an interstitial that is not there,
    // so its `tap:` times out. Aborting the ladder here would mean the prelude
    // only works on the runs that did not need it.
    const noPrompt = { ...screens(), biometrics_prompt: screen(el({ identifier: 'something_else' })) };
    const fake = new FakeAdapter(noPrompt, 'biometrics_prompt');
    const engine = new FlowEngine(cfg, fake, { ...FAST, reachRecheckMs: 20 });
    await expect(engine.ensureState('logged_in')).rejects.toThrow(/Timed out/);
    // it did not stop at the failed rung — login ran
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: undefined, intent: undefined },
    ]);
  });

  it('does not swallow the failed rung — the trace names it and the escalation', async () => {
    const noPrompt = { ...screens(), biometrics_prompt: screen(el({ identifier: 'something_else' })) };
    const fake = new FakeAdapter(noPrompt, 'biometrics_prompt');
    const engine = new FlowEngine(cfg, fake, { ...FAST, reachRecheckMs: 20 });
    const error = await engine.ensureState('logged_in').catch((e: unknown) => e);
    const entry = (error as FlowError).trace.find((t) => t.action.startsWith('\u26a0 reach'));
    expect(entry?.action).toBe('\u26a0 reach dismiss_prompt');
    expect(entry?.detail).toMatch(/failed, escalating to login — /);
  });

  it('a rung that threw AFTER reaching the state does not escalate', async () => {
    // The trap the escalation could re-open: the prelude gets home and then
    // dies on a later step. Escalating there runs the destructive flow on a
    // session that is already fine — the original finding, one level deeper.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompt, login]
flows:
  dismiss_prompt:
    steps:
      - tap: { id: not_now }
      - tap: { id: never_there }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = new FakeAdapter(screens(), 'biometrics_prompt', (id, self) => {
      if (id === 'not_now') self.current = 'dashboard';
    });
    const trace = await new FlowEngine(cfg2, fake, { ...FAST, reachRecheckMs: 20 }).ensureState('logged_in');
    expect(fake.launches).toEqual([]);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after dismiss_prompt' });
  });

  it('a CONFIG mistake in a rung aborts the ladder — it must not buy a wipe', async () => {
    // Escalation is for "the cheap flow did not fit the screen". An undeclared
    // credential is not that: the destructive flow cannot fix it and usually
    // hits it too, so escalating would wipe app state to re-run a step that
    // could never have worked. Measured before this rule: it did exactly that.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [prelude, login]
flows:
  prelude:
    steps:
      - type: { value: $nonexistent }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = new FakeAdapter(screens(), 'biometrics_prompt');
    const engine = new FlowEngine(cfg2, fake, { ...FAST, reachRecheckMs: 20 });
    await expect(engine.ensureState('logged_in')).rejects.toThrow(/Unknown credential "\$nonexistent"/);
    expect(fake.launches).toEqual([]);
  });

  it('an unset environment variable aborts the ladder for the same reason', async () => {
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  token: "\${AVERI_TEST_MISSING_VAR}"
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [prelude, login]
flows:
  prelude:
    steps:
      - type: { value: $token }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = new FakeAdapter(screens(), 'biometrics_prompt');
    const engine = new FlowEngine(cfg2, fake, { ...FAST, reachRecheckMs: 20 });
    await expect(engine.ensureState('logged_in')).rejects.toThrow(/AVERI_TEST_MISSING_VAR is not set/);
    expect(fake.launches).toEqual([]);
  });

  it('gives the between-flows detect a grace window instead of one probe', async () => {
    // The screen lands two polls after the flow returns: a single probe would
    // miss it and escalate straight into the destructive flow.
    const fake = new FakeAdapter(screens(), 'biometrics_prompt', (id, self) => {
      if (id !== 'not_now') return;
      let probes = 0;
      const orig = self.uiTree.bind(self);
      self.uiTree = async () => {
        if (++probes > 2) self.current = 'dashboard';
        return orig();
      };
    });
    const trace = await new FlowEngine(cfg, fake, { ...FAST, reachRecheckMs: 200 }).ensureState('logged_in');
    expect(fake.launches).toEqual([]);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after dismiss_prompt' });
  });
});

describe('a failing flow carries its trace', () => {
  it('appends the steps that ran to the error message, and keeps them structured', async () => {
    // The PIN keypad accepts the taps but the app never advances — the shape
    // of the finding: a timeout whose message alone says nothing about how far
    // the reach flow got.
    const fake = new FakeAdapter(buildScreens(), 'pin_login');
    const engine = new FlowEngine(CONFIG, fake, FAST);
    const error = await engine.ensureState('logged_in').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowError);
    const { message, trace } = error as FlowError;
    expect(message).toMatch(/Timed out after \d+ms waiting for state logged_in/);
    expect(message).toMatch(/Steps that ran before the failure:/);
    expect(message).toMatch(/flow login: start/);
    expect(message).toMatch(/type_pin/);
    expect(trace).toContainEqual({ action: 'flow login', detail: 'start' });
  });

  it('redacts credentials in the attached trace, exactly as on the success path', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const error = await new FlowEngine(CONFIG, fake, FAST).runFlow('login').catch((e: unknown) => e);
    expect((error as Error).message).not.toContain('hunter2secret');
    expect((error as Error).message).toContain('type: ***');
  });

  it('does not dress the environment line up as a step when nothing else ran', async () => {
    // Needs a config that actually LOGS an environment line, or the filter it
    // is testing is never reached and the assertion holds for the wrong reason.
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
defaultEnvironment: staging
environments:
  staging: { credentials: { username: "\${TEST_USER}" } }
flows:
  noop:
    steps:
      - launch: {}
`);
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const error = await new FlowEngine(cfg, fake, FAST).runFlow('nope').catch((e: unknown) => e);
    // the environment line WAS logged — the filter is what keeps it out
    expect((error as FlowError).trace).toEqual([
      { action: 'environment staging', detail: 'overrides: username' },
    ]);
    expect((error as Error).message).toMatch(/^Unknown flow "nope"/);
    expect((error as Error).message).not.toContain('Steps that ran');
  });
});

describe('clearState announces its cost', () => {
  const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
flows:
  cold:
    steps:
      - launch: { clearState: true }
  warm:
    steps:
      - launch: { clearState: false }
`);

  it('warns on the wipe and counts them across the session', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const engine = new FlowEngine(cfg, fake, FAST);
    const first = await engine.runFlow('cold');
    expect(first).toContainEqual({
      action: '\u26a0 clearState',
      detail:
        'app state wiped (data container deleted) — anything the app persisted, ' +
        'a device registration included, is gone (1 this session)',
    });
    // A second tool call is a fresh engine; the count is the SESSION's, which
    // is the only scale at which a finite resource can be budgeted.
    const second = await new FlowEngine(cfg, fake, FAST).runFlow('cold');
    expect(second.at(-2)?.detail).toContain('(2 this session)');
  });

  it('stays silent when the launch preserves state', async () => {
    const trace = await new FlowEngine(cfg, new FakeAdapter(buildScreens(), 'dashboard'), FAST).runFlow('warm');
    expect(trace.some((t) => t.action.includes('clearState'))).toBe(false);
  });
});

describe('launch step', () => {
  it('defaults to app.android.activity; a step-level activity + intent wins', async () => {
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app, activity: .MainActivity }
flows:
  open:
    steps:
      - launch: { clearState: true }
  share_qr:
    steps:
      - launch:
          activity: .ShareActivity
          intent: { action: android.intent.action.SEND }
`);
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const engine = new FlowEngine(cfg, fake, FAST);
    const trace = await engine.runFlow('open');
    await engine.runFlow('share_qr');
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: '.MainActivity' },
      { appId: 'md.bank.app', activity: '.ShareActivity', intent: { action: 'android.intent.action.SEND' } },
    ]);
    expect(trace).toContainEqual({ action: 'launch', detail: 'md.bank.app/.MainActivity (state cleared)' });
  });
});

describe('transient UI-tree read failures', () => {
  // After launch (clearState especially) the app has no window for a few
  // seconds and uiautomator reports "null root node" — a wait: whose whole
  // purpose is polling must survive that, not die on its first read.
  const NULL_ROOT = 'uiautomator dump returned no XML: ERROR: null root node returned by UiTestAutomationBridge.';

  const failingTree = (fake: FakeAdapter, failures: number) => {
    const orig = fake.uiTree.bind(fake);
    let remaining = failures;
    fake.uiTree = async () => {
      if (remaining-- > 0) throw new Error(NULL_ROOT);
      return orig();
    };
  };

  const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  home:
    detect: { element: { id: dashboard_root } }
    reach: [warm]
flows:
  warm:
    steps:
      - launch: { clearState: true }
  smoke:
    steps:
      - launch: { clearState: true }
      - wait: { element: { id: dashboard_root }, timeout: 300 }
`);

  it('a wait: keeps polling through reads that fail while the app has no window yet', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, 3);
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('smoke');
    expect(trace).toContainEqual({ action: 'wait', detail: 'element id:"dashboard_root"' });
  });

  it('a persistent read failure still times out, and the message carries the underlying error', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, Number.POSITIVE_INFINITY);
    await expect(new FlowEngine(cfg, fake, FAST).runFlow('smoke')).rejects.toThrow(
      /Timed out after 300ms[\s\S]*last UI tree read failed: uiautomator dump returned no XML/,
    );
  });

  it('ensure_state treats an unreadable detect probe as "not in state" and runs the reach flows', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, 1); // exactly the first probe fails — the cold-launch case
    const trace = await new FlowEngine(cfg, fake, FAST).ensureState('home');
    expect(fake.launches).toEqual([{ appId: 'md.bank.app', clearState: true, activity: undefined, intent: undefined }]);
    expect(trace).toContainEqual({ action: 'state home', detail: 'reached after warm' });
  });

  it('scroll_until reports the read failure instead of "element never appeared"', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, Number.POSITIVE_INFINITY);
    await expect(
      scrollUntilVisible(
        fake,
        { find: () => [], describe: 'id:below_fold' },
        { maxSwipes: 2, timeout: 100 },
        { settleMs: 1 },
      ),
    ).rejects.toThrow(/last UI tree read failed: uiautomator dump returned no XML/);
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

  it('dismissKeyboard presses AFTER the text landed, never before', async () => {
    const fake = formFake();
    const order: string[] = [];
    const typeText = fake.typeText.bind(fake);
    fake.typeText = async (t: string) => {
      order.push(`type:${t}`);
      return typeText(t);
    };
    fake.pressKey = async (k) => {
      order.push(`key:${k}`);
    };

    await new FlowEngine(
      cfg('{ id: amount_input, value: "2.50", dismissKeyboard: true }'),
      fake,
      FAST,
    ).runFlow('f');

    // Dismissing first would close the keyboard the typing needs.
    expect(order).toEqual(['type:2.50', 'key:back']);
  });

  it('dismissKeyboard is opt-in — no key press without it', async () => {
    const fake = formFake();
    const keys: string[] = [];
    fake.pressKey = async (k) => {
      keys.push(k);
    };
    await new FlowEngine(cfg('{ id: amount_input, value: "2.50" }'), fake, FAST).runFlow('f');
    expect(keys).toEqual([]);
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

describe('credential environments', () => {
  const MULTI_ENV = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  username: \${TEST_USER}
  password: \${TEST_PASSWORD}
  pin: \${TEST_PIN}
environments:
  alfons_dev:
    credentials:
      username: \${TEST_ALFONS_USER}
  starterkit:
    credentials:
      username: \${TEST_STARTERKIT_USER}
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
flows:
  type_username:
    steps:
      - tap:  { id: username_field }
      - type: { value: $username }
      - tap:  { id: password_field }
      - type: { value: $password }
`);

  beforeEach(() => {
    process.env.TEST_ALFONS_USER = 'martha.key';
    process.env.TEST_STARTERKIT_USER = 'starter.user';
  });

  afterEach(() => {
    delete process.env.TEST_ALFONS_USER;
    delete process.env.TEST_STARTERKIT_USER;
    delete process.env.AVERI_ENV;
  });

  it('types the selected environment’s username and the shared password', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    await new FlowEngine(MULTI_ENV, fake, { ...FAST, environment: 'starterkit' }).runFlow('type_username');
    // username from the environment, password inherited from base credentials
    expect(fake.typed).toEqual(['starter.user', 'hunter2secret']);
  });

  it('switching environment switches the username without touching averi.yaml', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    process.env.AVERI_ENV = 'alfons_dev';
    await new FlowEngine(MULTI_ENV, fake, FAST).runFlow('type_username');
    expect(fake.typed[0]).toBe('martha.key');
  });

  it('names the active environment in the trace so a mix-up is visible', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const trace = await new FlowEngine(MULTI_ENV, fake, { ...FAST, environment: 'starterkit' }).runFlow(
      'type_username',
    );
    expect(trace[0]).toEqual({ action: 'environment starterkit', detail: 'overrides: username' });
  });

  it('keeps environment usernames redacted from the trace', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const trace = await new FlowEngine(MULTI_ENV, fake, { ...FAST, environment: 'starterkit' }).runFlow(
      'type_username',
    );
    expect(JSON.stringify(trace)).not.toContain('starter.user');
  });

  it('fails before touching the device when the environment is unknown', () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    expect(() => new FlowEngine(MULTI_ENV, fake, { ...FAST, environment: 'nope' })).toThrow(
      /Unknown environment "nope"/,
    );
    expect(fake.taps).toEqual([]);
  });

  it('points at the environment when its env var is missing', async () => {
    delete process.env.TEST_STARTERKIT_USER;
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    await expect(
      new FlowEngine(MULTI_ENV, fake, { ...FAST, environment: 'starterkit' }).runFlow('type_username'),
    ).rejects.toThrow(/TEST_STARTERKIT_USER is not set .*environment "starterkit"/);
  });
});

describe('branch arm selection', () => {
  const cfg = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - branch:
          - when: { element: { id: pin_keyboard } }
            do: [ { tap: { id: pin_keyboard } } ]
          - when: { element: { id: username_field } }
            do: [ { tap: { id: username_field } } ]
`);

  it('takes the FIRST matching arm when several conditions hold', async () => {
    resetLayout();
    // Both arms' conditions are satisfiable on this screen — declaration order
    // decides, which is how a flow author expresses precedence.
    const fake = new FakeAdapter(
      { both: screen(el({ identifier: 'pin_keyboard' }), el({ identifier: 'username_field' })) },
      'both',
    );
    const trace = await new FlowEngine(cfg, fake, FAST).runFlow('f');
    expect(fake.taps).toEqual(['pin_keyboard']);
    expect(trace).toContainEqual({ action: 'branch', detail: 'matched element id:"pin_keyboard"' });
  });

  it('falls through to a later arm when the earlier condition does not hold', async () => {
    resetLayout();
    const fake = new FakeAdapter({ fresh: screen(el({ identifier: 'username_field' })) }, 'fresh');
    await new FlowEngine(cfg, fake, FAST).runFlow('f');
    expect(fake.taps).toEqual(['username_field']);
  });
});
