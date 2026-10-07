import { beforeEach, describe, expect, it, vi } from 'vitest';

// The one sleep owner as a zero-delay macrotask yield, as in engine.test.ts:
// every poll cadence collapses to one event-loop turn; deadlines are
// Date.now-based and still fire.
vi.mock('../../src/util/sleep.js', () => ({ sleep: () => new Promise((r) => setTimeout(r, 0)) }));
import type { ExecFn } from '../../src/adapters/exec.js';
import { IdbTreeSource } from '../../src/adapters/ios-tree-source.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError, EngineSession, idbContainerIdHint, type TraceEntry } from '../../src/flow/engine.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';

/**
 * The ladder against the measured stuck idb tree (docs/bugs/2026-10-06-ios-
 * idb-empty-tree-persists-on-pin-screen.md): `idb ui describe-all` returned
 * only a 0×0 Application for minutes on a RENDERED screen. Every read below
 * that is "stuck" goes through the REAL IdbTreeSource with that payload, so
 * what the engine sees is what the adapter now throws (IdbEmptyTreeError),
 * not a stand-in error. Before the fix the payload parsed as a tree in which
 * nothing matched, and mp-native's `logged_in.reach: [dismiss_post_login_
 * prompts, login_registered, login]` escalated into its `clearState` login —
 * wiping the app and its device registration on a screen nobody had read.
 */

const STUCK_PAYLOAD = JSON.stringify([
  { type: 'Application', AXLabel: 'dbosbanking', AXFrame: '{{0, 0}, {0, 0}}', frame: { x: 0, y: 0, width: 0, height: 0 } },
]);

const stuckExec: ExecFn = async (cmd, args) => ({
  stdout: Buffer.from([cmd, ...args].join(' ').startsWith('idb ui describe-all') ? STUCK_PAYLOAD : ''),
  stderr: '',
});

const CFG = parseConfig(`
app:
  android: { package: com.example.app }
  ios: { bundleId: com.example.app }
states:
  logged_in:
    detect: { element: { id: nav.tab_transactions } }
    reach: [dismiss, login_registered, login]
  pin_login:
    detect: { element: { text: "Enter your PIN to log in" } }
  login_only:
    detect: { element: { id: nav.tab_transactions } }
    reach: [login]
  relaunch_then_login:
    detect: { element: { id: nav.tab_transactions } }
    reach: [relaunch, login]
  cards:
    detect: { element: { id: cards.list } }
    reach: [goto_cards, reopen_cards]
  cards_three:
    detect: { element: { id: cards.list } }
    reach: [relaunch, goto_cards, reopen_cards]
  modal_gone:
    detect: { element: { id: some_modal }, absent: true }
flows:
  dismiss:
    steps:
      - optional:
          - tap: { text: "SKIP" }
  relaunch:
    steps:
      - launch: { clearState: false }
  login_registered:
    steps:
      - launch: { clearState: false }
      - wait: { state: pin_login, timeout: 60 }
  login:
    steps:
      - launch: { clearState: true }
      - wait: { state: pin_login, timeout: 60 }
  goto_cards:
    requires: logged_in
    steps:
      - tap: { id: nav.tab_cards }
  reopen_cards:
    steps:
      - launch: { clearState: false }
  wait_modal_gone:
    steps:
      - wait: { state: modal_gone, timeout: 60 }
  wait_login_screen:
    steps:
      - wait: { element: { id: login_screen }, timeout: 60 }
  assert_modal_absent:
    steps:
      - assert:
          - { element: { id: some_modal }, absent: true }
`);

const FAST = {
  pollMs: 5, tapTimeoutMs: 60, waitTimeoutMs: 60, ensureTimeoutMs: 60, optionalTimeoutMs: 30,
  assertTimeoutMs: 60, reachRecheckMs: 40, pinKeyDelayMs: 1, env: {},  // A fresh session at every use — a spread or a direct pass — so no test
  // inherits another's wipe count (EngineOptions.session is required).
  get session() {
    return new EngineSession();
  },
};

/** The two readable screens: the PIN screen (rendered, NOT logged in) and the logged-in home. */
const screens = () => ({
  pin: screen(el({ role: 'text', label: 'Enter your PIN to log in' }), el({ role: 'button', identifier: 'some_modal' })),
  home: screen(el({ role: 'button', identifier: 'nav.tab_transactions' })),
});

/**
 * An iOS idb fake whose reads are stuck while `stuck(readNo)` says so —
 * served by the real IdbTreeSource over the measured payload — and the
 * fake's current screen otherwise (the PIN screen unless a test moves it).
 * A test changes the rule mid-call by assigning `state.stuck`, typically
 * when a rung launches the app.
 */
function stuckIdb(stuck: (read: number) => boolean, start: 'pin' | 'home' = 'pin') {
  const fake = new FakeAdapter(screens(), start);
  fake.platform = 'ios';
  fake.treeSourceKind = 'idb';
  const source = new IdbTreeSource({ udid: 'D34212DB', exec: stuckExec });
  const readable = fake.uiTree.bind(fake);
  const state = { reads: 0, stuck };
  fake.uiTree = async () => (state.stuck(state.reads++) ? source.read() : readable());
  return { fake, state };
}

/** What the Android adapter throws for uiautomator's null root on a poller's read (adapters/android.ts, diagnoseDumpFailure). */
const ANDROID_NULL_ROOT =
  'device emulator-5554 is still settling: uiautomator has no window to dump yet (cold launch or animation; read once). ' +
  'Wait for the screen (`screenshot` waits for stability) and retry. ' +
  '(uiautomator dump returned no XML: ERROR: null root node returned by UiTestAutomationBridge.)';

/** The Android cold-launch shape: the first `unreadable` reads throw the null root, then the screen reads. */
function settlingAndroid(unreadable: number, start: 'pin' | 'home' = 'pin') {
  const fake = new FakeAdapter(screens(), start);
  const readable = fake.uiTree.bind(fake);
  let reads = 0;
  fake.uiTree = async () => {
    if (reads++ < unreadable) throw new Error(ANDROID_NULL_ROOT);
    return readable();
  };
  return fake;
}

const always = () => true;

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
  resetLayout();
});

describe('the ladder refuses a DESTRUCTIVE rung when the probe right before it never read a tree', () => {
  it('the stuck loop: mp-native\'s three-rung ladder runs its cheap rungs, refuses the clearState login with ⛔, and throws the refusal', async () => {
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'logged_in' }));

    expect(clearStateLaunches(fake)).toEqual([]);
    // The cheap rungs still ran: dismiss (its optional tap skipped) and login_registered's relaunch.
    expect(fake.launches).toEqual([expect.objectContaining({ appId: 'com.example.app', clearState: false })]);
    expect(error.trace).toContainEqual({ action: 'flow dismiss', detail: 'done' });
    expect(actions(error.trace)).toContain('⚠ reach login_registered');
    // ⛔ replaces the DESTRUCTIVE warning; the refusal is the error, with no salvage or recovery after it.
    const refused = error.trace.find((t) => t.action === '⛔ reach login');
    expect(refused?.detail).toMatch(
      /^refused: the rung is DESTRUCTIVE .* never read a UI tree, a second look included, .* last UI tree read failed: idb returned an empty accessibility tree \(only a 0×0 Application\)\. Compare with screenshot; retry once the tree reads$/,
    );
    // One spelling: the trace line is the error's reason, word for word.
    expect(error.message.split('\n')[0]).toBe(`Refused to run reach flow "login" for state "logged_in": ${refused?.detail?.slice('refused: '.length)}`);
    expect(error.trace.some((t) => t.detail?.includes('this rung is DESTRUCTIVE —') === true)).toBe(false);
    expect(error.trace.at(-1)?.action).toBe('⛔ reach login');
    expect(error.message).toMatch(
      /^Refused to run reach flow "login" for state "logged_in": the rung is DESTRUCTIVE .* last UI tree read failed: idb returned an empty accessibility tree \(only a 0×0 Application\)\. Compare with screenshot; retry once the tree reads\n/,
    );
    // The trace quotes the read error's first line only: the cause, never idb's paragraph of advice, however many probes failed.
    expect(error.trace.filter((t) => t.detail?.includes('idb returned an empty accessibility tree') === true).length).toBeGreaterThan(3);
    expect(error.trace.some((t) => t.detail?.includes('The app may still be rendered') === true)).toBe(false);
  });

  it('a nested refusal is terminal: the OUTER ladder neither escalates past it nor salvages it', async () => {
    // cards: [goto_cards (requires logged_in), reopen_cards]. goto_cards'
    // requires runs logged_in's ladder, which refuses its login; escalating
    // the outer ladder to reopen_cards would treat that refusal as a failed
    // cheap rung.
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'cards' }));

    expect(error.message).toMatch(/^Refused to run reach flow "login" for state "logged_in"/);
    expect(clearStateLaunches(fake)).toEqual([]);
    // Only the nested ladder's login_registered relaunched — reopen_cards never ran.
    expect(fake.launches).toHaveLength(1);
    expect(actions(error.trace)).not.toContain('flow reopen_cards');
    expect(error.trace.some((t) => t.detail?.includes('escalating to reopen_cards') === true)).toBe(false);
    // The refusal is the NESTED ladder's, on the rung that actually wipes —
    // goto_cards itself wipes nothing, so it was not refused for what its requires might pull in.
    expect(actions(error.trace)).toContain('⛔ reach login');
    expect(actions(error.trace)).not.toContain('⛔ reach goto_cards');
    expect(actions(error.trace).some((a) => a.startsWith('↻ recovery'))).toBe(false);
  });

  it('a nested refusal in a MIDDLE rung: no rung after it runs, and no "escalating to" line follows the ⛔', async () => {
    // cards_three: [relaunch, goto_cards (requires logged_in), reopen_cards].
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'cards_three' }));
    expect(error.message).toMatch(/^Refused to run reach flow "login" for state "logged_in"/);
    const refusedAt = actions(error.trace).indexOf('⛔ reach login');
    expect(refusedAt).toBeGreaterThan(-1);
    expect(error.trace.slice(refusedAt + 1).some((t) => t.detail?.includes('escalating to') === true)).toBe(false);
    expect(actions(error.trace)).not.toContain('flow reopen_cards');
    // relaunch (rung 1) and the nested ladder's login_registered; reopen_cards never launched.
    expect(fake.launches).toHaveLength(2);
    expect(clearStateLaunches(fake)).toEqual([]);
  });

  it('a single-rung `reach: [login]` behind an unreadable entry probe is refused — nothing launches', async () => {
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'login_only' }));
    expect(error.message).toMatch(/^Refused to run reach flow "login" for state "login_only"/);
    expect(fake.launches).toEqual([]);
    // The entry probe and its second look both failed to read.
    expect(actions(error.trace)).toEqual(['⚠ detect', '⚠ detect', '⛔ reach login']);
  });

  it('an explicit run_flow of the destructive flow is never refused — the rule is the ladder\'s', async () => {
    const { fake } = stuckIdb(always);
    await failure(FlowEngine.run(CFG, fake, FAST, { flow: 'login' })); // its wait still times out on the stuck tree
    expect(clearStateLaunches(fake)).toHaveLength(1);
  });
});

describe('an unknown probe gets ONE second look before a destructive rung is refused', () => {
  it('transient: one failed read, then good reads off the state — the destructive rung runs, with its warning and no ⛔', async () => {
    const { fake } = stuckIdb((read) => read === 0);
    // The call still fails: login's own wait times out, since the fake does not log in.
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'login_only' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(error.trace).toContainEqual(expect.objectContaining({ action: '⚠ reach login', detail: expect.stringMatching(/^this rung is DESTRUCTIVE/) }));
    expect(actions(error.trace)).not.toContain('⛔ reach login');
  });

  it('the second look reads the state: nothing runs, and the call succeeds as "already active"', async () => {
    const { fake } = stuckIdb((read) => read === 0, 'home');
    const trace = await FlowEngine.run(CFG, fake, FAST, { state: 'login_only' });
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state login_only', detail: 'already active' });
    expect(actions(trace)).not.toContain('⚠ reach login');
  });

  it('a LATER rung: the post-rung probe is unknown and the second look reads the state — "reached after" the previous rung, nothing destructive runs', async () => {
    // relaunch_then_login: the entry probe READS the PIN screen ("no"), so
    // relaunch runs; the relaunch lands on home but the tree is stuck past
    // the post-rung grace (40 ms), then readable inside the second look.
    // Timed, not counted, because a grace poll's read count is not fixed:
    // stuck for 100 ms after the launch, against a 1 s second look (the
    // window is ensureTimeoutMs since 2026-10-07; it was tapTimeoutMs).
    const { fake, state } = stuckIdb(() => false);
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      const at = Date.now();
      fake.current = 'home';
      state.stuck = () => Date.now() - at < 100;
      return launch(appId, opts);
    };
    const trace = await FlowEngine.run(CFG, fake, { ...FAST, ensureTimeoutMs: 1000 }, { state: 'relaunch_then_login' });
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(fake.launches).toHaveLength(1);
    expect(trace).toContainEqual({ action: 'state relaunch_then_login', detail: 'reached after relaunch' });
    expect(actions(trace)).toContain('⚠ detect'); // the post-rung probe really was unknown
  });

  it('persistent: every read fails through the second look — refused (the stuck loop and the single-rung case above)', async () => {
    const { fake, state } = stuckIdb(always);
    await failure(FlowEngine.run(CFG, fake, FAST, { state: 'login_only' }));
    expect(fake.launches).toEqual([]);
    expect(state.reads).toBeGreaterThan(2); // the window polled, it did not give up after one more read
  });
});

describe('Android: the cost of the rule on uiautomator\'s cold-launch null root', () => {
  it('a device that stays unreadable through the second look is refused — no clearState launch', async () => {
    const fake = settlingAndroid(Number.POSITIVE_INFINITY);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'login_only' }));
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(fake.launches).toEqual([]);
    expect(error.message).toMatch(
      /^Refused to run reach flow "login" for state "login_only": .* last UI tree read failed: device emulator-5554 is still settling: uiautomator has no window to dump yet/,
    );
  });

  it('a device that recovers inside the second look runs the rung, as before the rule', async () => {
    const fake = settlingAndroid(2);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'login_only' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(actions(error.trace)).not.toContain('⛔ reach login');
  });

  it('a device that recovers onto the state is already there — nothing runs', async () => {
    const fake = settlingAndroid(1, 'home');
    const trace = await FlowEngine.run(CFG, fake, FAST, { state: 'login_only' });
    expect(fake.launches).toEqual([]);
    expect(trace).toContainEqual({ action: 'state login_only', detail: 'already active' });
  });
});

describe('a state with no reach flows says honestly that it could not be checked', () => {
  it('unknown probe: "could not be checked", with the cause; a probe that read a tree keeps "Not in state"', async () => {
    const cfg = parseConfig(`
app:
  ios: { bundleId: com.example.app }
states:
  bare: { detect: { element: { id: nav.tab_transactions } } }
`);
    const { fake } = stuckIdb(always);
    const unread = await failure(FlowEngine.run(cfg, fake, FAST, { state: 'bare' }));
    expect(unread.message).toMatch(
      /^State "bare" could not be checked \(last UI tree read failed: idb returned an empty accessibility tree \(only a 0×0 Application\)\) and it has no reach flows\n/,
    );
    const { fake: readable } = stuckIdb(() => false);
    const missed = await failure(FlowEngine.run(cfg, readable, FAST, { state: 'bare' }));
    expect(missed.message).toMatch(/^Not in state "bare" and it has no reach flows/);
  });
});

describe('only the probe IMMEDIATELY before the destructive rung decides', () => {
  it('entry probe unreadable, then the post-rung probe reads a tree that is not in the state: the destructive rung runs', async () => {
    const { fake, state } = stuckIdb(always);
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      state.stuck = () => false; // the relaunch wakes idb
      return launch(appId, opts);
    };
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'relaunch_then_login' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
    expect(error.trace).toContainEqual(expect.objectContaining({ action: '⚠ reach login', detail: expect.stringMatching(/^this rung is DESTRUCTIVE/) }));
    expect(actions(error.trace)).not.toContain('⛔ reach login');
  });

  it('one tree read inside the post-rung grace window is knowledge, even when later reads in it fail', async () => {
    const { fake, state } = stuckIdb(always);
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      const first = state.reads;
      state.stuck = (read) => read !== first; // exactly the first read after the relaunch is readable
      return launch(appId, opts);
    };
    await failure(FlowEngine.run(CFG, fake, FAST, { state: 'relaunch_then_login' }));
    expect(clearStateLaunches(fake)).toHaveLength(1);
  });

  it('the reverse: entry probe READ a tree (not in state), the post-rung probe could not — refused', async () => {
    const { fake, state } = stuckIdb(() => false);
    const launch = fake.launch.bind(fake);
    fake.launch = async (appId, opts) => {
      state.stuck = always; // the relaunch lands on the stuck tree
      return launch(appId, opts);
    };
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { state: 'relaunch_then_login' }));
    expect(clearStateLaunches(fake)).toEqual([]);
    expect(fake.launches).toHaveLength(1); // relaunch ran
    expect(actions(error.trace)).toContain('⛔ reach login');
    expect(error.message).toMatch(/^Refused to run reach flow "login" for state "relaunch_then_login"/);
  });
});

describe('waits and asserts on the stuck tree fail closed', () => {
  it('a wait on an ABSENT condition times out instead of passing, quoting the empty-tree read error', async () => {
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { flow: 'wait_modal_gone' }));
    expect(error.message).toMatch(
      /^Timed out after 60ms waiting for state modal_gone\n {2}\(last UI tree read failed: idb returned an empty accessibility tree/,
    );
  });

  it('an absent assert fails as "could not verify", not PASS', async () => {
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { flow: 'assert_modal_absent' }));
    expect(error.message).toMatch(
      /FAIL element id:"some_modal" is absent — could not verify within 60ms \(last UI tree read failed: idb returned an empty accessibility tree/,
    );
  });

  it('an id wait under idb names the empty read, not the container-id hint — the reads are the story', async () => {
    const { fake } = stuckIdb(always);
    const error = await failure(FlowEngine.run(CFG, fake, FAST, { flow: 'wait_login_screen' }));
    expect(error.message).toMatch(/last UI tree read failed: idb returned an empty accessibility tree/);
    expect(error.message).not.toContain(idbContainerIdHint('login_screen'));
    expect(error.message).not.toContain('no tree read contained');
  });
});
