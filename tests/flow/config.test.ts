import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadConfig,
  loadConfigIfPresent,
  loadEnvBeside,
  parseConfig,
  resolveCredentials,
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

describe('loadEnvBeside', () => {
  it('loads .env.averi next to the config without overriding existing env', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'averi-env-'));
    try {
      await writeFile(
        join(dir, '.env.averi'),
        [
          '# comment',
          'AVERI_T_PLAIN=hello',
          'export AVERI_T_EXPORTED=world',
          'AVERI_T_QUOTED="with spaces"',
          "AVERI_T_SINGLE='single'",
          'AVERI_T_EXISTING=from-file',
          '',
          'not a valid line',
        ].join('\n'),
      );
      process.env.AVERI_T_EXISTING = 'from-shell';
      const applied = await loadEnvBeside(join(dir, 'averi.yaml'));
      expect(applied.sort()).toEqual(['AVERI_T_EXPORTED', 'AVERI_T_PLAIN', 'AVERI_T_QUOTED', 'AVERI_T_SINGLE']);
      expect(process.env.AVERI_T_PLAIN).toBe('hello');
      expect(process.env.AVERI_T_EXPORTED).toBe('world');
      expect(process.env.AVERI_T_QUOTED).toBe('with spaces');
      expect(process.env.AVERI_T_SINGLE).toBe('single');
      expect(process.env.AVERI_T_EXISTING).toBe('from-shell'); // shell wins
    } finally {
      await rm(dir, { recursive: true, force: true });
      for (const k of Object.keys(process.env)) if (k.startsWith('AVERI_T_')) delete process.env[k];
    }
  });

  it('refreshes values the file supplied when the file changes, but never shell exports', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'averi-env-'));
    try {
      process.env.AVERI_T_SHELL = 'from-shell';
      await writeFile(join(dir, '.env.averi'), 'AVERI_T_ROTATED=first\nAVERI_T_SHELL=from-file');
      await loadEnvBeside(join(dir, 'averi.yaml'));
      expect(process.env.AVERI_T_ROTATED).toBe('first');

      // credential rotated mid-session — the next load must pick it up
      await writeFile(join(dir, '.env.averi'), 'AVERI_T_ROTATED=second\nAVERI_T_SHELL=from-file');
      const applied = await loadEnvBeside(join(dir, 'averi.yaml'));
      expect(process.env.AVERI_T_ROTATED).toBe('second');
      expect(applied).toContain('AVERI_T_ROTATED');
      expect(process.env.AVERI_T_SHELL).toBe('from-shell'); // shell still wins
    } finally {
      await rm(dir, { recursive: true, force: true });
      for (const k of Object.keys(process.env)) if (k.startsWith('AVERI_T_')) delete process.env[k];
    }
  });

  it('returns empty when no .env.averi exists', async () => {
    expect(await loadEnvBeside('/nonexistent/averi.yaml')).toEqual([]);
  });
});

describe('loadConfigIfPresent', () => {
  it('returns undefined for a missing file — configless tools stay configless', async () => {
    expect(await loadConfigIfPresent('/nonexistent/averi.yaml')).toBeUndefined();
  });

  it('parses a present file and STILL throws on an invalid one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-cfg-'));
    try {
      const path = join(dir, 'averi.yaml');
      await writeFile(path, 'app:\n  ios: { bundleId: md.bank.app, treeSource: wda }\n');
      expect((await loadConfigIfPresent(path))?.app.ios?.treeSource).toBe('wda');

      await writeFile(path, 'app:\n  ios: { bundleId: md.bank.app, treeSource: nope }\n');
      await expect(loadConfigIfPresent(path)).rejects.toThrow(/Invalid/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The regression these cover: with the server running one directory above the
 * app repo, `apk: android/app/build/...` resolved against THAT directory and
 * install_app failed. Passing configPath found the file and changed nothing
 * about the paths inside it.
 */
describe('build paths resolve against averi.yaml, not the working directory', () => {
  const withConfig = async (yaml: string, run: (path: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-paths-'));
    try {
      const path = join(dir, 'averi.yaml');
      await writeFile(path, yaml);
      await run(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('makes a relative apk / .app absolute against the config directory', async () => {
    await withConfig(
      'app:\n' +
        '  android: { package: md.bank.app, apk: android/build/app.apk }\n' +
        '  ios: { bundleId: md.bank.app, app: ios/build/App.app }\n',
      async (path) => {
        const cfg = await loadConfig(path);
        expect(cfg.app.android?.apk).toBe(join(dirname(path), 'android/build/app.apk'));
        expect(cfg.app.ios?.app).toBe(join(dirname(path), 'ios/build/App.app'));
      },
    );
  });

  it('leaves an absolute path untouched', async () => {
    await withConfig('app:\n  android: { package: md.bank.app, apk: /builds/app.apk }\n', async (path) => {
      expect((await loadConfig(path)).app.android?.apk).toBe('/builds/app.apk');
    });
  });

  it('resolves against the config even when cwd is elsewhere — the nested-repo case', async () => {
    await withConfig('app:\n  android: { package: md.bank.app, apk: build/app.apk }\n', async (path) => {
      const cwdBefore = process.cwd();
      process.chdir(tmpdir());
      try {
        expect((await loadConfig(path)).app.android?.apk).toBe(join(dirname(path), 'build/app.apk'));
      } finally {
        process.chdir(cwdBefore);
      }
    });
  });

  it('applies to the lenient loader too — configless tools must not see raw relative paths', async () => {
    await withConfig('app:\n  ios: { bundleId: md.bank.app, app: build/App.app }\n', async (path) => {
      expect((await loadConfigIfPresent(path))?.app.ios?.app).toBe(join(dirname(path), 'build/App.app'));
    });
  });

  it('leaves a config without build paths alone', async () => {
    await withConfig('app:\n  android: { package: md.bank.app }\n', async (path) => {
      expect((await loadConfig(path)).app.android).toEqual({ package: 'md.bank.app' });
    });
  });
});

const MULTI_ENV = `
app:
  ios: { bundleId: md.bank.app }
credentials:
  username: \${AVERI_BANK_USERNAME}
  pin: \${AVERI_BANK_PIN}
environments:
  alfons_dev:
    credentials:
      username: \${AVERI_ALFONS_USERNAME}
  starterkit:
    credentials:
      username: \${AVERI_STARTERKIT_USERNAME}
flows:
  login:
    steps:
      - type_pin: { value: $pin }
`;

describe('resolveCredentials', () => {
  const cfg = () => parseConfig(MULTI_ENV);

  afterEach(() => {
    delete process.env.AVERI_ENV;
  });

  it('returns base credentials when no environment is selected', () => {
    const r = resolveCredentials(cfg());
    expect(r.environment).toBeUndefined();
    expect(r.credentials.username).toBe('${AVERI_BANK_USERNAME}');
  });

  it('overlays only the keys the environment declares, inheriting the rest', () => {
    const r = resolveCredentials(cfg(), 'starterkit');
    expect(r.environment).toBe('starterkit');
    expect(r.credentials.username).toBe('${AVERI_STARTERKIT_USERNAME}');
    // the shared secret is NOT repeated per environment and must still resolve
    expect(r.credentials.pin).toBe('${AVERI_BANK_PIN}');
  });

  it('prefers the explicit request over AVERI_ENV', () => {
    process.env.AVERI_ENV = 'alfons_dev';
    expect(resolveCredentials(cfg(), 'starterkit').environment).toBe('starterkit');
  });

  it('falls back to AVERI_ENV, then to defaultEnvironment', () => {
    process.env.AVERI_ENV = 'starterkit';
    expect(resolveCredentials(cfg()).environment).toBe('starterkit');
    delete process.env.AVERI_ENV;

    const withDefault = parseConfig(MULTI_ENV.replace('environments:', 'defaultEnvironment: alfons_dev\nenvironments:'));
    expect(resolveCredentials(withDefault).environment).toBe('alfons_dev');
  });

  it('names the source when the environment is unknown — the mix-up must not be silent', () => {
    expect(() => resolveCredentials(cfg(), 'nope')).toThrow(/Unknown environment "nope" \(from requested\)/);
    process.env.AVERI_ENV = 'nope';
    expect(() => resolveCredentials(cfg())).toThrow(/from AVERI_ENV/);
  });

  it('rejects a defaultEnvironment that is not declared', () => {
    expect(() => parseConfig(MULTI_ENV.replace('environments:', 'defaultEnvironment: typo\nenvironments:'))).toThrow(
      /defaultEnvironment "typo" is not declared/,
    );
  });
});
