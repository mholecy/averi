import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  childSteps,
  flowIsDestructive,
  flowItselfIsDestructive,
  inertKeyboardDismissNote,
  keyboardDismissals,
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

  // Device check, 2026-10-08: a YAML syntax error escaped as the bare
  // library message, naming no file — the config-policy table promises every
  // broken averi.yaml fails a call naming it.
  it('a YAML syntax error is `Invalid <source>: …`, naming the file, with the line and column kept and the parser error as cause', () => {
    const broken = 'app: {}\nflows: { f:\n  steps:\n    - tap: x\n}\n';
    let thrown: unknown;
    try {
      parseConfig(broken, '/proj/averi.yaml');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const err = thrown as Error;
    expect(err.message).toMatch(/^Invalid \/proj\/averi\.yaml: .*at line \d+, column \d+/);
    expect((err.cause as Error).name).toBe('YAMLParseError');
  });

  // D86: a step is judged by its one key — the kind it names — and that kind's own issues are said with their path.
  // Under the union of every kind, a wrong TYPE inside a step's object collapsed to "Unrecognized key(s) in object:
  // 'scroll_until'" at the step: zod's union reported the last member's key error.
  describe('a step is judged by its one key, and its own issues are said with their path (D86)', () => {
    const load = (stepYaml: string) => () => parseConfig(`app: {}\nflows:\n  f:\n    steps:\n      ${stepYaml}\n`);
    const only = (line: string) => new RegExp(`^Invalid averi\\.yaml:\\n {2}${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    const ONE_OF = 'one of: launch, tap, type, type_pin, swipe, scroll_until, fill, assert, wait, branch, optional, or a platform override (android and/or ios)';

    it.each([
      ['within: { id: 5 }', '- scroll_until: { element: { id: x }, within: { id: 5 } }', 'flows.f.steps.0.scroll_until.within.id: Expected string, received number'],
      ['within: ~', '- scroll_until: { element: { id: x }, within: ~ }', 'flows.f.steps.0.scroll_until.within: Expected object, received null'],
      ['element: { id: 5 }', '- scroll_until: { element: { id: 5 } }', 'flows.f.steps.0.scroll_until.element.id: Expected string, received number'],
      ['fully: 3', '- scroll_until: { element: { id: x }, fully: 3 }', 'flows.f.steps.0.scroll_until.fully: Expected boolean, received number'],
      ['wait: { element: { id: 5 } }', '- wait: { element: { id: 5 } }', 'flows.f.steps.0.wait.element.id: Expected string, received number'],
    ])('a wrong type inside a step (%s) names the field and the type it takes', (_, stepYaml, line) => {
      expect(load(stepYaml)).toThrow(only(line));
    });

    it('a kind\'s own unknown key is said at the kind, not at the step', () => {
      expect(load('- tap: { id: x, timeoutt: 3 }')).toThrow(only("flows.f.steps.0.tap: Unrecognized key(s) in object: 'timeoutt'"));
    });

    it('nested steps — in a platform override, an optional, a branch arm — say their issues at their own path', () => {
      expect(load('- android: { tap: { id: 5 } }')).toThrow(only('flows.f.steps.0.android.tap.id: Expected string, received number'));
      expect(load('- optional: [ { tap: { id: 5 } } ]')).toThrow(only('flows.f.steps.0.optional.0.tap.id: Expected string, received number'));
      expect(load('- branch: [ { when: { state: s }, do: [ { swipe: { direction: sideways } } ] } ]')).toThrow(
        /^Invalid averi\.yaml:\n {2}flows\.f\.steps\.0\.branch\.0\.do\.0\.swipe\.direction: Invalid enum value\. Expected 'up' \| 'down' \| 'left' \| 'right', received 'sideways'$/,
      );
    });

    it('a platform override takes android, ios or both; any other key beside them makes the step one of several keys', () => {
      const cfg = parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - { android: { tap: { id: a } }, ios: { tap: { id: i } } }\n      - ios: { swipe: { direction: up } }\n');
      expect(cfg.flows.f.steps).toEqual([{ android: { tap: { id: 'a' } }, ios: { tap: { id: 'i' } } }, { ios: { swipe: { direction: 'up' } } }]);
      expect(load('- { android: { tap: { id: x } }, tap: { id: y } }')).toThrow(only(`flows.f.steps.0: a step has exactly one key, ${ONE_OF}; this one has 2: android, tap`));
    });

    it('an unknown step names itself and the kinds there are — and is said alone, no "platform override" noise beside it', () => {
      expect(load('- tapp: { id: x }')).toThrow(only(`flows.f.steps.0: unknown step 'tapp': a step is ${ONE_OF}`));
    });

    it('a step with no key, or with several, says a step has exactly one', () => {
      expect(load('- {}')).toThrow(only(`flows.f.steps.0: a step has exactly one key, ${ONE_OF}; this one has none`));
      expect(load('- { tap: { id: x }, swipe: { direction: up } }')).toThrow(only(`flows.f.steps.0: a step has exactly one key, ${ONE_OF}; this one has 2: tap, swipe`));
      // The mis-indented field: `timeout` at the step's level instead of inside the tap.
      expect(load('- tap: { id: x }\n        timeout: 3')).toThrow(only(`flows.f.steps.0: a step has exactly one key, ${ONE_OF}; this one has 2: tap, timeout`));
    });

    it.each([
      ['null', '- ~'],
      ['string', '- tap'],
      ['array', '- [ { tap: { id: x } } ]'],
      ['number', '- 3'],
    ])('a step that is no mapping (%s) says what a step is and what it got', (got, stepYaml) => {
      expect(load(stepYaml)).toThrow(only(`flows.f.steps.0: a step is a mapping of one key, ${ONE_OF} — received ${got}`));
    });

    // The repo keeps no averi.yaml of its own; its machine-readable flows are the docs' yaml examples. Every one that
    // holds whole flows (references/averi-yaml.md's are fragments, `steps: [ … ]`) parses — given an empty `app:` where
    // the example leaves it out — to the very steps it was written as.
    it.each(['README.md', 'SETUP.md', 'ARCHITECTURE.md', 'skill/SKILL.md'])(
      'every flow example in %s parses to the steps it was written as',
      (doc) => {
        const md = readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8');
        const examples = [...md.matchAll(/```ya?ml\n([\s\S]*?)```/g)]
          .map((m) => { try { return parseYaml(m[1]) as unknown; } catch { return undefined; } })
          .filter((raw): raw is { app?: unknown; flows: Record<string, { steps: unknown }> } =>
            typeof raw === 'object' && raw !== null && 'flows' in raw && Object.values((raw as { flows: Record<string, { steps: unknown }> }).flows).every((f) => Array.isArray(f.steps) && f.steps.every((st) => typeof st === 'object')));
        expect(examples.length).toBeGreaterThan(0);
        for (const raw of examples) {
          const cfg = parseConfig(JSON.stringify({ app: {}, ...raw }), doc);
          for (const [name, flow] of Object.entries(raw.flows)) expect(cfg.flows[name].steps).toEqual(flow.steps);
        }
      },
    );

    it.each([
      ['a keypad with both patterns', '- type_pin: { value: "1", keypad: { id_pattern: k, text_pattern: t } }', 'flows.f.steps.0.type_pin.keypad: keypad needs exactly one of: id_pattern, text_pattern'],
      ['a keypad with neither', '- type_pin: { value: "1", keypad: {} }', 'flows.f.steps.0.type_pin.keypad: keypad needs exactly one of: id_pattern, text_pattern'],
      ['a wait on both', '- wait: { element: { id: x }, state: s }', 'flows.f.steps.0.wait: wait needs exactly one of: element, state'],
      ['a wait on neither', '- wait: { timeout: 2s }', 'flows.f.steps.0.wait: wait needs exactly one of: element, state'],
      ['a swipe of no times', '- swipe: { direction: up, times: 0 }', 'flows.f.steps.0.swipe.times: Number must be greater than or equal to 1'],
    ])('a kind\'s own refinement is said at the kind (%s)', (_, stepYaml, line) => {
      expect(load(stepYaml)).toThrow(only(line));
    });

    it('each kind\'s valid forms still parse', () => {
      const cfg = parseConfig(`app: {}
states:
  s: { detect: { element: { id: s } } }
flows:
  f:
    steps:
      - type_pin: { value: "1", keypad: { id_pattern: "k{digit}" } }
      - type_pin: { value: "1", keypad: { text_pattern: "{digit}" } }
      - swipe: { direction: up, times: 2 }
      - scroll_until: { element: { id: a }, direction: down }
      - scroll_until: { element: { id: a }, direction: left }
      - scroll_until: { element: { id: a }, direction: right }
      - wait: { state: s }
`);
      expect(cfg.flows.f.steps).toHaveLength(7);
    });

    it('a valid step parses to the very value it was written as', () => {
      const cfg = parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - optional: [ { tap: { id: x, timeout: 2s } } ]\n      - android: { branch: [ { when: { element: { id: y } }, do: [ { fill: { id: z, value: v, clear: true } } ] } ] }\n');
      expect(cfg.flows.f.steps).toEqual([
        { optional: [{ tap: { id: 'x', timeout: '2s' } }] },
        { android: { branch: [{ when: { element: { id: 'y' } }, do: [{ fill: { id: 'z', value: 'v', clear: true } }] }] } },
      ]);
    });
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

  // D81: the flow's `within` is an element spec, the step's own `element` vocabulary — never a rect, which is
  // device-specific (the MCP tool takes one from ui_snapshot; a flow is replayed on other screens).
  it('accepts scroll_until with `within`, an element spec of the scroll view or of an element inside it', () => {
    const cfg = parseConfig(`
app: {}
flows:
  f:
    steps:
      - scroll_until: { element: { id: row_o }, within: { id: lower_list } }
      - scroll_until: { element: { text: "Row" }, within: { role: scrollable, label: Accounts }, direction: up }
`);
    expect(cfg.flows.f.steps).toEqual([
      { scroll_until: { element: { id: 'row_o' }, within: { id: 'lower_list' } } },
      { scroll_until: { element: { text: 'Row' }, within: { role: 'scrollable', label: 'Accounts' }, direction: 'up' } },
    ]);
  });

  it.each([
    ['the whole rect', '{ x: 0, y: 1046, width: 1080, height: 495 }'],
    ['one side of it', '{ id: lower_list, height: 495 }'],
  ])('refuses a rect as `within` (%s), saying why', (_, within) => {
    expect(() => parseConfig(`app: {}\nflows:\n  f:\n    steps:\n      - scroll_until: { element: { id: x }, within: ${within} }\n`)).toThrow(
      /^Invalid averi\.yaml:\n {2}flows\.f\.steps\.0\.scroll_until\.within: within takes an element spec \(id, text, role, label\) of the scroll view or of an element inside it, not a rect: a rect is device-specific$/,
    );
  });

  it('refuses a `within` naming no selector field, an unknown key, or a selector string (a flow names elements by spec)', () => {
    const load = (within: string) => () => parseConfig(`app: {}\nflows:\n  f:\n    steps:\n      - scroll_until: { element: { id: x }, within: ${within} }\n`);
    expect(load('{}')).toThrow(/scroll_until\.within: element spec needs at least one of: id, text, role, label/);
    expect(load('{ idd: lower }')).toThrow(/scroll_until\.within: Unrecognized key\(s\) in object: 'idd'/);
    expect(load('"id:lower"')).toThrow(/^Invalid averi\.yaml:\n {2}flows\.f\.steps\.0\.scroll_until\.within: within takes an element spec \(\{ id: … \}\), as the step's element does, not a selector string$/);
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

  // C3 (2026-10-07): an `assert:` step's match is validated when averi.yaml
  // is parsed — it used to load clean and throw mid-flow, on a device.
  it('rejects an assert step whose match is not a valid regex, naming the step\'s path', () => {
    expect(() =>
      parseConfig('app: {}\nflows:\n  f:\n    steps:\n      - assert:\n          - { element: { id: x }, match: "(" }\n'),
    ).toThrow(/flows\.f\.steps\.0\.assert\.0\.match: not a valid regular expression — .*Unterminated group/);
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

  /**
   * Stage B (2026-10-07): `app.ios.keyboardDismiss`, the ordered, opt-in
   * list the keyboard guard taps from (docs/bugs/2026-10-05-ios-tap-lands-
   * on-soft-keyboard.md, "Fix (stage B)").
   */
  describe('app.ios.keyboardDismiss', () => {
    const ios = (rest: string) => `app:\n  ios:\n    bundleId: md.bank.app\n${rest}`;

    it('accepts an ordered list of tap element specs and accessory: true, and converts it in order to the guard\'s vocabulary', () => {
      const cfg = parseConfig(ios('    keyboardDismiss:\n      - tap: { id: login_title }\n      - tap: { text: "Prihlásenie", role: text }\n      - accessory: true\n'));
      expect(cfg.app.ios?.keyboardDismiss).toEqual([{ tap: { id: 'login_title' } }, { tap: { text: 'Prihlásenie', role: 'text' } }, { accessory: true }]);
      expect(keyboardDismissals(cfg)).toEqual([
        { kind: 'tap', target: { id: 'login_title' } },
        { kind: 'tap', target: { text: 'Prihlásenie', role: 'text' } },
        { kind: 'accessory' },
      ]);
    });

    it('is optional, and absent converts to undefined — the guard then has nothing to tap (stage A); so does no config and no ios section', () => {
      expect(parseConfig(VALID).app.ios?.keyboardDismiss).toBeUndefined();
      expect(keyboardDismissals(parseConfig(VALID))).toBeUndefined();
      expect(keyboardDismissals(undefined)).toBeUndefined();
      expect(keyboardDismissals(parseConfig('app:\n  android: { package: md.bank.app }\n'))).toBeUndefined();
    });

    it.each([
      ['an empty list', '    keyboardDismiss: []\n', /keyboardDismiss: Array must contain at least 1 element/],
      ['a tap without a selector field', '    keyboardDismiss:\n      - tap: { timeout: 2s }\n', /keyboardDismiss\.0\.tap: Unrecognized key/],
      ['a tap with no field at all', '    keyboardDismiss:\n      - tap: {}\n', /keyboardDismiss\.0\.tap: tap needs at least one of: id, text, role, label/],
      ['a tap with a non-selector key', '    keyboardDismiss:\n      - tap: { id: x, value: y }\n', /keyboardDismiss\.0\.tap: Unrecognized key/],
      ['a tap naming an interactive role (it would press a control — review round 1)', '    keyboardDismiss:\n      - tap: { role: button }\n', /keyboardDismiss\.0\.tap: a keyboard dismissal must be a non-interactive element \(a title, a label\) — role: button\/textfield\/switch\/checkbox\/radiobutton\/slider names a control the tap would press/],
      ['a tap naming textfield', '    keyboardDismiss:\n      - tap: { id: x, role: textfield }\n', /a keyboard dismissal must be a non-interactive element/],
      ['a tap given as a selector string', '    keyboardDismiss:\n      - tap: "id:x"\n', /keyboardDismiss\.0\.tap: Expected object, received string/],
      ['accessory: false (opt-in only; false reads like an override and would be none)', '    keyboardDismiss:\n      - accessory: false\n', /keyboardDismiss\.0\.accessory: accessory takes only true/],
      ['an entry with both forms', '    keyboardDismiss:\n      - { tap: { id: x }, accessory: true }\n', /keyboardDismiss\.0: each entry is \{ tap: <element spec> \} or \{ accessory: true \}/],
      ['an empty entry', '    keyboardDismiss:\n      - {}\n', /keyboardDismiss\.0: each entry is \{ tap: <element spec> \} or \{ accessory: true \}/],
      ['an unknown strategy', '    keyboardDismiss:\n      - swipe: down\n', /keyboardDismiss\.0: Unrecognized key\(s\) in object: 'swipe'/],
      ['a bare string', '    keyboardDismiss:\n      - login_title\n', /keyboardDismiss\.0: Expected object, received string/],
      ['not a list', '    keyboardDismiss: { tap: { id: x } }\n', /keyboardDismiss: Expected array, received object/],
      ['the key on the android section', '    keyboardDismiss:\n      - accessory: true\n  android: { package: md.bank.app, keyboardDismiss: [] }\n', /android: Unrecognized key\(s\) in object: 'keyboardDismiss'/],
    ])('rejects %s — with a message that names the field and the rule', (_name, rest, message) => {
      expect(() => parseConfig(ios(rest))).toThrow(/Invalid averi\.yaml/);
      expect(() => parseConfig(ios(rest))).toThrow(message);
    });

    it('a tap naming a non-interactive role (text, image) is accepted — the rule is about controls', () => {
      expect(parseConfig(ios('    keyboardDismiss:\n      - tap: { role: text, text: "Login" }\n')).app.ios?.keyboardDismiss).toEqual([{ tap: { role: 'text', text: 'Login' } }]);
    });

    /** Review round 1: the key under the default tree source cannot act — said once at load time (flow/load.ts), decided here. */
    describe('inertKeyboardDismissNote — the key set where the tree marks no keyboard', () => {
      const LIST = '    keyboardDismiss:\n      - accessory: true\n';
      it('treeSource omitted (idb, the default): the note names the default and the fix', () => {
        expect(inertKeyboardDismissNote(parseConfig(ios(LIST)))).toBe(
          'app.ios.keyboardDismiss is set but app.ios.treeSource is idb (the default): the idb tree marks no node as the keyboard (on iOS 27 it lists the keys, as plain buttons), so no guard hides it before a tap and the list is inert (a tap whose centre lies under its band, read by shape, is refused instead) — set treeSource: wda for it to apply',
        );
      });
      it('treeSource: idb written out: the note, without "(the default)"', () => {
        expect(inertKeyboardDismissNote(parseConfig(ios(`${LIST}    treeSource: idb\n`)))).toMatch(/^app\.ios\.keyboardDismiss is set but app\.ios\.treeSource is idb: /);
      });
      it('treeSource: wda, or no keyboardDismiss, or no ios section: nothing', () => {
        expect(inertKeyboardDismissNote(parseConfig(ios(`${LIST}    treeSource: wda\n`)))).toBeUndefined();
        expect(inertKeyboardDismissNote(parseConfig(ios('')))).toBeUndefined();
        expect(inertKeyboardDismissNote(parseConfig('app:\n  android: { package: md.bank.app }\n'))).toBeUndefined();
      });
    });
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

describe('detect cycles are config errors, rejected at parse', () => {
  // A state's detect evaluating another state's detect (`matches`) on a cycle
  // never finished at run time (a stack overflow, measured 2026-10-07). The
  // engine's other recursion, a reach rung's `requires:`, is a runtime
  // condition and is NOT rejected here (engine.test.ts, re-entry guard).
  // Every expected message carries the whole cycle path.
  const cfg = (states: string, flows = '') =>
    `app: {}\nstates:\n${states}${flows ? `flows:\n${flows}` : ''}`;

  it('rejects two states whose detects name each other, with the path', () => {
    expect(() => parseConfig(cfg('  a: { detect: { state: b } }\n  b: { detect: { state: a } }\n'))).toThrow(
      'Invalid averi.yaml: states.a.detect refers back to itself: states.a → states.b → states.a',
    );
  });

  it('rejects a detect that names its own state', () => {
    expect(() =>
      parseConfig(cfg('  a: { detect: { any: [ { element: { id: x } }, { state: a } ] } }\n')),
    ).toThrow(/states\.a\.detect refers back to itself: states\.a → states\.a \(/);
  });

  it('follows any: and all: at any depth, through a longer cycle', () => {
    // An `any:` whose first arm would short-circuit on some screens is still a
    // cycle: on every screen where the element is absent it never finishes
    // (with an element arm awaited first, it loops in microtasks until the
    // heap is gone rather than overflowing).
    expect(() =>
      parseConfig(
        cfg(
          '  a: { detect: { any: [ { element: { id: x } }, { all: [ { element: { id: y } }, { state: b } ] } ] } }\n' +
            '  b: { detect: { all: [ { state: c } ] } }\n' +
            '  c: { detect: { any: [ { element: { id: z } }, { state: a } ] } }\n',
        ),
      ),
    ).toThrow('states.a → states.b → states.c → states.a');
  });

  it('accepts shared references — a DAG is not a cycle', () => {
    // a and b both name c, c names d; flows require shared states and wait on,
    // branch on, them. Every state is reached by two routes, none comes back.
    const parsed = parseConfig(
      cfg(
        '  a: { detect: { any: [ { state: c }, { state: d } ] }, reach: [f] }\n' +
          '  b: { detect: { all: [ { state: c }, { state: c } ] }, reach: [f, g] }\n' +
          '  c: { detect: { state: d }, reach: [g] }\n' +
          '  d: { detect: { element: { id: d } } }\n',
        `  f: { requires: c, steps: [ { wait: { state: a } }, { branch: [ { when: { state: b }, do: [] } ] } ] }\n` +
          '  g: { requires: d, steps: [ { wait: { state: c } } ] }\n',
      ),
    );
    expect(Object.keys(parsed.states)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('accepts a reach/requires loop — whether it loops depends on the screen, so the engine decides', () => {
    // The mutual login/logout shape works from either state on the loop; only
    // a third screen loops, and the engine refuses that re-entry at run time.
    const parsed = parseConfig(
      cfg(
        '  logged_in: { detect: { element: { id: home } }, reach: [login] }\n' +
          '  login_screen: { detect: { element: { id: login } }, reach: [logout] }\n',
        `  login: { requires: login_screen, steps: [ { swipe: { direction: up } } ] }\n` +
          `  logout: { requires: logged_in, steps: [ { swipe: { direction: up } } ] }\n`,
      ),
    );
    expect(parsed.flows.logout.requires).toBe('logged_in');
  });

  it('does not join the detect graph to requires: a detect edge and a requires edge make no cycle', () => {
    // Ensuring b runs f, f requires a, a's detect evaluates b's detect and
    // returns — neither recursion re-enters itself.
    const parsed = parseConfig(
      cfg(
        '  a: { detect: { state: b } }\n  b: { detect: { element: { id: b } }, reach: [f] }\n',
        '  f: { requires: a, steps: [ { swipe: { direction: up } } ] }\n',
      ),
    );
    expect(parsed.flows.f.requires).toBe('a');
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
