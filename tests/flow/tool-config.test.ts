import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import {
  iosToolSettings,
  loadForCall,
  NO_CONFIG,
  OPTIONAL_CONFIG,
  REQUIRED_CONFIG,
  REQUIRED_CONFIG_AND_ENV,
} from '../../src/flow/tool-config.js';

/**
 * flow/tool-config.ts at its own level (2026-10-08): the policy vocabulary,
 * the one read it drives, and the pure iOS settings over what was read. Real
 * files in a temp dir, no device; tests/mcp/tools.test.ts pins the same
 * policies through the protocol, and that each tool reads the file once.
 *
 * The iosToolSettings rows moved here from tests/flow/load.test.ts's
 * `iosToolSettingsFor` describe, which pinned the read and the derivation
 * together; the read's half (android never reads, missing → undefined,
 * invalid → throws naming the file) is now loadForCall's `none`/`optional`
 * rows below, and mcp/config-policy.ts's `onIos` entries tie the two
 * together (that table is pinned in tests/mcp/config-policy.test.ts).
 */

let dir: string;
let stderr: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'averi-tool-config-'));
  stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  stderr.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

const write = async (content: string, name = 'averi.yaml') => {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
};
const missing = () => join(dir, 'no-such.yaml');
const VALID = 'app:\n  android: { package: md.bank.app, activity: .MainActivity }\n  ios: { bundleId: md.bank.app, treeSource: wda }\n';
/** Present, and not a config: `app` is required. */
const INVALID = 'flows: 12\n';
const said = (): string[] => stderr.mock.calls.map((c: unknown[]) => String(c[0]));

describe('loadForCall — the one read of a tool call, judged by its policy', () => {
  it('none: nothing is read — an invalid file and a missing one are both no config, and nothing is said', async () => {
    expect(await loadForCall(NO_CONFIG, await write(INVALID))).toEqual({ cfg: undefined, env: undefined });
    expect(await loadForCall(NO_CONFIG, missing())).toEqual({ cfg: undefined, env: undefined });
  });

  it('optional: a missing file is no config, and the call proceeds', async () => {
    expect(await loadForCall(OPTIONAL_CONFIG, missing())).toEqual({ cfg: undefined, env: undefined });
  });

  it('optional: a present-but-INVALID file fails, naming it — never silently no config', async () => {
    const path = await write(INVALID);
    await expect(loadForCall(OPTIONAL_CONFIG, path)).rejects.toThrow(path);
  });

  // Review round 1: only a MISSING file is no config. Any other read error —
  // here a directory where the file should be — throws as it came under
  // `optional` too, rather than passing for "no averi.yaml".
  it('optional: a read error other than a missing file (a directory at the path) fails as it came, EISDIR', async () => {
    const path = join(dir, 'averi.yaml');
    await mkdir(path);
    await expect(loadForCall(OPTIONAL_CONFIG, path)).rejects.toThrow(/EISDIR/);
  });

  it('optional and required: a file that is not even YAML fails naming it', async () => {
    const path = await write('app: {}\nflows: { f:\n  steps:\n    - tap: x\n}\n');
    await expect(loadForCall(OPTIONAL_CONFIG, path)).rejects.toThrow(`Invalid ${path}: `);
    await expect(loadForCall(REQUIRED_CONFIG_AND_ENV, path)).rejects.toThrow(`Invalid ${path}: `);
  });

  it('optional: a valid file is the config, and no environment is assembled', async () => {
    await write('AVERI_TOOL_CONFIG_TEST=1\n', '.env.averi');
    const { cfg, env } = await loadForCall(OPTIONAL_CONFIG, await write(VALID));
    expect(cfg?.app.android?.activity).toBe('.MainActivity');
    expect(env).toBeUndefined();
    expect(said().filter((line) => line.includes('.env.averi'))).toEqual([]);
  });

  it('required: a missing file fails; an invalid one fails naming it', async () => {
    await expect(loadForCall(REQUIRED_CONFIG, missing())).rejects.toThrow(/ENOENT/);
    const path = await write(INVALID);
    await expect(loadForCall(REQUIRED_CONFIG, path)).rejects.toThrow(path);
    await expect(loadForCall(REQUIRED_CONFIG_AND_ENV, path)).rejects.toThrow(path);
  });

  it('required without env (install_app): the config, and .env.averi beside it is neither read nor announced', async () => {
    await write('AVERI_TOOL_CONFIG_TEST=1\n', '.env.averi');
    const { cfg, env } = await loadForCall(REQUIRED_CONFIG, await write(VALID));
    expect(cfg.app.android?.package).toBe('md.bank.app');
    expect(env).toBeUndefined();
    expect(said().filter((line) => line.includes('.env.averi'))).toEqual([]);
  });

  it('required with env (the engine tools): the config and the environment, .env.averi announced', async () => {
    await write('AVERI_TOOL_CONFIG_TEST=from-file\n', '.env.averi');
    const { cfg, env } = await loadForCall(REQUIRED_CONFIG_AND_ENV, await write(VALID));
    expect(cfg.app.android?.package).toBe('md.bank.app');
    expect(env.AVERI_TOOL_CONFIG_TEST).toBe('from-file');
    expect(said()).toContain('averi: loaded AVERI_TOOL_CONFIG_TEST from .env.averi');
  });

  /** Review round 1 of stage B: the key under the default tree source is inert — said on stderr once per file, by every loader. */
  describe('the inert-key note', () => {
    const INERT = 'app:\n  ios: { bundleId: md.bank.app, keyboardDismiss: [{ accessory: true }] }\n';
    const notes = () => said().filter((line) => line.includes('keyboardDismiss'));

    it('the optional read (the config-optional tools) says it', async () => {
      await loadForCall(OPTIONAL_CONFIG, await write(INERT));
      expect(notes()).toHaveLength(1);
    });

    it('a call that reads nothing (an android tap) never loads the file, so never says it', async () => {
      await loadForCall(NO_CONFIG, await write(INERT));
      expect(notes()).toEqual([]);
    });
  });
});

/**
 * One derivation for both fields since K3 (2026-10-07): every row pins the
 * WHOLE two-field result, so a value leaking from one field into the other
 * fails.
 */
describe('iosToolSettings — the iOS settings of a config already read', () => {
  const NONE = { treeSource: undefined, dismissals: undefined };
  const cfg = (yaml: string) => parseConfig(yaml);
  const CONFIGURED = 'app:\n  ios: { bundleId: md.bank.app, keyboardDismiss: [{ tap: { id: login_title } }, { accessory: true }] }\n';

  it('no config → neither field: the registry\'s default (idb) and stage A for the guard', () => {
    expect(iosToolSettings(undefined, 'ios')).toEqual(NONE);
    expect(iosToolSettings(undefined, 'android')).toEqual(NONE);
  });

  it('android gets neither field even from a config that names both', () => {
    expect(iosToolSettings(cfg('app:\n  ios: { bundleId: md.bank.app, treeSource: wda, keyboardDismiss: [{ accessory: true }] }\n'), 'android')).toEqual(NONE);
  });

  it('ios: the configured kind (and no dismissals, none being configured), or neither when the config names none', () => {
    expect(iosToolSettings(cfg('app:\n  ios: { bundleId: md.bank.app, treeSource: wda }\n'), 'ios')).toEqual({ treeSource: 'wda', dismissals: undefined });
    expect(iosToolSettings(cfg('app:\n  ios: { bundleId: md.bank.app }\n'), 'ios')).toEqual(NONE);
  });

  it('ios: the configured dismissals in the guard\'s vocabulary, in order (and no kind, none being configured)', () => {
    expect(iosToolSettings(cfg(CONFIGURED), 'ios')).toEqual({ treeSource: undefined, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }, { kind: 'accessory' }] });
  });

  it('ios: a config naming both gives both', () => {
    expect(iosToolSettings(cfg('app:\n  ios: { bundleId: md.bank.app, treeSource: wda, keyboardDismiss: [{ accessory: true }] }\n'), 'ios')).toEqual({
      treeSource: 'wda',
      dismissals: [{ kind: 'accessory' }],
    });
  });
});
