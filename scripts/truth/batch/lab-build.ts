import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_CHECK_SIMULATOR } from '../lab-device.js';
import type { CallResult } from './bounded.js';
import { CELLS_ENTRY, UNZIP_SECS } from './lab-emu.js';
import { CATALOG_PATH, cellsWhy, javaHomeOf } from './lab-lines.js';
import type { Block, Need, NeedCtx, NeedSpec } from './runner.js';
import type { NeedResult } from './runner-lines.js';
import { exitText, failedCall, nameInLine } from './words.js';

/**
 * The lab apps built from the checkout under test (T2 S6b; batch-11.sh:295–320, batch-12.sh:350–375), as two needs a
 * block names — `ios-build`, `android-build` — so a build that fails makes every block needing it INCONCLUSIVE naming
 * why (the runner's need rule), and a block that does not need it runs on the app already installed: main's catalog
 * `--check`ed first, once for both (S3's not-ported row: a stale cells.json builds nothing); the iOS build (xcodegen,
 * xcodebuild) and the Android build (`gradlew assembleDebug` under JDK 17), each a bounded step logged in the lab
 * folder, its product's cells.json main's; then `gradlew --stop`, after every Android build: the Gradle daemon leaves the
 * call's group by design, so S2's group kill cannot reach it. xcodebuild needs no pkill: its group ends with it (S2).
 * The devices' needs (ios-lab.ts, android-lab.ts) install this run's build (`built`) before their cells check; and
 * `labBlock` is batch-11's and batch-12's `lab` block — `ONLY=lab` runs just its needs.
 */

/** A build's bound when the batch names none (batch-11's B_BUILD). */
export const BUILD_SECS = 2400;
/** catalog.ts --check's bound, and xcodegen's. */
export const CATALOG_SECS = 120;
/** `java_home -v 17`'s bound. */
export const JAVA_HOME_SECS = 10;
/** `gradlew --stop`'s bound. */
export const GRADLE_STOP_SECS = 120;
/** macOS's JDK finder (batch-11's JAVA_HOME_CMD). */
export const JAVA_HOME = '/usr/libexec/java_home';
/** The built lab app and APK in the checkout under test (batch-11.sh:47–48). */
export const IOS_APP_PATH = 'fixtures/apps/ios/build/Build/Products/Debug-iphonesimulator/AveriLab.app';
export const APK_PATH = 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk';
/** The needs' names in a batch's `needs`. */
export const IOS_BUILD_NEED = 'ios-build';
export const ANDROID_BUILD_NEED = 'android-build';
/** batch-11's and batch-12's lab block: its folder is the run's lab folder. */
export const LAB_BLOCK = 'lab';

export interface LabBuild {
  /** The two build needs, by name: a batch spreads them into its `needs`. */
  needs: Readonly<Record<typeof IOS_BUILD_NEED | typeof ANDROID_BUILD_NEED, NeedSpec>>;
  /** This run's builds, once their need was met: the .app, the APK; none: not built this run (or the build failed). */
  built: { ios(): string | undefined; android(): string | undefined };
}

/** A step's failure in words, naming its log: past its bound, its group was ended (bounded.ts). */
const failedText = (what: string, r: CallResult, log: string): string => `${what} (${r.timedOut ? `past its bound, exit ${r.code} — its process group ended` : exitText(r)}; ${log})`;

/**
 * The lab builds. Each need checks main's catalog first (one `catalog.ts --check` for the run, from the checkout under
 * test), then builds; met, its product's cells.json is main's. `alive`: the product still there.
 */
export function labBuild(o: { secs?: number } = {}): LabBuild {
  const secs = o.secs ?? BUILD_SECS;
  let catalog: Promise<string | undefined> | undefined;
  const built: { ios?: string; android?: string } = {};
  const catalogFresh = (c: NeedCtx): Promise<string | undefined> =>
    (catalog ??= (async () => {
      const log = join(c.labDir, 'catalog-check.log');
      const r = await c.bounded(process.execPath, ['--import', 'tsx', join(c.config.repo, 'scripts/truth/catalog.ts'), '--check'], { secs: CATALOG_SECS, cwd: c.config.repo, log });
      return failedCall(r) ? failedText(`main's cells.json is stale or unchecked (catalog --check)`, r, log) : undefined;
    })());
  const catalogText = (c: NeedCtx): string | undefined => c.fs.read(join(c.config.repo, CATALOG_PATH));

  const ios = async (c: NeedCtx): Promise<NeedResult> => {
    const stale = await catalogFresh(c);
    if (stale !== undefined) return { ok: false, why: `${stale} — nothing built` };
    const udid = c.config.udid;
    if (udid === undefined) return { ok: false, why: 'no lab simulator udid given (--udid or AVERI_LAB_UDID): the iOS build names its destination' };
    if (udid.toUpperCase() === DEVICE_CHECK_SIMULATOR) return { ok: false, why: `${udid} is the device-check simulator: never a build's destination` };
    const cwd = join(c.config.repo, 'fixtures/apps/ios');
    const log = join(c.labDir, 'ios-build.log');
    const gen = await c.bounded('xcodegen', ['generate'], { secs: CATALOG_SECS, cwd, log });
    if (gen.code === 127) return { ok: false, why: 'xcodegen not found (brew install xcodegen)' };
    if (failedCall(gen)) return { ok: false, why: failedText('xcodegen generate failed', gen, log) };
    const build = await c.bounded('xcodebuild', ['-scheme', 'AveriLab', '-destination', `id=${udid}`, '-derivedDataPath', 'build', 'build'], { secs, cwd, log });
    if (failedCall(build)) return { ok: false, why: failedText('the iOS build failed', build, log) };
    const app = join(c.config.repo, IOS_APP_PATH);
    const why = cellsWhy(c.fs.read(join(app, 'cells.json')), catalogText(c), 'the built app');
    if (why !== undefined) return { ok: false, why };
    built.ios = app;
    return { ok: true, how: `built from the checkout under test (${nameInLine(app)}); its cells.json main's` };
  };

  const android = async (c: NeedCtx): Promise<NeedResult> => {
    const stale = await catalogFresh(c);
    if (stale !== undefined) return { ok: false, why: `${stale} — nothing built` };
    const found = await c.bounded(JAVA_HOME, ['-v', '17'], { secs: JAVA_HOME_SECS });
    const home = failedCall(found) ? '' : found.out.trim();
    const checked = javaHomeOf(found, home === '' ? undefined : c.fs.read(join(home, 'release')));
    if ('why' in checked) return { ok: false, why: checked.why };
    const cwd = join(c.config.repo, 'fixtures/apps/android');
    const log = join(c.labDir, 'android-build.log');
    const env = { ...c.config.env, JAVA_HOME: checked.home, ANDROID_HOME: c.config.env.ANDROID_HOME ?? join(homedir(), 'Library', 'Android', 'sdk') };
    const gradlew = join(cwd, 'gradlew');
    const build = await c.bounded(gradlew, ['--console=plain', 'assembleDebug'], { secs, cwd, env, log });
    // After every build, whatever it did: the daemon leaves the call's group by design (S2), so it is stopped by name.
    const stop = await c.bounded(gradlew, ['--stop'], { secs: GRADLE_STOP_SECS, cwd, env, log });
    if (failedCall(stop)) c.step('WARN', `lab android: gradlew --stop: ${exitText(stop)} — the Gradle daemon may still be running`);
    if (failedCall(build)) return { ok: false, why: failedText('the Android build failed', build, log) };
    const apk = join(c.config.repo, APK_PATH);
    if (!c.fs.exists(apk)) return { ok: false, why: `the Android build exited 0 but left no APK at ${nameInLine(apk)}` };
    const cells = await c.bounded('unzip', ['-p', apk, CELLS_ENTRY], { secs: UNZIP_SECS });
    const why = cellsWhy(failedCall(cells) ? undefined : cells.out, catalogText(c), 'the built APK');
    if (why !== undefined) return { ok: false, why };
    built.android = apk;
    return { ok: true, how: `built from the checkout under test (${nameInLine(apk)}); its ${CELLS_ENTRY} main's; the Gradle daemon stopped` };
  };

  const stillThere = (product: () => string | undefined) => async (c: NeedCtx): Promise<NeedResult> => {
    const p = product();
    return p !== undefined && c.fs.exists(p) ? { ok: true, how: `${nameInLine(p)} still there` } : { ok: false, why: `this run's build is gone (${p === undefined ? 'none' : nameInLine(p)})` };
  };
  return {
    needs: {
      [IOS_BUILD_NEED]: { check: ios, alive: stillThere(() => built.ios) },
      [ANDROID_BUILD_NEED]: { check: android, alive: stillThere(() => built.android) },
    },
    built: { ios: () => built.ios, android: () => built.android },
  };
}

/**
 * batch-11's and batch-12's `lab` block: it runs only its needs (the builds, the devices' checks, as the batch names
 * them) and says they were met — so `ONLY=lab` checks the lab and runs nothing else; a need not met makes it
 * INCONCLUSIVE naming why (the runner's rule), each need's LAB line the details.
 */
export function labBlock(needs: readonly Need[]): Block {
  return {
    id: LAB_BLOCK,
    label: 'lab check',
    needs,
    noRecords: true,
    run: async (ctx) => ctx.verdict('PASS', `every lab need met: ${needs.join(', ')} (each one's LAB line above)`),
  };
}
