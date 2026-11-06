import { describe, expect, it } from 'vitest';
import { type Case, type CaseReads, selectCases } from '../../scripts/truth/live-cases.js';

/**
 * What each group's cases declare they read (Case.reads, docs/adr/0044): every case the catalog can select, on both
 * platforms and both lab apps. Each row is what the run loop inferred from `c.group` before A11. A case that declares
 * something else must say why here.
 */
const DECLARED: Record<Case['group'], CaseReads | undefined> = {
  forms: undefined,
  dismissal: undefined,
  ensure: undefined,
  visibility: { betweenCalls: true, late: false },
  carousel: { swipes: true, late: false },
};

describe('the reads each group\'s cases declare', () => {
  it.each(Object.keys(DECLARED) as Case['group'][])('%s', async (group) => {
    const cases: Case[] = [];
    for (const platform of ['ios', 'android'] as const) for (const app of ['native', 'react-native'] as const) cases.push(...(await selectCases({ platform, app, groups: [group] })));
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => JSON.stringify(c.reads)))).toEqual(new Set([JSON.stringify(DECLARED[group])]));
  });
});
