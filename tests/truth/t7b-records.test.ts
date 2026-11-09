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
const RUNS = ['run-1.json', 'run-2.json', 'run-3.json'];
const IDS = ['lc1', 'lc2', 'lc3', "lc4'", "lc4''"];

const verdictsOf = async (f: string) => (await rejudgedResults(read(f), { groups: ['chooser'] })).map((r) => [r.c.id, r.verdict.outcome]);

describe('T7b: the chooser group\'s records, rejudged', () => {
  it.each(RUNS)('%s: the five cases ok', async (f) => {
    expect(await verdictsOf(f)).toEqual(IDS.map((id) => [id, 'ok']));
  });

  it('the first run, before the focus read waited out the window transition: lc4\'\' MISMATCH, the ResolverActivity record still on the stack under mCurrentFocus=null', async () => {
    expect(await verdictsOf('unsettled-1.json')).toEqual([...IDS.slice(0, 4).map((id) => [id, 'ok']), ["lc4''", 'MISMATCH']]);
    const pp = read('unsettled-1.json').results.find((r) => r.id === "lc4''")!;
    expect(pp.focus!.after).toMatchObject({ window: expect.stringContaining('mCurrentFocus=null'), activities: expect.stringContaining('android/com.android.internal.app.ResolverActivity') });
    expect(pp.focus!.after).not.toHaveProperty('waitedMs');
  });

  it("every settled run's lc1 left the chooser in front and its teardown's BACK dropped it; lc4' and lc4'' read after a wait, the others at once", () => {
    for (const f of RUNS) {
      const byId = new Map(read(f).results.map((r) => [r.id, r]));
      expect(byId.get('lc1')!.focus!.teardown).toMatchObject({ window: expect.stringContaining('mFocusedApp=ActivityRecord{') });
      expect(byId.get('lc1')!.focus!.teardown).not.toMatchObject({ window: expect.stringContaining('ResolverActivity') });
      for (const id of ["lc4'", "lc4''"]) expect(byId.get(id)!.focus!.after).toHaveProperty('waitedMs');
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

const MISMATCH3 = ['MISMATCH', 'MISMATCH', 'MISMATCH'];
const headline = (reply: string) => reply.split('\n')[0];
const REFUSED = 'ERROR monkey started nothing in dev.averi.lab — check that dev.averi.lab is installed and has a launcher activity … ** SYS_KEYS has no physical keys but with factor 2.0%.';

describe('T7b: every case goes MISMATCH on the recorded device reads under a plausible regression of the reply', () => {
  it('lc1: the ⚠ chooser line dropped (D55b undone, a bare Launched over the chooser)', async () => {
    expect(await withReplies('lc1', ([r]) => [headline(r)])).toEqual(MISMATCH3);
  });

  it('lc2: a chooser note added over the one-handler launch', async () => {
    expect(await withReplies('lc2', ([r]) => [`${r}\n⚠ Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) is in front, and dev.averi.lab is not.`])).toEqual(MISMATCH3);
  });

  it('lc3: the activity dropped from the reply (a -p start), or a refusal of the start the device took', async () => {
    expect(await withReplies('lc3', () => ['Launched dev.averi.lab on android'])).toEqual(MISMATCH3);
    expect(await withReplies('lc3', () => ['ERROR Android started nothing for dev.averi.lab/.Twin'])).toEqual(MISMATCH3);
  });

  it("lc4': monkey's refusal (D73 undone)", async () => {
    expect(await withReplies("lc4'", () => [REFUSED])).toEqual(MISMATCH3);
  });

  it("lc4'': monkey's refusal under the chooser (D73 undone), and the link answered \"Opened\" (D55 undone)", async () => {
    expect(await withReplies("lc4''", ([link]) => [link, REFUSED])).toEqual(MISMATCH3);
    expect(await withReplies("lc4''", ([, launch]) => ['Opened averilab://shared/open on android', launch])).toEqual(MISMATCH3);
  });
});
