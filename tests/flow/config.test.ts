import { describe, expect, it } from 'vitest';
import { parseConfig, parseDuration } from '../../src/flow/config.js';

const VALID = `
app:
  android: { package: md.bank.app, apk: build/app.apk }
  ios:     { bundleId: md.bank.app }
credentials:
  pin: \${AVERI_PIN}
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
      - optional:
          - tap: { text: "Not now" }
      - wait: { state: logged_in, timeout: 20s }
  goto_transfers:
    requires: logged_in
    steps:
      - tap: { id: tab_payments }
`;

describe('parseConfig', () => {
  it('accepts the documented banking example shape', () => {
    const cfg = parseConfig(VALID);
    expect(cfg.app.android?.package).toBe('md.bank.app');
    expect(cfg.states.logged_in.reach).toEqual(['login']);
    expect(cfg.flows.login.steps).toHaveLength(4);
    expect(cfg.flows.goto_transfers.requires).toBe('logged_in');
  });

  it('rejects unknown step keys with a path', () => {
    expect(() => parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - frobnicate: {}\n'))
      .toThrow(/Invalid averi\.yaml/);
  });

  it('rejects reach references to unknown flows', () => {
    expect(() =>
      parseConfig('app: {}\nstates:\n  s:\n    detect: { element: { id: x } }\n    reach: [nope]\n'),
    ).toThrow(/unknown flow "nope"/);
  });

  it('rejects waits on unknown states', () => {
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - wait: { state: nope }\n'),
    ).toThrow(/unknown state "nope"/);
  });

  it('rejects a wait with both element and state', () => {
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - wait: { element: { id: x }, state: s }\n'),
    ).toThrow(/Invalid averi\.yaml/);
  });
});

describe('parseDuration', () => {
  it('parses ms, s, m and passes numbers through', () => {
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('15s')).toBe(15_000);
    expect(parseDuration('2m')).toBe(120_000);
  });

  it('rejects garbage', () => {
    expect(() => parseDuration('soon')).toThrow(/Invalid duration/);
  });
});
