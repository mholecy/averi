import { describe, expect, it, vi } from 'vitest';

// The one sleep owner (util/sleep.ts) is a zero-delay macrotask yield here,
// not a wait: every poll cadence and the fill's 350 ms focus delay collapse to
// one event-loop turn, so EngineOptions needs no test-only timing knob for
// the fill (review 2026-10-03). A macrotask rather than a no-op on purpose —
// some fakes below make an element appear on a real setTimeout, and a poll
// that never leaves the microtask queue would starve them. Deadlines are
// Date.now-based and still fire; measured: the suite is ~1 s faster, not
// slower, with every test green either way.
vi.mock('../../src/util/sleep.js', () => ({ sleep: () => new Promise((r) => setTimeout(r, 0)) }));
import type { UiNode } from '../../src/adapters/types.js';
import { parseConfig, type AveriConfig, type Step } from '../../src/flow/config.js';
import { FlowEngine, EngineSession, FlowError, idbContainerIdHint, runRequestOf, stepSummary, waitTimeoutHint, type EngineOptions, type RunRequest, type TraceEntry } from '../../src/flow/engine.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { el, FakeAdapter, hidesKeyboardOn, iosLoginFake, node, resetLayout, screen } from '../helpers/fake.js';

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

/** The environment every engine here resolves `${VAR}` from — a value, not process.env (2026-10-04). */
const TEST_ENV = { TEST_USER: 'alice@bank.md', TEST_PASSWORD: 'hunter2secret', TEST_PIN: '1234' };
/** TEST_ENV without the named variables — for the "variable is not set" cases. */
const envWithout = (...names: string[]) =>
  Object.fromEntries(Object.entries(TEST_ENV).filter(([k]) => !names.includes(k)));
const FAST = {
  pollMs: 5, tapTimeoutMs: 200, waitTimeoutMs: 300, ensureTimeoutMs: 300, optionalTimeoutMs: 50, assertTimeoutMs: 100, pinKeyDelayMs: 1, env: TEST_ENV,
  // A fresh session at every use — a spread or a direct pass — so no test
  // inherits another's wipe count (EngineOptions.session is required).
  get session() {
    return new EngineSession();
  },
};

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

describe('run({ state }) — ensuring a state', () => {
  it('is a no-op when the state is already active', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const trace = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' });
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
    const trace = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' });
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
    await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' });
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
    await FlowEngine.run(cfg, fake, FAST, { flow: 'enter_pin' });
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
    const fake = new FakeAdapter(screens, 'otp');
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      await origType(text);
      if (fake.typed.length === 9) fake.current = 'dashboard';
    };
    const trace = await FlowEngine.run(cfg, fake, { ...FAST, env: { ...TEST_ENV, TEST_SMS: '111-111-111' } }, { flow: 'enter_otp' });
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
    await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' });
    expect(fake.taps).toContain('promo_close');
  });

  // Regression: on a real Android device one uiautomator dump runs 1-3s —
  // longer than the whole optional budget. The instant FakeAdapter above can
  // never catch that, so this one makes each tree read outlast
  // optionalTimeoutMs: the presence check must still succeed (resolvePresent's
  // pollTree completes at least one read before checking its deadline) and the tap
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
    await FlowEngine.run(cfg, fake, FAST, { flow: 'dismiss' });
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
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'dismiss' });
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
    await FlowEngine.run(flow('{ id: promo_close, timeout: 2s }'), overridden, FAST, { flow: 'dismiss' });
    expect(overridden.taps).toEqual(['promo_close']);

    const defaulted = lateFake();
    const trace = await FlowEngine.run(flow('{ id: promo_close }'), defaulted, FAST, { flow: 'dismiss' });
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
    await FlowEngine.run(cfg, fake, FAST, { flow: 'slow' });
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
    const trace = await FlowEngine.run(cfg, fake, FAST, { state: 'logged_in' });
    expect(fake.taps).toEqual(['not_now']);
    expect(fake.launches).toEqual([]); // no clearState → no burned device registration
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after dismiss_prompt' });
  });

  it('escalates to the next flow when the cheap one did not get there', async () => {
    const fake = new FakeAdapter(screens(), 'biometrics_prompt'); // tapping changes nothing
    await expect(FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/Timed out/);
    // Twice: once as rung 1, once in the recovery pass after the final wait
    // timed out (see 'the ladder gets one recovery pass' below).
    expect(fake.taps).toEqual(['not_now', 'not_now']);
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: undefined, intent: undefined },
    ]);
  });

  it('WARNS before running a destructive rung, not after the wipe', async () => {
    // The 2026-08-27 finding: an inactivity timeout made the ladder escalate
    // CORRECTLY into a wipe that destroyed a still-valid device registration.
    // The engine cannot tell "log in from scratch" from "re-authenticate an
    // already-registered device" — only the config can — so the fix is to
    // announce the cost while a human watching the run can still interrupt.
    const fake = new FakeAdapter(screens(), 'biometrics_prompt');
    const error = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    const trace = (error as FlowError).trace;
    const warned = trace.findIndex((t) => t.detail?.includes('this rung is DESTRUCTIVE') === true);
    const wiped = trace.findIndex((t) => t.detail?.includes('app state wiped') === true);
    expect(warned).toBeGreaterThanOrEqual(0);
    expect(wiped).toBeGreaterThanOrEqual(0);
    expect(warned).toBeLessThan(wiped); // pre-flight, not post-hoc
    // ...and it names the cure, which lives in the config, not the engine.
    expect(trace[warned].detail).toMatch(/non-destructive rung declared BEFORE this one/);
  });

  it('stays SILENT about destructiveness on a rung that does not wipe', async () => {
    // The negative half: warning on every rung would train the reader to skip it.
    const fake = new FakeAdapter(screens(), 'biometrics_prompt', (id, self) => {
      if (id === 'not_now') self.current = 'dashboard';
    });
    const trace = await FlowEngine.run(cfg, fake, FAST, { state: 'logged_in' });
    expect(trace.some((t) => t.detail?.includes('DESTRUCTIVE') === true)).toBe(false);
  });

  describe('a rung whose `requires` leads to a wipe is not itself the wipe', () => {
    // Measured 2026-10-05: a one-tap navigation flow requiring a logged-in
    // state printed "this rung is DESTRUCTIVE" on every call, because the
    // recovery-pass predicate follows `requires` and the login at the end of
    // that ladder wipes. The next trace line was "already active" — nothing
    // could have wiped. A warning that fires on every harmless navigation is
    // not read on the call that does wipe, so the pre-flight line must speak
    // only for the rung's OWN steps; the nested ladder warns for its own.
    const yaml2 = `
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompt, login]
  transfers:
    detect: { element: { id: transfer_form } }
    reach: [goto_transfers]
flows:
  dismiss_prompt:
    steps:
      - tap: { id: not_now }
  login:
    steps:
      - launch: { clearState: true }
  goto_transfers:
    requires: logged_in
    steps:
      - tap: { id: tab_payments }
`;
    const cfg2 = parseConfig(yaml2);
    const destructiveWarnings = (trace: TraceEntry[]) =>
      trace.filter((t) => t.detail?.includes('this rung is DESTRUCTIVE') === true);
    const screens2 = () => {
      resetLayout();
      return {
        biometrics_prompt: screen(el({ role: 'button', identifier: 'not_now' })),
        dashboard: screen(el({ role: 'button', identifier: 'tab_payments' }), el({ identifier: 'dashboard_root' })),
        transfers: screen(el({ identifier: 'transfer_form' })),
      };
    };

    it('stays SILENT when the required state is already active — nothing wipes, nothing launches', async () => {
      const fake = new FakeAdapter(screens2(), 'dashboard', (id, self) => {
        if (id === 'tab_payments') self.current = 'transfers';
      });
      const trace = await FlowEngine.run(cfg2, fake, FAST, { state: 'transfers' });
      expect(fake.launches).toEqual([]);
      expect(trace.some((t) => t.detail?.includes('DESTRUCTIVE') === true)).toBe(false);
      expect(trace).toContainEqual({ action: 'state logged_in', detail: 'already active' });
    });

    it('warns ONCE, naming the rung that wipes, when `requires` does escalate into the login', async () => {
      // The device is logged out: `goto_transfers` → `requires: logged_in` →
      // nested ladder → `login`. The warning belongs to `login`, right before
      // its launch — not to `goto_transfers`, whose own steps are one tap.
      const fake = new FakeAdapter(screens2(), 'biometrics_prompt'); // tapping changes nothing
      const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'transfers' }).catch((e: unknown) => e);
      const trace = (error as FlowError).trace;
      const warnings = destructiveWarnings(trace);
      expect(warnings.map((t) => t.action)).toEqual(['⚠ reach login']);
      const warned = trace.indexOf(warnings[0]);
      const wiped = trace.findIndex((t) => t.detail?.includes('app state wiped') === true);
      expect(wiped).toBeGreaterThanOrEqual(0);
      expect(warned).toBeLessThan(wiped); // still pre-flight
    });

    describe('entered through run_flow, two levels deep — the measured shape', () => {
      // The incident was `run_flow goto_swift_payment_form`: the called flow
      // requires a state whose rung (`goto_payment_type_chooser`, here
      // `goto_transfers`) requires logged_in. The called flow is not a rung,
      // so the false warning was on the INNER rung, one level down.
      const cfg3 = parseConfig(`${yaml2}  goto_swift:
    requires: transfers
    steps:
      - tap: { id: swift }
`);
      const screens3 = () => {
        const s = screens2();
        return { ...s, transfers: screen(el({ identifier: 'transfer_form' }), el({ role: 'button', identifier: 'swift' })) };
      };

      it('stays SILENT when logged_in is already active', async () => {
        const fake = new FakeAdapter(screens3(), 'dashboard', (id, self) => {
          if (id === 'tab_payments') self.current = 'transfers';
        });
        const trace = await FlowEngine.run(cfg3, fake, FAST, { flow: 'goto_swift' });
        expect(fake.launches).toEqual([]);
        expect(trace.some((t) => t.detail?.includes('DESTRUCTIVE') === true)).toBe(false);
        expect(trace).toContainEqual({ action: 'state logged_in', detail: 'already active' });
      });

      it('warns only on the login when logged out', async () => {
        const fake = new FakeAdapter(screens3(), 'biometrics_prompt'); // tapping changes nothing
        const error = await FlowEngine.run(cfg3, fake, { ...FAST, reachRecheckMs: 20 }, { flow: 'goto_swift' }).catch((e: unknown) => e);
        const trace = (error as FlowError).trace;
        expect(destructiveWarnings(trace).map((t) => t.action)).toEqual(['⚠ reach login']);
      });
    });
  });

  it('escalates when the cheap flow THROWS, and says so in the trace', async () => {
    // The everyday shape: the prelude taps an interstitial that is not there,
    // so its `tap:` times out. Aborting the ladder here would mean the prelude
    // only works on the runs that did not need it.
    const noPrompt = { ...screens(), biometrics_prompt: screen(el({ role: 'text', identifier: 'something_else' })) };
    const fake = new FakeAdapter(noPrompt, 'biometrics_prompt');
    await expect(FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/Timed out/);
    // it did not stop at the failed rung — login ran
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: undefined, intent: undefined },
    ]);
  });

  it('does not swallow the failed rung — the trace names it and the escalation', async () => {
    const noPrompt = { ...screens(), biometrics_prompt: screen(el({ role: 'text', identifier: 'something_else' })) };
    const fake = new FakeAdapter(noPrompt, 'biometrics_prompt');
    const error = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
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
    const trace = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
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
    await expect(FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/Unknown credential "\$nonexistent"/);
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
    await expect(FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/AVERI_TEST_MISSING_VAR is not set/);
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
    const trace = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 200 }, { state: 'logged_in' });
    expect(fake.launches).toEqual([]);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after dismiss_prompt' });
  });
});

/** Screens where the interstitial exists only AFTER the destructive rung ran. */
const lateInterstitial = () => {
  resetLayout();
  const screens = {
    logged_out: screen(el({ role: 'button', identifier: 'login_button' })),
    interstitial: screen(el({ role: 'button', identifier: 'not_now' })),
    dashboard: screen(el({ identifier: 'dashboard_root' })),
  };
  const fake = new FakeAdapter(screens, 'logged_out', (id, self) => {
    if (id === 'not_now') self.current = 'dashboard';
  });
  const launch = fake.launch.bind(fake);
  fake.launch = async (appId, opts) => {
    await launch(appId, opts);
    fake.current = 'interstitial';
  };
  return fake;
};

describe('the ladder gets one recovery pass, over the repeatable rungs only', () => {
  // The mirror of the escalation finding, measured the same day: `login` ends,
  // the biometrics interstitial arrives a network round-trip later — after
  // login's own `optional:` windows closed — and `dismiss_prompt`, the exact
  // cure, has already been consumed. One ensure_state call failed; an
  // immediately repeated, identical one passed, because it restarted the
  // ladder from rung 1.
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

  it('converges in ONE call, and the destructive rung still runs exactly once', async () => {
    const fake = lateInterstitial();
    const trace = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
    expect(fake.launches).toHaveLength(1); // one wipe, not two
    expect(fake.taps).toEqual(['not_now']); // rung 1 re-ran, and only after the wait timed out
    expect(trace.at(-1)).toEqual({
      action: 'state logged_in',
      detail: 'reached after recovery dismiss_prompt',
    });
  });

  it('never re-runs a destructive rung, even when it is not last', async () => {
    // "Non-last" is a convention about cheap preludes, not an invariant: a
    // clearState login can sit at index 0. Re-running it is a second wipe.
    // The last rung uses `optional:` so it COMPLETES and the pass arms in the
    // final wait's catch. The throwing-last-rung path reaches the same filter
    // by its own route, and has its own case in the describe below.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [login, settle]
flows:
  login:
    steps:
      - launch: { clearState: true }
  settle:
    steps:
      - optional: [ { tap: { id: never_there } } ]
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/waiting for state logged_in/);
    // no ↻ line: the only candidate was filtered out, so the pass had nothing
    // to run. Without the filter it would re-run login and wipe a second time.
    const trace = (error as FlowError).trace;
    expect(trace.some((t) => t.action.startsWith('↻ recovery'))).toBe(false);
    expect(fake.launches).toHaveLength(1); // the wipe was never repeated
  });

  it('sees a clearState nested inside branch/optional, not just at top level', async () => {
    // The recursive walk is the drift-prone part: a wipe buried in a branch arm
    // is still a wipe, and classifying it as cheap is how the recovery pass
    // would turn into a second registration burn. The branch condition holds on
    // every screen ON PURPOSE — a classifier that stops at the top level really
    // does wipe twice here, so this test fails when the recursion is removed.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [hidden_wipe, settle]
flows:
  hidden_wipe:
    steps:
      - optional:
          - branch:
              - when: { element: { id: app_root } }
                do:
                  - launch: { clearState: true }
  settle:
    steps:
      - optional: [ { tap: { id: never_there } } ]
`);
    resetLayout();
    const fake = new FakeAdapter(
      { home: screen(el({ identifier: 'app_root' }), el({ role: 'button', identifier: 'not_now' })) },
      'home',
    );
    await expect(FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/waiting for state logged_in/);
    expect(fake.launches).toHaveLength(1); // ran as rung 1; the pass would not touch it
  });

  it('spends its single pass across nested requires, not once per state', async () => {
    // `requires` nests a state's ladder inside a reach flow, so "at most once" has
    // to mean once per tool call. The inner state consumes the pass; the outer
    // one must then fail without a second.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [inner_gate, settle]
  gated:
    detect: { element: { id: never_there } }
    reach: [poke, settle]
flows:
  inner_gate:
    requires: gated
    steps:
      - optional: [ { tap: { id: never_there } } ]
  poke:
    steps:
      - optional: [ { tap: { id: not_now } } ]
  settle:
    steps:
      - optional: [ { tap: { id: never_there } } ]
`);
    const fake = new FakeAdapter(
      { interstitial: screen(el({ role: 'button', identifier: 'not_now' })) },
      'interstitial',
    );
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    const passes = (error as FlowError).trace.filter((t) => t.action.startsWith('↻ recovery'));
    expect(passes).toHaveLength(1);
    expect(passes[0]?.action).toBe('↻ recovery gated'); // the inner one spent it
  });

  it('spends its single pass across a run\'s state AND flow — one per tool call, a verify leg included', async () => {
    // 2026-10-07: a verify leg with a state and a flow is ONE run. Before,
    // it called two entries, each with its own budget, so the flow's
    // `requires` got a second pass after the state had spent the first.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss_prompt, login]
  gated:
    detect: { element: { id: never_there } }
    reach: [poke, settle]
flows:
  dismiss_prompt:
    steps:
      - tap: { id: not_now }
  login:
    steps:
      - launch: { clearState: true }
  poke:
    steps:
      - optional: [ { tap: { id: not_now } } ]
  settle:
    steps:
      - optional: [ { tap: { id: never_there } } ]
  behind_gate:
    requires: gated
    steps:
      - tap: { id: dashboard_root }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in', flow: 'behind_gate' })
      .catch((e: unknown) => e);
    const passes = (error as FlowError).trace.filter((t) => t.action.startsWith('↻ recovery'));
    expect(passes.map((t) => t.action)).toEqual(['↻ recovery logged_in']); // the state spent it; gated gets none
    expect((error as FlowError).message).toMatch(/waiting for state gated/);
    // ...and the trace says so, rather than reading as `requires:` not getting recovery at all.
    expect((error as FlowError).trace).toContainEqual({
      action: '↻ no recovery gated',
      detail: expect.stringMatching(/ — the run's one recovery pass was already spent on logged_in$/),
    });
    expect((error as FlowError).message).toContain("↻ no recovery gated: ");
  });

  it('honours destructive: true for a wipe a static walk cannot see', async () => {
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [log_out_and_back, login]
flows:
  log_out_and_back:
    destructive: true
    steps:
      - tap: { id: not_now }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = lateInterstitial();
    await expect(FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/Timed out/);
    expect(fake.taps).toEqual([]); // the interstitial was tappable; the flag kept us off it
  });

  it('follows requires: a prelude that needs a clearState state is not cheap', async () => {
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [prelude, login]
  registered:
    detect: { element: { id: never_there } }
    reach: [login]
flows:
  prelude:
    requires: registered
    steps:
      - tap: { id: not_now }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = lateInterstitial();
    await expect(FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' })).rejects.toThrow(/Timed out/);
    // prelude ran once as rung 1 (wiping via requires), and was not re-run
    expect(fake.launches).toHaveLength(2);
  });

  it('is bounded: a still-stuck run fails as before, with the pass in the trace', async () => {
    const screens = () => {
      resetLayout();
      return {
        stuck: screen(el({ role: 'button', identifier: 'not_now' })),
        dashboard: screen(el({ identifier: 'dashboard_root' })),
      };
    };
    const fake = new FakeAdapter(screens(), 'stuck'); // tapping never gets home
    const error = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/Timed out after \d+ms waiting for state logged_in/);
    const trace = (error as FlowError).trace;
    expect(trace.find((t) => t.action.startsWith('↻ recovery'))?.detail).toMatch(
      /re-running dismiss_prompt once/,
    );
    // rung 1 ran twice — ladder + recovery — and stopped there
    expect(fake.taps).toEqual(['not_now', 'not_now']);
    expect(fake.launches).toHaveLength(1);
  });

  it('re-checks detect after a recovery rung that threw', async () => {
    // The ladder's own rule, mirrored: a rung may reach the state and then die
    // on a later step. Escalating — or here, giving up — on that is how the
    // cure gets thrown away one step after it worked.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss, login]
flows:
  dismiss:
    steps:
      - tap: { id: not_now }
      - tap: { id: never_there }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = lateInterstitial();
    const trace = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
    expect(trace.find((t) => t.action === '⚠ recovery dismiss')?.detail).toMatch(/never_there/);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after recovery dismiss' });
    expect(fake.launches).toHaveLength(1);
  });

  it('a throwing recovery rung never replaces the original timeout', async () => {
    // What the caller must see is "I never got to logged_in", not whatever the
    // last-ditch re-run happened to trip over on its way to failing anyway.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [dismiss, login]
flows:
  dismiss:
    steps:
      - tap: { id: never_there }
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    // The headline is the real failure; the rung's own error is trace detail
    // (guard appends the whole trace to the message, so assert the first line).
    const headline = (error as Error).message.split('\n')[0];
    expect(headline).toMatch(/^Timed out after \d+ms waiting for state logged_in/);
    expect(headline).not.toMatch(/never_there/);
    const trace = (error as FlowError).trace;
    expect(trace.find((t) => t.action === '⚠ recovery dismiss')?.detail).toMatch(/never_there/);
  });

  it('does not fire when the state has a single reach flow', async () => {
    // Nothing to re-run: the only rung IS the anchor. Guards against a
    // recovery pass quietly re-running a lone login.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [login]
flows:
  login:
    steps:
      - launch: { clearState: true }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    const trace = (error as FlowError).trace;
    expect(trace.some((t) => t.action.startsWith('↻ recovery'))).toBe(false);
    expect(fake.launches).toHaveLength(1);
  });
});

describe('the last rung THROWING gets the same two chances as any other rung', () => {
  // The gap 0.5.0 shipped with, measured on device against it: the recovery
  // pass armed only in the final wait's catch, and a throwing last rung was
  // rethrown before ever reaching that wait. Real configs walk straight into
  // it — a login flow's success criterion is spelled as the flow's OWN
  // trailing `wait: { state: ... }`, so a late interstitial makes the rung
  // throw rather than the ladder time out. Same incident, no `↻ recovery`.
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
      - wait: { state: logged_in, timeout: 100ms }
`);

  it('converges in ONE call, and the destructive rung still runs exactly once', async () => {
    // The previously-VACUOUS shape, now as the positive case: this is the test
    // the 0.5.0 review found proved nothing, because the throw path skipped
    // the pass entirely and it passed with the destructiveness filter deleted.
    const fake = lateInterstitial();
    const trace = await FlowEngine.run(cfg, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
    expect(fake.launches).toHaveLength(1); // one wipe, not two
    expect(fake.taps).toEqual(['not_now']); // rung 1 re-ran, after the last rung threw
    expect(trace.find((t) => t.action === '↻ recovery logged_in')?.detail).toMatch(
      /^login failed — re-running dismiss_prompt once/,
    );
    expect(trace.at(-1)).toEqual({
      action: 'state logged_in',
      detail: 'reached after recovery dismiss_prompt',
    });
  });

  it('re-checks detect for the throwing rung before anything else', async () => {
    // The smaller half of the same rethrow: the ladder re-checks `detect`
    // after a rung that failed, because a flow can REACH the state and then
    // die on a later step — and the last rung alone jumped over that check.
    // Single-rung on purpose: the recovery pass has nothing to run here, so
    // only the detect can make this pass.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [login]
flows:
  login:
    steps:
      - launch: { clearState: false }
      - tap: { id: never_there }
`);
    resetLayout();
    const fake = new FakeAdapter(
      { out: screen(el({ role: 'button', identifier: 'login_button' })), dashboard: screen(el({ identifier: 'dashboard_root' })) },
      'out',
    );
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      await launch(appId, opts);
      fake.current = 'dashboard'; // the state IS reached when the trailing tap dies
    };
    const trace = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
    expect(trace.find((t) => t.action === '⚠ reach login')?.detail).toMatch(/never_there/);
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after login' });
  });

  it('checks detect BEFORE re-running anything — the order is load-bearing', async () => {
    // The two probes are not commutative, and getting them backwards is worse
    // than doing nothing: the state can already be on screen when the rung
    // dies, and a recovery rung is a real tap on a real device. Here the
    // dashboard carries its own `not_now` banner, so a pass that runs first
    // taps a LIVE screen and navigates off the very state that was reached —
    // turning a success into a failure, and spending the one recovery pass to
    // do it. Swapping the two lines in salvageThrowingLastRung survives every
    // other test in this file.
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
  login:
    steps:
      - launch: { clearState: false }
      - wait: { element: { id: never_there }, timeout: 100ms }
`);
    resetLayout();
    const fake = new FakeAdapter(
      {
        logged_out: screen(el({ role: 'button', identifier: 'login_button' })),
        // the banner sits ON the dashboard, and dismissing it navigates away
        dashboard: screen(el({ identifier: 'dashboard_root' }), el({ role: 'button', identifier: 'not_now' })),
        elsewhere: screen(el({ identifier: 'some_other_screen' })),
      },
      'logged_out',
      (id, self) => {
        if (id === 'not_now') self.current = 'elsewhere';
      },
    );
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      await launch(appId, opts);
      fake.current = 'dashboard'; // reached, and then the rung dies on its next step
    };
    const trace = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' });
    expect(trace.at(-1)).toEqual({ action: 'state logged_in', detail: 'reached after login' });
    expect(fake.taps).toEqual([]); // nothing was touched on the live screen
    expect(trace.some((t) => t.action.startsWith('↻ recovery'))).toBe(false); // pass still unspent
  });

  it('keeps the SetupError abort: a config mistake still buys no recovery', async () => {
    // The ladder exempts SetupError because re-running flows cannot fix a
    // broken descriptor. Salvage must inherit that exactly — an undeclared
    // credential in the last rung is not something rung 1 can clear.
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
  login:
    steps:
      - type: { value: $nonexistent }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/Unknown credential "\$nonexistent"/);
    expect((error as FlowError).trace.some((t) => t.action.startsWith('↻ recovery'))).toBe(false);
  });

  it('never re-runs a destructive rung, even when the LAST rung is what threw', async () => {
    // The filter is what makes the pass safe on a throw at all: "non-last" is
    // a convention about cheap preludes, and a clearState login can sit at
    // index 0. Without it this run wipes twice.
    const cfg2 = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  logged_in:
    detect: { element: { id: dashboard_root } }
    reach: [login, settle]
flows:
  login:
    steps:
      - launch: { clearState: true }
  settle:
    steps:
      - wait: { state: logged_in, timeout: 100ms }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    expect((error as Error).message).toMatch(/waiting for state logged_in/);
    const trace = (error as FlowError).trace;
    expect(trace.some((t) => t.action.startsWith('↻ recovery'))).toBe(false);
    expect(fake.launches).toHaveLength(1); // the wipe was never repeated
  });

  it('reports the failing rung, not whatever the salvage tripped over', async () => {
    // The caller must see why the login failed. The last-ditch re-run is
    // diagnostics and lives in the trace.
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
      - tap: { id: never_there }
  login:
    steps:
      - launch: { clearState: true }
      - wait: { element: { id: nothing_like_this }, timeout: 100ms }
`);
    const fake = lateInterstitial();
    const error = await FlowEngine.run(cfg2, fake, { ...FAST, reachRecheckMs: 20 }, { state: 'logged_in' }).catch((e: unknown) => e);
    const headline = (error as Error).message.split('\n')[0];
    expect(headline).toMatch(/nothing_like_this/); // the last rung's own failure
    expect(headline).not.toMatch(/never_there/); // not the salvage's
    const trace = (error as FlowError).trace;
    expect(trace.find((t) => t.action === '⚠ recovery dismiss_prompt')?.detail).toMatch(/never_there/);
    expect(fake.launches).toHaveLength(1);
  });
});

describe('a failing flow carries its trace', () => {
  it('appends the steps that ran to the error message, and keeps them structured', async () => {
    // The PIN keypad accepts the taps but the app never advances — the shape
    // of the finding: a timeout whose message alone says nothing about how far
    // the reach flow got.
    const fake = new FakeAdapter(buildScreens(), 'pin_login');
    const error = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' }).catch((e: unknown) => e);
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
    const error = await FlowEngine.run(CONFIG, fake, FAST, { flow: 'login' }).catch((e: unknown) => e);
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
    const error = await FlowEngine.run(cfg, fake, FAST, { flow: 'nope' }).catch((e: unknown) => e);
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
    const session = new EngineSession();
    const first = await FlowEngine.run(cfg, fake, { ...FAST, session }, { flow: 'cold' });
    expect(first).toContainEqual({
      action: '\u26a0 clearState',
      detail:
        'app state wiped (data container deleted) — anything the app persisted, ' +
        'a device registration included, is gone (1 this session)',
    });
    // A second tool call is a fresh engine; the count is the SESSION's, which
    // is the only scale at which a finite resource can be budgeted.
    const second = await FlowEngine.run(cfg, fake, { ...FAST, session }, { flow: 'cold' });
    expect(second.at(-2)?.detail).toContain('(2 this session)');
    expect(session.clearStateCount).toBe(2);
  });

  // The count used to be a module global the engine tests zeroed by hand
  // (2026-10-07): every engine continued whatever count the process had
  // reached. Now the count is the session's, and two sessions share nothing.
  it('two sessions count apart — nothing leaks from the runs of another', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await FlowEngine.run(cfg, fake, FAST, { flow: 'cold' });
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'cold' });
    expect(trace.at(-2)?.detail).toContain('(1 this session)');
  });

  it('stays silent when the launch preserves state', async () => {
    const trace = await FlowEngine.run(cfg, new FakeAdapter(buildScreens(), 'dashboard'), FAST, { flow: 'warm' });
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
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'open' });
    await FlowEngine.run(cfg, fake, FAST, { flow: 'share_qr' });
    expect(fake.launches).toEqual([
      { appId: 'md.bank.app', clearState: true, activity: '.MainActivity' },
      { appId: 'md.bank.app', activity: '.ShareActivity', intent: { action: 'android.intent.action.SEND' } },
    ]);
    expect(trace).toContainEqual({ action: 'launch', detail: 'md.bank.app/.MainActivity (state cleared)' });
  });

  // 2026-10-03, decided: app.android.activity applies only when the step
  // names neither an activity nor an intent — the launch_app rule, now the
  // one rule (flow/config.ts#resolveLaunchActivity). This test pinned the
  // opposite until then. The adapter scopes the activity-less intent to the
  // package (tests/adapters/android.test.ts).
  it('a step with an intent and no activity launches with the intent alone — app.android.activity stays out of it', async () => {
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app, activity: .MainActivity }
flows:
  share:
    steps:
      - launch:
          intent: { action: android.intent.action.SEND }
`);
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'share' });
    expect(fake.launches).toEqual([{ appId: 'md.bank.app', intent: { action: 'android.intent.action.SEND' } }]);
    expect(trace).toContainEqual({ action: 'launch', detail: 'md.bank.app' });
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

  // `warm` is a non-destructive rung on purpose (2026-10-06): a DESTRUCTIVE
  // rung behind a probe that never read a tree is refused instead of run —
  // tests/flow/unread-tree-ladder.test.ts pins that side.
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
      - launch: { clearState: false }
  smoke:
    steps:
      - launch: { clearState: true }
      - wait: { element: { id: dashboard_root }, timeout: 300 }
`);

  it('a wait: keeps polling through reads that fail while the app has no window yet', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, 3);
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'smoke' });
    expect(trace).toContainEqual({ action: 'wait', detail: 'element id:"dashboard_root"' });
  });

  it('a persistent read failure still times out, and the message carries the underlying error', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, Number.POSITIVE_INFINITY);
    await expect(FlowEngine.run(cfg, fake, FAST, { flow: 'smoke' })).rejects.toThrow(
      /Timed out after 300ms[\s\S]*last UI tree read failed: uiautomator dump returned no XML/,
    );
  });

  it('ensure_state treats an unreadable detect probe as "not in state" and runs the reach flows', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, 1); // exactly the first probe fails — the cold-launch case
    const trace = await FlowEngine.run(cfg, fake, FAST, { state: 'home' });
    expect(fake.launches).toEqual([{ appId: 'md.bank.app', clearState: false, activity: undefined, intent: undefined }]);
    expect(trace).toContainEqual({ action: 'state home', detail: 'reached after warm' });
  });

  // Until 2026-10-03 the detect probe swallowed its read error: a device that
  // was gone looked exactly like "not in this state", and the ladder escalated
  // with nothing in the trace saying it had never been asked.
  it('a detect probe that cannot read the tree says so in the trace — the ladder still runs, the reason is no longer silent', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    failingTree(fake, Number.POSITIVE_INFINITY);
    const error = await FlowEngine.run(cfg, fake, FAST, { state: 'home' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowError);
    expect((error as FlowError).trace).toContainEqual({
      action: '⚠ detect',
      detail: 'element id:"dashboard_root" treated as not detected — last UI tree read failed: ' + NULL_ROOT,
    });
    expect(fake.launches).toHaveLength(1); // the reach flow ran, as before
  });

  it('a detect probe that reads fine and simply misses adds NO such line', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const error = await FlowEngine.run(cfg, fake, FAST, { state: 'home' }).catch((e: unknown) => e);
    expect((error as FlowError).trace.some((t) => t.action === '⚠ detect')).toBe(false);
  });
});

describe('runFlow', () => {
  it('requires: runs ensureState first, then the flow steps', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await FlowEngine.run(CONFIG, fake, FAST, { flow: 'goto_transfers' });
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
    const trace = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' });
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
    await expect(FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' }))
      .rejects.toThrow(/Timed out/);
    // and the message must not contain any secret
    await expect(FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in' }))
      .rejects.not.toThrow(/hunter2secret/);
  });

  it('missing env var error names the variable and the credential', async () => {
    const fake = new FakeAdapter(buildScreens(), 'pin_login');
    await expect(FlowEngine.run(CONFIG, fake, { ...FAST, env: envWithout('TEST_PIN') }, { state: 'logged_in' }))
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
    await FlowEngine.run(cfg, fake, FAST, { flow: 'scroll_up' });
    expect(fake.swipes).toHaveLength(2);
    const { from, to } = fake.swipes[0];
    expect(from.x).toBe(to.x); // vertical gesture
    expect(to.y).toBeGreaterThan(from.y); // finger moves down
  });
});

describe('tap stability', () => {
  it("a tap: with two interactive matches taps the FIRST — the flow's 'first' policy — and traces the spec, not the choice", async () => {
    resetLayout();
    const first = el({ role: 'button', identifier: 'dup', label: 'A' });
    const second = el({ role: 'button', identifier: 'dup', label: 'B' });
    const fake = new FakeAdapter({ s: screen(first, second) }, 's');
    const points: { x: number; y: number }[] = [];
    const tap = fake.tap.bind(fake);
    fake.tap = async (x, y) => {
      points.push({ x, y });
      return tap(x, y);
    };
    const c = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - tap: { id: dup }
`);
    const trace = await FlowEngine.run(c, fake, FAST, { flow: 'f' });
    expect(points).toEqual([{ x: 50, y: first.rect.y + 5 }]); // the first button's centre, not the second's
    expect(trace).toContainEqual({ action: 'tap', detail: 'id:"dup"' }); // byte-identical to a one-match tap
  });

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
    await FlowEngine.run(CONFIG, fake, FAST, { flow: 'goto_transfers' });
    // tapped exactly once, at the settled position
    expect(fake.taps).toEqual(['tab_payments']);
    expect(poll).toBeGreaterThanOrEqual(4); // needed at least two identical polls after moving
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
  function scrollingFake(startY: number, perSwipe = 600, height = 40) {
    resetLayout();
    const target = node({
      role: 'button',
      identifier: 'submit_button',
      rect: { x: 0, y: startY, width: 100, height },
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
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' });
    expect(fake.swipes).toHaveLength(2);
    // content below → finger moves up
    expect(fake.swipes[0].to.y).toBeLessThan(fake.swipes[0].from.y);
    expect(trace).toContainEqual({
      action: 'scroll_until',
      detail: 'id:"submit_button" fully visible after 2 swipes',
    });
  });

  it('passes with 0 swipes when the element is already visible (fast path)', async () => {
    const fake = scrollingFake(500);
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' });
    expect(fake.swipes).toHaveLength(0);
    expect(trace).toContainEqual({
      action: 'scroll_until',
      detail: 'id:"submit_button" fully visible after 0 swipes',
    });
  });

  // ---- the 2026-08-27 finding: "visible" meant INTERSECTS, and said so to nobody.
  // A row clipped by the floating bottom-nav bar stopped the loop, reported a
  // bare "visible", and the next rect assert measured the CLIPPED box — sending
  // the investigation at the app's row-height logic, which was correct.

  const cfgFully = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  to_submit:
    steps:
      - scroll_until: { element: { id: submit_button }, maxSwipes: 4, timeout: 2s, fully: true }
`);

  it('reports the CLIPPED fraction instead of a bare "visible" when the element straddles an edge', async () => {
    // 40px tall, stopping at y=1980 in a 1000x2000 viewport → half of it below the fold.
    const fake = scrollingFake(2580);
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' });
    const row = trace.find((t) => t.action.endsWith('scroll_until'));
    expect(row?.detail).toContain('CLIPPED at bottom');
    expect(row?.detail).toContain('50% of it is in the viewport');
    // The caller is told what it costs them, in the terms of their next call.
    expect(row?.detail).toContain('will measure the CLIPPED box');
    // ...and the row is marked, so it is visible in a long trace.
    expect(row?.action).toBe('⚠ scroll_until');
  });

  it('fully: true keeps swiping past a clipped stop until the element is entirely inside', async () => {
    const fake = scrollingFake(2580);
    const trace = await FlowEngine.run(cfgFully, fake, FAST, { flow: 'to_submit' });
    expect(fake.swipes).toHaveLength(2); // the default would have stopped at 1
    expect(trace).toContainEqual({
      action: 'scroll_until',
      detail: 'id:"submit_button" fully visible after 2 swipes',
    });
  });

  it('fully: true names the real defect when the content is exhausted and the element STAYS clipped', async () => {
    // The measured shape: a scroll container with no clearance for an overlay.
    // No amount of swiping can reveal the last row, so more swipes is the wrong
    // diagnosis and the message must say which one is right.
    const fake = scrollingFake(1980, 0); // clipped at bottom, swipes move nothing
    await expect(FlowEngine.run(cfgFully, fake, FAST, { flow: 'to_submit' })).rejects.toThrow(
      /CLIPPED at bottom, 50% of it is in the viewport, and the content is exhausted/,
    );
    await expect(FlowEngine.run(cfgFully, scrollingFake(1980, 0), FAST, { flow: 'to_submit' })).rejects.toThrow(
      /cannot be fully revealed — that is a layout defect/,
    );
  });

  it('never rounds a clipped element up to a reassuring 100%', async () => {
    // A sub-pixel clip is still a clip: the line exists to say something is
    // missing, so "CLIPPED at bottom, 100% of it is in the viewport" would
    // contradict itself in the one place a reader is looking for the shortfall.
    //
    // The element must be TALL enough for the clamp to be reachable: at 400 px
    // high with 399 inside, the fraction is 99.75% and rounds to 100. A 40 px
    // element tops out at 97.5% and would pass this test with the clamp
    // deleted — a pin that cannot fail cannot distinguish itself from no check.
    const fake = scrollingFake(1601, 600, 400); // 399 of 400 px inside → 99.75%
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' });
    const row = trace.find((t) => t.action.endsWith('scroll_until'));
    expect(row?.detail).toContain('CLIPPED at bottom');
    expect(row?.detail).toContain('99% of it is in the viewport');
    expect(row?.detail).not.toContain('100% of it is in the viewport');
  });

  it('the NEGATIVE half: a genuinely off-screen element still fails as before', async () => {
    const fake = scrollingFake(50_000, 10);
    await expect(FlowEngine.run(cfgFully, fake, FAST, { flow: 'to_submit' })).rejects.toThrow(
      /never intersected the 1000x2000 viewport/,
    );
  });

  it('fails after maxSwipes with a diagnosis of the last tree', async () => {
    const fake = scrollingFake(50_000, 10); // never gets there in 4 swipes
    await expect(FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' })).rejects.toThrow(
      /scroll_until id:"submit_button" failed after 4 swipes \(maxSwipes\) — element in tree but never intersected/,
    );
  });

  it('reports when the element never appeared at all', async () => {
    resetLayout();
    const fake = new FakeAdapter({ form: screen(el({ identifier: 'form_root' })) }, 'form');
    await expect(FlowEngine.run(cfg, fake, FAST, { flow: 'to_submit' })).rejects.toThrow(
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
    const trace = await FlowEngine.run(cfg('{ id: amount_input, value: "2.50" }'), fake, FAST, { flow: 'f' });
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['2.50']);
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" = 2.50' });
  });

  it('clear: true through YAML wipes the pre-filled value before typing, and the trace says (cleared)', async () => {
    const fake = formFake('2.50');
    const trace = await FlowEngine.run(cfg('{ id: amount_input, value: "7", clear: true }'), fake, FAST, { flow: 'f' });
    expect(fake.deletes).toEqual([4]); // "2.50".length — the step's `clear` reached the fill
    expect(fake.typed).toEqual(['7']);
    expect(fake.focused?.value).toBe('7');
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" = 7 (cleared)' });
  });

  it('a fill on a field that never appears fails within the TAP budget, with the settle wording', async () => {
    const fake = formFake();
    const started = Date.now();
    await expect(
      FlowEngine.run(cfg('{ id: nope, value: "1" }'), fake, { ...FAST, tapTimeoutMs: 120 }, { flow: 'f' }),
    ).rejects.toThrow(/Timed out after 120ms waiting for element id:"nope" to appear/);
    expect(Date.now() - started).toBeLessThan(FAST.waitTimeoutMs); // not some other budget
    expect(fake.taps).toEqual([]);
  });

  it('dismissKeyboard presses AFTER the text landed, never before', async () => {
    const fake = formFake();
    fake.attachKeyboard(); // an Android fake: the dismissal is `back`
    const order: string[] = [];
    const typeText = fake.typeText.bind(fake);
    fake.typeText = async (t: string) => {
      order.push(`type:${t}`);
      return typeText(t);
    };
    fake.pressKey = async (k) => {
      order.push(`key:${k}`);
    };

    await FlowEngine.run(cfg('{ id: amount_input, value: "2.50", dismissKeyboard: true }'),
      fake,
      FAST, { flow: 'f' });

    // Dismissing first would close the keyboard the typing needs.
    expect(order).toEqual(['type:2.50', 'key:back']);
  });

  // The fill's mechanics (clear retries, verified typing, the masked-value
  // length rule, autofill/re-entry re-reads, per-platform keyboard dismissal)
  // are pinned in tests/interact/fill.test.ts since 2026-10-03. What stays
  // here is the STEP: the YAML reaching the fill, and the trace it writes.
  const appendBullets = (fake: ReturnType<typeof formFake>) => {
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      if (fake.focused) fake.focused.value = (fake.focused.value ?? '') + '•'.repeat(text.length);
    };
  };

  it('typing onto a pre-filled masked field without clear is a legal APPEND — it passes, with a ⚠ fill warning', async () => {
    // The length rule cannot see content, so it cannot tell this from a correct
    // fill (finportal 2026-09-17: the backend said invalid_grant). The trace says it.
    const fake = formFake('•'.repeat(20));
    appendBullets(fake);
    const trace = await FlowEngine.run(cfg('{ id: amount_input, value: "hunter2-password" }'), fake, FAST, { flow: 'f' });
    expect(fake.focused?.value).toHaveLength(36);
    expect(trace).toContainEqual({
      action: '⚠ fill',
      detail: 'id:"amount_input": masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    });
  });

  it('a failing fill never presses the dismiss key', async () => {
    const fake = formFake('9.99');
    const keys: string[] = [];
    fake.pressKey = async (k) => {
      keys.push(k);
    };
    fake.typeText = async (text: string) => {
      fake.typed.push(text); // nothing lands
    };
    await expect(
      FlowEngine.run(cfg('{ id: amount_input, value: "12.34", dismissKeyboard: true }'), fake, FAST, { flow: 'f' }),
    ).rejects.toThrow(/typed 5 characters/);
    expect(keys).toEqual([]);
  });

  it('the ⚠ fill warning is in the trace even when dismissing the keyboard then throws (review 2026-10-03)', async () => {
    const fake = formFake('•'.repeat(20));
    fake.attachKeyboard(); // an Android fake (window state unknown → back): the in-tree model presses no key since stage B
    appendBullets(fake);
    fake.pressKey = async () => {
      throw new Error('idb ui key: timed out');
    };
    const error = await FlowEngine.run(cfg('{ id: amount_input, value: "hunter2-password", dismissKeyboard: true }'), fake, FAST, { flow: 'f' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowError);
    const { trace } = error as FlowError;
    expect(trace.map((t) => t.action)).toEqual(['flow f', '⚠ fill', '✗ fill id:"amount_input"']);
    expect(trace[1].detail).toContain('typing APPENDS');
  });

  // Measured 2026-09-17 (finportal): steps logged only on success, so the trace
  // ended on `fill: id:"login_username"` while the PASSWORD fill was failing.
  it('the FAILING step is named in the trace with a ✗ line (steps used to log only on success)', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
    };
    await expect(
      FlowEngine.run(cfg('{ id: amount_input, value: "12.34" }'), fake, FAST, { flow: 'f' }),
    ).rejects.toThrow(/✗ fill id:"amount_input".*failed — fill: typed 5 characters/s);
  });

  it('a failure inside a bare `branch` logs exactly ONE ✗ — the innermost step, not the branch too', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
    };
    const c = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - branch:
          - when: { element: { id: amount_input } }
            do:
              - fill: { id: amount_input, value: "12.34" }
`);
    const err = await FlowEngine.run(c, fake, FAST, { flow: 'f' }).then(() => undefined, (e: Error) => e);
    const crosses = (err?.message ?? '').split('\n').filter((l) => l.includes('✗'));
    expect(crosses).toHaveLength(1);
    expect(crosses[0]).toContain('✗ fill id:"amount_input"');
  });

  it('a failure swallowed by `optional` — even through a `branch` — logs `skipped`, never ✗', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
    };
    const c = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - optional:
          - branch:
              - when: { element: { id: amount_input } }
                do:
                  - fill: { id: amount_input, value: "12.34" }
`);
    const trace = await FlowEngine.run(c, fake, FAST, { flow: 'f' });
    expect(trace.some((t) => t.action.startsWith('✗'))).toBe(false);
    // The field WAS found and tapped: until 2026-10-08 this pinned "skipped
    // step (not present)", the engine's guess. Which reason the skip quotes
    // is the table's below; this test is about the branch in between.
    expect(trace).toContainEqual({ action: 'optional', detail: expect.stringMatching(/^skipped step \(fill: typed /) });
  });

  /**
   * One fact, one table (2026-10-08): an `optional:` step is skipped "(not
   * present)" exactly when the interaction module threw ElementNotFoundError, and
   * with its own headline otherwise — every row is still skipped, none ✗.
   */
  describe('optional: — "(not present)" only when interact never found the element', () => {
    const optionalFlow = (inner: string) =>
      parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - optional:
          - ${inner}
`);
    const skipOf = async (fake: FakeAdapter, inner: string) => {
      const trace = await FlowEngine.run(optionalFlow(inner), fake, FAST, { flow: 'f' });
      expect(trace.some((t) => t.action.startsWith('✗'))).toBe(false);
      return trace.filter((t) => t.action === 'optional').map((t) => t.detail);
    };

    it('a fill whose field is ABSENT: skipped step (not present), nothing typed', async () => {
      const fake = formFake();
      expect(await skipOf(fake, 'fill: { id: nope, value: "1" }')).toEqual(['skipped step (not present)']);
      expect(fake.taps).toEqual([]);
      expect(fake.typed).toEqual([]);
    });

    it('a fill whose field is FOUND but the text does not land: skipped with the fill\'s headline, not (not present)', async () => {
      const fake = formFake('9.99');
      fake.typeText = async (text: string) => {
        fake.typed.push(text);
      };
      expect(await skipOf(fake, 'fill: { id: amount_input, value: "12.34" }')).toEqual([
        'skipped step (fill: typed 5 characters but the field shows 4 (content withheld from this error))',
      ]);
      expect(fake.taps).toEqual(['amount_input']);
    });

    it('a fill REFUSED for a control character (nothing tapped): skipped with the refusal, not (not present)', async () => {
      const fake = formFake();
      const [detail] = await skipOf(fake, 'fill: { id: amount_input, value: "1\\n2" }');
      expect(detail).toMatch(/^skipped step \(cannot type U\+000A \("\\n", a control character\): it is a key, not text/);
      expect(fake.taps).toEqual([]);
      expect(fake.typed).toEqual([]);
    });

    it('a wait that times out is skipped with its own timeout, which names what it waited for', async () => {
      const fake = formFake();
      const [detail] = await skipOf(fake, 'wait: { element: { id: nope }, timeout: 20ms }');
      expect(detail).toMatch(/^skipped step \(Timed out after 20ms waiting for /);
    });

    it('a branch whose arms never match is skipped with its own timeout, which names the conditions', async () => {
      const fake = formFake();
      const [detail] = await skipOf(fake, 'branch: [ { when: { element: { id: nope } }, do: [ { tap: { id: submit_button } } ] } ]');
      expect(detail).toBe(`skipped step (Timed out after ${FAST.waitTimeoutMs}ms waiting for any branch condition (element id:"nope"))`);
      expect(fake.taps).toEqual([]);
    });

    it('a scroll_until whose element never appears in any read: skipped step (not present)', async () => {
      const fake = formFake();
      expect(await skipOf(fake, 'scroll_until: { element: { id: nope }, maxSwipes: 2 }')).toEqual(['skipped step (not present)']);
    });

    it('a tap on a DEAD device is not (not present): the skip carries the read error, so it never reads as a slow screen', async () => {
      const fake = formFake();
      fake.uiTree = async () => {
        throw new Error('device offline');
      };
      expect(await skipOf(fake, 'tap: { id: promo_close }')).toEqual([
        `skipped id:"promo_close" (Timed out after ${FAST.optionalTimeoutMs}ms waiting for element id:"promo_close" to appear ` +
          '(last UI tree read failed: device offline))',
      ]);
    });

    // Code review 2026-10-08, against the spec card: a failure after the
    // element was found stays another error. The tap's own resolution never
    // saw it, but the presence check did — so the skip quotes the tap.
    it('a tap SIGHTED by the presence check that then leaves for the whole tap budget: the tap\'s timeout, not (not present)', async () => {
      const fake = formFake();
      const real = fake.uiTree.bind(fake);
      let reads = 0;
      fake.uiTree = async () => {
        const tree = await real();
        if (reads++ > 0) tree.children = tree.children?.filter((c) => c.identifier !== 'submit_button');
        return tree;
      };
      expect(await skipOf(fake, 'tap: { id: submit_button }')).toEqual([
        `skipped id:"submit_button" (Timed out after ${FAST.tapTimeoutMs}ms waiting for element id:"submit_button" to appear)`,
      ]);
      expect(fake.taps).toEqual([]);
    });
  });

  describe('stepSummary — the ✗ line names the step and its selector, never a value', () => {
    const cases: [Step, string][] = [
      [{ tap: { id: 'pay', timeout: '5s' } }, 'tap id:"pay"'],
      [{ tap: { role: 'button', label: 'Pay' } }, 'tap role:"button" label:"Pay"'],
      [{ fill: { id: 'pw', value: 'hunter2', clear: true } }, 'fill id:"pw"'],
      [{ fill: { role: 'textfield', value: 'hunter2' } }, 'fill role:"textfield"'],
      [{ wait: { element: { id: 'home' }, timeout: '20s' } }, 'wait id:"home"'],
      [{ wait: { state: 'logged_in' } }, 'wait state:"logged_in"'],
      [{ scroll_until: { element: { id: 'row_9' } } }, 'scroll_until id:"row_9"'],
      [{ type: { value: 'hunter2' } }, 'type'],
      [{ type_pin: { value: '1234' } }, 'type_pin'],
      [{ swipe: { direction: 'up' } }, 'swipe up'],
      [{ launch: {} }, 'launch'],
      [{ ios: { tap: { id: 'ios_only' } } }, 'tap id:"ios_only"'],
    ];
    for (const [step, want] of cases) {
      it(`${JSON.stringify(step)} → ${want}`, () => {
        const got = stepSummary(step, 'ios');
        expect(got).toBe(want);
        expect(got).not.toContain('hunter2');
        expect(got).not.toContain('1234');
      });
    }
  });

  it('a type: step holding a control character is refused before anything is typed (interact/type-text.ts)', async () => {
    const c = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - type: { value: "a\\nb" }
`);
    const fake = formFake();
    await expect(FlowEngine.run(c, fake, FAST, { flow: 'f' })).rejects.toThrow('cannot type U+000A');
    expect(fake.typed).toEqual([]);
  });

  it('redacts credential values in the fill trace', async () => {
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
    const trace = await FlowEngine.run(cfgSecret, fake, { ...FAST, env: { TEST_PIN: '4321' } }, { flow: 'f' });
    expect(JSON.stringify(trace)).not.toContain('4321');
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" = ***' });
  });

  // 2026-10-07 (docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md):
  // "" is typed as a no-op on both platforms now, so a credential whose
  // variable is set but EMPTY (`TEST_PIN=` in .env.averi) must fail the step
  // before the device is touched — it would otherwise pass as `***` and the
  // bank would reject it one screen later. A literal "" is a different thing:
  // a clear, or a focus without typing, and stays a passing step.
  it('a credential whose variable is set but empty fails the fill before the field is tapped', async () => {
    const cfgSecret = parseConfig(`
app: { android: { package: md.bank.app } }
credentials:
  pin: \${TEST_PIN}
flows:
  f:
    steps:
      - fill: { id: amount_input, value: $pin, clear: true }
`);
    const fake = formFake();
    await expect(FlowEngine.run(cfgSecret, fake, { ...FAST, env: { TEST_PIN: '' } }, { flow: 'f' })).rejects.toThrow(
      /TEST_PIN is set but empty \(needed for credential "pin"\)/,
    );
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
  });

  it('a literal value: "" is not a credential: with clear it clears the field and the step passes', async () => {
    const cfgLiteral = parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - fill: { id: amount_input, value: "", clear: true }
`);
    const fake = formFake('9.99');
    const trace = await FlowEngine.run(cfgLiteral, fake, FAST, { flow: 'f' });
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([4]); // "9.99".length
    expect(trace).toContainEqual({ action: 'fill', detail: 'id:"amount_input" =  (cleared)' });
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
    const trace = await FlowEngine.run(cfg('          - { element: { id: dashboard_root } }'), fake, FAST, { flow: 'f' });
    expect(trace).toContainEqual({ action: 'assert PASS', detail: 'element id:"dashboard_root" exists' });
  });

  it('a failing assert fails the FLOW with the diff in the error', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await expect(
      FlowEngine.run(cfg('          - { element: { text: "No such text" } }'), fake, FAST, { flow: 'f' }),
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
    const trace = await FlowEngine.run(cfg, fakeOn('transactions'), FAST, { state: 'transactions_only' });
    expect(trace).toEqual([{ action: 'state transactions_only', detail: 'already active' }]);
  });

  it('does not match while the discriminator is visible', async () => {
    await expect(FlowEngine.run(cfg, fakeOn('cards'), FAST, { state: 'transactions_only' })).rejects.toThrow(
      /no reach flows/,
    );
  });

  it('treats an off-viewport node as absent (portable across the platform tree semantics)', async () => {
    const trace = await FlowEngine.run(cfg, fakeOn('cards_offscreen'), FAST, { state: 'transactions_only' });
    expect(trace).toEqual([{ action: 'state transactions_only', detail: 'already active' }]);
  });
});

describe('failure modes', () => {
  it('branch with no matching arm times out with the tried conditions', async () => {
    resetLayout();
    const fake = new FakeAdapter({ blank: screen(el({ role: 'text', identifier: 'something_else' })) }, 'blank');
    await expect(FlowEngine.run(CONFIG, fake, FAST, { flow: 'login' }))
      .rejects.toThrow(/any branch condition.*pin_keyboard.*username_field/);
  });

  it('unknown state and flow names produce helpful errors', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    await expect(FlowEngine.run(CONFIG, fake, FAST, { state: 'nirvana' })).rejects.toThrow(
      /Unknown state "nirvana" — known: logged_in/,
    );
    await expect(FlowEngine.run(CONFIG, fake, FAST, { flow: 'fly' })).rejects.toThrow(
      /Unknown flow "fly" — known: login, goto_transfers/,
    );
  });
});

/**
 * One tool call = one engine run (2026-10-07, flow-engine review candidate 1).
 * The engine had two entries that each reset the trace, and `verify` called
 * both on one instance; now a run names a state, a flow or both, and owns one
 * trace for all of it.
 */
describe('run — the one entry', () => {
  it('a state and a flow in one run: a failing flow\'s FlowError carries the state\'s lines too', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const err = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in', flow: 'fly' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FlowError);
    expect((err as FlowError).trace).toContainEqual({ action: 'state logged_in', detail: 'already active' });
    expect((err as FlowError).message).toContain('Steps that ran before the failure:\nstate logged_in: already active');
  });

  it('runRequestOf: the request two optional names make — an empty one is none', () => {
    expect(runRequestOf('home', 'pay')).toEqual({ state: 'home', flow: 'pay' });
    expect(runRequestOf('home', undefined)).toEqual({ state: 'home', flow: undefined });
    expect(runRequestOf('', 'pay')).toEqual({ flow: 'pay' });
    expect(runRequestOf(undefined, '')).toBeUndefined();
    expect(runRequestOf()).toBeUndefined();
  });

  it('the state runs before the flow', async () => {
    const fake = new FakeAdapter(buildScreens(), 'dashboard');
    const trace = await FlowEngine.run(CONFIG, fake, FAST, { state: 'logged_in', flow: 'goto_transfers' });
    expect(trace[0]).toEqual({ action: 'state logged_in', detail: 'already active' });
    expect(trace.at(-1)?.action).toBe('flow goto_transfers');
  });

  // Two shapes, not two runtime checks: the constructor is private, so the
  // static `run` is the only way in and an engine cannot be run twice; and a
  // request must name a state or a flow. `npm run lint` type-checks this file,
  // so each @ts-expect-error fails the build the day its rule loosens.
  it('the engine is only reachable through one run, and a run must name something', () => {
    // @ts-expect-error — a request must name a state, a flow, or both
    const nothing: RunRequest = {};
    // @ts-expect-error — a run must be handed its session: an omitted one silently reset the count per call
    const sessionless: EngineOptions = { env: {} };
    // @ts-expect-error — the constructor is private: build-and-keep is not a shape the engine offers
    const kept = (cfg: AveriConfig, a: FakeAdapter) => new FlowEngine(cfg, a, FAST);
    expect([nothing, sessionless, typeof kept]).toEqual([{}, { env: {} }, 'function']);
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

  // The environments' variables on top of the base ones — a value handed to
  // the engine, so no test here sets or scrubs the process environment.
  const ENV_USERS = { ...TEST_ENV, TEST_ALFONS_USER: 'martha.key', TEST_STARTERKIT_USER: 'starter.user' };
  const MULTI = { ...FAST, env: ENV_USERS };

  it('types the selected environment’s username and the shared password', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    await FlowEngine.run(MULTI_ENV, fake, { ...MULTI, environment: 'starterkit' }, { flow: 'type_username' });
    // username from the environment, password inherited from base credentials
    expect(fake.typed).toEqual(['starter.user', 'hunter2secret']);
  });

  it('switching environment switches the username without touching averi.yaml', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    // AVERI_ENV comes from the same environment value (.env.averi can set it), not from the process
    await FlowEngine.run(MULTI_ENV, fake, { ...MULTI, env: { ...ENV_USERS, AVERI_ENV: 'alfons_dev' } }, { flow: 'type_username' });
    expect(fake.typed[0]).toBe('martha.key');
  });

  it('names the active environment in the trace so a mix-up is visible', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const trace = await FlowEngine.run(MULTI_ENV, fake, { ...MULTI, environment: 'starterkit' }, { flow: 'type_username' });
    expect(trace[0]).toEqual({ action: 'environment starterkit', detail: 'overrides: username' });
  });

  it('an environment that overrides nothing is still the first trace line, with no detail', async () => {
    // Pins the no-override form of the line (the names come from
    // Credentials.overriddenNames since 2026-10-05; the wording must not move).
    const cfg = { ...MULTI_ENV, environments: { ...MULTI_ENV.environments, mirror: { credentials: {} } } };
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const trace = await FlowEngine.run(cfg, fake, { ...MULTI, environment: 'mirror' }, { flow: 'type_username' });
    expect(trace[0]).toEqual({ action: 'environment mirror' });
  });

  it('keeps environment usernames redacted from the trace', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const trace = await FlowEngine.run(MULTI_ENV, fake, { ...MULTI, environment: 'starterkit' }, { flow: 'type_username' });
    expect(JSON.stringify(trace)).not.toContain('starter.user');
  });

  it('refuses an unknown environment at construction — before any step (the run layer refuses it before any device)', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    await expect(FlowEngine.run(MULTI_ENV, fake, { ...MULTI, environment: 'nope' }, { flow: 'type_username' })).rejects.toThrow(
      /Unknown environment "nope"/,
    );
    expect(fake.taps).toEqual([]);
  });

  it('points at the environment when its env var is missing', async () => {
    const fake = new FakeAdapter(buildScreens(), 'fresh_login');
    const { TEST_STARTERKIT_USER: _unset, ...withoutStarterkit } = ENV_USERS;
    await expect(
      FlowEngine.run(MULTI_ENV, fake, { ...MULTI, env: withoutStarterkit, environment: 'starterkit' }, { flow: 'type_username' }),
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
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'f' });
    expect(fake.taps).toEqual(['pin_keyboard']);
    expect(trace).toContainEqual({ action: 'branch', detail: 'matched element id:"pin_keyboard"' });
  });

  it('falls through to a later arm when the earlier condition does not hold', async () => {
    resetLayout();
    const fake = new FakeAdapter({ fresh: screen(el({ identifier: 'username_field' })) }, 'fresh');
    await FlowEngine.run(cfg, fake, FAST, { flow: 'f' });
    expect(fake.taps).toEqual(['username_field']);
  });
});

describe('tap: / fill: under the Android soft keyboard — the one trace line that says the keyboard was hidden', () => {
  // The measured screen (finportal login, 1080x2220, 2026-10-03); the policy
  // itself is pinned in tests/interact/keyboard-window.test.ts. Here: the STEP, and
  // the trace it writes.
  const KEYBOARD = { x: 0, y: 1285, width: 1080, height: 935 };
  function loginFake() {
    const fake = new FakeAdapter(
      {
        login: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 1080, height: 2220 },
          children: [
            node({ role: 'textfield', identifier: 'login_password', rect: { x: 99, y: 1100, width: 882, height: 132 } }),
            node({ role: 'button', identifier: 'login_submit', rect: { x: 99, y: 1400, width: 300, height: 132 } }),
            node({ role: 'textfield', identifier: 'login_otp', rect: { x: 99, y: 1600, width: 882, height: 132 } }),
          ],
        }),
      },
      'login',
    );
    fake.attachKeyboard(); // Android: the oracle is there, answering `unknown` until a test sets it
    fake.onKey = (key, self) => {
      // adjustResize: the keyboard goes, everything below the password field moves down 300 px.
      if (key === 'back') for (const n of self.live().children.slice(1)) n.rect.y += 300;
    };
    return fake;
  }
  const flow = (step: string) =>
    parseConfig(`
app: { android: { package: md.bank.app } }
flows:
  f:
    steps:
      - ${step}
`);

  it('a tap: under the keyboard logs ONE ⚠ tap line before the tap line, and taps the re-resolved point', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const trace = await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(trace).toEqual([
      { action: 'flow f', detail: 'start' },
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; hidden before tapping' },
      { action: 'tap', detail: 'id:"login_submit"' },
      { action: 'flow f', detail: 'done' },
    ]);
    expect(fake.keys).toEqual(['back']);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1766 }]); // 1400 + 300 + 66, not the stale 1466
  });

  it.each([
    ['unknown (the adapter cannot tell — every flow before 2026-10-03)', { state: 'unknown' as const }],
    ['hidden', { state: 'hidden' as const }],
    ['shown, but not over the target', { state: 'shown' as const, frame: { ...KEYBOARD, y: 1900, height: 320 } }],
  ])('a tap: that meets no keyboard traces exactly what it always did — keyboard %s', async (_name, keyboard) => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = keyboard;
    const trace = await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(JSON.stringify(trace)).toBe('[{"action":"flow f","detail":"start"},{"action":"tap","detail":"id:\\"login_submit\\""},{"action":"flow f","detail":"done"}]');
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
  });

  it('a fill: whose field lies under the keyboard logs ONE ⚠ fill line before the fill line', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const trace = await FlowEngine.run(flow('fill: { id: login_otp, value: "123456" }'), fake, FAST, { flow: 'f' });
    expect(trace).toEqual([
      { action: 'flow f', detail: 'start' },
      { action: '⚠ fill', detail: 'the soft keyboard covered id:"login_otp"; hidden before tapping' },
      { action: 'fill', detail: 'id:"login_otp" = 123456' },
      { action: 'flow f', detail: 'done' },
    ]);
    expect(fake.keys).toEqual(['back']);
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1966 }]);
    expect(fake.typed).toEqual(['123456']);
  });

  it('a fill: clear of the keyboard traces the one fill line, as before', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const trace = await FlowEngine.run(flow('fill: { id: login_password, value: "123456" }'), fake, FAST, { flow: 'f' });
    expect(JSON.stringify(trace)).toBe('[{"action":"flow f","detail":"start"},{"action":"fill","detail":"id:\\"login_password\\" = 123456"},{"action":"flow f","detail":"done"}]');
    expect(fake.keys).toEqual([]);
  });

  it('a keyboard that stays: the step fails with the recovery error and nothing is tapped', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    };
    const error = (await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.message).toMatch(/Pressed back to hide the soft keyboard covering id:"login_submit", but back did not close it/);
    expect(error.message).toMatch(
      /In a flow: no step can recover this — the screen keeps a keyboard that back does not close over id:"login_submit" — fix the screen \(or the test data\) so the target is not under the keyboard$/,
    );
    expect(fake.taps).toEqual([]);
    // The ⚠ line is worded for the ATTEMPT and precedes the ✗ line.
    expect(error.trace.slice(1).map((t) => t.action)).toEqual(['⚠ tap', '✗ tap id:"login_submit"']);
    expect(error.trace[1].detail).toBe('the soft keyboard covered id:"login_submit"; back pressed');
  });

  it('back NAVIGATED AWAY (the keyboard had gone by the key press): the trace shows ⚠ tap … back pressed, then a ✗ line that names back', async () => {
    const fake = loginFake();
    const raced = new FakeAdapter({ login: fake.live(), previous: screen(node({ role: 'text', identifier: 'previous_title' })) }, 'login');
    raced.backTo = 'previous';
    raced.attachKeyboard({ state: 'unknown' }, 'shown'); // the input method agrees, wrongly: nothing could have vetoed this back
    raced.attachedKeyboard.state = async () => ({ state: 'shown', frame: KEYBOARD }); // the adapter saw one; none is up when back lands
    const error = (await FlowEngine.run(flow('tap: { id: login_submit }'), raced, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(raced.current).toBe('previous');
    expect(error.trace.slice(1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; back pressed' },
      {
        action: '✗ tap id:"login_submit"',
        detail:
          'failed — After pressing back to hide the soft keyboard that covered id:"login_submit" at (249,1466): Timed out after ' +
          `${FAST.tapTimeoutMs}ms waiting for element id:"login_submit" to appear. If no keyboard was really up at ` +
          'that moment, back may have navigated away — check the screen (ui_snapshot / screenshot)',
      },
    ]);
  });

  it('the window state was STALE and cleared while averi waited: ONE ⚠ tap line that explains the wait, no back, the tap', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    fake.attachedKeyboard.windowAnswers.queue = [{ state: 'shown', frame: KEYBOARD }, { state: 'shown', frame: KEYBOARD }, { state: 'hidden' }];
    const trace = await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1)).toEqual([
      {
        action: '⚠ tap',
        detail: 'the window state reported a soft keyboard over id:"login_submit" that the input method denied; waited 1000ms for it to clear',
      },
      { action: 'tap', detail: 'id:"login_submit"' },
    ]);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
  });

  it('the two sources NEVER agree: the step fails with the refusal, a ⚠ tap line saying they disagreed precedes the ✗, and nothing was sent', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    const error = (await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1)).toEqual([
      { action: '⚠ tap', detail: 'the window state reported a soft keyboard over id:"login_submit" that the input method denied; nothing sent' },
      {
        action: '✗ tap id:"login_submit"',
        detail:
          'failed — The window state reports a soft keyboard over id:"login_submit" — its frame [0,1285][1080,2220] contains the tap ' +
          'point (249,1466) — but the input method says no keyboard is shown, and the two still disagreed after 3000ms. Neither back ' +
          'nor the tap was sent: back would navigate away if no keyboard is up, and the tap would press a key if one is. From the MCP ' +
          'tools: look at the screen (ui_snapshot / screenshot), then tap again, or press_key back yourself if a keyboard is visibly ' +
          'up. In a flow: wait for an element or state that only holds once the screen has settled after the previous step ' +
          '(wait: { element: … } / wait: { state: … }), or fix the screen so the target is not under a keyboard — no flow step ' +
          'waits on the keyboard itself',
      },
    ]);
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual([]);
  });

  it('a fill: refused the same way traces ⚠ fill … nothing sent before its ✗, and types nothing', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    const error = (await FlowEngine.run(flow('fill: { id: login_otp, value: "123456" }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1).map((t) => t.action)).toEqual(['⚠ fill', expect.stringMatching(/^✗ fill/)]);
    expect(error.trace[1].detail).toBe('the window state reported a soft keyboard over id:"login_otp" that the input method denied; nothing sent');
    expect(fake.typed).toEqual([]);
  });

  it('an optional: tap refused that way is skipped with the refusal\'s headline, not "(not present)"', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    const trace = await FlowEngine.run(flow('optional: [ { tap: { id: login_submit } } ]'), fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1).map((t) => t.action)).toEqual(['⚠ tap', 'optional']);
    expect(trace[2].detail).toMatch(/^skipped id:"login_submit" \(The window state reports a soft keyboard over id:"login_submit" — .* no flow step waits on the keyboard itself\)$/);
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual([]);
  });

  it('a guarded dismissal the witness CONFIRMS traces exactly what it did before the veto existed', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.attachedKeyboard.witnessAnswers.current = 'shown';
    const trace = await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(JSON.stringify(trace.slice(1, -1))).toBe(
      '[{"action":"⚠ tap","detail":"the soft keyboard covered id:\\"login_submit\\"; hidden before tapping"},{"action":"tap","detail":"id:\\"login_submit\\""}]',
    );
    expect(fake.keys).toEqual(['back']);
  });

  it('fill … dismissKeyboard: true with a stale window state: the witness denies the keyboard and no back is pressed', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: { ...KEYBOARD, y: 1900, height: 320 } }; // not over the field: the fill itself meets no keyboard
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    await FlowEngine.run(flow('fill: { id: login_password, value: "123456", dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
    expect(fake.keys).toEqual([]);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(1);
  });

  it('a tap: that fails with NO dismissal (the element is simply not there) gets no ⚠ tap line — only its ✗', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const error = (await FlowEngine.run(flow('tap: { id: nope }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1).map((t) => t.action)).toEqual(['✗ tap id:"nope"']);
    expect(fake.keys).toEqual([]);
  });

  it('a fill: that fails after the dismissal traces ⚠ fill … back pressed before its ✗ line', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    };
    const error = (await FlowEngine.run(flow('fill: { id: login_otp, value: "123456" }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1).map((t) => t.action)).toEqual(['⚠ fill', expect.stringMatching(/^✗ fill/)]);
    expect(error.trace[1].detail).toBe('the soft keyboard covered id:"login_otp"; back pressed');
    expect(fake.typed).toEqual([]);
  });

  it('an optional: tap whose keyboard will not hide is NOT "not present": the skip quotes the failure, after the ⚠ tap line', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    };
    const trace = await FlowEngine.run(flow('optional: [ { tap: { id: login_submit } } ]'), fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; back pressed' },
      {
        action: 'optional',
        detail:
          'skipped id:"login_submit" (Pressed back to hide the soft keyboard covering id:"login_submit", but back did not close it: ' +
          'the keyboard frame [0,1285][1080,2220] still contains the tap point (249,1466); nothing was tapped. From the MCP tools: ' +
          'inspect the screen with ui_snapshot, then press_key back once more or tap a control above the keyboard. In a flow: no step ' +
          'can recover this — the screen keeps a keyboard that back does not close over id:"login_submit" — fix the screen (or the ' +
          'test data) so the target is not under the keyboard)',
      },
    ]);
    expect(fake.taps).toEqual([]);
  });

  it('an optional: tap on a genuinely absent element still reads "(not present)", byte for byte', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const trace = await FlowEngine.run(flow('optional: [ { tap: { id: promo_close } } ]'), fake, FAST, { flow: 'f' });
    expect(JSON.stringify(trace.slice(1, -1))).toBe('[{"action":"optional","detail":"skipped id:\\"promo_close\\" (not present)"}]');
    expect(fake.keys).toEqual([]);
  });

  it('type_pin on a keypad under the keyboard: the FIRST digit gets the one ⚠ tap and the one back; the following digits are plain quiet taps', async () => {
    const key = (d: string, x: number) => node({ role: 'button', identifier: `pin_key_${d}`, label: d, rect: { x, y: 1500, width: 200, height: 132 } });
    const fake = new FakeAdapter(
      { pin: node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [key('1', 0), key('2', 300), key('3', 600)] }) },
      'pin',
    );
    fake.attachKeyboard({ state: 'shown', frame: KEYBOARD });
    const cfg = parseConfig(`
app: { android: { package: md.bank.app } }
credentials: { pin: "1231" }
flows:
  f:
    steps:
      - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
`);
    const trace = await FlowEngine.run(cfg, fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"pin_key_1"; hidden before tapping' },
      { action: 'type_pin', detail: '4 digits' },
    ]);
    expect(fake.keys).toEqual(['back']);
    expect(fake.taps).toEqual(['pin_key_1', 'pin_key_2', 'pin_key_3', 'pin_key_1']);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(5); // one per digit, plus the re-check after the one dismissal
  });

  it('a step that SUCCEEDS without the keyboard being confirmed gone traces the "could not be read" sentence, once, and no ✗', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    const move = fake.onKey!;
    fake.onKey = (key, self) => {
      move(key, self);
      self.attachedKeyboard.windowAnswers.current = { state: 'unknown' };
    };
    const trace = await FlowEngine.run(flow('tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; back pressed; the keyboard\'s state afterwards could not be read' },
      { action: 'tap', detail: 'id:"login_submit"' },
    ]);
  });

  it('fill … dismissKeyboard: true does NOT press back when the adapter says no keyboard is up (it would navigate away)', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'hidden' };
    await FlowEngine.run(flow('fill: { id: login_password, value: "123456", dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
    expect(fake.keys).toEqual([]);
  });
});

describe('wait: timeout on an id iOS idb cannot see — the message names the likely cause', () => {
  // Measured 2026-10-05 (docs/bugs/2026-10-06-wait-timeout-no-hint-for-ids-idb-cannot-see.md):
  // a `wait` on an id set on a SwiftUI container timed out after 30 s with
  // only "Timed out … waiting for element" while the screen was showing —
  // idb never exposes container identifiers, so the id was in NO tree read.
  // Indistinguishable from a slow screen without this hint.
  const cfgFor = (ios: string, wait: string) =>
    parseConfig(`
app:
  ios: { bundleId: md.bank.app${ios} }
flows:
  f:
    steps:
      - wait: { element: { ${wait} }, timeout: 60 }
`);
  /** The screen shows one button, `debit_select` — the id idb DOES expose in the measured case. */
  const fakeOn = (platform: 'android' | 'ios', kind?: IosTreeSourceKind) => {
    resetLayout();
    const fake = new FakeAdapter({ home: screen(el({ role: 'button', identifier: 'debit_select' })) }, 'home');
    fake.platform = platform;
    fake.treeSourceKind = kind;
    return fake;
  };
  /** The failure's message — the headline, any hint beneath it, then the trace the FlowError appends. */
  const failure = async (cfg: ReturnType<typeof parseConfig>, fake: FakeAdapter): Promise<string> => {
    const error = await FlowEngine.run(cfg, fake, FAST, { flow: 'f' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FlowError);
    return (error as Error).message;
  };
  const HINT = 'no tree read contained id:';

  it('iOS adapter reading with idb, config omitting treeSource (the measured case): the hint sits beneath the headline', async () => {
    const message = await failure(cfgFor('', 'id: amount_input'), fakeOn('ios', 'idb'));
    expect(message).toMatch(
      /^Timed out after 60ms waiting for element id:"amount_input"\n  \(no tree read contained id:"amount_input"\. [\s\S]*set app\.ios\.treeSource: wda in averi\.yaml[^\n]*\)\n\nSteps that ran/,
    );
  });

  it('iOS adapter reading with wda, config omitting treeSource: no hint — the adapter, not the config, says what reads the tree', async () => {
    const message = await failure(cfgFor('', 'id: amount_input'), fakeOn('ios', 'wda'));
    expect(message).toMatch(/^Timed out after 60ms waiting for element id:"amount_input"\n\nSteps that ran/);
    expect(message).not.toContain(HINT);
  });

  it('iOS adapter that does not say what it reads with: no hint, whatever the config says', async () => {
    const message = await failure(cfgFor('', 'id: amount_input'), fakeOn('ios'));
    expect(message).not.toContain(HINT);
    const configured = await failure(cfgFor(', treeSource: wda', 'id: amount_input'), fakeOn('ios'));
    expect(configured).not.toContain(HINT);
  });

  it('android: no hint', async () => {
    const message = await failure(cfgFor('', 'id: amount_input'), fakeOn('android'));
    expect(message).toMatch(/^Timed out after 60ms waiting for element id:"amount_input"\n\nSteps that ran/);
    expect(message).not.toContain(HINT);
  });

  it('iOS idb, but a text/label selector: no hint — the limitation is about identifiers', async () => {
    const byText = await failure(cfgFor('', 'text: "Amount"'), fakeOn('ios', 'idb'));
    expect(byText).toMatch(/^Timed out after 60ms waiting for element text:"Amount"\n\nSteps that ran/);
    expect(byText).not.toContain(HINT);
    const byLabel = await failure(cfgFor('', 'label: "Amount"'), fakeOn('ios', 'idb'));
    expect(byLabel).toMatch(/^Timed out after 60ms waiting for element label:"Amount"\n\nSteps that ran/);
    expect(byLabel).not.toContain(HINT);
  });

  it('iOS idb, id AND text, the id on screen in every read: no hint — findBySpec ANDs the fields, so the text is what never matched', async () => {
    const message = await failure(cfgFor('', 'id: debit_select, text: "Nope"'), fakeOn('ios', 'idb'));
    expect(message).toMatch(/^Timed out after 60ms waiting for element id:"debit_select" text:"Nope"\n\nSteps that ran/);
    expect(message).not.toContain(HINT);
  });

  it('a wait whose LAST read failed names the read error, not the hint — the reads, not idb, are the story', async () => {
    const fake = fakeOn('ios', 'idb');
    fake.uiTree = async () => {
      throw new Error('idb ui describe-all failed');
    };
    const message = await failure(cfgFor('', 'id: amount_input'), fake);
    expect(message).toMatch(
      /^Timed out after 60ms waiting for element id:"amount_input"\n  \(last UI tree read failed: idb ui describe-all failed\)\n\nSteps that ran/,
    );
    expect(message).not.toContain(HINT);
  });

  describe('waitTimeoutHint — the condition, pure', () => {
    const id = { element: { id: 'x' } };
    it('fires only for a non-absent element condition whose SOLE selector is an id, on ios under idb', () => {
      expect(waitTimeoutHint(id, 'ios', 'idb')).toBe(idbContainerIdHint('x'));
      expect(waitTimeoutHint(id, 'ios', 'wda')).toBeUndefined();
      expect(waitTimeoutHint(id, 'ios', undefined)).toBeUndefined();
      expect(waitTimeoutHint(id, 'android', undefined)).toBeUndefined();
      expect(waitTimeoutHint({ element: { id: 'x' }, absent: true }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ element: { text: 'x' } }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ element: { id: 'x', text: 'y' } }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ element: { id: 'x', role: 'button' } }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ element: { id: 'x', label: 'y' } }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ state: 's' }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ any: [id] }, 'ios', 'idb')).toBeUndefined();
      expect(waitTimeoutHint({ all: [id] }, 'ios', 'idb')).toBeUndefined();
    });
  });

  describe('idbContainerIdHint — the wording', () => {
    it('names the id, both container idioms, and the two ways out', () => {
      expect(idbContainerIdHint('amount_input')).toBe(
        'no tree read contained id:"amount_input". iOS treeSource: idb never exposes an identifier set on a container — ' +
          'SwiftUI .accessibilityElement(children: .contain), React Native testID on a non-interactive view. ' +
          'If the screen is showing, set app.ios.treeSource: wda in averi.yaml, or wait on a button/row id idb does show',
      );
    });
  });
});

/**
 * The in-tree keyboard (iOS, 2026-10-07; docs/bugs/2026-10-05-ios-tap-lands-
 * on-soft-keyboard.md): the WDA source marks the band the keyboard covers
 * (role `keyboard`), the adapter has no oracle, and the guard REFUSES a
 * target under it — nothing to press. The policy is pinned in
 * tests/interact/keyboard-in-tree.test.ts; here: the STEP, and the trace it writes
 * through the same `tracingDismissal` path as every KeyboardGuardError.
 */
describe('tap: / fill: under the iOS in-tree keyboard — the ⚠ line says nothing was sent, before the ✗ (2026-10-07)', () => {
  function iosFake(band = true) {
    const fake = iosLoginFake(band ? {} : { band: null });
    fake.treeSourceKind = 'wda';
    return fake;
  }
  const flow = (steps: string) =>
    parseConfig(`
app: { ios: { bundleId: sk.finportal.myport } }
flows:
  f:
    steps:
${steps}
`);

  it('the measured bug as a flow: fill, fill, tap login_submit → the tap step fails with the refusal, ⚠ tap then ✗ tap, nothing tapped or pressed', async () => {
    const fake = iosFake();
    const error = (await FlowEngine.run(flow('      - tap: { id: login_submit }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error).toBeInstanceOf(FlowError);
    expect(error.message).toMatch(/^The soft keyboard covers id:"login_submit": the band it draws over \[0,539\]\[402,874\] contains the tap point \(107,571\)/);
    expect(error.message).toMatch(/on two looks 300ms apart; this adapter cannot hide it on its own \(ADVICE\), and no dismissal is configured\. Nothing was tapped/);
    expect(error.message).toMatch(/In a flow: hide it with a step before this one \(a tap: on an element the keyboard does not cover\), configure a dismissal for the guard to tap, or lay the screen out so id:"login_submit" is not under the keyboard$/);
    expect(error.trace.slice(1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; no dismissal, nothing sent' },
      { action: '✗ tap id:"login_submit"', detail: expect.stringMatching(/^failed — The soft keyboard covers id:"login_submit"/) },
    ]);
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
  });

  it('the workaround the message names: a tap: on the title first — a target clear of the band traces exactly what it always did', async () => {
    const fake = iosFake();
    const trace = await FlowEngine.run(flow('      - tap: { id: login_title }'), fake, FAST, { flow: 'f' });
    expect(JSON.stringify(trace)).toBe('[{"action":"flow f","detail":"start"},{"action":"tap","detail":"id:\\"login_title\\""},{"action":"flow f","detail":"done"}]');
    expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }]);
  });

  it('no band in the tree (keyboard parked or absent, or an idb tree): the tap lands as before 2026-10-07, no ⚠ line', async () => {
    const fake = iosFake(false);
    const trace = await FlowEngine.run(flow('      - tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(trace.map((t) => t.action)).toEqual(['flow f', 'tap', 'flow f']);
    expect(fake.tapPoints).toEqual([{ x: 107, y: 571 }]);
  });

  it('a fill: whose field lies under the band is refused the same way — ⚠ fill, ✗ fill, nothing typed', async () => {
    const fake = iosFake();
    fake.live().children[1].rect = { x: 90, y: 600, width: 222, height: 20 };
    const error = (await FlowEngine.run(flow('      - fill: { id: login_password, value: secret }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1).map((t) => t.action)).toEqual(['⚠ fill', expect.stringMatching(/^✗ fill/)]);
    expect(error.trace[1].detail).toBe('the soft keyboard covered id:"login_password"; no dismissal, nothing sent');
    expect(fake.typed).toEqual([]);
    expect(fake.taps).toEqual([]);
  });

  it('the second look fails (the target gone by then): still a ⚠ tap line, saying the first look found it covered and nothing was sent, before the ✗', async () => {
    const fake = iosFake();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === 3) fake.live().children = fake.live().children.filter((c) => c.identifier !== 'login_submit');
      return real();
    };
    const error = (await FlowEngine.run(flow('      - tap: { id: login_submit }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
    expect(error.trace.slice(1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; nothing sent, and the second look failed' },
      { action: '✗ tap id:"login_submit"', detail: expect.stringMatching(/^failed — After the soft keyboard covered id:"login_submit" at \(107,571\) on a first look, the second look failed: Timed out/) },
    ]);
    expect(fake.taps).toEqual([]);
  });

  it('an optional: tap under the band is skipped quoting the refusal, not "not present", after its ⚠ tap line', async () => {
    const fake = iosFake();
    const trace = await FlowEngine.run(flow('      - optional:\n          - tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
    expect(trace.slice(1, -1)).toEqual([
      { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; no dismissal, nothing sent' },
      { action: 'optional', detail: expect.stringMatching(/^skipped id:"login_submit" \(The soft keyboard covers id:"login_submit"/) },
    ]);
    expect(fake.taps).toEqual([]);
  });

  /**
   * Stage B (2026-10-07): `app.ios.keyboardDismiss` reaches the guard through
   * the engine — converted once in the constructor, passed to every tap and
   * fill and to the post-fill dismissal. The policy is pinned in
   * tests/interact/keyboard-in-tree.test.ts; here the STEP and its trace lines.
   */
  describe('with app.ios.keyboardDismiss configured (stage B)', () => {
    const configured = (steps: string, dismiss = '[{ tap: { id: login_title } }, { accessory: true }]') =>
      parseConfig(`
app: { ios: { bundleId: sk.finportal.myport, treeSource: wda, keyboardDismiss: ${dismiss} } }
flows:
  f:
    steps:
${steps}
`);
    /** The app as measured (K5b): a tap on the title hides the keyboard — the band is gone on the next read. */
    const hidingFake = () => {
      const fake = iosFake();
      fake.onTap = hidesKeyboardOn('login_title');
      return fake;
    };

    it('a tap: under the band: the title tapped first, then the target — ONE ⚠ tap line naming the strategy, before the tap line', async () => {
      const fake = hidingFake();
      const trace = await FlowEngine.run(configured('      - tap: { id: login_submit }'), fake, FAST, { flow: 'f' });
      expect(trace).toEqual([
        { action: 'flow f', detail: 'start' },
        { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; hidden by tapping id:"login_title" before tapping' },
        { action: 'tap', detail: 'id:"login_submit"' },
        { action: 'flow f', detail: 'done' },
      ]);
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 571 }]);
      expect(fake.keys).toEqual([]);
    });

    it('a tap: whose dismissal does not hide the keyboard: ⚠ tap … still covered, then the ✗ naming the tap that was sent; the target untapped', async () => {
      const fake = iosFake(); // the band stays
      const error = (await FlowEngine.run(configured('      - tap: { id: login_submit }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
      expect(error.trace.slice(1)).toEqual([
        { action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; tapped id:"login_title" to hide it, still covered' },
        { action: '✗ tap id:"login_submit"', detail: expect.stringMatching(/^failed — Tapped id:"login_title" at \(201,303\) to hide the soft keyboard covering id:"login_submit", but it is still up/) },
      ]);
      expect(fake.taps).toEqual(['login_title']);
    });

    it('a tap: with every configured dismissal absent from the screen: the refusal lists them', async () => {
      const fake = iosFake();
      const error = (await FlowEngine.run(configured('      - tap: { id: login_submit }', '[{ tap: { id: twofactor_title } }, { accessory: true }]'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
      expect(error.message).toMatch(/and none of the configured dismissals is usable on this screen \(tap id:"twofactor_title": not found; accessory: no accessory toolbar on screen\)\. Nothing was tapped/);
      expect(error.trace[1]).toEqual({ action: '⚠ tap', detail: 'the soft keyboard covered id:"login_submit"; no dismissal, nothing sent' });
      expect(fake.taps).toEqual([]);
    });

    it('fill … dismissKeyboard: true with the band up after typing: the configured title is tapped, and the fill line says what hid the keyboard; no enter', async () => {
      const fake = hidingFake();
      const trace = await FlowEngine.run(configured('      - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
      expect(trace).toEqual([
        { action: 'flow f', detail: 'start' },
        { action: 'fill', detail: 'id:"login_password" = secret; keyboard hidden by tapping id:"login_title"' },
        { action: 'flow f', detail: 'done' },
      ]);
      expect(fake.taps).toEqual(['login_password', 'login_title']);
      expect(fake.keys).toEqual([]);
    });

    it('the post-fill dismissal judges its strategies under the flow\'s `first` policy: a tap: { text } matching two neutral nodes taps the first, and the fill line says so', async () => {
      const fake = hidingFake();
      fake.live().children.push(node({ role: 'text', identifier: 'login_heading', label: 'Prihlásenie', rect: { x: 36, y: 330, width: 330, height: 24 } }));
      const trace = await FlowEngine.run(configured('      - fill: { id: login_password, value: secret, dismissKeyboard: true }', '[{ tap: { text: Prihlásenie } }]'), fake, FAST, { flow: 'f' });
      expect(trace[1]).toEqual({ action: 'fill', detail: 'id:"login_password" = secret; keyboard hidden by tapping text:"Prihlásenie" (2 matches, the first)' });
      expect(fake.taps).toEqual(['login_password', 'login_title']);
    });

    it('fill … dismissKeyboard: true whose dismissal tap does not hide the keyboard: a ⚠ fill line naming the tap, then the ✗ (review round 1: the line was missing)', async () => {
      const fake = iosFake(); // the band stays
      const error = (await FlowEngine.run(configured('      - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
      expect(error).toBeInstanceOf(FlowError);
      expect(error.trace.slice(1)).toEqual([
        { action: '⚠ fill', detail: 'the soft keyboard was up after the fill; tapped id:"login_title" to hide it, still up' },
        { action: '✗ fill id:"login_password"', detail: expect.stringMatching(/^failed — Tapped id:"login_title" at \(201,303\) to hide the soft keyboard after the fill, but it is still up/) },
      ]);
      expect(fake.taps).toEqual(['login_password', 'login_title']);
    });

    it('fill … dismissKeyboard: true whose confirming read THROWS after the dismissal tap: the ⚠ fill line naming the tap, then the ✗ saying it was sent (review 2026-10-07 #1: the raw read error had neither)', async () => {
      const fake = hidingFake();
      const real = fake.uiTree.bind(fake);
      fake.uiTree = async () => {
        if (fake.taps.includes('login_title')) throw new Error('WDA /source failed: connection refused');
        return real();
      };
      const error = (await FlowEngine.run(configured('      - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' }).catch((e: unknown) => e)) as FlowError;
      expect(error).toBeInstanceOf(FlowError);
      expect(error.trace.slice(1)).toEqual([
        { action: '⚠ fill', detail: 'the soft keyboard was up after the fill; tapped id:"login_title" to hide it, and the read after it failed' },
        {
          action: '✗ fill id:"login_password"',
          detail: expect.stringMatching(/^failed — After tapping id:"login_title" at \(201,303\) to hide the soft keyboard after the fill: WDA \/source failed: connection refused\. That tap may have changed the screen/),
        },
      ]);
      expect(fake.taps).toEqual(['login_password', 'login_title']);
    });

    it('…and inside optional: the skip quotes that headline, never "(not present)" — a tap was sent', async () => {
      const fake = iosFake();
      const trace = await FlowEngine.run(configured('      - optional:\n          - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
      expect(trace.slice(1, -1)).toEqual([
        { action: '⚠ fill', detail: 'the soft keyboard was up after the fill; tapped id:"login_title" to hide it, still up' },
        { action: 'optional', detail: expect.stringMatching(/^skipped step \(Tapped id:"login_title" at \(201,303\) to hide the soft keyboard after the fill/) },
      ]);
    });

    it('fill … dismissKeyboard: true with the band up and nothing configured: a ⚠ fill line that the keyboard was left up, the fill line as before, and NO enter (the blind key submitted, K5d)', async () => {
      const fake = iosFake();
      const trace = await FlowEngine.run(flow('      - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
      expect(trace).toEqual([
        { action: 'flow f', detail: 'start' },
        { action: '⚠ fill', detail: 'id:"login_password": the soft keyboard is up and was left up: no dismissal is configured — the next tap under it will be refused' },
        { action: 'fill', detail: 'id:"login_password" = secret' },
        { action: 'flow f', detail: 'done' },
      ]);
      expect(fake.keys).toEqual([]);
      expect(fake.taps).toEqual(['login_password']);
    });

    it('fill … dismissKeyboard: true with no band (the HID typing parked the keyboard, or an idb tree): nothing pressed, nothing tapped, the fill line as before', async () => {
      const fake = iosFake(false);
      const trace = await FlowEngine.run(configured('      - fill: { id: login_password, value: secret, dismissKeyboard: true }'), fake, FAST, { flow: 'f' });
      expect(trace.map((t) => t.action)).toEqual(['flow f', 'fill', 'flow f']);
      expect(trace[1].detail).toBe('id:"login_password" = secret');
      expect(fake.keys).toEqual([]);
      expect(fake.taps).toEqual(['login_password']);
    });

    it('the measured flow: fill, fill, tap login_submit under the band — passes with the title tapped between the last fill and the submit, by the guard', async () => {
      const fake = hidingFake();
      fake.live().children.splice(1, 0, node({ role: 'textfield', identifier: 'login_username', rect: { x: 90, y: 400, width: 222, height: 20 } }));
      const trace = await FlowEngine.run(configured('      - fill: { id: login_username, value: user }\n      - fill: { id: login_password, value: secret }\n      - tap: { id: login_submit }'),
        fake,
        FAST, { flow: 'f' });
      expect(trace.map((t) => `${t.action}: ${t.detail}`)).toEqual([
        'flow f: start',
        'fill: id:"login_username" = user',
        'fill: id:"login_password" = secret',
        '⚠ tap: the soft keyboard covered id:"login_submit"; hidden by tapping id:"login_title" before tapping',
        'tap: id:"login_submit"',
        'flow f: done',
      ]);
      expect(fake.taps).toEqual(['login_username', 'login_password', 'login_title', 'login_submit']);
    });
  });
});
