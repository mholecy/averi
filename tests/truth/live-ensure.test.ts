import { describe, expect, it } from 'vitest';
import { flowIsDestructive, parseConfig } from '../../src/flow/config.js';
import { caseConfig, rejudge, selectCases, type RunRecord } from '../../scripts/truth/live-cases.js';
import { EPS_S, ENSURE_WINDOW_S, heldSlackS, judgeFullWindow, judgeHeldNo, POLL_S, READ_S, TAP_S } from '../../scripts/truth/live-ensure.js';
import { bareEntry, heldStill } from '../../scripts/truth/replies.js';
import type { LabState } from '../../scripts/truth/schema.js';

// The `ensure` group (backlog D30, ADR 0033's held "no" on a device): ensure_state on the held cells — bare for 6 s,
// (held-no-spinner: then 4 s of a spinner), then Welcome with Continue, Continue showing Home. The app's phase events
// and Continue's tap are the oracle; the reply's bare entry line and held line are averi's word on the probe and the
// hold. Judged without a device here, over synthesized reads (the reply lines themselves: live-ensure-engine.test.ts,
// which takes them from the engine).

const T0 = 1_800_000_000;
/** A held cell's read: its phases at seconds after launch, Continue's tap at `tap` s (none when undefined). */
function read(phases: Record<string, number>, tap?: number, cell = 'held-no'): LabState {
  const events = [
    ...Object.entries(phases).map(([tag, t]) => ({ kind: 'phase' as const, tag, at: T0 + t })),
    ...(tap === undefined ? [] : [{ kind: 'tap' as const, tag: 'continue', at: T0 + tap }]),
  ].sort((a, b) => a.at - b.at);
  return { cell, ready: true, screen: { x: 0, y: 0, width: 402, height: 874 }, scale: 3, frames: {}, events };
}
const LAUNCHED = read({ bare: 0 });
/** The judges as held-no's catalog entry makes them (`held.bareMs` 6 s). */
const heldNo = judgeHeldNo({ bareMs: 6000 });
const fullWindow = judgeFullWindow({ bareMs: 6000 });
/** The run of h1: Welcome at 6 s, Continue tapped at `tap`, Home right after it. */
const h1 = (tap: number) => read({ bare: 0, welcome: 6, home: tap + 0.2 }, tap);
/** The run of h2: the spinner at 6 s, Welcome at 10 s. */
const h2 = (tap: number) => read({ bare: 0, spinner: 6, welcome: 10, home: tap + 0.2 }, tap, 'held-no-spinner');
const ENTRY = '⚠ detect: element id:"lab.held-no.home" treated as not detected — every UI tree read was bare, the last one 2 nodes (roles: other ×2) holding nothing';
const LOOK_BARE = '⚠ detect: element id:"lab.held-no.home" treated as not detected (second look over 20 s) — every UI tree read was bare, the last one 2 nodes';
const ENTRY_FAILED = '⚠ detect: element id:"lab.held-no.home" treated as not detected — last UI tree read failed: idb timed out';
const DONE = ['flow continue: start', 'tap id:"lab.held-no.continue": Tapped', 'state home: reached after continue'];
const held = (s: number, entry = ENTRY) => [entry, `state home: second look: not detected, the screen held still ${s} s — running continue before the 20 s window's end`, ...DONE].join('\n');
const full = (entry = ENTRY) => [entry, ...DONE].join('\n');

describe('replies.ts: the bare entry line and the held line, read in one place', () => {
  it('heldStill reads the held seconds and the rung it ran; none without the line', () => {
    expect(heldStill(held(2.3))).toEqual({ heldS: 2.3, flow: 'continue' });
    expect(heldStill(full())).toBeUndefined();
  });
  it('bareEntry: the ENTRY probe\'s bare line only — not the second look\'s, not a failed read', () => {
    expect(bareEntry(full())).toBe(true);
    expect(bareEntry([LOOK_BARE, ...DONE].join('\n'))).toBe(false);
    expect(bareEntry(full(ENTRY_FAILED))).toBe(false);
    expect(bareEntry(DONE.join('\n'))).toBe(false);
  });
  it('bareEntry: the entry probe\'s line is the trace\'s first (after an `environment` line) — a bare rung re-check later is not it', () => {
    const recheck = ENTRY;
    expect(bareEntry(['flow continue: start', recheck, 'state home: reached after continue'].join('\n'))).toBe(false);
    expect(bareEntry(['environment staging: overrides: user', ENTRY, ...DONE].join('\n'))).toBe(true);
  });
});

describe('judgeHeldNo (h1, h2): no wipe ahead — the hold ends the look heldS after Welcome', () => {
  it('the bounds: heldS − ε below, heldS + a poll, three reads and a tap above, per source', () => {
    expect(EPS_S).toBe(0.05);
    expect(POLL_S).toBe(0.5);
    expect(READ_S).toEqual({ idb: 0.5, wda: 0.5, uiautomator: 3 });
    expect(TAP_S).toEqual({ idb: 0.5, wda: 0.5, uiautomator: 1 });
    expect(heldSlackS('idb')).toBe(2.5);
    expect(heldSlackS('uiautomator')).toBe(10.5);
  });

  it('Continue tapped within [Welcome + heldS − ε, Welcome + heldS + slack], the bare entry and the held line said: ok', () => {
    expect(heldNo(h1(6 + 2.3), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'ok', kind: 'other' });
    expect(heldNo(h1(6 + 2.3 - 0.04), [held(2.3)], 'idb', LAUNCHED).outcome).toBe('ok');
    expect(heldNo(h1(6 + 2.3 + 2.45), [held(2.3)], 'wda', LAUNCHED).outcome).toBe('ok');
    expect(heldNo(h2(10 + 3), [held(2.1)], 'uiautomator', LAUNCHED).outcome).toBe('ok');
  });

  it('past the slack: MISMATCH held-late', () => {
    expect(heldNo(h1(6 + 2.3 + 2.6), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
    expect(heldNo(h1(6 + 2.3 + 10.4), [held(2.3)], 'uiautomator', LAUNCHED).outcome).toBe('ok');
    expect(heldNo(h1(6 + 2.3 + 10.6), [held(2.3)], 'uiautomator', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
  });

  it('tapped sooner after Welcome than the screen held: the hold began before Welcome — on the spinner — MISMATCH held-early', () => {
    // The hold ran 2.1 s on a spinner read as content; the rung's tap waited for Continue and tapped it at once.
    expect(heldNo(h2(10.4), [held(2.1)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-early', why: expect.stringMatching(/held 2\.1 s/) });
    expect(heldNo(h1(6 + 2.3 - 0.06), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-early' });
  });

  it('no bare entry line — the entry probe read content or failed, so no second look was earned: MISMATCH entry-not-bare, never SKIP', () => {
    expect(heldNo(h1(6.5), [DONE.join('\n')], 'wda', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'entry-not-bare' });
    expect(heldNo(h1(6 + 2.3), [held(2.3, ENTRY_FAILED)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'entry-not-bare' });
  });

  it('a bare entry, no held line: the look ran its full window (held-late) or ended unsaid (held-unsaid)', () => {
    expect(heldNo(h1(ENSURE_WINDOW_S + 0.5), [full()], 'wda', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
    expect(heldNo(h1(8.5), [full()], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-unsaid' });
  });

  it('the app logged no bare phase: SKIP — the case never set up, outside averi', () => {
    expect(heldNo(read({ welcome: 0, home: 2.5 }, 2.3), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/no bare phase/) });
  });

  it('Home reached but averi failed: MISMATCH failed-holds; Home not reached and averi failed: LOUD; not reached, averi silent: MISMATCH', () => {
    expect(heldNo(h1(8.3), [`ERROR ${held(2.3)}`], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
    const stuck = read({ bare: 0, welcome: 6 });
    expect(heldNo(stuck, ['ERROR Timed out after 5000ms waiting for element id:"lab.held-no.home"'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
    expect(heldNo(stuck, [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'ensure-claim' });
  });

  it('`unconfigured` (a stale catalog): SKIP naming the cause, whatever averi said or the read holds', () => {
    const stale = /the lab app never left the bare phase — rebuild\/reinstall the lab app with the current catalog/;
    for (const reply of ['ERROR x', held(2.3)]) {
      expect(heldNo(read({ bare: 0, unconfigured: 0 }), [reply], 'idb', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/unconfigured/) });
      expect(fullWindow(read({ bare: 0, unconfigured: 0 }), [reply], 'idb', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(stale) });
    }
    expect(heldNo(read({ bare: 0, unconfigured: 0, welcome: 6, home: 8.5 }, 8.3), [held(2.3)], 'idb', LAUNCHED).outcome).toBe('SKIP');
  });

  it('no welcome phase: a stale app only when the read came after Welcome was due (bareMs + spinnerMs past the bare phase)', () => {
    const stale = /the lab app never left the bare phase — rebuild\/reinstall the lab app with the current catalog/;
    const at = (readAt: number) => ({ ...read({ bare: 0 }), readAt: T0 + readAt });
    // held-no: Welcome due at 6 s.
    expect(heldNo(at(6.5), ['ERROR x'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(stale) });
    expect(fullWindow(at(6.5), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(stale) });
    // A fast averi failure, read before Welcome was due: averi's verdict, not the app's.
    expect(heldNo(at(5.5), ['ERROR boom'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached', why: expect.stringMatching(/no welcome phase logged.*ERROR boom/) });
    expect(heldNo(at(5.5), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'ensure-claim' });
    // held-no-spinner: Welcome due at 6 + 4 s.
    expect(judgeHeldNo({ bareMs: 6000, spinnerMs: 4000 })(at(9.5), ['ERROR x'], 'idb', LAUNCHED).outcome).toBe('LOUD');
    expect(judgeHeldNo({ bareMs: 6000, spinnerMs: 4000 })(at(10.5), ['ERROR x'], 'idb', LAUNCHED).outcome).toBe('SKIP');
    // No read time (a record before it was stamped): nothing proves the app stale — averi's verdict.
    expect(heldNo(read({ bare: 0 }), ['ERROR x'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
    // Home without Welcome: averi's claim held to the app.
    expect(heldNo({ ...read({ bare: 0, home: 7 }, 6.8), readAt: T0 + 5 }, [full()], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'ensure-claim' });
  });
});

describe('judgeFullWindow (h3): a wipe ahead — the look keeps its full window', () => {
  it('Continue tapped ≥ the bare phase + the 20 s window, a bare entry, no held line: ok', () => {
    expect(ENSURE_WINDOW_S).toBe(20);
    expect(fullWindow(h1(21), [full()], 'idb', LAUNCHED)).toMatchObject({ outcome: 'ok', kind: 'other' });
    expect(fullWindow(h1(20 - 0.04), [full()], 'idb', LAUNCHED).outcome).toBe('ok');
  });
  it('a held line with a wipe ahead: MISMATCH held-said', () => {
    expect(fullWindow(h1(21), [held(2.3)], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-said' });
  });
  it('tapped before the window could end: MISMATCH window-cut', () => {
    expect(fullWindow(h1(20 - 0.06), [full()], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'window-cut' });
    expect(fullWindow(h1(9), [full()], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'window-cut' });
  });
  it('no bare entry line: MISMATCH entry-not-bare; no bare phase: SKIP', () => {
    expect(fullWindow(h1(6.5), [DONE.join('\n')], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'entry-not-bare' });
    expect(fullWindow(read({ welcome: 0, home: 21 }, 20.8), [full()], 'idb', LAUNCHED).outcome).toBe('SKIP');
  });
  it('Home and the reply held to each other as in h1', () => {
    expect(fullWindow(h1(21), [`ERROR ${full()}`], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
    expect(fullWindow(read({ bare: 0, welcome: 6 }), ['ERROR x'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
  });
});

describe('the ensure group: h1–h3, only when asked', () => {
  it('not in the default groups; --groups ensure selects h1, h2, h3 on both platforms', async () => {
    expect((await selectCases({ platform: 'ios', app: 'native', groups: ['forms'] })).filter((c) => c.group === 'ensure')).toEqual([]);
    for (const platform of ['ios', 'android'] as const) {
      const cases = await selectCases({ platform, app: 'native', groups: ['ensure'] });
      expect(cases.map((c) => [c.id, c.cell, c.calls.map((x) => x.tool)])).toEqual([
        ['h1', 'held-no', ['ensure_state']],
        ['h2', 'held-no-spinner', ['ensure_state']],
        ['h3', 'held-no', ['ensure_state']],
      ]);
      // Per case: its tree source bound first (live.ts), and a SKIP of it fails the run (summarize).
      expect(cases.every((c) => c.warmUp === true && c.skipFails === true)).toBe(true);
      // Each judge reads its cell's catalog `held`: Welcome due at 6 s on held-no, at 10 s on held-no-spinner.
      const stuck = (readAt: number, cell: string) => ({ ...read({ bare: 0 }, undefined, cell), readAt: T0 + readAt });
      const [h1c, h2c, h3c] = cases;
      expect(h1c.judge(stuck(7, 'held-no'), ['ERROR x'], 'idb', LAUNCHED, []).outcome).toBe('SKIP');
      expect(h2c.judge(stuck(7, 'held-no-spinner'), ['ERROR x'], 'idb', LAUNCHED, []).outcome).toBe('LOUD');
      expect(h2c.judge(stuck(10.5, 'held-no-spinner'), ['ERROR x'], 'idb', LAUNCHED, []).outcome).toBe('SKIP');
      expect(h3c.judge(stuck(7, 'held-no'), [full()], 'idb', LAUNCHED, []).outcome).toBe('SKIP');
    }
    expect(await selectCases({ platform: 'ios', app: 'react-native', groups: ['ensure'] })).toEqual([]);
  });

  it('each case\'s averi.yaml parses; h1 and h2 have no wipe ahead, h3\'s ladder ends in a flow marked destructive', async () => {
    const cases = await selectCases({ platform: 'ios', app: 'native', groups: ['ensure'] });
    for (const c of cases) {
      const written = caseConfig('idb', c, 'native');
      expect(written).toMatchObject({ app: { ios: { bundleId: 'dev.averi.lab', treeSource: 'idb' } } });
      const cfg = parseConfig(JSON.stringify(written));
      const state = c.calls[0].args.state as string;
      const reach = cfg.states[state].reach!;
      expect(reach[0]).toBe('continue');
      expect(flowIsDestructive(cfg, 'continue')).toBe(false);
      expect(reach.some((f) => flowIsDestructive(cfg, f))).toBe(c.id === 'h3');
    }
  });

  it('a case without states writes none (the forms\' configs unchanged)', async () => {
    const [b1] = await selectCases({ platform: 'ios', app: 'native', groups: ['forms'], only: ['b1'] });
    expect(caseConfig('wda', b1, 'native')).toEqual({ app: { android: { package: 'dev.averi.lab' }, ios: { bundleId: 'dev.averi.lab', treeSource: 'wda' } } });
  });
});

describe('a recorded ensure run, rejudged', () => {
  const record = (h3 = h1(21)): RunRecord => ({
    platform: 'ios',
    side: 'this checkout',
    results: [
      { source: 'idb', id: 'h1', replies: [held(2.3)], launched: LAUNCHED, after: [], state: h1(8.4) },
      { source: 'idb', id: 'h2', replies: [held(2.1)], launched: LAUNCHED, after: [], state: h2(10.4) },
      { source: 'idb', id: 'h3', replies: [full()], launched: LAUNCHED, after: [], state: h3 },
    ],
  });
  it('--groups ensure: judged — h2 held on the spinner is a MISMATCH, exit 1', async () => {
    const { lines, exitCode } = await rejudge(record(), 'r.json', { groups: ['ensure'] });
    expect(lines[1]).toBe('# Live golden: 3 cases, 2 ok, 0 loud, 1 mismatches (1 not known), 0 skipped');
    expect(exitCode).toBe(1);
  });
  it('a SKIP in the ensure group fails the run too: it proves nothing', async () => {
    const r = record();
    r.results = [r.results[0], { ...r.results[2], state: read({ welcome: 0, home: 21 }, 20.8) }];
    const { lines, exitCode } = await rejudge(r, 'r.json', { groups: ['ensure'] });
    expect(lines[1]).toBe('# Live golden: 2 cases, 1 ok, 0 loud, 0 mismatches (0 not known), 1 skipped');
    expect(lines).toContain('SKIPPED where a skip proves nothing — the run fails: idb h3');
    expect(exitCode).toBe(1);
  });
  it('all ok: exit 0', async () => {
    const r = record();
    r.results = [r.results[0], r.results[2]];
    expect((await rejudge(r, 'r.json', { groups: ['ensure'] })).exitCode).toBe(0);
  });
  it('the default groups select none of it', async () => {
    const { lines } = await rejudge(record(), 'r.json', { groups: ['forms'] });
    expect(lines[1]).toMatch(/^# Live golden: 0 cases/);
  });
});
