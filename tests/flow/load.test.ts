import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import {
  appBuildPath,
  envBeside,
  loadConfig,
  loadConfigIfPresent,
  loadProjectConfig,
} from '../../src/flow/load.js';

/**
 * flow/load.ts at its own level: real files in a temp dir, no device. The
 * loader describes below moved here verbatim from tests/flow/config.test.ts
 * on 2026-10-04 (C6); the environment tests are new that day — they pin what
 * the `.env.averi` reading GUARANTEES (precedence, re-read, what is said on
 * stderr) through its returned value, where the tests they replace could
 * only read the side effect on `process.env`.
 */

describe('envBeside — the environment a project runs in', () => {
  let dir: string;
  const project = async (envFile?: string) => {
    dir = await mkdtemp(join(tmpdir(), 'averi-env-'));
    if (envFile !== undefined) await writeFile(join(dir, '.env.averi'), envFile);
    return join(dir, 'averi.yaml');
  };
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('merges .env.averi under the real environment: the shell wins, the file fills the gaps', async () => {
    const path = await project(
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
    const { env, contributed } = await envBeside(path, { AVERI_T_EXISTING: 'from-shell', HOME: '/home/x' });
    expect(Object.keys(contributed).sort()).toEqual(['AVERI_T_EXPORTED', 'AVERI_T_PLAIN', 'AVERI_T_QUOTED', 'AVERI_T_SINGLE']);
    expect(env.AVERI_T_PLAIN).toBe('hello');
    expect(env.AVERI_T_EXPORTED).toBe('world');
    expect(env.AVERI_T_QUOTED).toBe('with spaces');
    expect(env.AVERI_T_SINGLE).toBe('single');
    expect(env.AVERI_T_EXISTING).toBe('from-shell'); // shell wins
    expect(env.HOME).toBe('/home/x'); // the rest of the real environment is there too
  });

  it('is a value, not a write: the environment handed in is untouched and the result is frozen', async () => {
    const path = await project('AVERI_T_X=1\n');
    const given: Record<string, string | undefined> = { KEEP: 'k' };
    const { env } = await envBeside(path, given);
    expect(given).toEqual({ KEEP: 'k' });
    expect(Object.isFrozen(env)).toBe(true);
    expect(process.env.AVERI_T_X).toBeUndefined();
  });

  it('re-reads the file on every load: a credential rotated mid-session is the next load\'s value, the shell\'s never', async () => {
    const path = await project('AVERI_T_ROTATED=first\nAVERI_T_SHELL=from-file');
    const shell = { AVERI_T_SHELL: 'from-shell' };
    expect((await envBeside(path, shell)).env.AVERI_T_ROTATED).toBe('first');

    await writeFile(join(dir, '.env.averi'), 'AVERI_T_ROTATED=second\nAVERI_T_SHELL=from-file');
    const { env, contributed } = await envBeside(path, shell);
    expect(env.AVERI_T_ROTATED).toBe('second');
    expect(contributed).toEqual({ AVERI_T_ROTATED: 'second' }); // the shell's name is not the file's contribution
    expect(env.AVERI_T_SHELL).toBe('from-shell'); // shell still wins
  });

  it('is pure: the same file and environment give the same contribution every time', async () => {
    const path = await project('AVERI_T_ONCE=1\n');
    expect((await envBeside(path, {})).contributed).toEqual({ AVERI_T_ONCE: '1' });
    expect((await envBeside(path, {})).contributed).toEqual({ AVERI_T_ONCE: '1' });
    expect((await envBeside(path, {})).env.AVERI_T_ONCE).toBe('1');
  });

  it('a name the shell shadows is not the file\'s contribution', async () => {
    const path = await project('AVERI_T_SHADOWED=file\n');
    expect((await envBeside(path, { AVERI_T_SHADOWED: 'shell' })).contributed).toEqual({});
  });

  it('a name removed from the file is gone on the next load — AVERI_ENV included', async () => {
    // Until 2026-10-04 the file was written into process.env and a removed
    // name stayed there for the server's life: a removed AVERI_ENV kept every
    // later run on the old backend.
    const path = await project('AVERI_ENV=staging\nAVERI_T_KEPT=k\nAVERI_T_GONE=g\n');
    const first = await envBeside(path, {});
    expect(first.env.AVERI_ENV).toBe('staging');
    expect(first.env.AVERI_T_GONE).toBe('g');

    await writeFile(join(dir, '.env.averi'), 'AVERI_T_KEPT=k\n');
    const { env } = await envBeside(path, {});
    expect(env.AVERI_ENV).toBeUndefined();
    expect(env.AVERI_T_GONE).toBeUndefined();
    expect(env.AVERI_T_KEPT).toBe('k');
  });

  it('one project\'s file values do not leak into another project loaded by the same server', async () => {
    // Until 2026-10-04 project B, with no file of its own, saw project A's
    // values because A's load had written them into process.env.
    const a = await project('AVERI_T_FROM_A=a\n');
    const dirA = dir;
    const b = await project(); // no .env.averi
    try {
      expect((await envBeside(a, {})).env.AVERI_T_FROM_A).toBe('a');
      expect((await envBeside(b, {})).env.AVERI_T_FROM_A).toBeUndefined();
    } finally {
      await rm(dirA, { recursive: true, force: true });
    }
  });

  it('no .env.averi: the real environment, nothing contributed', async () => {
    const path = await project();
    const { env, contributed } = await envBeside(path, { ONLY: 'real' });
    expect(contributed).toEqual({});
    expect(env).toEqual({ ONLY: 'real' });
  });
});

describe('loadProjectConfig — the config and its environment, together', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('returns { cfg, env }: the env carries .env.averi, and the load says so on stderr', async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-project-'));
    const path = join(dir, 'averi.yaml');
    await writeFile(path, 'app:\n  android: { package: md.bank.app }\n');
    await writeFile(join(dir, '.env.averi'), 'AVERI_T_PROJECT_VAR=from-file\n');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { cfg, env } = await loadProjectConfig(path);
      expect(cfg.app.android?.package).toBe('md.bank.app');
      expect(env.AVERI_T_PROJECT_VAR).toBe('from-file');
      expect(env.PATH).toBe(process.env.PATH); // the real environment is in it
      expect(process.env.AVERI_T_PROJECT_VAR).toBeUndefined(); // and was not written to
      expect(stderr).toHaveBeenCalledWith('averi: loaded AVERI_T_PROJECT_VAR from .env.averi');
    } finally {
      stderr.mockRestore();
    }
  });

  it('says it once: an unchanged file on the next load is not announced again, an edit names what changed', async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-project-'));
    const path = join(dir, 'averi.yaml');
    await writeFile(path, 'app:\n  android: { package: md.bank.app }\n');
    await writeFile(join(dir, '.env.averi'), 'AVERI_T_ONCE_A=1\nAVERI_T_ONCE_B=1\n');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await loadProjectConfig(path);
      expect(stderr).toHaveBeenCalledTimes(1);
      await loadProjectConfig(path);
      expect(stderr).toHaveBeenCalledTimes(1); // unchanged: nothing said
      await writeFile(join(dir, '.env.averi'), 'AVERI_T_ONCE_A=1\nAVERI_T_ONCE_B=2\n');
      const { env } = await loadProjectConfig(path);
      expect(env.AVERI_T_ONCE_B).toBe('2');
      expect(stderr).toHaveBeenLastCalledWith('averi: loaded AVERI_T_ONCE_B from .env.averi');
    } finally {
      stderr.mockRestore();
    }
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

describe('appBuildPath — the build install_app uses when the call names none', () => {
  const cfg = parseConfig(`
app:
  android: { package: md.bank.app, apk: build/app.apk }
  ios:     { bundleId: md.bank.app, app: build/Bank.app }
`);

  it('picks the build of the platform asked about', () => {
    expect(appBuildPath(cfg, 'android')).toBe('build/app.apk');
    expect(appBuildPath(cfg, 'ios')).toBe('build/Bank.app');
  });

  it('no build path for that platform — or no section at all — is an error naming the missing key', () => {
    const none = parseConfig('app:\n  android: { package: md.bank.app }\n');
    expect(() => appBuildPath(none, 'android')).toThrow('No path given and averi.yaml has no app.android build path');
    expect(() => appBuildPath(none, 'ios')).toThrow('No path given and averi.yaml has no app.ios build path');
  });
});
