import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The one sleep owner as a zero-delay macrotask yield, as in engine.test.ts:
// every poll cadence collapses to one event-loop turn; deadlines are
// Date.now-based and still fire.
vi.mock('../../src/util/sleep.js', () => ({ sleep: () => new Promise((r) => setTimeout(r, 0)) }));
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import type { UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError, resetClearStateCount, type TraceEntry } from '../../src/flow/engine.js';
import { isBareTree, treeShape } from '../../src/ui-tree/bare-tree.js';
import { FakeAdapter } from '../helpers/fake.js';

/**
 * The ladder against a cold launch's BARE trees (docs/bugs/2026-10-06-second-
 * look-reads-android-decor-as-not-in-state.md). Measured 2026-10-06 on
 * finportal (Android 13 emulator, RN debug build): null root to ~+3 s, the
 * decor alone (android:id/content, action_bar_root) +5.3…+13.8 s,
 * `login_screen` at +18.3 s — and `ensure_state logged_out`, whose only rung
 * is a `clearState` launch, wiped the app three runs of three, because the
 * 5 s second look ended on the decor and read it as "not in state". Through
 * WDA the ENTRY probe read the 7-node splash as "no" and the wipe ran with
 * no second look at all. Every tree below goes through the REAL parser of
 * its source, so what the engine sees is what the adapter returns.
 *
 * The timelines are scaled down (ms, not s) and run against the clock: the
 * second look is one Date.now-deadline poll, so "rendered after tapTimeoutMs
 * but before ensureTimeoutMs" can only be said in time.
 */

const PKG = 'sk.example.app';

const CFG = parseConfig(`
app:
  android: { package: ${PKG} }
  ios: { bundleId: ${PKG} }
states:
  logged_out:
    detect: { element: { id: login_screen } }
    reach: [fresh_launch]
  logged_out_cheap_first:
    detect: { element: { id: login_screen } }
    reach: [open_app, fresh_launch]
  no_reach:
    detect: { element: { id: login_screen } }
flows:
  fresh_launch:
    steps:
      - launch: { clearState: true }
  open_app:
    steps:
      - launch: { clearState: false }
`);

/** The second look runs over ensureTimeoutMs; tapTimeoutMs, its window before 2026-10-07, is kept far shorter so a test can tell them apart. */
const FAST = {
  pollMs: 5, tapTimeoutMs: 60, waitTimeoutMs: 60, ensureTimeoutMs: 1000, optionalTimeoutMs: 30,
  assertTimeoutMs: 60, reachRecheckMs: 40, pinKeyDelayMs: 1, env: {},
};

/** What the Android adapter throws for uiautomator's null root on a poller's read (adapters/android.ts, diagnoseDumpFailure). */
const ANDROID_NULL_ROOT = new Error(
  'device emulator-5554 is still settling: uiautomator has no window to dump yet (cold launch or animation; read once). ' +
    'Wait for the screen (`screenshot` waits for stability) and retry. ' +
    '(uiautomator dump returned no XML: ERROR: null root node returned by UiTestAutomationBridge.)',
);

const androidXml = (content: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">
      <node index="0" text="" resource-id="${PKG}:id/action_bar_root" class="android.widget.FrameLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">
        <node index="0" text="" resource-id="android:id/content" class="android.widget.FrameLayout" package="${PKG}" content-desc="" bounds="[0,0][1080,2400]">${content}</node>
      </node>
    </node>
    <node index="1" text="" resource-id="android:id/statusBarBackground" class="android.view.View" package="${PKG}" content-desc="" bounds="[0,0][1080,128]"/>
    <node index="2" text="" resource-id="android:id/navigationBarBackground" class="android.view.View" package="${PKG}" content-desc="" bounds="[0,2274][1080,2400]"/>
  </node>
</hierarchy>`;

/** The measured decor: the window chain down to android:id/content, empty — what the second look read for +5.3…+13.8 s. */
const ANDROID_DECOR = parseUiautomatorXml(androidXml(''));
/** The RN login screen as uiautomator dumps it: testID `login_screen` as the resource-id, a field and a button inside. */
const ANDROID_LOGIN = parseUiautomatorXml(
  androidXml(`
          <node index="0" text="" resource-id="login_screen" class="android.view.ViewGroup" package="${PKG}" content-desc="" bounds="[0,128][1080,2274]">
            <node index="0" text="" resource-id="login_username" class="android.widget.EditText" package="${PKG}" content-desc="" bounds="[60,900][1020,1040]"/>
            <node index="1" text="Prihlásiť" resource-id="login_submit" class="android.widget.Button" package="${PKG}" content-desc="" bounds="[60,1400][1020,1540]"/>
          </node>`),
);
/** A RENDERED screen that is not the state: the logged-in home, a tab bar button. */
const ANDROID_HOME = parseUiautomatorXml(
  androidXml(`
          <node index="0" text="Prehľad" resource-id="nav.tab_overview" class="android.widget.Button" package="${PKG}" content-desc="" bounds="[0,2100][360,2274]"/>`),
);

const FULL = { x: 0, y: 0, width: 402, height: 874 };
const other = (children: Record<string, unknown>[]) => ({ type: 'Other', label: null, rawIdentifier: null, rect: FULL, children });
/**
 * The measured WDA splash (2026-10-06, docs/bugs/2026-10-06-bare-tree-misses-
 * wda-rn-splash.md): 7 nodes — the labelled Application, five unlabeled
 * containers (the Window among them) and expo-splash-screen's identified,
 * unlabeled `SplashScreenLogo` image.
 */
const WDA_SPLASH = parseWdaSourceValue({
  value: {
    type: 'Application', label: 'MyPort', rawIdentifier: null, rect: FULL,
    children: [{
      type: 'Window', rect: FULL,
      children: [other([other([other([other([
        { type: 'Image', label: null, rawIdentifier: 'SplashScreenLogo', rect: { x: 101, y: 337, width: 200, height: 200 }, children: [] },
      ])])])])],
    }],
  },
});
/** The rendered MyPort login, as WDA returned it (it carries `login_screen`). */
const WDA_LOGIN = parseWdaSource(readFileSync(new URL('../fixtures/wda-source-myport-login-no-keyboard.json', import.meta.url), 'utf8'));

/**
 * A device whose reads follow a timeline: `at(ms since the first read, read
 * number)` is what that read returns — a tree, or an error the adapter throws.
 * A fresh clone per read, as both real adapters parse a fresh graph.
 */
function timeline(at: (ms: number, read: number) => UiNode | Error, platform: 'android' | 'ios' = 'android') {
  const fake = new FakeAdapter({}, 'unused');
  fake.platform = platform;
  if (platform === 'ios') fake.treeSourceKind = 'wda';
  const state = { t0: undefined as number | undefined, reads: 0 };
  fake.uiTree = async () => {
    state.t0 ??= Date.now();
    const r = at(Date.now() - state.t0, state.reads++);
    if (r instanceof Error) throw r;
    return structuredClone(r);
  };
  return { fake, state };
}

const failure = async (run: Promise<unknown>): Promise<FlowError> => {
  const e = await run.then(
    () => expect.unreachable('expected the call to fail'),
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(FlowError);
  return e as FlowError;
};

const actions = (trace: TraceEntry[]) => trace.map((t) => t.action);
const clearStateLaunches = (fake: FakeAdapter) => fake.launches.filter((l) => l.clearState === true);

beforeEach(() => {
  resetClearStateCount();
});

describe('the fixtures are the shapes the rule is about', () => {
  it('the decor and the WDA splash are bare; the login and home screens are not', () => {
    expect(isBareTree(ANDROID_DECOR)).toBe(true);
    expect(isBareTree(WDA_SPLASH)).toBe(true);
    expect(treeShape(WDA_SPLASH)).toBe('7 nodes (roles: container ×6, image ×1)');
    expect(isBareTree(ANDROID_LOGIN)).toBe(false);
    expect(isBareTree(ANDROID_HOME)).toBe(false);
    expect(isBareTree(WDA_LOGIN)).toBe(false);
  });
});

describe('a cold launch\'s bare trees are not "not in state": the ladder looks again before a DESTRUCTIVE rung', () => {
  it('Android, the measured shape: null root → decor → login_screen inside the second look — nothing is wiped, "already active"', async () => {
    const { fake } = timeline((ms) => (ms < 30 ? ANDROID_NULL_ROOT : ms < 150 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await new FlowEngine(CFG, fake, FAST).ensureState('logged_out');
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state logged_out', detail: 'already active' });
    expect(actions(trace)).not.toContain('⚠ reach fresh_launch');
  });

  it('iOS WDA: the ENTRY probe reads the 7-node splash — bare, not "no" — and the second look finds the login; nothing is wiped', async () => {
    const { fake } = timeline((ms) => (ms < 150 ? WDA_SPLASH : WDA_LOGIN), 'ios');
    const trace = await new FlowEngine(CFG, fake, FAST).ensureState('logged_out');
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state logged_out', detail: 'already active' });
    // The entry probe says what it read, the way an unreadable one does.
    expect(trace[0]).toEqual({
      action: '⚠ detect',
      detail:
        'element id:"login_screen" treated as not detected — every UI tree read was bare, ' +
        'the last one 7 nodes (roles: container ×6, image ×1) of only wrappers and unlabeled decoration',
    });
  });

  it('the window is ensureTimeoutMs, not tapTimeoutMs: a state rendered after the settle budget but inside the ensure budget is found', async () => {
    // Decor for 250 ms against a 60 ms tapTimeoutMs and a 1 s ensureTimeoutMs.
    const { fake } = timeline((ms) => (ms < 250 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await new FlowEngine(CFG, fake, FAST).ensureState('logged_out');
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(trace).toContainEqual({ action: 'state logged_out', detail: 'already active' });
  });

  it('bare for the whole window: ⛔ with the bare wording, nothing launches', async () => {
    const { fake, state } = timeline(() => ANDROID_DECOR);
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(fake.launches).toEqual([]);
    expect(state.reads).toBeGreaterThan(2); // the second look polled, it did not give up after one more read
    const refused = error.trace.find((t) => t.action === '⛔ reach fresh_launch');
    expect(refused?.detail).toBe(
      'refused: the rung is DESTRUCTIVE (it wipes app state, and any device registration with it), and the detect probe ' +
        'before it never read a RENDERED UI tree, a second look included — every UI tree read was bare, the last one ' +
        `${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration — so whether the app is in "logged_out" is unknown. ` +
        'Compare with screenshot; retry once the screen has rendered, or run_flow "fresh_launch" runs it deliberately',
    );
    expect(error.message.split('\n')[0]).toBe(`Refused to run reach flow "fresh_launch" for state "logged_out": ${refused?.detail?.slice('refused: '.length)}`);
    expect(error.trace.some((t) => t.detail?.includes('this rung is DESTRUCTIVE —') === true)).toBe(false);
    // The entry probe and the second look each said what they read.
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach fresh_launch']);
  });

  it('bare reads, then failing ones: the probe answers bare, and its trace line is the bare one alone — no read-error line beside it', async () => {
    const { fake } = timeline((ms) => (ms < 40 ? ANDROID_DECOR : ANDROID_NULL_ROOT));
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(fake.launches).toEqual([]);
    expect(error.trace.find((t) => t.action === '⛔ reach fresh_launch')?.detail).toContain('never read a RENDERED UI tree');
    expect(error.trace.filter((t) => t.detail?.includes('last UI tree read failed') === true)).toEqual([]);
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach fresh_launch']);
  });

  // The refusal's cause is what the entry probe and the second look learned
  // TOGETHER (review 2026-10-07): until then it was the second look's alone,
  // so each mixed order below was worded with something false.
  it('mixed, bare entry then a second look whose every read failed: the refusal names the bare tree AND the failure — not "never read a UI tree"', async () => {
    const { fake } = timeline((_, read) => (read === 0 ? ANDROID_DECOR : ANDROID_NULL_ROOT));
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(fake.launches).toEqual([]);
    expect(error.trace.find((t) => t.action === '⛔ reach fresh_launch')?.detail).toBe(
      'refused: the rung is DESTRUCTIVE (it wipes app state, and any device registration with it), and the detect probe ' +
        'before it never read a RENDERED UI tree, a second look included — every UI tree read was bare, the last one ' +
        `${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration, and every read after it failed ` +
        `(last UI tree read failed: ${ANDROID_NULL_ROOT.message}) — so whether the app is in "logged_out" is unknown. ` +
        'Compare with screenshot; retry once the screen has rendered, or run_flow "fresh_launch" runs it deliberately',
    );
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach fresh_launch']);
  });

  it('mixed, failed entry read then a bare second look: the refusal is the bare one — "every UI tree read", not "every read", and no read-error clause', async () => {
    const { fake } = timeline((_, read) => (read === 0 ? ANDROID_NULL_ROOT : ANDROID_DECOR));
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(fake.launches).toEqual([]);
    expect(error.trace.find((t) => t.action === '⛔ reach fresh_launch')?.detail).toBe(
      'refused: the rung is DESTRUCTIVE (it wipes app state, and any device registration with it), and the detect probe ' +
        'before it never read a RENDERED UI tree, a second look included — every UI tree read was bare, the last one ' +
        `${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration — so whether the app is in "logged_out" is unknown. ` +
        'Compare with screenshot; retry once the screen has rendered, or run_flow "fresh_launch" runs it deliberately',
    );
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach fresh_launch']);
  });

  it('bare, then a RENDERED tree outside the state: the second look answers "no" and the destructive rung runs, with its warning', async () => {
    const { fake } = timeline((ms) => (ms < 30 ? ANDROID_DECOR : ANDROID_HOME));
    // The call still fails: fresh_launch does not move the fake to the login.
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(error.trace).toContainEqual(expect.objectContaining({ action: '⚠ reach fresh_launch', detail: expect.stringMatching(/^this rung is DESTRUCTIVE/) }));
    expect(actions(error.trace)).not.toContain('⛔ reach fresh_launch');
  });

  it('ONE rendered read among bare ones is knowledge: the probe answers "no", not bare — the rung runs', async () => {
    // Entry: decor. Second look: decor, decor, the home screen once, decor to the deadline.
    const { fake } = timeline((_, read) => (read === 3 ? ANDROID_HOME : ANDROID_DECOR));
    const error = await failure(new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }).ensureState('logged_out'));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(actions(error.trace)).not.toContain('⛔ reach fresh_launch');
    // Before the rung, only the entry probe was bare; a bare second look would have said so too.
    const before = error.trace.slice(0, actions(error.trace).indexOf('⚠ reach fresh_launch'));
    expect(before.filter((t) => t.detail?.includes('every UI tree read was bare') === true)).toHaveLength(1);
  });

  it('a CHEAP rung runs at once on a bare probe — no second look, no added wait — and the ladder goes on from there', async () => {
    // Decor until the cheap rung relaunches, the login after it.
    let relaunched = false;
    const { fake, state } = timeline(() => (relaunched ? ANDROID_LOGIN : ANDROID_DECOR));
    const launch = fake.launch.bind(fake);
    let readsBeforeLaunch = -1;
    fake.launch = async (appId, opts) => {
      readsBeforeLaunch = state.reads;
      relaunched = true;
      return launch(appId, opts);
    };
    const engine = new FlowEngine(CFG, fake, { ...FAST, ensureTimeoutMs: 5000 });
    const started = Date.now();
    const trace = await engine.ensureState('logged_out_cheap_first');
    expect(readsBeforeLaunch).toBe(1); // the entry probe's single read, nothing more
    expect(Date.now() - started).toBeLessThan(2500); // nowhere near the 5 s window
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(fake.launches).toEqual([expect.objectContaining({ clearState: false })]);
    expect(trace).toContainEqual({ action: 'state logged_out_cheap_first', detail: 'reached after open_app' });
  });
});

describe('a state with no reach flows says honestly that a bare read could not check it', () => {
  it('"could not be checked", with the tree\'s shape — not "Not in state"', async () => {
    const { fake } = timeline(() => WDA_SPLASH, 'ios');
    const error = await failure(new FlowEngine(CFG, fake, FAST).ensureState('no_reach'));
    expect(error.message.split('\n')[0]).toBe(
      'State "no_reach" could not be checked (every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) ' +
        'of only wrappers and unlabeled decoration) and it has no reach flows',
    );
  });
});
