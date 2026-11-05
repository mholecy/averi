import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_CHECK_SIMULATOR } from '../../../scripts/truth/lab-device.js';
import type { Run } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { ANDROID_BUILD_NEED, APK_PATH, BUILD_SECS, CATALOG_SECS, GRADLE_STOP_SECS, IOS_APP_PATH, IOS_BUILD_NEED, JAVA_HOME, JAVA_HOME_SECS, LAB_BLOCK, labBlock, labBuild } from '../../../scripts/truth/batch/lab-build.js';
import type { NeedCtx } from '../../../scripts/truth/batch/runner.js';
import { CATALOG, LAB_UDID, labWorld, runOf, type LabWorld, type WorldOptions } from './lab-fakes.js';

// scripts/truth/batch/lab-build.ts over the fake host (lab-fakes.ts: catalog.ts --check, xcodegen, xcodebuild,
// java_home, gradlew, unzip — each answered, nothing built): the two build needs, main's catalog checked once before
// either, each build a bounded step logged in the lab folder, gradlew --stop after every Android build, and the lab
// block. Real files in a temp dir. The titles name the batch and the fix each rule comes from.

let dir: string;
let repo: string;
let world: LabWorld;
const steps: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-lab-build-'));
  repo = join(dir, 'repo');
  mkdirSync(join(dir, 'lab'));
  mkdirSync(join(repo, 'fixtures', 'apps', 'ios'), { recursive: true });
  mkdirSync(join(repo, 'fixtures', 'apps', 'android'), { recursive: true });
  writeFileSync(join(repo, 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir });
  steps.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});

const fresh = (o: Omit<WorldOptions, 'dir'> = {}) => (world = labWorld({ dir, ...o }));
const needCtx = (run: Run = runOf(world), udid: string | null = LAB_UDID, env: Record<string, string> = {}): NeedCtx => ({
  bounded: run,
  labDir: join(dir, 'lab'),
  config: { out: join(dir, 'out'), repo, env, ...(udid === null ? {} : { udid }) },
  fs: nodeFs,
  step: (w, t) => void steps.push(`${w} ${t}`),
});
type Spec = { check(c: NeedCtx): Promise<unknown>; alive(c: NeedCtx): Promise<unknown> };
const need = (b: ReturnType<typeof labBuild>, n: string) => b.needs[n as typeof IOS_BUILD_NEED] as Spec;

describe('main\'s catalog --check before any build, once for both (S3\'s not-ported row; batch-12.sh:340)', () => {
  it('the checkout under test\'s catalog.ts, bounded, its log in the lab folder; asked once for the two builds', async () => {
    const b = labBuild();
    const run = runOf(world);
    await need(b, IOS_BUILD_NEED).check(needCtx(run));
    await need(b, ANDROID_BUILD_NEED).check(needCtx(run));
    const checks = run.seen.filter((s) => s.words.includes('catalog.ts --check'));
    expect(checks).toEqual([{ words: `node --import tsx ${join(repo, 'scripts/truth/catalog.ts')} --check`, secs: CATALOG_SECS, cwd: repo, log: join(dir, 'lab', 'catalog-check.log'), env: undefined }]);
  });

  it('stale: both builds not met naming it, nothing built (batch-11.sh:300)', async () => {
    fresh({ buildFails: 'catalog' });
    const b = labBuild();
    const why = `main's cells.json is stale or unchecked (catalog --check) (exit 1; ${join(dir, 'lab', 'catalog-check.log')}) — nothing built`;
    expect(await need(b, IOS_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why });
    expect(await need(b, ANDROID_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why });
    expect(world.calls.some((c) => /xcode|gradlew/.test(c))).toBe(false);
    expect(b.built.ios()).toBeUndefined();
  });
});

describe('the iOS build (batch-11.sh:297, 302–307): xcodegen, then xcodebuild for the lab simulator, bounded; its app\'s cells.json main\'s', () => {
  it('built: each step in fixtures/apps/ios, logged; its bound BUILD_SECS unless given; built() the app', async () => {
    const b = labBuild();
    const run = runOf(world);
    const r = await need(b, IOS_BUILD_NEED).check(needCtx(run));
    const app = join(repo, IOS_APP_PATH);
    expect(r).toEqual({ ok: true, how: `built from the checkout under test (${app}); its cells.json main's` });
    const cwd = join(repo, 'fixtures/apps/ios');
    const log = join(dir, 'lab', 'ios-build.log');
    expect(run.seen.slice(1)).toEqual([
      { words: 'xcodegen generate', secs: CATALOG_SECS, cwd, log, env: undefined },
      { words: `xcodebuild -scheme AveriLab -destination id=${LAB_UDID} -derivedDataPath build build`, secs: BUILD_SECS, cwd, log, env: undefined },
    ]);
    expect(readFileSync(log, 'utf8')).toContain('** BUILD SUCCEEDED **');
    expect(b.built.ios()).toBe(app);
    expect(await need(b, IOS_BUILD_NEED).alive(needCtx())).toEqual({ ok: true, how: `${app} still there` });
    expect((await need(labBuild({ secs: 99 }), IOS_BUILD_NEED).check(needCtx(run)), run.seen.at(-1)!.secs)).toBe(99);
  });

  it('no udid, or device-check\'s simulator as the destination: not met, nothing built', async () => {
    expect(await need(labBuild(), IOS_BUILD_NEED).check(needCtx(runOf(world), null))).toMatchObject({ ok: false, why: expect.stringMatching(/^no lab simulator udid given/) });
    expect(await need(labBuild(), IOS_BUILD_NEED).check(needCtx(runOf(world), DEVICE_CHECK_SIMULATOR.toLowerCase()))).toEqual({ ok: false, why: `${DEVICE_CHECK_SIMULATOR.toLowerCase()} is the device-check simulator: never a build's destination` });
    expect(world.calls.some((c) => c.startsWith('xcode'))).toBe(false);
  });

  it('xcodegen missing, xcodebuild failing or past its bound, its app\'s cells.json not main\'s: not met, each its why; built() none', async () => {
    fresh({ buildFails: 'xcodegen' });
    expect(await need(labBuild(), IOS_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why: 'xcodegen not found (brew install xcodegen)' });
    fresh({ buildFails: 'xcodebuild' });
    const b = labBuild();
    expect(await need(b, IOS_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why: `the iOS build failed (exit 65; ${join(dir, 'lab', 'ios-build.log')})` });
    expect(b.built.ios()).toBeUndefined();
    expect(await need(b, IOS_BUILD_NEED).alive(needCtx())).toEqual({ ok: false, why: "this run's build is gone (none)" });
    const late = await need(labBuild(), IOS_BUILD_NEED).check(needCtx(async (cmd, args, call) => (cmd === 'xcodebuild' ? { code: 142, timedOut: true, signal: 'SIGKILL', out: '', err: '' } : runOf((fresh(), world))(cmd, args, call))));
    expect(late).toEqual({ ok: false, why: `the iOS build failed (past its bound, exit 142 — its process group ended; ${join(dir, 'lab', 'ios-build.log')})` });
    const gen = await need(labBuild(), IOS_BUILD_NEED).check(needCtx(async (cmd, args, call) => (cmd === 'xcodegen' ? { code: 1, timedOut: false, signal: null, out: '', err: '' } : runOf(world)(cmd, args, call))));
    expect(gen).toEqual({ ok: false, why: `xcodegen generate failed (exit 1; ${join(dir, 'lab', 'ios-build.log')})` });
    fresh({ builtCells: '{"cells":[]}\n' });
    expect(await need(labBuild(), IOS_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why: "the built app's cells.json is not main's" });
  });
});

describe('the Android build (batch-11.sh:298, 308–314): JDK 17, gradlew assembleDebug, then gradlew --stop — always (S2: the daemon leaves the call\'s group)', () => {
  it('built: java_home, the build under JDK 17 and the SDK, its stop, the APK\'s cells.json read; built() the APK', async () => {
    const b = labBuild();
    const run = runOf(world);
    const r = await need(b, ANDROID_BUILD_NEED).check(needCtx(run, LAB_UDID, { PATH: '/bin', ANDROID_HOME: '/sdk' }));
    const apk = join(repo, APK_PATH);
    expect(r).toEqual({ ok: true, how: `built from the checkout under test (${apk}); its assets/cells.json main's; the Gradle daemon stopped` });
    const cwd = join(repo, 'fixtures/apps/android');
    const log = join(dir, 'lab', 'android-build.log');
    const env = { PATH: '/bin', ANDROID_HOME: '/sdk', JAVA_HOME: join(dir, 'jdk17') };
    expect(run.seen.slice(1)).toEqual([
      { words: `${JAVA_HOME} -v 17`, secs: JAVA_HOME_SECS, cwd: undefined, log: undefined, env: undefined },
      { words: `${join(cwd, 'gradlew')} --console=plain assembleDebug`, secs: BUILD_SECS, cwd, log, env },
      { words: `${join(cwd, 'gradlew')} --stop`, secs: GRADLE_STOP_SECS, cwd, log, env },
      { words: `unzip -p ${apk} assets/cells.json`, secs: 30, cwd: undefined, log: undefined, env: undefined },
    ]);
    expect(b.built.android()).toBe(apk);
    expect(steps).toEqual([]);
    expect(await need(b, ANDROID_BUILD_NEED).alive(needCtx())).toEqual({ ok: true, how: `${apk} still there` });
    rmSync(apk);
    expect(await need(b, ANDROID_BUILD_NEED).alive(needCtx())).toEqual({ ok: false, why: `this run's build is gone (${apk})` });
    expect([IOS_BUILD_NEED, ANDROID_BUILD_NEED]).toEqual(['ios-build', 'android-build']);
  });

  it('ANDROID_HOME not set: the SDK under the home folder, as batch-11 gave it', async () => {
    const run = runOf(world);
    await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx(run));
    expect(run.seen.find((s) => s.words.endsWith('assembleDebug'))?.env?.ANDROID_HOME).toMatch(/\/Library\/Android\/sdk$/);
  });

  it('a build that fails: --stop still called after it, then not met naming its log', async () => {
    fresh({ buildFails: 'gradlew' });
    const run = runOf(world);
    const b = labBuild();
    expect(await need(b, ANDROID_BUILD_NEED).check(needCtx(run))).toEqual({ ok: false, why: `the Android build failed (exit 1; ${join(dir, 'lab', 'android-build.log')})` });
    expect(run.seen.at(-1)!.words).toMatch(/gradlew --stop$/);
    expect(b.built.android()).toBeUndefined();
  });

  it('a --stop that fails is a WARN (the daemon may still run); no JDK 17, no APK, its cells.json not main\'s: not met', async () => {
    const r = await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx(async (cmd, args, call) => (args.includes('--stop') ? { code: 1, timedOut: false, signal: null, out: '', err: 'no daemon' } : runOf(world)(cmd, args, call))));
    expect(r).toMatchObject({ ok: true });
    expect(steps).toEqual(['WARN lab android: gradlew --stop: exit 1 no daemon — the Gradle daemon may still be running']);
    fresh({ buildFails: 'java' });
    expect(await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why: 'no JDK 17 (java_home -v 17 → nothing: exit 1 Unable to find any JVMs matching version "17")' });
    fresh();
    writeFileSync(join(dir, 'jdk17', 'release'), 'JAVA_VERSION="21"\n');
    expect(await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx())).toMatchObject({ ok: false, why: expect.stringContaining('its release says no 17') });
    fresh();
    rmSync(join(repo, APK_PATH), { force: true });
    const noApk = await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx(async (cmd, args, call) => (args.includes('assembleDebug') ? { code: 0, timedOut: false, signal: null, out: '', err: '' } : runOf(world)(cmd, args, call))));
    expect(noApk).toEqual({ ok: false, why: `the Android build exited 0 but left no APK at ${join(repo, APK_PATH)}` });
    fresh({ builtCells: '{"cells":[]}\n' });
    expect(await need(labBuild(), ANDROID_BUILD_NEED).check(needCtx())).toEqual({ ok: false, why: "the built APK's cells.json is not main's" });
  });
});

describe('the lab block (batch-11\'s and batch-12\'s `lab`: ONLY=lab checks the lab and runs nothing else)', () => {
  it('its needs the batch\'s; its run says they were met; it records nothing', async () => {
    const block = labBlock(['android-build', 'android']);
    expect([block.id, block.label, block.needs, block.noRecords, LAB_BLOCK]).toEqual(['lab', 'lab check', ['android-build', 'android'], true, 'lab']);
    const said: unknown[] = [];
    await block.run({ verdict: (...a: unknown[]) => void said.push(a) } as never);
    expect(said).toEqual([['PASS', "every lab need met: android-build, android (each one's LAB line above)"]]);
  });
});
