import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isCut } from '../../scripts/truth/live-carousel.js';
import { rejudgedResults, type CaseRecord, type RunRecord } from '../../scripts/truth/live-cases.js';
import { carouselReply, swipesOf } from '../../scripts/truth/replies.js';

/**
 * T12's evidence (docs/truth/live-records/t12-first-probe, ADR 0013's T12 amendment): the counts the backlog row and the
 * ADR state, read back off the committed records. Base 5f126fdc's src against the fix's, one harness (the fix's), ABBA,
 * each group labelled by a raw-strokes read before and after it (label-group.mjs). Not a rejudged record set.
 */

const DIR = new URL('../../docs/truth/live-records/t12-first-probe/', import.meta.url);

type Labelled = RunRecord & { deviceState?: { before: { short: number; strokes: number }; after: { short: number; strokes: number }; disagree: boolean } };

const files = (prefix: string) => readdirSync(DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
const read = (f: string) => JSON.parse(readFileSync(new URL(f, DIR), 'utf8')) as Labelled;
const records = (prefix: string): CaseRecord[] => files(prefix).flatMap((f) => read(f).results);
/** The reply claims C whole, and the app has C past the clip. */
const falseClaim = (r: CaseRecord) => carouselReply(r.replies[0]) === 'fully-visible' && isCut(r.state!);
const replyOf = (prefix: string, id: string) => records(prefix).filter((r) => r.id === id).map((r) => r.replies[0]);

describe('T12: lv-t12-drop-first, the first probe after the pre-drag dropped', () => {
  it('base 8 of 8 false "fully visible" after 1 swipe; the fix 0 of 8, each sending the probe again and ending hedged at maxSwipes', () => {
    const base = records('drop-first-base');
    const fix = records('drop-first-fix');
    expect(base).toHaveLength(8);
    expect(base.filter(falseClaim)).toHaveLength(8);
    expect(base.every((r) => swipesOf(r.replies[0]) === 1)).toBe(true);
    expect(fix).toHaveLength(8);
    expect(fix.filter(falseClaim)).toEqual([]);
    expect(fix.map((r) => carouselReply(r.replies[0]))).toEqual(Array(8).fill('maxSwipes-hedged'));
    // The retry: the stroke after the dropped one is the same probe.
    for (const r of fix) expect(r.swipes![1]).toMatchObject({ from: r.swipes![0].from, to: r.swipes![0].to, dropped: false });
  });

  it('every group labelled by its raw reads, and every one read fast (0 of 24 at 94 px or less)', () => {
    for (const prefix of ['drop-first', 'residual', 'pins', 'settings', 'rest-max1', 'vis']) {
      expect(files(prefix).length).toBeGreaterThan(0);
      for (const f of files(prefix)) expect(read(f).deviceState).toMatchObject({ before: { short: 0 }, after: { short: 0 }, disagree: false });
    }
  });
});

/** Each record of `prefix` rejudged by this checkout's judges (live-cases.ts#rejudgedResults), the verdicts of case `id`. */
async function verdicts(prefix: string, group: 'carousel' | 'visibility', id: string) {
  const out = [];
  for (const f of files(prefix)) out.push(...(await rejudgedResults(read(f), { groups: [group] })).filter((r) => r.c.id === id).map((r) => r.verdict));
  return out;
}

describe('T12: the records rejudged by this checkout\'s judges', () => {
  it('drop-first base: 8 of 8 MISMATCH fully-cut; fix: 8 of 8 ok, maxSwipes-hedged', async () => {
    const base = await verdicts('drop-first-base', 'carousel', 'lv-t12-drop-first');
    expect(base).toHaveLength(8);
    for (const v of base) expect(v).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
    const fix = await verdicts('drop-first-fix', 'carousel', 'lv-t12-drop-first');
    expect(fix).toHaveLength(8);
    for (const v of fix) expect(v).toMatchObject({ outcome: 'ok', why: expect.stringMatching(/^maxSwipes-hedged, C cut /) });
  });

  it('pins: sticky-rest R ok on every run of both arms', async () => {
    for (const arm of ['pins-base', 'pins-fix']) {
      const r = await verdicts(arm, 'visibility', 'rest:scroll-sticky-rest.R.fully');
      expect(r).toHaveLength(4);
      for (const v of r) expect(v.outcome).toBe('ok');
    }
  });
});

describe('T12: the residual, two first probes dropped, fix only', () => {
  it('3 of 3 false "fully visible after 2 swipes … 2 probe swipes toward it moved nothing": the record of the residual, not a pass', () => {
    const r = records('residual-fix');
    expect(r).toHaveLength(3);
    expect(r.filter(falseClaim)).toHaveLength(3);
    for (const x of r) expect(x.replies[0]).toMatch(/fully visible after 2 swipes; .*and 2 probe swipes toward it moved nothing — nothing of it is cut there/);
  });
});

describe('T12: the cost', () => {
  it('sticky-rest R at rest: 1 swipe on base, 2 on the fix, checked both; bounded P and S unchanged', () => {
    expect(replyOf('pins-base', 'rest:scroll-sticky-rest.R.fully').map(swipesOf)).toEqual([1, 1, 1, 1]);
    expect(replyOf('pins-fix', 'rest:scroll-sticky-rest.R.fully').map(swipesOf)).toEqual([2, 2, 2, 2]);
    for (const reply of replyOf('pins-fix', 'rest:scroll-sticky-rest.R.fully')) expect(reply).toMatch(/and 2 probe swipes toward it moved nothing — nothing of it is cut there/);
    for (const id of ['scroll:scroll-bounded-flush.P.fully', 'scroll:scroll-bounded-flush.S.fully']) expect(replyOf('pins-fix', id)).toEqual(replyOf('pins-base', id));
  });

  it('sticky-rest R with maxSwipes 1: `checked` on base, the `budget` hedge on the fix, both after 1 swipe', () => {
    for (const reply of replyOf('rest-max1-base', 'rest-R-1')) expect(reply).toMatch(/fully visible after 1 swipe; its top edge .*a probe swipe toward it moved nothing — nothing of it is cut there$/);
    for (const reply of replyOf('rest-max1-fix', 'rest-R-1')) expect(reply).toMatch(/fully visible after 1 swipe; but its top edge .*no swipe or time was left to check it — it may be cut there/);
  });
});
