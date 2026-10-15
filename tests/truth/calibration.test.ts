import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GoldenCheck, GoldenJson } from '../../scripts/differential/golden.js';
import {
  calibrationReport,
  captureOf,
  failing,
  plan,
  regressedElsewhere,
  results,
  sideRunFromOutput,
  sideRunOf,
  STATUSES,
  VERDICTS,
  verdictCell,
  verdictOf,
  WORKING_TREE,
  type Calibration,
  type CalibrationEntry,
  type SideRun,
} from '../../scripts/truth/calibrate.js';

// The calibration table (scripts/truth/calibration.json) — data, pinned here: its shape, its commits against the git
// history, and that every bug note is in it, as a note calibrated (or why it cannot be) or as one excluded with its
// class. The run itself (calibrate.ts) needs git checkouts of old commits and is not a vitest test; its verdicts, the
// canary that refuses a miswired side, and the wiring of runs to notes are pure and tested below.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const table = JSON.parse(readFileSync(`${ROOT}scripts/truth/calibration.json`, 'utf8')) as Calibration;
const SHA = /^[0-9a-f]{7}$/;
const VERBS = new Set(['tap', 'colour', 'scroll_until', 'error', 'text']);
const captures = new Set(
  readdirSync(`${ROOT}${table.corpus}`).flatMap((run) => {
    const manifest = JSON.parse(readFileSync(`${ROOT}${table.corpus}/${run}/manifest.json`, 'utf8')) as { captures: { file: string; truth?: string }[] };
    return manifest.captures.filter((c) => c.truth !== undefined).map((c) => `${run}/${c.file}`);
  }),
);
const rowProblem = (k: string): string | undefined => {
  const [capture, target, verb, ...rest] = k.split(' ');
  if (rest.length > 0 || target === undefined || !VERBS.has(verb)) return `${k} is not "<run>/<file> <target> <verb>"`;
  return captures.has(capture) ? undefined : `${capture} is no truth capture of ${table.corpus}`;
};

describe('calibration.json', () => {
  it('every bug note of docs/bugs is in the table — calibrated, or excluded with its class — and none twice', () => {
    const listed = [...table.notes.map((e) => e.note), ...table.excluded.map((e) => e.note)];
    expect(listed.filter((n, i) => listed.indexOf(n) !== i)).toEqual([]);
    expect(readdirSync(`${ROOT}docs/bugs`).filter((f) => f.endsWith('.md') && !listed.includes(f))).toEqual([]);
  });

  it('each note: a unique number, a known status, an expected verdict of the set; its commits short SHAs', () => {
    const ns = table.notes.map((e) => e.n);
    expect(ns.filter((n, i) => ns.indexOf(n) !== i)).toEqual([]);
    const bad = table.notes.flatMap((e) => [
      ...(STATUSES.test(e.status) ? [] : [`${e.n}: status ${e.status}`]),
      ...(e.expect === undefined || VERDICTS.includes(e.expect) ? [] : [`${e.n}: expect ${e.expect}`]),
      ...[...(e.fix ?? []), e.before, e.after, ...(e.regressions ?? []).flatMap((r) => [r.broke, r.fixed])]
        .filter((s): s is string => s !== undefined && !SHA.test(s))
        .map((s) => `${e.n}: ${s} is no short SHA`),
      ...(e.after !== undefined && !(e.fix ?? []).includes(e.after) ? [`${e.n}: after ${e.after} is none of its fix commits`] : []),
    ]);
    expect(bad).toEqual([]);
  });

  it('the statuses: exactly the closed set', () => {
    for (const s of ['calibrate', 'open', 'residual:anything', 'needs-cell:edges', 'needs-cell:presented', 'needs-cell:bars', 'needs-cell:false-covers', 'needs-cell:forms', 'needs-2b', 'needs-live', 'needs-ocr'])
      expect(STATUSES.test(s), s).toBe(true);
    for (const s of ['needs-cell:other', 'needs-cell:', 'residual:', 'needs-3', 'calibrated', 'open ', 'needs-2b:x', ''])
      expect(STATUSES.test(s), s).toBe(false);
    expect(STATUSES.source).toBe('^(calibrate|open|residual:.+|needs-cell:(edges|presented|bars|false-covers|forms)|needs-2b|needs-live|needs-ocr)$');
    expect(VERDICTS).toEqual(['CALIBRATED', 'CALIBRATED-ON-DEFECT', 'DOES-NOT-FAIL', 'STILL-RED-AFTER', 'OPEN-RED', 'OPEN-NOT-REPRODUCED', 'NOT-ASKED', 'SIDE-DOES-NOT-LOAD']);
  });

  it("a note calibrated or open names golden rows of the committed truth and the note's defect; any other names none", () => {
    const bad = table.notes.flatMap((e) => {
      const runs = e.status === 'calibrate' || e.status === 'open';
      if (!runs) return [...(e.checks === undefined ? [] : [`${e.n}: ${e.status} names rows`]), ...(e.partial === undefined ? [] : [`${e.n}: ${e.status} is partial`])];
      if (e.checks === undefined || e.checks.length === 0) return [`${e.n}: no rows`];
      if (e.defect === undefined) return [`${e.n}: no defect`];
      if (e.status === 'calibrate' && (e.before === undefined || e.after === undefined)) return [`${e.n}: no before/after`];
      return e.checks.flatMap((k) => rowProblem(k) ?? []).map((p) => `${e.n}: ${p}`);
    });
    expect(bad).toEqual([]);
  });

  it('a regression names rows of the committed truth', () => {
    const bad = table.notes.flatMap((e) => (e.regressions ?? []).flatMap((r) => (r.rows.length === 0 ? ['no rows'] : r.rows.flatMap((k) => rowProblem(k) ?? [])).map((p) => `${e.n}: ${p}`)));
    expect(bad).toEqual([]);
  });

  it('a defect pattern compiles', () => {
    for (const e of table.notes) if (e.defect !== undefined) expect(() => new RegExp(e.defect!)).not.toThrow();
  });

  // The commits against the history: each exists, each fix is in this branch, and `before` is the commit the first fix
  // was made on (its first parent) — a typo'd or swapped SHA is caught here, not by a run that reads green.
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  const history = git('rev-parse', '--verify', 'HEAD') !== undefined && git('cat-file', '-e', 'b7c44de^{commit}') !== undefined;
  it.skipIf(!history)('each commit exists; every fix is an ancestor of HEAD; before is the first parent of the first fix', () => {
    const bad = table.notes.flatMap((e) => [
      ...[...(e.fix ?? []), e.before, ...(e.regressions ?? []).flatMap((r) => [r.broke, r.fixed])]
        .filter((s): s is string => s !== undefined && git('cat-file', '-e', `${s}^{commit}`) === undefined)
        .map((s) => `${e.n}: ${s} is no commit`),
      ...(e.fix ?? []).filter((f) => git('merge-base', '--is-ancestor', f, 'HEAD') === undefined).map((f) => `${e.n}: fix ${f} is not in HEAD`),
      ...(e.fix !== undefined && e.before !== undefined && git('rev-parse', `${e.fix[0]}^1`) !== git('rev-parse', `${e.before}^{commit}`)
        ? [`${e.n}: before ${e.before} is not ${e.fix[0]}'s first parent`]
        : []),
    ]);
    expect(bad).toEqual([]);
  });
});

// --- the verdicts ---

const K1 = 'ios-iphone17-ios27/form-keyboard.wda.json vs tap';
const K2 = 'ios-iphone17-ios27/form-keyboard.wda.json ks tap';
const KX = 'ios-iphone17-ios27/sheet-medium.wda.json S tap';
const OPEN = 'ios-iphone17-ios27/open.wda.json A tap';
const check = (key: string, mismatch: string | undefined, more: Partial<GoldenCheck> = {}): GoldenCheck => {
  const [recording, target, verb] = key.split(' ');
  return { recording, target, verb: verb as GoldenCheck['verb'], says: '', reply: `reply of ${key}`, kind: 'other', calls: [], ...(mismatch !== undefined && { mismatch }), ...more };
};
/** A side whose rows are `rows` (key → mismatch, undefined green). */
const side = (rows: Record<string, string | undefined>): SideRun => ({ checks: new Map(Object.entries(rows).map(([k, m]) => [k, check(k, m)])) });
const entry = (more: Partial<CalibrationEntry> = {}): CalibrationEntry => ({ n: 'x', note: 'x.md', status: 'calibrate', fix: ['bbbbbbb'], before: 'aaaaaaa', after: 'bbbbbbb', checks: [K1], ...more });
const two = (more: Partial<CalibrationEntry> = {}) => entry({ checks: [K1, K2], ...more });

describe('calibrate.ts — the verdicts', () => {
  it.each([
    ['red before, green after', entry(), side({ [K1]: 'Tapped' }), side({ [K1]: undefined }), 'CALIBRATED'],
    ['green before: a hole', entry(), side({ [K1]: undefined }), side({ [K1]: undefined }), 'DOES-NOT-FAIL'],
    ['red after', entry(), side({ [K1]: 'Tapped' }), side({ [K1]: 'Tapped' }), 'STILL-RED-AFTER'],
    ['red before with the defect, red after without it', entry({ defect: 'under the keyboard' }), side({ [K1]: 'not in the tree: touched down under the keyboard' }), side({ [K1]: 'not in the tree: never appeared' }), 'CALIBRATED-ON-DEFECT'],
    ['red before without the defect: it does not fail for the note', entry({ defect: 'under the keyboard' }), side({ [K1]: 'not in the tree: never appeared' }), side({ [K1]: undefined }), 'DOES-NOT-FAIL'],
    ['red before on wording only (the defect is the Tapped)', entry({ defect: '^Tapped|fully visible' }), side({ [K1]: 'refused without "close it first": ERROR … scroll_until it first' }), side({ [K1]: undefined }), 'DOES-NOT-FAIL'],
    ['red after WITH the defect', entry({ defect: '^Tapped' }), side({ [K1]: 'Tapped: x' }), side({ [K1]: 'Tapped: y' }), 'STILL-RED-AFTER'],
    ['the defect in the reply where the mismatch quotes only its start', entry({ defect: 'of ios-iphone17' }), side({ [K1]: 'refused' }), side({ [K1]: undefined }), 'CALIBRATED'],
    ['the defect in neither', entry({ defect: 'of android' }), side({ [K1]: 'refused' }), side({ [K1]: undefined }), 'DOES-NOT-FAIL'],
    ['a row not asked before', entry(), side({}), side({ [K1]: undefined }), 'NOT-ASKED'],
    ['a row not asked after', entry(), side({ [K1]: 'Tapped' }), side({}), 'NOT-ASKED'],
    ['a before side that did not load', entry(), { error: 'boom' }, side({ [K1]: undefined }), 'SIDE-DOES-NOT-LOAD'],
    ['an after side that did not load', entry(), side({ [K1]: 'Tapped' }), { error: 'boom' }, 'SIDE-DOES-NOT-LOAD'],
    // two rows, one red and one green: every row must hold, on each side
    ['two rows, one green before', two(), side({ [K1]: 'Tapped', [K2]: undefined }), side({ [K1]: undefined, [K2]: undefined }), 'DOES-NOT-FAIL'],
    ['two rows, the other green before', two(), side({ [K1]: undefined, [K2]: 'Tapped' }), side({ [K1]: undefined, [K2]: undefined }), 'DOES-NOT-FAIL'],
    ['two rows, one red after', two(), side({ [K1]: 'Tapped', [K2]: 'Tapped' }), side({ [K1]: undefined, [K2]: 'Tapped' }), 'STILL-RED-AFTER'],
    ['two rows, the other red after', two(), side({ [K1]: 'Tapped', [K2]: 'Tapped' }), side({ [K1]: 'Tapped', [K2]: undefined }), 'STILL-RED-AFTER'],
    ['two rows, one with the defect before', two({ defect: '^Tapped' }), side({ [K1]: 'Tapped', [K2]: 'stopped' }), side({ [K1]: undefined, [K2]: undefined }), 'DOES-NOT-FAIL'],
    ['two rows, one red after for another class', two({ defect: '^Tapped' }), side({ [K1]: 'Tapped', [K2]: 'Tapped' }), side({ [K1]: undefined, [K2]: 'not in the tree' }), 'CALIBRATED-ON-DEFECT'],
    ['two rows, both red before, both green after', two(), side({ [K1]: 'Tapped', [K2]: 'Tapped' }), side({ [K1]: undefined, [K2]: undefined }), 'CALIBRATED'],
  ] as const)('%s', (_, e, before, after, want) => {
    expect(verdictOf(e, before, after)).toBe(want);
  });

  it('an open note: red with the defect in the working tree, or not reproduced — every row', () => {
    const open = (more: Partial<CalibrationEntry> = {}) => entry({ status: 'open', before: undefined, after: undefined, fix: undefined, ...more });
    expect(verdictOf(open(), side({ [K1]: 'Tapped' }))).toBe('OPEN-RED');
    expect(verdictOf(open(), side({ [K1]: undefined }))).toBe('OPEN-NOT-REPRODUCED');
    expect(verdictOf(open({ checks: [K1, K2] }), side({ [K1]: 'Tapped', [K2]: undefined }))).toBe('OPEN-NOT-REPRODUCED');
    expect(verdictOf(open({ checks: [K1, K2] }), side({ [K1]: undefined, [K2]: 'Tapped' }))).toBe('OPEN-NOT-REPRODUCED');
    expect(verdictOf(open({ defect: '^Tapped' }), side({ [K1]: 'stopped' }))).toBe('OPEN-NOT-REPRODUCED');
    expect(verdictOf(open(), { error: 'boom' })).toBe('SIDE-DOES-NOT-LOAD');
  });

  it('the plan: each side once, in order; an open note on the working tree', () => {
    expect(
      plan([
        entry({ checks: ['r/a.json x tap'] }),
        entry({ before: 'bbbbbbb', after: 'ccccccc', fix: ['ccccccc'], checks: ['r/b.json y tap'] }),
        entry({ status: 'open', checks: ['r/c.json z tap'] }),
        entry({ status: 'needs-live', checks: undefined }),
      ]),
    ).toEqual(['aaaaaaa', 'bbbbbbb', 'ccccccc', WORKING_TREE]);
    expect(captureOf('r/a.json x tap')).toBe('r/a.json');
  });
});

describe('calibrate.ts — the wiring of runs to notes (results)', () => {
  it("a note's before is its before commit's run, its after its after commit's; an open note's the working tree's", () => {
    const runs = new Map<string, SideRun>([
      ['aaaaaaa', side({ [K1]: 'Tapped' })],
      ['bbbbbbb', side({ [K1]: undefined })],
      [WORKING_TREE, side({ [K1]: 'Tapped' })],
    ]);
    const rs = results([entry(), entry({ n: 'o', status: 'open', before: undefined, after: undefined, fix: undefined }), entry({ n: 's', status: 'needs-live', checks: undefined })], runs);
    expect(rs.map((r) => r.verdict)).toEqual(['CALIBRATED', 'OPEN-RED', undefined]);
    expect(rs[0].before).toBe(runs.get('aaaaaaa'));
    expect(rs[0].after).toBe(runs.get('bbbbbbb'));
    // swapped, the same runs would read green before: not calibrated
    expect(results([entry({ before: 'bbbbbbb', after: 'aaaaaaa', fix: ['aaaaaaa'] })], runs)[0].verdict).toBe('DOES-NOT-FAIL');
  });

  it('a side a note needs and the run lacks is an error, not a verdict', () => {
    expect(() => results([entry()], new Map([['aaaaaaa', side({ [K1]: 'Tapped' })]]))).toThrow('a side it needs was not run');
  });

  it('a row elsewhere in the corpus green before and red after is a regression at the fix; recorded ones do not fail the run', () => {
    const before = side({ [K1]: 'Tapped', [KX]: undefined, [K2]: 'red both' });
    const after = side({ [K1]: undefined, [KX]: 'not tapped: under container', [K2]: 'red both' });
    expect(regressedElsewhere(entry(), before, after)).toEqual([KX]);
    // the note's own rows are its verdict's business, never "elsewhere"
    expect(regressedElsewhere(entry(), side({ [K1]: undefined }), side({ [K1]: 'Tapped' }))).toEqual([]);
    const runs = new Map([['aaaaaaa', before], ['bbbbbbb', after]]);
    const [loose] = results([entry()], runs);
    expect(loose.verdict).toBe('CALIBRATED');
    expect(loose.elsewhere).toEqual([KX]);
    expect(verdictCell(loose)).toBe('CALIBRATED, regressed elsewhere: 1 row — **1 unrecorded**');
    expect(failing([loose])).toEqual([loose]);
    const recorded = results([entry({ regressions: [{ rows: [KX], broke: 'bbbbbbb', why: 'w' }] })], runs)[0];
    expect(verdictCell(recorded)).toBe('CALIBRATED, regressed elsewhere: 1 row (recorded)');
    expect(failing([recorded])).toEqual([]);
    // recorded at another commit: not this fix's
    expect(failing(results([entry({ regressions: [{ rows: [KX], broke: 'ccccccc', why: 'w' }] })], runs))).toHaveLength(1);
    const report = calibrationReport([recorded]);
    expect(report).toContain('Regressed elsewhere at bbbbbbb (green at aaaaaaa):');
    expect(report).toContain(`- ${KX}: broke at bbbbbbb, not fixed — w`);
  });

  it('a verdict other than expected fails the run; a partial calibration is said so', () => {
    const runs = new Map([['aaaaaaa', side({ [K1]: undefined })], ['bbbbbbb', side({ [K1]: undefined })]]);
    expect(failing(results([entry()], runs))).toHaveLength(1);
    expect(failing(results([entry({ expect: 'DOES-NOT-FAIL' })], runs))).toEqual([]);
    const partial = results([entry({ partial: 'stage A only' })], new Map([['aaaaaaa', side({ [K1]: 'Tapped' })], ['bbbbbbb', side({ [K1]: undefined })]]))[0];
    expect(verdictCell(partial)).toBe('CALIBRATED (partial: stage A only)');
    expect(calibrationReport([partial])).toContain('| x | x | calibrate | aaaaaaa → bbbbbbb | CALIBRATED (partial: stage A only) |');
  });
});

describe('calibrate.ts — the canary (sideRunOf)', () => {
  const json = (checks: GoldenCheck[]): GoldenJson => ({ side: '/x', results: [{ recording: 'r', checks, broken: [] }] });

  it('a side with the open cell green and no fault counts, its rows by key', () => {
    const run = sideRunOf(json([check(OPEN, undefined), check(K1, 'Tapped')]));
    expect('checks' in run && [...run.checks.keys()]).toEqual([OPEN, K1]);
  });

  it.each([
    ['a reply that is a harness error', [check(OPEN, undefined), check(K1, undefined, { faults: ['ERROR this.factory is not a function'] })]],
    ['an unmodelled device command', [check(OPEN, undefined), check(K1, undefined, { faults: ['UNMODELLED adb shell foo'] })]],
    ['the open cell red', [check(OPEN, 'not tapped: ERROR …'), check(K1, undefined)]],
    ['the open cell not replayed', [check(K1, undefined)]],
  ])('%s: the side does not load', (_, checks) => {
    expect(sideRunOf(json(checks))).toEqual({ error: expect.stringMatching(/^canary: /) });
  });

  it("golden's output: no JSON is the failure, JSON goes through the canary", () => {
    expect(sideRunFromOutput('', 'SyntaxError: boom')).toEqual({ error: 'SyntaxError: boom' });
    expect(sideRunFromOutput('noise')).toEqual({ error: 'no JSON from golden: noise' });
    expect(sideRunFromOutput(`warn\n${JSON.stringify(json([check(K1, undefined)]))}\n`)).toEqual({ error: expect.stringContaining('open cell was not replayed') });
  });
});
