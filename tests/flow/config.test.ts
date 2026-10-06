import { describe, expect, it } from 'vitest';
import {
  childSteps,
  flowIsDestructive,
  flowItselfIsDestructive,
  resolveLaunchActivity,
  launchConsultsConfigActivity,
  parseConfig,
  type ContainerKind,
  type Step,
} from '../../src/flow/config.js';

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

  it('accepts app.android.activity and launch steps with activity/intent', () => {
    const cfg = parseConfig(`
app:
  android: { package: md.bank.app, activity: .MainActivity }
flows:
  share_qr:
    steps:
      - launch:
          activity: .ShareActivity
          intent:
            action: android.intent.action.SEND
            mimeType: image/png
            extras: { qr: payload }
`);
    expect(cfg.app.android?.activity).toBe('.MainActivity');
    expect(cfg.flows.share_qr.steps[0]).toEqual({
      launch: {
        activity: '.ShareActivity',
        intent: { action: 'android.intent.action.SEND', mimeType: 'image/png', extras: { qr: 'payload' } },
      },
    });
  });

  it('rejects unknown launch intent keys', () => {
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - launch: { intent: { flags: 32 } }\n'),
    ).toThrow(/Invalid averi\.yaml/);
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

  it('rejects unknown references nested inside branch arms and optional', () => {
    // The nested walk is shared with the engine's destructiveness check
    // (`childSteps`); a container kind dropped from it silently stops being
    // validated here, which is the half that fails quietly.
    expect(() =>
      parseConfig(
        'app: {}\nflows:\n  f:\n    steps:\n      - optional:\n' +
          '          - branch:\n              - when: { element: { id: x } }\n' +
          '                do: [ { wait: { state: nope } } ]\n',
      ),
    ).toThrow(/unknown state "nope"/);
  });

  it('validates branch conditions nested inside a platform override', () => {
    expect(() =>
      parseConfig(
        'app: {}\nflows:\n  f:\n    steps:\n      - android:\n' +
          '          branch:\n            - when: { state: nope }\n              do: [ { swipe: { direction: up } } ]\n',
      ),
    ).toThrow(/unknown state "nope"/);
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

  it('accepts scroll_until with defaults and with all options', () => {
    const cfg = parseConfig(`
app: {}
flows:
  f:
    steps:
      - scroll_until: { element: { id: submit_button } }
      - scroll_until: { element: { text: "Row" }, direction: up, maxSwipes: 3, timeout: 10s }
`);
    expect(cfg.flows.f.steps).toHaveLength(2);
  });

  it('accepts tap with a timeout override, rejects tap with a timeout but no selector', () => {
    const cfg = parseConfig(`
app: {}
flows:
  f:
    steps:
      - tap: { text: "Not now", timeout: 10s }
      - optional:
          - tap: { id: promo_close, timeout: 500 }
`);
    expect(cfg.flows.f.steps).toHaveLength(2);
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - tap: { timeout: 10s }\n'),
    ).toThrow(/Invalid averi\.yaml/);
  });

  // The selector fields live once, in element-spec.ts, and step schemas extend
  // them. Both halves of that need pinning: extending must not loosen `strict`
  // (a typo'd key has to stay an error), and the extra fields a step adds must
  // not satisfy "names at least one selector" — the two ways the shared shape
  // could silently go wrong for every step at once.
  it('extended step specs keep strict keys and do not count their own fields as selectors', () => {
    for (const step of ['tap: { id: a, timeoutt: 10s }', 'fill: { id: a, value: "1", clera: true }']) {
      expect(() => parseConfig(`app: {}\nflows:\n  f:\n    steps:\n      - ${step}\n`)).toThrow(
        /Invalid averi\.yaml/,
      );
    }
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - fill: { value: "1", clear: true }\n'),
    ).toThrow(/fill needs at least one of/);
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - tap: { timeout: 10s }\n'),
    ).toThrow(/tap needs at least one of/);
  });

  it('accepts fill with inline element spec + value/clear, rejects fill without a selector field', () => {
    const cfg = parseConfig(`
app: {}
flows:
  f:
    steps:
      - fill: { id: amount_input, value: "1.00", clear: true }
`);
    expect(cfg.flows.f.steps).toHaveLength(1);
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - fill: { value: "1.00" }\n'),
    ).toThrow(/Invalid averi\.yaml/);
  });

  it('accepts assert steps with text/absent/error and rejects absent+text', () => {
    const cfg = parseConfig(`
app: {}
flows:
  f:
    steps:
      - assert:
          - { element: { text: "Required" } }
          - { element: { text: "Required" }, absent: true }
          - { element: { id: amount_input }, error: "Required" }
`);
    expect(cfg.flows.f.steps).toHaveLength(1);
    expect(() =>
      parseConfig(
        'app: {}\nflows:\n  f:\n    steps:\n      - assert:\n          - { element: { id: x }, absent: true, text: y }\n',
      ),
    ).toThrow(/Invalid averi\.yaml/);
  });

  it('accepts app.ios.treeSource wda, leaves it undefined by default, rejects unknown values', () => {
    const cfg = parseConfig('app:\n  ios: { bundleId: md.bank.app, treeSource: wda }\n');
    expect(cfg.app.ios?.treeSource).toBe('wda');
    expect(parseConfig('app:\n  ios: { bundleId: md.bank.app, treeSource: idb }\n').app.ios?.treeSource).toBe('idb');
    expect(parseConfig(VALID).app.ios?.treeSource).toBeUndefined();
    // `auto` is explicitly deferred (plan, decision 3) — it must not parse yet
    expect(() => parseConfig('app:\n  ios: { bundleId: md.bank.app, treeSource: auto }\n'))
      .toThrow(/Invalid averi\.yaml/);
  });

  it('accepts absent inside detect conditions, only next to element', () => {
    const cfg = parseConfig(`
app: {}
states:
  list_only:
    detect:
      all:
        - element: { id: row_0 }
        - element: { id: card_face, role: button }
          absent: true
`);
    expect(cfg.states.list_only.detect.all).toHaveLength(2);
    expect(() =>
      parseConfig('app: {}\nstates:\n  s:\n    detect: { state: s, absent: true }\n'),
    ).toThrow(/absent is only valid together with element|Invalid averi\.yaml/);
  });
});

describe('app.android.package format', () => {
  it('rejects a package name that is not a package name — before any adb command could interpolate it', () => {
    expect(() =>
      parseConfig(`
app:
  android: { package: "md.bank.app; rm -rf /" }
flows: {}
`),
    ).toThrow(/app\.android\.package must be a package name/);
  });
});

describe('resolveLaunchActivity — the one launch-activity fallback (flow launch step and launch_app)', () => {
  const cfg = parseConfig(`
app:
  android: { package: md.bank.app, activity: .MainActivity }
  ios:     { bundleId: md.bank.app }
`);

  it("android, the config's own package → its activity", () => {
    expect(resolveLaunchActivity(cfg, { platform: 'android', appId: 'md.bank.app' })).toBe('.MainActivity');
  });

  it('another package → none: the config describes a different app', () => {
    expect(resolveLaunchActivity(cfg, { platform: 'android', appId: 'com.other.app' })).toBeUndefined();
  });

  it('ios → none, even when the bundle id equals the android package', () => {
    expect(resolveLaunchActivity(cfg, { platform: 'ios', appId: 'md.bank.app' })).toBeUndefined();
  });

  it('no config, no android section, or no activity configured → none', () => {
    expect(resolveLaunchActivity(undefined, { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
    expect(resolveLaunchActivity(parseConfig('app:\n  ios: { bundleId: md.bank.app }\n'), { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
    expect(resolveLaunchActivity(parseConfig('app:\n  android: { package: md.bank.app }\n'), { platform: 'android', appId: 'md.bank.app' })).toBeUndefined();
  });

  // 2026-10-03: WHEN the fallback applies is this rule's too, for both callers.
  const SEND = { action: 'android.intent.action.SEND' };
  const entry = { platform: 'android' as const, appId: 'md.bank.app' };

  it('a named activity is returned as given, with or without an intent, on either platform', () => {
    expect(resolveLaunchActivity(cfg, { ...entry, activity: '.ShareActivity' })).toBe('.ShareActivity');
    expect(resolveLaunchActivity(cfg, { ...entry, activity: '.ShareActivity', intent: SEND })).toBe('.ShareActivity');
    expect(resolveLaunchActivity(cfg, { ...entry, platform: 'ios', activity: '.X' })).toBe('.X');
  });

  it('an intent and no activity → none: the config activity is not forced onto the intent', () => {
    expect(resolveLaunchActivity(cfg, { ...entry, intent: SEND })).toBeUndefined();
  });

  it('launchConsultsConfigActivity: android with neither an activity nor an intent, and nothing else', () => {
    expect(launchConsultsConfigActivity({ platform: 'android' })).toBe(true);
    expect(launchConsultsConfigActivity({ platform: 'android', intent: SEND })).toBe(false);
    expect(launchConsultsConfigActivity({ platform: 'android', activity: '.X' })).toBe(false);
    expect(launchConsultsConfigActivity({ platform: 'ios' })).toBe(false);
  });
});

describe('ContainerKind and childSteps name the same kinds — the safe-leaf check depends on it', () => {
  // `SAFE_LEAVES` (config.ts) is checked against every Step kind that is
  // neither `launch` nor in ContainerKind. ContainerKind is hand-written; a
  // container missing from it would make tsc ask for the kind in SAFE_LEAVES,
  // and `repeat: true` there would class a nested clearState as safe. This
  // table is typed Record<ContainerKind, Step>, so a kind added to ContainerKind
  // must appear here, and the assertion says childSteps descends into it.
  const samples: Record<ContainerKind, Step> = {
    branch: { branch: [{ when: { state: 's' }, do: [{ wait: { state: 's' } }] }] },
    optional: { optional: [{ tap: { id: 'x' } }] },
    android: { android: { tap: { id: 'x' } } },
    ios: { ios: { tap: { id: 'x' } } },
  };

  it.each(Object.entries(samples))('%s is a container childSteps descends into', (_kind, step) => {
    expect(childSteps(step)).toBeDefined();
    expect(childSteps(step)?.length).toBeGreaterThan(0);
  });

  it('and the leaves are not: childSteps has nothing to descend into', () => {
    const leaves: Step[] = [
      { launch: {} },
      { tap: { id: 'x' } },
      { type: { value: 'v' } },
      { type_pin: { value: 'v' } },
      { swipe: { direction: 'up' } },
      { scroll_until: { element: { id: 'x' } } },
      { fill: { id: 'x', value: 'v' } },
      { assert: [{ element: { id: 'x' } }] },
      { wait: { state: 's' } },
    ];
    for (const leaf of leaves) expect(childSteps(leaf)).toBeUndefined();
  });
});

describe('stepsAreDestructive reads SAFE_LEAVES by own key only', () => {
  it('a step whose only key is an inherited Object property is NOT a safe leaf', () => {
    // `kind in SAFE_LEAVES` would see `toString` on Object.prototype and call
    // the step safe; `Object.hasOwn` does not. Such a step cannot come out of
    // parseConfig (the union is strict), so the rule is pinned on the walk.
    const cfg = parseConfig('app:\n  android: { package: md.bank.app }\nflows:\n  f:\n    steps:\n      - tap: { id: x }\n');
    const hostile = { ...cfg, flows: { f: { steps: [{ toString: {} } as unknown as Step] } } };
    expect(flowIsDestructive(hostile, 'f')).toBe(true);
    expect(flowIsDestructive(cfg, 'f')).toBe(false);
  });
});

describe('two destructiveness predicates, two policies', () => {
  // `flowIsDestructive` follows `requires` because it gates a RE-RUN in the
  // recovery pass, where "might pull in a wipe" must count. The pre-flight
  // warning asks a narrower question — will THIS rung's own steps wipe — and
  // `flowItselfIsDestructive` answers only that (measured 2026-10-05: the
  // transitive answer put the warning on every navigation flow).
  const cfg = parseConfig(`
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
  goto_transfers:
    requires: logged_in
    steps:
      - tap: { id: tab_payments }
  flagged:
    destructive: true
    steps:
      - tap: { id: x }
`);

  it('a safe-stepped flow that REQUIRES a wiping state: transitive yes, own-steps no', () => {
    expect(flowIsDestructive(cfg, 'goto_transfers')).toBe(true);
    expect(flowItselfIsDestructive(cfg, 'goto_transfers')).toBe(false);
  });

  it('both agree on the rung that wipes, and on `destructive: true`', () => {
    expect(flowItselfIsDestructive(cfg, 'login')).toBe(true);
    expect(flowItselfIsDestructive(cfg, 'flagged')).toBe(true);
    expect(flowIsDestructive(cfg, 'login')).toBe(true);
    expect(flowIsDestructive(cfg, 'flagged')).toBe(true);
  });

  it('an unknown flow: the re-run gate refuses, the pre-flight warning stays silent', () => {
    // Opposite fail-safe directions, on purpose: not re-running an unprovable
    // rung costs a slower recovery, while warning "this rung wipes" about a
    // flow that cannot run (runFlowInner throws SetupError first) is a false
    // statement — the exact thing the narrower predicate exists to prevent.
    expect(flowIsDestructive(cfg, 'nope')).toBe(true);
    expect(flowItselfIsDestructive(cfg, 'nope')).toBe(false);
  });
});
