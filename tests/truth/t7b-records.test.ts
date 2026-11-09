import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { judged, rejudgedResults, selectCases, type Case, type CaseRecord, type RunRecord } from '../../scripts/truth/live-cases.js';

/**
 * T7b's evidence (docs/truth/live-records/t7b-chooser, the backlog's T7 row, ADR 0044's T7b amendment): the chooser
 * group's runs on the lab AVD, read back and judged again by this checkout's judges; then each case's recorded device
 * reads judged against the reply a plausible regression would give, to show every case can fail on what the device
 * really said. Not a rejudged record set of the static ratchet.
 */

const DIR = new URL('../../docs/truth/live-records/t7b-chooser/', import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as RunRecord;
/** The first three settled runs (no first window read kept, no HOME read), then review round 1's three (both kept). */
const FIRST_RUNS = ['run-1.json', 'run-2.json', 'run-3.json'];
const REVIEW_RUNS = ['review1-run-1.json', 'review1-run-2.json', 'review1-run-3.json'];
const RUNS = [...FIRST_RUNS, ...REVIEW_RUNS];
const IDS = ['lc1', 'lc2', 'lc3', "lc4'", "lc4''"];

const verdictsOf = async (f: string) => (await rejudgedResults(read(f), { groups: ['chooser'] })).map((r) => [r.c.id, r.verdict.outcome]);

describe('T7b: the chooser group\'s records, rejudged', () => {
  it.each(RUNS)('%s: the five cases ok', async (f) => {
    expect(await verdictsOf(f)).toEqual(IDS.map((id) => [id, 'ok']));
  });

  it("the first run, its reads after monkey taken once, mid-transition: lc4'' was MISMATCH and lc4' ok when run; now each one's mFocusedApp (the lab's .MainActivity) holds and what is left on the stack is unread: SKIP both", async () => {
    const results = await rejudgedResults(read('unsettled-1.json'), { groups: ['chooser'] });
    expect(results.map((r) => [r.c.id, r.verdict.outcome])).toEqual([...IDS.slice(0, 3).map((id) => [id, 'ok']), ["lc4'", 'SKIP'], ["lc4''", 'SKIP']]);
    expect(results[3].verdict.why).toBe(results[4].verdict.why);
    expect(results[4].verdict.why).toBe('the read after the calls never settled (mCurrentFocus=null): whether a chooser is left on the stack is unread');
    const pp = read('unsettled-1.json').results.find((r) => r.id === "lc4''")!;
    expect(pp.focus!.after).toMatchObject({ window: expect.stringMatching(/mCurrentFocus=null\n {2}mFocusedApp=ActivityRecord\{\w+ u0 dev\.averi\.lab\/\.MainActivity\}/), activities: expect.stringContaining('android/com.android.internal.app.ResolverActivity') });
    expect(pp.focus!.after).not.toHaveProperty('waitedMs');
  });

  it("review round 1's runs: lc4' and lc4'''s first read after monkey mid-transition (mCurrentFocus=null) with the lab's .MainActivity already mFocusedApp, settled 300 ms later; the HOME activity the launcher in front before", () => {
    for (const f of REVIEW_RUNS) {
      const byId = new Map(read(f).results.map((r) => [r.id, r]));
      for (const id of ["lc4'", "lc4''"]) {
        const focus = byId.get(id)!.focus!;
        expect(focus.after).toMatchObject({ waitedMs: 300, firstWindow: expect.stringMatching(/mCurrentFocus=null\n {2}mFocusedApp=ActivityRecord\{\w+ u0 dev\.averi\.lab\/\.MainActivity\}/) });
        expect(focus.home).toEqual({ resolved: expect.stringMatching(/\ncom\.google\.android\.apps\.nexuslauncher\/\.NexusLauncherActivity\n$/) });
        expect(focus.before).toMatchObject({ window: expect.stringContaining('mFocusedApp=ActivityRecord{95524f u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity}') });
      }
      for (const id of ['lc1', 'lc2', 'lc3']) expect(byId.get(id)!.focus!.after).not.toHaveProperty('firstWindow');
    }
  });

  it("every settled run's lc1 left the chooser in front and its teardown's BACK dropped it; lc4' and lc4'' read after a wait, the others at once", () => {
    for (const f of RUNS) {
      const byId = new Map(read(f).results.map((r) => [r.id, r]));
      expect(byId.get('lc1')!.focus!.teardown).toMatchObject({ window: expect.stringContaining('mFocusedApp=ActivityRecord{') });
      expect(byId.get('lc1')!.focus!.teardown).not.toMatchObject({ window: expect.stringContaining('ResolverActivity') });
      for (const id of ["lc4'", "lc4''"]) expect(byId.get(id)!.focus!.after).toHaveProperty('waitedMs', 300);
      for (const id of ['lc2', 'lc3', "lc4'", "lc4''"]) expect(byId.get(id)!.focus).not.toHaveProperty('teardown');
    }
  });
});

/** The device's reads of one recorded case, its replies replaced by `replies`, judged again. */
async function withReplies(id: string, replies: (recorded: readonly string[]) => string[]) {
  const cases = await selectCases({ platform: 'android', app: 'native', groups: ['chooser'] });
  const c = cases.find((x) => x.id === id) as Case;
  return RUNS.map((f) => {
    const r = read(f).results.find((x) => x.id === id) as CaseRecord;
    return judged(c, { ...r, replies: replies(r.replies), state: r.state! }).outcome;
  });
}

const MISMATCH_ALL = RUNS.map(() => 'MISMATCH');
const headline = (reply: string) => reply.split('\n')[0];
const REFUSED = 'ERROR monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity … ** SYS_KEYS has no physical keys but with factor 2.0%.';

describe('T7b: every case goes MISMATCH on the recorded device reads under a plausible regression of the reply', () => {
  it('lc1: the ⚠ chooser line dropped (D55b undone, a bare Launched over the chooser); the headline naming another app', async () => {
    expect(await withReplies('lc1', ([r]) => [r.replace('Launched dev.averi.lab on', 'Launched dev.averi.lab.rn on')])).toEqual(MISMATCH_ALL);
    expect(await withReplies('lc1', ([r]) => [headline(r)])).toEqual(MISMATCH_ALL);
  });

  it('lc2: a chooser note added over the one-handler launch', async () => {
    expect(await withReplies('lc2', ([r]) => [`${r}\n⚠ Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) is in front, and dev.averi.lab is not.`])).toEqual(MISMATCH_ALL);
  });

  it('lc3: the activity dropped from the reply (a -p start), or a refusal of the start the device took', async () => {
    expect(await withReplies('lc3', () => ['Launched dev.averi.lab on android'])).toEqual(MISMATCH_ALL);
    expect(await withReplies('lc3', () => ['ERROR Android started nothing for dev.averi.lab/.Twin'])).toEqual(MISMATCH_ALL);
  });

  it("lc4': monkey's refusal (D73 undone)", async () => {
    expect(await withReplies("lc4'", () => [REFUSED])).toEqual(MISMATCH_ALL);
  });

  it("lc4'': monkey's refusal under the chooser (D73 undone), and the link answered \"Opened\" (D55 undone)", async () => {
    expect(await withReplies("lc4''", ([link]) => [link, REFUSED])).toEqual(MISMATCH_ALL);
    expect(await withReplies("lc4''", ([, launch]) => ['Opened averilab://shared/open on android', launch])).toEqual(MISMATCH_ALL);
  });
});
