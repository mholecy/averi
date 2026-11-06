import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cutOf, isCut } from '../../scripts/truth/live-carousel.js';
import { rejudge, type RunRecord } from '../../scripts/truth/live-cases.js';
import { carouselReply } from '../../scripts/truth/replies.js';
import type { LabState } from '../../scripts/truth/schema.js';

/**
 * T11's evidence (docs/truth/live-records/t11-carousel-visible, ADR 0013's T11 amendment): the rates the backlog row and
 * the ADR state, read back off the committed records. The folder is not a rejudged record set: lv-d62-drop's false
 * "fully visible" on the old rule is what it holds, and tests/truth/live-records-replayed.test.ts does not read folders.
 */

const DIR = new URL('../../docs/truth/live-records/t11-carousel-visible/', import.meta.url);

interface Stroke { view: string; from: number; to: number }
interface Rec { id: string; replies: string[]; state: LabState & { strokes?: Stroke[] }; swipes?: { from: { x: number }; to: { x: number }; dropped: boolean }[]; preDrag?: unknown }

const filesIn = (dir: string, prefix: string) => readdirSync(new URL(`${dir}/`, DIR)).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
const read = (dir: string, f: string) => JSON.parse(readFileSync(new URL(`${dir}/${f}`, DIR), 'utf8')) as { results: Rec[] };
const recordsIn = (dir: string, prefix: string): Rec[] => filesIn(dir, prefix).flatMap((f) => read(dir, f).results);

const named = (id: string, ...sets: [string, string][]) => sets.flatMap(([dir, prefix]) => recordsIn(dir, prefix)).filter((r) => r.id === id);
/** The reply claims C whole (the classifier the carousel judges read), and the app has C past the clip. */
const claims = (r: Rec) => carouselReply(r.replies[0]) === 'fully-visible';
const falseClaim = (r: Rec) => claims(r) && isCut(r.state);
const strokes = (r: Rec) => (r.state.strokes ?? []).filter((x) => x.view === 'carousel');
/** How far the app says the call's first stroke carried C: a pre-drag case's second carousel stroke. */
const probeCarry = (r: Rec) => {
  const s = strokes(r)[1];
  return s.to - s.from;
};

const C899: [string, string] = ['ab-c899-head', 'c899'];
const HEAD: [string, string][] = [['ab-c899-head', 'head'], ['group', 'head'], ['fix-drop', 'base']];
const FIX: [string, string][] = [['fix-drop', 'fix-'], ['fix-drop-more', 'fix']];
const OLD_RULE = [C899, ...HEAD];

describe('T11: the measured rate of "fully visible" with C past the clip, lv-d62-drop', () => {
  it('c899839d 10 of 16, b3ce0150 25 of 38, C 429–532 px past the clip', () => {
    expect(named('lv-d62-drop', C899)).toHaveLength(16);
    expect(named('lv-d62-drop', C899).filter(falseClaim)).toHaveLength(10);
    expect(named('lv-d62-drop', ...HEAD)).toHaveLength(38);
    expect(named('lv-d62-drop', ...HEAD).filter(falseClaim)).toHaveLength(25);
    const cuts = named('lv-d62-drop', ...OLD_RULE).filter(falseClaim).map((r) => cutOf(r.state)!.right);
    expect([Math.min(...cuts), Math.max(...cuts)]).toEqual([429, 532]);
  });

  it('on the old rule the claim follows the probe\'s carry alone: every claim at 94 px or less of its 142, none above', () => {
    const old = named('lv-d62-drop', ...OLD_RULE);
    expect(old.filter(claims).every(falseClaim)).toBe(true);
    expect(Math.max(...old.filter(claims).map(probeCarry))).toBeLessThanOrEqual(94);
    expect(Math.min(...old.filter((r) => !claims(r)).map(probeCarry))).toBeGreaterThan(94);
  });

  it('an earlier series, after the load experiment and affected by it: with the doubt alone 1 of 39, 22 of them on a probe that ran short; the one left: the retry itself moved C 0 px', () => {
    const fix = named('lv-d62-drop', ...FIX);
    expect(fix).toHaveLength(39);
    expect(fix.filter((r) => probeCarry(r) <= 94)).toHaveLength(22);
    const [left, ...more] = fix.filter(falseClaim);
    expect(more).toEqual([]);
    const [, proof, retry] = strokes(left);
    expect(proof.to - proof.from).toBe(55);
    expect(retry.to - retry.from).toBe(0);
  });

  it('the control, no stroke dropped: no claim in 41 runs', () => {
    const control = named('lv-d62-control', ...OLD_RULE, ['fix-drop-more', 'fixgroup']);
    expect(control).toHaveLength(41);
    expect(control.filter(claims)).toEqual([]);
  });
});

describe('T11: what the device did', () => {
  it('raw `input swipe` of 142 px, no averi: 94 px or less 18, 16 and 14 of 24, none at 0', () => {
    const shorts = ['raw-1.jsonl', 'raw-2-speed.jsonl', 'raw-3-after-restart.jsonl'].map((f) => {
      const carries = readFileSync(new URL(`raw/${f}`, DIR), 'utf8').trim().split('\n').flatMap((l) => (JSON.parse(l) as { strokes: { carry: number }[] }).strokes.map((s) => s.carry));
      expect(carries).toHaveLength(24);
      expect(carries).not.toContain(0);
      return carries.filter((c) => c <= 94).length;
    });
    expect(shorts).toEqual([18, 16, 14]);
  });

  it('recovered with no boot: raw-4, 135–146 px of 142, none at 94 or less', () => {
    const carries = readFileSync(new URL('raw/raw-4-recovered.jsonl', DIR), 'utf8').trim().split('\n').flatMap((l) => (JSON.parse(l) as { strokes: { carry: number }[] }).strokes.map((s) => s.carry));
    expect(carries).toHaveLength(24);
    expect([Math.min(...carries), Math.max(...carries)]).toEqual([135, 146]);
  });

  it('strokes the app logged with no motion: 5 of 675 sent, 53, 53, 61, 85 and 233 px drawn', () => {
    const recs = [...OLD_RULE, ['group', 'explore'] as [string, string], ...FIX].flatMap(([dir, prefix]) => recordsIn(dir, prefix)).filter((r) => r.swipes !== undefined && /d62|d68|d59b|e2/.test(r.id));
    const drawn = recs.flatMap((r) => {
      const sent = r.swipes!.filter((s) => !s.dropped);
      const taken = strokes(r).slice(r.preDrag === undefined ? 0 : 1);
      return taken.flatMap((t, i) => (Math.abs(t.to - t.from) <= 1 ? [Math.abs(sent[i].from.x - sent[i].to.x)] : []));
    });
    expect(recs.flatMap((r) => r.swipes!.filter((s) => !s.dropped))).toHaveLength(675);
    expect(drawn.sort((a, b) => a - b)).toEqual([53, 53, 61, 85, 233]);
  });
});

describe('T11: the final wording, a check and not a rate (after the load experiment)', () => {
  const CHECK = 'final-wording-check';
  it('no claim with C past the clip; lv-d62-drop maxSwipes hedged 16 of 16; no probe ran short, 134–145 px of 142', () => {
    const drop = named('lv-d62-drop', [CHECK, 'd62']);
    expect(drop.map((r) => carouselReply(r.replies[0]))).toEqual(Array(16).fill('maxSwipes-hedged'));
    const control = named('lv-d62-control', [CHECK, 'd62']);
    expect(control.filter(falseClaim)).toEqual([]);
    const carries = [...drop, ...control, ...named('ctl-12', [CHECK, 'ctl12'])].map(probeCarry);
    expect(carries).toHaveLength(40);
    expect([Math.min(...carries), Math.max(...carries)]).toEqual([134, 145]);
  });
  it('sticky R: hedged, and the repeat call\'s first probe holds, `checked` after 1 swipe', () => {
    const r = named('scroll:scroll-sticky-cut.R.fully', [CHECK, 'pins'], [CHECK, 'vis-all']);
    expect(r).toHaveLength(9);
    for (const x of r) expect(x.replies[0]).toContain('the content ended there or the app did not take them');
    const again = named('again-sticky-R', [CHECK, 'again']);
    expect(again).toHaveLength(4);
    for (const x of again) {
      expect(x.replies[0]).toContain('calling again tells');
      expect(x.replies[1]).toMatch(/fully visible after 1 swipe; .*nothing of it is cut there$/);
    }
  });
});

describe('T11: lv-d62-short, the recorded shape in both device states seen, ABBA over one harness (after the load experiment; a check, the rate is the final A/B)', () => {
  const short = (prefix: string) => named('lv-d62-short', ['short-probe-check', prefix]);
  it('base 12 of 12 false, C 430–441 px past the clip; the fix 0 of 12, all maxSwipes hedged', () => {
    expect(short('base')).toHaveLength(12);
    expect(short('base').filter(falseClaim)).toHaveLength(12);
    const cuts = short('base').map((r) => cutOf(r.state)!.right);
    expect([Math.min(...cuts), Math.max(...cuts)]).toEqual([430, 441]);
    expect(short('fix').map((r) => carouselReply(r.replies[0]))).toEqual(Array(12).fill('maxSwipes-hedged'));
  });
  it('the shape is the recorded one: every probe sent 90 of 142 px, carrying 71–78, 94 or less, then the reveal dropped', () => {
    for (const r of [...short('base'), ...short('fix')]) {
      const [probe, reveal] = r.swipes!;
      expect(Math.abs(probe.from.x - probe.to.x)).toBe(142);
      expect(probe.from.x - (probe as unknown as { sentTo: { x: number } }).sentTo.x).toBe(90);
      expect(reveal.dropped).toBe(true);
    }
    const carries = [...short('base'), ...short('fix')].map(probeCarry);
    expect([Math.min(...carries), Math.max(...carries)]).toEqual([71, 78]);
  });
});

describe('T11: the final A/B (final-ab/, base b3ce0150 vs fix 7a18842e, ABBA, a guest reboot before it)', () => {
  const F = 'final-ab';
  const short = (p: string) => named('lv-d62-short', [F, `short-${p}`]);
  const state = (g: string) => (read(F, `${g}-fix-1.json`) as unknown as { deviceState: { before: { short: number }; after: { short: number }; disagree: boolean } }).deviceState;
  it('lv-d62-short: base 20 of 20 false, the fix 1 of 20, and that one a first stroke carrying 0, T12; the rest hedged or at the bound', () => {
    expect(short('base')).toHaveLength(20);
    expect(short('base').filter(falseClaim)).toHaveLength(20);
    const shortCuts = short('base').map((r) => cutOf(r.state)!.right);
    expect([Math.min(...shortCuts), Math.max(...shortCuts)]).toEqual([436, 526]);
    // Every base first-call false claim of the run, 33: drop-two's judged on the state between its calls.
    const first = ['lv-d62-short', 'lv-d62-drop', 'lv-d62-drop-two'].flatMap((id) => named(id, [F, 'short-base'], [F, 'drop-base'], [F, 'two-base'], [F, 'harm-carousel-base'])).filter(claims);
    expect(first).toHaveLength(33);
    const cuts = first.map((r) => cutOf(r.id === 'lv-d62-drop-two' ? (r as unknown as { after: LabState[] }).after[0] : r.state)!.right);
    expect([Math.min(...cuts), Math.max(...cuts)]).toEqual([408, 526]);
    expect(short('fix')).toHaveLength(20);
    const [left, ...more] = short('fix').filter(falseClaim);
    expect(more).toEqual([]);
    expect(probeCarry(left)).toBe(0);
    expect(cutOf(left.state)!.right).toBe(542);
    expect(left.replies[0]).toMatch(/after 1 swipe; .*nothing of it is cut there$/);
    expect(short('fix').filter((r) => carouselReply(r.replies[0]) === 'maxSwipes-hedged')).toHaveLength(17);
    expect([...short('base'), ...short('fix')].every((r) => probeCarry(r) <= 94)).toBe(true);
    expect(state('short')).toMatchObject({ before: { short: 0 }, after: { short: 18 }, disagree: true });
  });
  it('lv-d62-drop base 3 of 6, fix 0 of 6; control 0 and 0; drop-two: base false 4 of 4, the fix hedged with C cut, then moved, 8 of 8', () => {
    expect(named('lv-d62-drop', [F, 'drop-base']).filter(falseClaim)).toHaveLength(3);
    expect(named('lv-d62-drop', [F, 'drop-fix'])).toHaveLength(6);
    expect(named('lv-d62-drop', [F, 'drop-fix']).filter(falseClaim)).toEqual([]);
    expect([...named('lv-d62-control', [F, 'control-base']), ...named('lv-d62-control', [F, 'control-fix'])].filter(claims)).toEqual([]);
    expect(named('lv-d62-drop-two', [F, 'two-base']).filter((r) => carouselReply(r.replies[0]) === 'fully-visible')).toHaveLength(4);
    const two = named('lv-d62-drop-two', [F, 'two-fix']);
    expect(two).toHaveLength(8);
    for (const r of two) {
      expect(r.replies[0]).toContain('the content ended there or the app did not take them');
      expect(strokes(r).length).toBeGreaterThan(2);
    }
  });
  it('the predicted harm: sticky R with maxSwipes 2, base passes, the fix fails hedged 3 of 3, a repeat call passes', () => {
    for (const r of named('sticky-R-2', [F, 'harm-sticky-max2-base'])) expect(r.replies[0]).toMatch(/fully visible after 2 swipes/);
    const fix = named('sticky-R-2', [F, 'harm-sticky-max2-fix']);
    expect(fix).toHaveLength(3);
    for (const r of fix) {
      expect(r.replies[0]).toMatch(/^ERROR .*failed after 2 swipes \(maxSwipes\)/);
      expect(r.replies[1]).toMatch(/fully visible after 1 swipe; .*nothing of it is cut there$/);
    }
  });
  it('the visibility diff lists what the row names', () => {
    const diff = readFileSync(new URL(`${F}/harm-visibility-diff.txt`, DIR), 'utf8');
    expect(diff).toContain('cases 153, all three the same 147');
    expect(diff).toMatch(/Caused by the fix, on the held path: 1\nuiautomator scroll:scroll-sticky-cut\.R\.fully/);
    expect(diff).toContain('NOT on the held path (unexplained, not called noise): 2');
    expect(diff).toContain('Differs base-vs-base (not attributable to the fix): 3');
  });
  it('raw strokes: fresh 0 of 24 short, then short through the run', () => {
    const shortOf = (f: string) => readFileSync(new URL(`${F}/${f}`, DIR), 'utf8').trim().split('\n').flatMap((l) => (JSON.parse(l) as { strokes: { carry: number }[] }).strokes.map((s) => s.carry)).filter((c) => c <= 94).length;
    expect(shortOf('raw-fresh.jsonl')).toBe(0);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => shortOf(`raw-group-${i}.jsonl`))).toEqual([18, 13, 10, 11, 8, 9, 13, 12, 12]);
    expect(shortOf('raw-end.jsonl')).toBe(14);
  });
});

describe('T11: the judge still catches it, rejudged', () => {
  const judged = async (dir: string, f: string) => {
    const recorded = read(dir, f) as unknown as RunRecord;
    return (await rejudge(recorded, f, { groups: ['carousel'] })).lines.join('\n');
  };
  it('a base record: MISMATCH fully-cut; a fix record: no mismatch', { timeout: 60_000 }, async () => {
    expect(await judged('fix-drop', 'base-2.json')).toMatch(/^- MISMATCH \(fully-cut\) lv-d62-drop .*"fully visible" while C cut L 0 R 468/m);
    expect(await judged('fix-drop', 'fix-1.json')).toMatch(/^# Live golden: 1 cases, 1 ok, 0 loud, 0 mismatches/m);
  });
});
