import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * T11's evidence (docs/truth/live-records/t11-carousel-visible, ADR 0013's T11 amendment): the rates the backlog row and
 * the ADR state, read back off the committed records. The folder is not a rejudged record set: lv-d62-drop's false
 * "fully visible" on the old rule is what it holds, and tests/truth/live-records-replayed.test.ts does not read folders.
 */

const DIR = new URL('../../docs/truth/live-records/t11-carousel-visible/', import.meta.url);

interface Stroke { view: string; from: number; to: number }
interface Rec { id: string; replies: string[]; state: { strokes?: Stroke[] }; swipes?: { dropped: boolean }[]; preDrag?: unknown }

const recordsIn = (dir: string, prefix: string): Rec[] =>
  readdirSync(new URL(`${dir}/`, DIR))
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .flatMap((f) => (JSON.parse(readFileSync(new URL(`${dir}/${f}`, DIR), 'utf8')) as { results: Rec[] }).results);

const named = (id: string, ...sets: [string, string][]) => sets.flatMap(([dir, prefix]) => recordsIn(dir, prefix)).filter((r) => r.id === id);
const claims = (r: Rec) => !r.replies[0].startsWith('ERROR') && r.replies[0].includes('fully visible');
/** How far the app says the call's first stroke carried C: a pre-drag case's second carousel stroke. */
const probeCarry = (r: Rec) => {
  const s = (r.state.strokes ?? []).filter((x) => x.view === 'carousel')[1];
  return s.to - s.from;
};

const C899: [string, string] = ['ab-c899-head', 'c899'];
const HEAD: [string, string][] = [['ab-c899-head', 'head'], ['group', 'head'], ['fix-drop', 'base']];
const FIX: [string, string][] = [['fix-drop', 'fix-'], ['fix-drop-more', 'fix']];

describe('T11: the measured rate of "fully visible" with C cut, lv-d62-drop', () => {
  it('c899839d 10 of 16, b3ce0150 25 of 38: the same rate, no regression between them', () => {
    expect(named('lv-d62-drop', C899).filter(claims).length).toBe(10);
    expect(named('lv-d62-drop', C899)).toHaveLength(16);
    expect(named('lv-d62-drop', ...HEAD).filter(claims).length).toBe(25);
    expect(named('lv-d62-drop', ...HEAD)).toHaveLength(38);
  });

  it('on the old rule the claim follows the probe\'s carry alone: every claim at 94 px or less of its 142, none above', () => {
    const old = named('lv-d62-drop', C899, ...HEAD);
    expect(Math.max(...old.filter(claims).map(probeCarry))).toBeLessThanOrEqual(94);
    expect(Math.min(...old.filter((r) => !claims(r)).map(probeCarry))).toBeGreaterThan(94);
  });

  it('with the doubt 1 of 39, 22 of them on a probe that ran short; the one left: the retry itself moved C 0 px', () => {
    const fix = named('lv-d62-drop', ...FIX);
    expect(fix).toHaveLength(39);
    expect(fix.filter((r) => probeCarry(r) <= 94)).toHaveLength(22);
    const [left, ...more] = fix.filter(claims);
    expect(more).toEqual([]);
    const [, proof, retry] = (left.state.strokes ?? []).filter((x) => x.view === 'carousel');
    expect(proof.to - proof.from).toBe(55);
    expect(retry.to - retry.from).toBe(0);
  });

  it('the control, no stroke dropped: no claim in 41 runs', () => {
    const control = named('lv-d62-control', C899, ...HEAD, ['fix-drop-more', 'fixgroup']);
    expect(control).toHaveLength(41);
    expect(control.filter(claims)).toEqual([]);
  });
});
