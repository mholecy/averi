import { describe, expect, it } from 'vitest';
import { type Case, type CaseReads, selectCases } from '../../scripts/truth/live-cases.js';

/**
 * What each group's cases declare they read (Case.reads, docs/adr/0044): every case the catalog can select, on both
 * platforms and both lab apps. A group's row is what the run loop inferred from `c.group` before A11. A case that
 * declares something else says why in EXCEPTIONS; `reads` lives on the case, so nothing else holds it to its group.
 */
const DECLARED: Record<Case['group'], CaseReads | undefined> = {
  forms: undefined,
  dismissal: undefined,
  ensure: undefined,
  visibility: { betweenCalls: true, late: false },
  carousel: { swipes: {}, late: false },
};

const EXCEPTIONS: Record<string, { reads: CaseReads; why: string }> = {
  'lv-d62-drop': { reads: { swipes: { drop: [2] }, late: false }, why: 'D62: its second stroke, the first reveal, is dropped: never "fully visible" with C cut' },
  'lv-d62-drop-two': { reads: { swipes: { drop: [2, 3] }, betweenCalls: true, late: false }, why: 'T11: two reveals dropped, then the same call again: the hedge with C cut, read between the calls, then the second call moving C' },
  'lv-t12-drop-first': { reads: { swipes: { drop: [1] }, late: false }, why: 'T12: its first stroke, the first probe after the pre-drag, is dropped: never "fully visible" with C cut' },
  'lv-d62-short': { reads: { swipes: { drop: [2], shorten: { stroke: 1, px: 90 } }, late: false }, why: 'T11: its probe drawn short and its first reveal dropped, the recorded shape in both device states seen: never "fully visible" with C cut' },
};

async function everyCase(groups: readonly Case['group'][]): Promise<Case[]> {
  const cases: Case[] = [];
  for (const platform of ['ios', 'android'] as const) for (const app of ['native', 'react-native'] as const) cases.push(...(await selectCases({ platform, app, groups })));
  return cases;
}

describe('the reads each group\'s cases declare', () => {
  it.each(Object.keys(DECLARED) as Case['group'][])('%s', async (group) => {
    const cases = await everyCase([group]);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) expect([c.id, c.reads]).toEqual([c.id, EXCEPTIONS[c.id]?.reads ?? DECLARED[group]]);
  });

  it('every exception names a case there is', async () => {
    const ids = new Set((await everyCase(Object.keys(DECLARED) as Case['group'][])).map((c) => c.id));
    expect(Object.keys(EXCEPTIONS).filter((id) => !ids.has(id))).toEqual([]);
  });
});
