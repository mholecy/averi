import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The one sleep owner as a zero-delay macrotask yield, as in engine.test.ts:
// every poll cadence collapses to one event-loop turn; deadlines are
// Date.now-based and still fire.
vi.mock('../../src/util/sleep.js', () => ({ sleep: () => new Promise((r) => setTimeout(r, 0)) }));
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import type { UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError, EngineSession, idbContainerIdHint, type TraceEntry } from '../../src/flow/engine.js';
import { isBareTree, treeShape } from '../../src/ui-tree/bare-tree.js';
import { Verifier } from '../../src/verify/assert.js';
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
  assertTimeoutMs: 60, reachRecheckMs: 40, pinKeyDelayMs: 1, env: {},  // A fresh session at every use — a spread or a direct pass — so no test
  // inherits another's wipe count (EngineOptions.session is required).
  get session() {
    return new EngineSession();
  },
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
  // The screen in the trees' own units (the absent conditions ask for it): uiautomator's pixels, WDA's points.
  fake.viewportSize = platform === 'ios' ? { width: 402, height: 874 } : { width: 1080, height: 2400 };
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
    const trace = await FlowEngine.run(CFG, fake, FAST, { state: 'logged_out' });
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state logged_out', detail: 'already active' });
    expect(actions(trace)).not.toContain('⚠ reach fresh_launch');
  });

  it('iOS WDA: the ENTRY probe reads the 7-node splash — bare, not "no" — and the second look finds the login; nothing is wiped', async () => {
    const { fake } = timeline((ms) => (ms < 150 ? WDA_SPLASH : WDA_LOGIN), 'ios');
    const trace = await FlowEngine.run(CFG, fake, FAST, { state: 'logged_out' });
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
    const trace = await FlowEngine.run(CFG, fake, FAST, { state: 'logged_out' });
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(trace).toContainEqual({ action: 'state logged_out', detail: 'already active' });
  });

  it('bare for the whole window: ⛔ with the bare wording, nothing launches', async () => {
    const { fake, state } = timeline(() => ANDROID_DECOR);
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
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

  // The round-3 device check (2026-10-08) saw two identical `⚠ detect … bare`
  // lines: the entry probe's and the second look's said the same sentence.
  it('the second look\'s ⚠ detect line names the second look and its window, so it never repeats the entry probe\'s', async () => {
    const { fake } = timeline(() => ANDROID_DECOR);
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
    const bare = `every UI tree read was bare, the last one ${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration`;
    expect(error.trace.filter((t) => t.action === '⚠ detect').map((t) => t.detail)).toEqual([
      `element id:"login_screen" treated as not detected — ${bare}`,
      `element id:"login_screen" treated as not detected (second look over 0.12 s) — ${bare}`,
    ]);
  });

  it('bare reads, then failing ones: the probe answers bare, and its trace line is the bare one alone — no read-error line beside it', async () => {
    const { fake } = timeline((ms) => (ms < 40 ? ANDROID_DECOR : ANDROID_NULL_ROOT));
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
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
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
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
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
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
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(error.trace).toContainEqual(expect.objectContaining({ action: '⚠ reach fresh_launch', detail: expect.stringMatching(/^this rung is DESTRUCTIVE/) }));
    expect(actions(error.trace)).not.toContain('⛔ reach fresh_launch');
  });

  it('ONE rendered read among bare ones is knowledge: the probe answers "no", not bare — the rung runs', async () => {
    // Entry: decor. Second look: decor, decor, the home screen once, decor to the deadline.
    const { fake } = timeline((_, read) => (read === 3 ? ANDROID_HOME : ANDROID_DECOR));
    const error = await failure(FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'logged_out' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(actions(error.trace)).not.toContain('⛔ reach fresh_launch');
    // Before the rung, only the entry probe was bare; a bare second look would have said so too.
    const before = error.trace.slice(0, actions(error.trace).indexOf('⚠ reach fresh_launch'));
    expect(before.filter((t) => t.detail?.includes('every UI tree read was bare') === true)).toHaveLength(1);
  });

  it('a CHEAP rung on a probe still bare after the second look runs (since 2026-10-08 it waits for that look first) — and the ladder goes on from there', async () => {
    // Decor until the cheap rung relaunches, the login after it.
    let relaunched = false;
    const { fake, state } = timeline(() => (relaunched ? ANDROID_LOGIN : ANDROID_DECOR));
    const launch = fake.launch.bind(fake);
    let readsBeforeLaunch = -1;
    let msBeforeLaunch = -1;
    const started = Date.now();
    fake.launch = async (appId, opts) => {
      readsBeforeLaunch = state.reads;
      msBeforeLaunch = Date.now() - started;
      relaunched = true;
      return launch(appId, opts);
    };
    const trace = await FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 150 }, { state: 'logged_out_cheap_first' });
    expect(readsBeforeLaunch).toBeGreaterThan(2); // the entry probe AND the second look's polling
    expect(msBeforeLaunch).toBeGreaterThanOrEqual(150); // the whole window, then the rung
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(fake.launches).toEqual([expect.objectContaining({ clearState: false })]);
    expect(actions(trace).slice(0, 2)).toEqual(['⚠ detect', '⚠ detect']); // both probes said they read only decor
    expect(trace).toContainEqual({ action: 'state logged_out_cheap_first', detail: 'reached after open_app' });
  });

  it('an UNKNOWN probe (every read failed) still runs a cheap rung at once — no second look', async () => {
    let relaunched = false;
    const { fake, state } = timeline(() => (relaunched ? ANDROID_LOGIN : ANDROID_NULL_ROOT));
    const launch = fake.launch.bind(fake);
    let readsBeforeLaunch = -1;
    fake.launch = async (appId, opts) => {
      readsBeforeLaunch = state.reads;
      relaunched = true;
      return launch(appId, opts);
    };
    const trace = await FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 5000 }, { state: 'logged_out_cheap_first' });
    expect(readsBeforeLaunch).toBe(1); // the entry probe's single read, nothing more
    expect(trace).toContainEqual({ action: 'state logged_out_cheap_first', detail: 'reached after open_app' });
  });
});

/**
 * A bare probe gets the second look before a CHEAP rung too (2026-10-08,
 * review of the absent-on-bare change): with `absent:` undecided on the
 * decor, the entry probe of a state detected by an absence is bare, and a
 * cheap rung run at once taps a screen with nothing on it.
 */
describe('a bare probe looks again before a cheap rung', () => {
  const PROMPT_CFG = parseConfig(`
app:
  android: { package: ${PKG} }
states:
  no_prompt:
    detect: { element: { id: prompt }, absent: true }
    reach: [dismiss]
flows:
  dismiss:
    steps:
      - tap: { id: later }
`);
  /** A rendered rating prompt with its "later" button. */
  const ANDROID_PROMPT = parseUiautomatorXml(
    androidXml(`
          <node index="0" text="Ohodnoťte nás" resource-id="prompt" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[60,700][1020,840]"/>
          <node index="1" text="Neskôr" resource-id="later" class="android.widget.Button" package="${PKG}" content-desc="" bounds="[60,1400][1020,1540]"/>`),
  );

  it('the decor outlasting tapTimeoutMs, then a screen with no prompt: "already active", nothing tapped', async () => {
    const { fake } = timeline((ms) => (ms < 150 ? ANDROID_DECOR : ANDROID_LOGIN)); // 150 ms ≫ tapTimeoutMs 60
    const trace = await FlowEngine.run(PROMPT_CFG, fake, FAST, { state: 'no_prompt' });
    expect(fake.taps).toEqual([]);
    expect(trace).toContainEqual({ action: 'state no_prompt', detail: 'already active' });
  });

  it('the decor, then the prompt rendered: the rung runs on the rendered tree and taps "later"', async () => {
    let dismissed = false;
    const { fake } = timeline((ms) => (dismissed ? ANDROID_LOGIN : ms < 150 ? ANDROID_DECOR : ANDROID_PROMPT));
    const tapped: string[] = [];
    fake.tap = async () => {
      tapped.push('later');
      dismissed = true;
    };
    const trace = await FlowEngine.run(PROMPT_CFG, fake, FAST, { state: 'no_prompt' });
    expect(tapped).toEqual(['later']);
    expect(trace).toContainEqual({ action: 'tap', detail: 'id:"later"' });
    expect(trace).toContainEqual({ action: 'state no_prompt', detail: 'reached after dismiss' });
  });
});

describe('a state with no reach flows says honestly that a bare read could not check it', () => {
  it('"could not be checked", with the tree\'s shape — not "Not in state"', async () => {
    const { fake } = timeline(() => WDA_SPLASH, 'ios');
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'no_reach' }));
    expect(error.message.split('\n')[0]).toBe(
      'State "no_reach" could not be checked (every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) ' +
        'of only wrappers and unlabeled decoration) and it has no reach flows',
    );
  });
});

/**
 * An ABSENCE on a bare tree is not "yes" either (2026-10-08, flow-engine
 * review candidate 2, flow/condition.ts): nothing in the decor matches any
 * selector, so until then a state detected by `absent: true` was "already
 * active" on a cold launch, a `wait:` on it passed at once, a `branch:` arm
 * on it was taken, and the absent assert passed — all before the app had
 * drawn anything.
 */
describe('an absent condition on a bare tree is undecided: not detected, not waited past, not branched on, not asserted', () => {
  const ABSENT_CFG = parseConfig(`
app:
  android: { package: ${PKG} }
  ios: { bundleId: ${PKG} }
states:
  no_modal:
    detect: { element: { id: some_modal }, absent: true }
    reach: [fresh_launch]
  no_modal_no_reach:
    detect: { element: { id: some_modal }, absent: true }
flows:
  fresh_launch:
    steps:
      - launch: { clearState: true }
  wait_no_modal:
    steps:
      - wait: { state: no_modal }
  wait_login:
    steps:
      - wait: { element: { id: login_screen } }
  branch_on_absence:
    steps:
      - branch:
          - when: { element: { id: some_modal }, absent: true }
            do:
              - wait: { element: { id: login_screen } }
  branch_in_order:
    steps:
      - branch:
          - when: { element: { id: login_screen } }
            do: []
          - when: { element: { id: content } }
            do: []
`);

  it('ensure_state on a cold launch: the decor is NOT "already active" — the ladder looks again, and the rendered login is', async () => {
    const { fake, state } = timeline((ms) => (ms < 100 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await FlowEngine.run(ABSENT_CFG, fake, FAST, { state: 'no_modal' });
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state no_modal', detail: 'already active' });
    // The entry probe read the decor and said so; "already active" came from the second look.
    expect(trace[0]).toEqual({
      action: '⚠ detect',
      detail:
        'element id:"some_modal" treated as not detected — every UI tree read was bare, the last one ' +
        `${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration`,
    });
    expect(state.reads).toBeGreaterThan(1);
  });

  it('decor for the whole window: the destructive rung is refused (⛔), nothing is wiped', async () => {
    const { fake } = timeline(() => ANDROID_DECOR);
    const error = await failure(FlowEngine.run(ABSENT_CFG, fake, { ...FAST, ensureTimeoutMs: 120 }, { state: 'no_modal' }));
    expect(fake.launches).toEqual([]);
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach fresh_launch']);
  });

  it('no reach flows: "could not be checked", not "already active" — WDA splash', async () => {
    const { fake } = timeline(() => WDA_SPLASH, 'ios');
    const error = await failure(FlowEngine.run(ABSENT_CFG, fake, FAST, { state: 'no_modal_no_reach' }));
    expect(error.message.split('\n')[0]).toBe(
      'State "no_modal_no_reach" could not be checked (every UI tree read was bare, the last one 7 nodes (roles: container ×6, image ×1) ' +
        'of only wrappers and unlabeled decoration) and it has no reach flows',
    );
  });

  it('wait: on a state detected by absence keeps polling through the decor and passes once the screen renders', async () => {
    const { fake, state } = timeline((ms) => (ms < 30 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await FlowEngine.run(ABSENT_CFG, fake, { ...FAST, waitTimeoutMs: 1000 }, { flow: 'wait_no_modal' });
    expect(trace).toContainEqual({ action: 'wait', detail: 'state no_modal' });
    expect(state.reads).toBeGreaterThan(1);
  });

  it('wait: decor to the deadline times out, and the message says the last tree was bare', async () => {
    const { fake } = timeline(() => ANDROID_DECOR);
    const error = await failure(FlowEngine.run(ABSENT_CFG, fake, FAST, { flow: 'wait_no_modal' }));
    expect(error.message.split('\n').slice(0, 2)).toEqual([
      'Timed out after 60ms waiting for state no_modal',
      `  (the last UI tree read was bare, ${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration, so it could not ` +
        'decide this — the screen had not rendered by the deadline; compare with screenshot, and a longer timeout may be all it needs)',
    ]);
  });

  it('wait: for a present element on the decor gets the bare note too; one rendered tree after it clears the note', async () => {
    const bare = timeline(() => ANDROID_DECOR);
    expect((await failure(FlowEngine.run(ABSENT_CFG, bare.fake, FAST, { flow: 'wait_login' }))).message.split('\n')[1]).toMatch(
      /^ {2}\(the last UI tree read was bare, /,
    );
    const rendered = timeline((ms) => (ms < 20 ? ANDROID_DECOR : ANDROID_HOME));
    const error = await failure(FlowEngine.run(ABSENT_CFG, rendered.fake, FAST, { flow: 'wait_login' }));
    expect(error.message).toMatch(/^Timed out after 60ms waiting for element id:"login_screen"\n\nSteps that ran before the failure:/);
  });

  it('wait: on an id under iOS idb, a bare last tree gets the bare note — not the idb container-id hint, which is about what a rendered tree held', async () => {
    const { fake } = timeline(() => WDA_SPLASH, 'ios');
    fake.treeSourceKind = 'idb';
    const error = await failure(FlowEngine.run(ABSENT_CFG, fake, FAST, { flow: 'wait_login' }));
    expect(error.message.split('\n')[1]).toMatch(/^ {2}\(the last UI tree read was bare, 7 nodes/);
    expect(error.message).not.toContain(idbContainerIdHint('login_screen'));
  });

  it('branch: an absent arm is not taken on the decor; the poll goes on and takes it once the screen renders', async () => {
    const { fake, state } = timeline((ms) => (ms < 30 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await FlowEngine.run(ABSENT_CFG, fake, { ...FAST, waitTimeoutMs: 1000 }, { flow: 'branch_on_absence' });
    expect(trace).toContainEqual({ action: 'branch', detail: 'matched element id:"some_modal"' });
    expect(state.reads).toBeGreaterThan(2); // the decor rounds, then the login (and the arm's wait)
  });

  it('branch: an earlier arm undecided on the decor holds the round even when a later arm matches the decor — written order is the priority', async () => {
    // Arm 2 (`id: content`) is `yes` on the decor itself; arm 1 (`login_screen`) is `unknown` there and wins once the screen renders.
    const { fake, state } = timeline((ms) => (ms < 30 ? ANDROID_DECOR : ANDROID_LOGIN));
    const trace = await FlowEngine.run(ABSENT_CFG, fake, { ...FAST, waitTimeoutMs: 1000 }, { flow: 'branch_in_order' });
    expect(trace).toContainEqual({ action: 'branch', detail: 'matched element id:"login_screen"' });
    expect(trace).not.toContainEqual({ action: 'branch', detail: 'matched element id:"content"' });
    expect(state.reads).toBeGreaterThan(1);
    // Decor to the deadline: arm 2 is never taken on it; the branch times out with the bare note.
    const bare = timeline(() => ANDROID_DECOR);
    const error = await failure(FlowEngine.run(ABSENT_CFG, bare.fake, FAST, { flow: 'branch_in_order' }));
    expect(error.message.split('\n')[0]).toBe('Timed out after 60ms waiting for any branch condition (element id:"login_screen" | element id:"content")');
    expect(error.message.split('\n')[1]).toMatch(/^ {2}\(the last UI tree read was bare, /);
  });

  it('branch: decor to the deadline times out with the bare note', async () => {
    const { fake } = timeline(() => WDA_SPLASH, 'ios');
    const error = await failure(FlowEngine.run(ABSENT_CFG, fake, FAST, { flow: 'branch_on_absence' }));
    expect(error.message.split('\n').slice(0, 2)).toEqual([
      'Timed out after 60ms waiting for any branch condition (element id:"some_modal")',
      '  (the last UI tree read was bare, 7 nodes (roles: container ×6, image ×1) of only wrappers and unlabeled decoration, ' +
        'so it could not decide this — the screen had not rendered by the deadline; compare with screenshot, and a longer timeout may be all it needs)',
    ]);
  });

  it('assert absent: fails as "could not verify" on the decor, passes once the screen renders', async () => {
    const decor = timeline(() => ANDROID_DECOR);
    const v = new Verifier(decor.fake, { pollMs: 5, timeoutMs: 60 });
    expect(await v.assert({ element: { id: 'some_modal' }, absent: true })).toEqual({
      description: 'element id:"some_modal" is absent',
      pass: false,
      detail: `could not verify within 0.06 s (the last UI tree read was bare, ${treeShape(ANDROID_DECOR)} of only wrappers and unlabeled decoration, so it could not ` +
        'decide this — the screen had not rendered by the deadline; compare with screenshot, and a longer timeout may be all it needs)',
    });
    // Bare, then a rendered screen SHOWING the modal: the verdict is the last tree's — "still visible", not could-not-verify.
    const modal = parseUiautomatorXml(
      androidXml(`<node index="0" text="Nová verzia" resource-id="some_modal" class="android.widget.TextView" package="${PKG}" content-desc="" bounds="[60,900][1020,1040]"/>`),
    );
    const shown = timeline((ms) => (ms < 20 ? ANDROID_DECOR : modal));
    expect(await new Verifier(shown.fake, { pollMs: 5, timeoutMs: 80 }).assert({ element: { id: 'some_modal' }, absent: true })).toMatchObject({
      pass: false,
      detail: 'still visible after 0.08 s',
    });
    const later = timeline((ms) => (ms < 20 ? ANDROID_DECOR : ANDROID_LOGIN));
    expect(await new Verifier(later.fake, { pollMs: 5, timeoutMs: 1000 }).assert({ element: { id: 'some_modal' }, absent: true })).toMatchObject({ pass: true });
    expect(later.state.reads).toBeGreaterThan(1);
  });
});
