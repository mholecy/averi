import { homedir } from 'node:os';
import { join } from 'node:path';
import { APK_PATH, isDeviceCheckSimulator } from '../lab-device.js';
import type { CallResult, Run } from './bounded.js';
import { CELLS_ENTRY, UNZIP_SECS } from './lab-emu.js';
import { CATALOG_PATH, cellsWhy, jdk17Of, jdkLine, jvmDirs, NOT_REBUILT, REBUILT, RERUN_HINT, type Opened } from './lab-lines.js';
import type { Block, LastStep, Need, NeedCtx, NeedSpec } from './runner.js';
import { NO_UDID, type NeedResult } from './runner-lines.js';
import { exitText, failedCall, nameInLine } from './words.js';

/**
 * The lab apps built from the checkout under test (T2 S6b; batch-11.sh:295–320, batch-12.sh:350–375), as two needs a
 * block names — `ios-build`, `android-build` — so a build that fails makes every block needing it INCONCLUSIVE naming
 * why (the runner's need rule), and a block that does not need it runs on the app already installed: main's catalog
 * `--check`ed first, once for both (S3's not-ported row: a stale cells.json builds nothing); the iOS build (xcodegen,
 * xcodebuild) and the Android build (`gradlew assembleDebug` under JDK 17: `jdk17Of` in lab-lines.ts, T23), each a
 * bounded step logged in the lab folder, its product's cells.json main's; then `gradlew --stop`, after every Android
 * build: the Gradle daemon leaves the call's group by design, so S2's group kill cannot reach it. xcodebuild needs no
 * pkill: its group ends with it (S2). The devices' needs (ios-lab.ts, android-lab.ts) install this run's build
 * (`built`) before their cells check; and `labBlock` is batch-11's and batch-12's `lab` block — `ONLY=lab` runs just
 * its needs.
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
/** The built lab app in the checkout under test (batch-11.sh:47). */
export const IOS_APP_PATH = 'fixtures/apps/ios/build/Build/Products/Debug-iphonesimulator/AveriLab.app';
/** The built lab APK (batch-11.sh:48): lab-device.ts's since T20a (the live premise's hand line installs it too). */
export { APK_PATH } from '../lab-device.js';
/** The needs' names in a batch's `needs`. */
export const IOS_BUILD_NEED = 'ios-build';
export const ANDROID_BUILD_NEED = 'android-build';
/** batch-11's and batch-12's lab block: its folder is the run's lab folder. */
export const LAB_BLOCK = 'lab';

/**
 * One platform's build as a device need asks it (T2 S6b review round 1, MAJOR 2): `ensure` runs it once for the run —
 * whoever asks first, the device need or the build need's own check — and `built` is its product once it was met.
 * `builtUnder`: what it was built under, once met, for the device's line (the Android build's JDK, T23).
 */
export interface BuildRef {
  ensure(c: NeedCtx): Promise<NeedResult>;
  built(): string | undefined;
  builtUnder?(): string | undefined;
}

export interface LabBuild {
  /** The two build needs, by name: a batch spreads them into its `needs`. */
  needs: Readonly<Record<typeof IOS_BUILD_NEED | typeof ANDROID_BUILD_NEED, NeedSpec>>;
  /** Each platform's build, for its device need (`iosLab({ build: kit.ios })`). */
  ios: BuildRef;
  android: BuildRef;
  /** Each build that was asked and failed: `<need>: <why>`. */
  failures(): string[];
  /** The run's last step: `gradlew --stop` when an Android build was started and its own stop never ran (an abort). */
  lastly: LastStep;
}

/**
 * What a device need does with its build: install this product (none: not rebuilt) built under `builtUnder`, with a
 * warning; or not met.
 */
export type BuildAnswer = { built?: string; builtUnder?: string; warning?: string } | { why: string };

/**
 * A device need's build (T2 S6b review round 1, MAJOR 2): asked by the need itself, so the order of a block's needs
 * does not matter. None wanted: nothing to install. Met: its product, what it was built under, and the build's own
 * warning (T23: a JDK source passed over) — lab-run.ts reaches the build only through here. Failed: not met when the
 * batch requires it, else batch-11's way — a warning, the app already installed is used.
 */
export async function askBuild(c: NeedCtx, o: { build?: BuildRef; requireBuild?: boolean }): Promise<BuildAnswer> {
  if (o.build === undefined) return {};
  const r = await o.build.ensure(c);
  if (r.ok) {
    const builtUnder = o.build.builtUnder?.();
    return { built: o.build.built(), ...(builtUnder !== undefined && { builtUnder }), ...(r.warning !== undefined && { warning: r.warning }) };
  }
  if (o.requireBuild === true) return { why: `this run's build failed, and the batch requires it: ${r.why}` };
  return { warning: `${r.why}; the app already installed is used` };
}

/** A lab device as its need checks it (ios-lab.ts, android-lab.ts): opened, this run's build installed, its cells. */
export interface DeviceCheck<T> {
  /** Guarded and readied (the reset, a first read): the device — with a warning the readying left (batch-13) — or why not. */
  open(): Promise<Opened<T> & { warning?: string | undefined }>;
  /** How the build is installed (`simctl install`), for its why, and the call that does it. */
  installWord: string;
  install(device: T, built: string): Promise<CallResult>;
  /** The installed app's cells.json against main's: its how part, or why not. */
  cells(device: T): Promise<{ how: string } | { why: string }>;
  /** The device as the how names it. */
  describe(device: T): string;
}

/**
 * A device need's one shape (code review): the device opened; its build asked (askBuild); met, installed; the installed
 * app's cells.json main's (else not met, the rerun hint); met — with the readying's warning (batch-13: the companion
 * entry's) and the build's when it failed (batch-11's `LAB …: WARN — …`), joined in that order.
 */
export async function checkDevice<T>(c: NeedCtx, o: { build?: BuildRef; requireBuild?: boolean }, d: DeviceCheck<T>): Promise<NeedResult> {
  const opened = await d.open();
  if (!opened.ok) return opened;
  const device = opened.value;
  const asked = await askBuild(c, o);
  if ('why' in asked) return { ok: false, why: asked.why };
  if (asked.built !== undefined) {
    const r = await d.install(device, asked.built);
    if (failedCall(r)) return { ok: false, why: `this run's build not installed (${d.installWord}: ${exitText(r)})` };
  }
  const cells = await d.cells(device);
  if ('why' in cells) return { ok: false, why: `${cells.why} ${RERUN_HINT}` };
  const how = `${d.describe(device)}; ${installedText(asked)}; ${cells.how}`;
  const warnings = [opened.warning, asked.warning].filter((w) => w !== undefined);
  return warnings.length === 0 ? { ok: true, how } : { ok: true, how, warning: warnings.join('; ') };
}

/** What the device's line says of its build: not rebuilt, or this run's build installed — under its JDK when named. */
const installedText = (a: { built?: string; builtUnder?: string }): string => {
  if (a.built === undefined) return NOT_REBUILT;
  return a.builtUnder === undefined ? REBUILT : `${REBUILT} under ${a.builtUnder}`;
};

/** A Gradle call's whole: its wrapper, its folder, its env (the JDK, the SDK) and its log. */
export interface GradleCall {
  gradlew: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
}

/** `gradlew --stop`, bounded (GRADLE_STOP_SECS): after every Android build, and at the run's end when it did not run. */
const gradleStop = (run: Run, g: GradleCall): Promise<CallResult> => run(g.gradlew, ['--stop'], { secs: GRADLE_STOP_SECS, cwd: g.cwd, env: g.env, log: g.log });

/** A step's failure in words, naming its log: past its bound, its group was ended (bounded.ts). */
const failedText = (what: string, r: CallResult, log: string): string => `${what} (${r.timedOut ? `past its bound, exit ${r.code} — its process group ended` : exitText(r)}; ${log})`;

/**
 * The lab builds. Each need checks main's catalog first (one `catalog.ts --check` for the run, from the checkout under
 * test), then builds; met, its product's cells.json is main's. `alive`: the product still there. `jvms`: the folders
 * the JDK lookup tries last (jvmDirs: the system's, then the user's; a test's own).
 */
export function labBuild(o: { secs?: number; jvms?: readonly string[] } = {}): LabBuild {
  const secs = o.secs ?? BUILD_SECS;
  const jvms = o.jvms ?? jvmDirs(homedir());
  let catalog: Promise<string | undefined> | undefined;
  const built: { ios?: string; android?: string } = {};
  const failed = new Map<string, string>();
  /** The Android build's call, once started, until its own --stop returned: what the last step stops. */
  let gradle: { call: GradleCall; why: string } | undefined;
  /** The Android build's JDK, once it was met (jdkLine): the device's line names it. */
  let jdk: string | undefined;
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
    if (udid === undefined) return { ok: false, why: `${NO_UDID}: the iOS build names its destination` };
    if (isDeviceCheckSimulator(udid)) return { ok: false, why: `${udid} is the device-check simulator: never a build's destination` };
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
    // JAVA_HOME, else java_home, else the JVM folder (T23: java_home finds none inside the agent's sandbox).
    const checked = await jdk17Of({
      javaHomeEnv: c.config.env.JAVA_HOME,
      javaHome: () => c.bounded(JAVA_HOME, ['-v', '17'], { secs: JAVA_HOME_SECS }),
      jvms,
      list: (d) => c.fs.list(d),
      release: (home) => c.fs.read(join(home, 'release')),
      javac: (home) => c.fs.exists(join(home, 'bin', 'javac')),
    });
    if ('why' in checked) return { ok: false, why: checked.why };
    const cwd = join(c.config.repo, 'fixtures/apps/android');
    const log = join(c.labDir, 'android-build.log');
    // The SDK the config names (runner-lines.ts#configOf: ANDROID_HOME, else the one under the home folder).
    const env = { ...c.config.env, JAVA_HOME: checked.home, ...(c.config.androidHome !== undefined && { ANDROID_HOME: c.config.androidHome }) };
    const gradlew = join(cwd, 'gradlew');
    const call: GradleCall = { gradlew, cwd, env, log };
    gradle = { call, why: 'its build was cut short' };
    const build = await c.bounded(gradlew, ['--console=plain', 'assembleDebug'], { secs, cwd, env, log });
    // After every build, whatever it did: the daemon leaves the call's group by design (S2), so it is stopped by name.
    const stop = await gradleStop(c.bounded, call);
    // Only a stop that succeeded clears it: one cut or failed leaves the daemon to the last step (review round 2), its
    // reason kept for the step's line (code review).
    gradle = failedCall(stop) ? { call, why: `its --stop failed: ${exitText(stop)}` } : undefined;
    if (failedCall(stop)) c.step('WARN', `lab android: gradlew --stop: ${exitText(stop)} — the Gradle daemon may still be running`);
    if (failedCall(build)) return { ok: false, why: failedText('the Android build failed', build, log) };
    const apk = join(c.config.repo, APK_PATH);
    if (!c.fs.exists(apk)) return { ok: false, why: `the Android build exited 0 but left no APK at ${nameInLine(apk)}` };
    const cells = await c.bounded('unzip', ['-p', apk, CELLS_ENTRY], { secs: UNZIP_SECS });
    const why = cellsWhy(failedCall(cells) ? undefined : cells.out, catalogText(c), 'the built APK');
    if (why !== undefined) return { ok: false, why };
    built.android = apk;
    jdk = jdkLine(checked);
    const how = `built from the checkout under test (${nameInLine(apk)}) under ${jdk}; its ${CELLS_ENTRY} main's; the Gradle daemon stopped`;
    // A source passed over (JAVA_HOME not a JDK 17, java_home failing) is said: the build ran, but not where asked.
    return checked.warning === undefined ? { ok: true, how } : { ok: true, how, warning: checked.warning };
  };

  const stillThere = (product: () => string | undefined) => async (c: NeedCtx): Promise<NeedResult> => {
    const p = product();
    if (p === undefined) return { ok: false, why: "this run's build is gone (none)" };
    return c.fs.exists(p) ? { ok: true, how: `${nameInLine(p)} still there` } : { ok: false, why: `this run's build is gone (${nameInLine(p)})` };
  };
  /**
   * A build run once for the run, its failure kept for failures(). A met build's warning is said once (T23 code
   * review): the first asker's line keeps it — the build need's own, when the batch lists it first, else the device
   * need's — and every later answer comes without it, so the SUMMARY never says it twice.
   */
  const once = (need: string, build: (c: NeedCtx) => Promise<NeedResult>) => {
    let run: Promise<NeedResult> | undefined;
    let said = false;
    return async (c: NeedCtx): Promise<NeedResult> => {
      const r = await (run ??= build(c).then((r) => {
        if (!r.ok) failed.set(need, r.why);
        return r;
      }));
      if (!r.ok) return r;
      const first = !said;
      said = true;
      return first ? r : { ok: true, how: r.how };
    };
  };
  const iosOnce = once(IOS_BUILD_NEED, ios);
  const androidOnce = once(ANDROID_BUILD_NEED, android);
  return {
    needs: {
      [IOS_BUILD_NEED]: { check: iosOnce, alive: stillThere(() => built.ios) },
      [ANDROID_BUILD_NEED]: { check: androidOnce, alive: stillThere(() => built.android) },
    },
    ios: { ensure: iosOnce, built: () => built.ios },
    android: { ensure: androidOnce, built: () => built.android, builtUnder: () => jdk },
    failures: () => [...failed].map(([need, why]) => `${need}: ${why}`),
    async lastly({ run, step }) {
      if (gradle === undefined) return;
      const stop = await gradleStop(run, gradle.call);
      if (failedCall(stop)) step('WARN', `lab android: gradlew --stop at the run's end: ${exitText(stop)} — the Gradle daemon may still be running`);
      else step('NOTE', `lab android: the Gradle daemon stopped at the run's end (${gradle.why})`);
    },
  };
}

/**
 * batch-11's and batch-12's `lab` block: it runs only its needs (the builds, the devices' checks, as the batch names
 * them) and says they were met — so `ONLY=lab` checks the lab and runs nothing else; a need not met makes it
 * INCONCLUSIVE naming why (the runner's rule), each need's LAB line the details.
 */
export function labBlock(needs: readonly Need[], o: { build?: Pick<LabBuild, 'failures'> } = {}): Block {
  return {
    id: LAB_BLOCK,
    label: 'lab check',
    needs,
    noRecords: true,
    run: async (ctx) => {
      // A device need met on the app already installed after its build failed: never "every lab need met".
      const failed = o.build?.failures() ?? [];
      if (failed.length > 0) return ctx.verdict('WARN', `the lab devices checked, but this run's build failed (${failed.join('; ')}): the app already installed is used`);
      ctx.verdict('PASS', `every lab need met: ${needs.join(', ')} (each one's LAB line above)`);
    },
  };
}
