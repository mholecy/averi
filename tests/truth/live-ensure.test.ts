import { describe, expect, it } from 'vitest';
import { flowIsDestructive, parseConfig } from '../../src/flow/config.js';
import { caseConfig, rejudge, selectCases, type RunRecord } from '../../scripts/truth/live-cases.js';
import { HELD_SLACK_S, HOLD_S, judgeFullWindow, judgeHeldNo, WIPE_WINDOW_S } from '../../scripts/truth/live-ensure.js';
import { heldStill } from '../../scripts/truth/replies.js';
import type { LabState } from '../../scripts/truth/schema.js';

// The `ensure` group (backlog D30, ADR 0033's held "no" on a device): ensure_state on the held cells — bare for 3 s,
// (held-no-spinner: then 4 s of a spinner), then Welcome with Continue, Continue showing Home. The app's phase events
// and Continue's tap are the oracle; the reply's held line is averi's word on the hold (engine.ts's `second look: not
// detected, the screen held still …`). Judged without a device here, over synthesized reads.

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
/** The run of h1: Welcome at 3 s, Continue tapped at `tap`, Home right after it. */
const h1 = (tap: number) => read({ bare: 0, welcome: 3, home: tap + 0.2 }, tap);
/** The run of h2: the spinner at 3 s, Welcome at 7 s. */
const h2 = (tap: number) => read({ bare: 0, spinner: 3, welcome: 7, home: tap + 0.2 }, tap, 'held-no-spinner');
const HELD = [
  "state home: second look: not detected, the screen held still 2.3 s — running continue before the 20 s window's end",
  'tap id:"lab.held-no.continue": Tapped',
  'state home: reached after continue',
].join('\n');
const FULL = ['tap id:"lab.held-no.continue": Tapped', 'state home: reached after continue'].join('\n');

describe('replies.ts#heldStill: the held line, read in one place', () => {
  it('reads the held seconds and the rung it ran', () => {
    expect(heldStill(HELD)).toEqual({ heldS: 2.3, flow: 'continue' });
  });
  it('no held line: undefined', () => {
    expect(heldStill(FULL)).toBeUndefined();
  });
});

describe('judgeHeldNo (h1, h2): no wipe ahead — the hold ends the look ~2 s after Welcome', () => {
  it('Continue tapped 2.5 s after Welcome, the held line said, Home reached: ok', () => {
    expect(judgeHeldNo(h1(5.5), [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'ok' });
    expect(judgeHeldNo(h2(9.6), [HELD], 'wda', LAUNCHED)).toMatchObject({ outcome: 'ok' });
  });

  it('the slack per source: iOS 1 s, Android 3 s past Welcome + 2 s', () => {
    expect(HOLD_S).toBe(2);
    expect(HELD_SLACK_S).toEqual({ idb: 1, wda: 1, uiautomator: 3 });
    expect(judgeHeldNo(h1(3 + 2 + 1), [HELD], 'idb', LAUNCHED).outcome).toBe('ok');
    expect(judgeHeldNo(h1(3 + 2 + 1.1), [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
    expect(judgeHeldNo(h1(3 + 2 + 2.9), [HELD], 'uiautomator', LAUNCHED).outcome).toBe('ok');
    expect(judgeHeldNo(h1(3 + 2 + 3.1), [HELD], 'uiautomator', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
  });

  it('Continue tapped at the full window\'s end, no held line: the hold never ended the look — MISMATCH held-late', () => {
    expect(judgeHeldNo(h1(21), [FULL], 'wda', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-late' });
  });

  it('the held line said, Continue tapped under 2 s after Welcome: the hold ended before Welcome had held — on the spinner (D37) — MISMATCH held-early', () => {
    // idb reads the spinner as `other`: the hold ends ~2 s into it, the rung's tap waits for Continue and taps it at once.
    expect(judgeHeldNo(h2(7.4), [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-early', why: expect.stringMatching(/before Welcome had held 2 s/) });
    expect(judgeHeldNo(h1(4.9), [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-early' });
  });

  it('no held line, Continue tapped under 2 s after Welcome: the entry probe read Welcome itself, no second look ran — SKIP', () => {
    expect(judgeHeldNo(h1(3.6), [FULL], 'wda', LAUNCHED)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/entry probe/) });
  });

  it('in time, but no held line: MISMATCH held-unsaid', () => {
    expect(judgeHeldNo(h1(5.5), [FULL], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-unsaid' });
  });

  it('Home reached but averi failed: MISMATCH failed-holds; Home not reached and averi failed: LOUD; not reached, averi silent: MISMATCH', () => {
    expect(judgeHeldNo(h1(5.5), [`ERROR ${HELD}`], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
    const stuck = read({ bare: 0, welcome: 3 });
    expect(judgeHeldNo(stuck, ['ERROR Timed out after 5000ms waiting for element id:"lab.held-no.home"'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
    expect(judgeHeldNo(stuck, [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'ensure-claim' });
  });

  it('the app never showed Welcome: LOUD not-reached, naming it', () => {
    expect(judgeHeldNo(read({ bare: 0 }), ['ERROR x'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached', why: expect.stringMatching(/no welcome phase/) });
  });
});

describe('judgeFullWindow (h3): a wipe ahead — the look keeps its full window', () => {
  it('Continue tapped 18 s after Welcome, no held line, Home reached: ok', () => {
    expect(WIPE_WINDOW_S).toBe(15);
    expect(judgeFullWindow(h1(21), [FULL], 'idb', LAUNCHED)).toMatchObject({ outcome: 'ok' });
    expect(judgeFullWindow(h1(3 + 15), [FULL], 'idb', LAUNCHED).outcome).toBe('ok');
  });
  it('a held line with a wipe ahead: MISMATCH held-said', () => {
    expect(judgeFullWindow(h1(21), [HELD], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'held-said' });
  });
  it('Continue tapped before Welcome + 15 s, no held line: the window cut — MISMATCH window-cut', () => {
    expect(judgeFullWindow(h1(3 + 14.9), [FULL], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'window-cut' });
    expect(judgeFullWindow(h1(6), [FULL], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'window-cut' });
  });
  it('no held line, Continue under 2 s after Welcome: the entry probe read Welcome — SKIP', () => {
    expect(judgeFullWindow(h1(4), [FULL], 'idb', LAUNCHED).outcome).toBe('SKIP');
  });
  it('Home and the reply held to each other as in h1', () => {
    expect(judgeFullWindow(h1(21), [`ERROR ${FULL}`], 'idb', LAUNCHED)).toMatchObject({ outcome: 'MISMATCH', cls: 'failed-holds' });
    expect(judgeFullWindow(read({ bare: 0, welcome: 3 }), ['ERROR x'], 'idb', LAUNCHED)).toMatchObject({ outcome: 'LOUD', cls: 'not-reached' });
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
  const record: RunRecord = {
    platform: 'ios',
    side: 'this checkout',
    results: [
      { source: 'idb', id: 'h1', replies: [HELD], launched: LAUNCHED, after: [], state: h1(5.5) },
      { source: 'idb', id: 'h2', replies: [HELD], launched: LAUNCHED, after: [], state: h2(7.4) },
      { source: 'idb', id: 'h3', replies: [FULL], launched: LAUNCHED, after: [], state: h1(21) },
    ],
  };
  it('--groups ensure: judged — h2 held on the spinner is a MISMATCH, exit 1', async () => {
    const { lines, exitCode } = await rejudge(record, 'r.json', { groups: ['ensure'] });
    expect(lines[1]).toBe('# Live golden: 3 cases, 2 ok, 0 loud, 1 mismatches (1 not known), 0 skipped');
    expect(exitCode).toBe(1);
  });
  it('the default groups select none of it', async () => {
    const { lines } = await rejudge(record, 'r.json', { groups: ['forms'] });
    expect(lines[1]).toMatch(/^# Live golden: 0 cases/);
  });
});
