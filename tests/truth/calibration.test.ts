import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GoldenCheck, GoldenJson } from '../../scripts/differential/golden.js';
import { VERBS as GOLDEN_VERBS } from '../../scripts/differential/golden-spec/judges.js';
import { failureOf, pool, runSide, runSides, sideLine, sideRunFromOutput, type ProcessError, type SideDeps, type SideOutcome, type Sides } from '../../scripts/truth/calibrate-run.js';
import { calibrationReport, verdictCell } from '../../scripts/truth/calibration-report.js';
import {
  captureOf,
  disposition,
  entriesOf,
  failing,
  gitParentOf,
  isOpenCell,
  notesOf,
  pairsOf,
  plan,
  regressedElsewhere,
  results,
  sideRunOf,
  STATUSES,
  VERDICTS,
  verdictOf,
  withSides,
  WORKING_TREE,
  type Calibration,
  type CalibrationEntry,
  type LiveCalibration,
  type ParentOf,
  type SideRun,
} from '../../scripts/truth/calibrate.js';

// The calibration table (scripts/truth/calibration.json) — data, pinned here: its shape, its commits against the git
// history, and that every bug note is in it, as a note calibrated (or why it cannot be) or as one excluded with its
// class. The run itself (calibrate.ts) needs git checkouts of old commits and is not a vitest test; its verdicts, the
// canary that refuses a miswired side, and the wiring of runs to notes are pure and tested below.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const table = JSON.parse(readFileSync(`${ROOT}scripts/truth/calibration.json`, 'utf8')) as Calibration;
const SHA = /^[0-9a-f]{7}$/;
/** A stand-in for the history where none is asked: a commit's first parent named after it. */
const parentNamed: ParentOf = (c) => `${c}^1`;
const VERBS = new Set<string>(GOLDEN_VERBS);
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
      ...[...(e.fix ?? []), e.before, e.after, ...(e.pairs ?? []).flatMap((p) => [p.before, p.after]), ...(e.regressions ?? []).flatMap((r) => [r.broke, r.fixed])]
        .filter((s): s is string => s !== undefined && !SHA.test(s))
        .map((s) => `${e.n}: ${s} is no short SHA`),
      ...(e.after !== undefined && !(e.fix ?? []).includes(e.after) && e.afterNotFix === undefined ? [`${e.n}: after ${e.after} is none of its fix commits, and afterNotFix says not why`] : []),
      ...(e.afterNotFix !== undefined && (e.after === undefined || (e.fix ?? []).includes(e.after)) ? [`${e.n}: afterNotFix, but after ${e.after} is a fix commit`] : []),
      // a side is calibrate's: only a calibrate note gives one (withSides leaves any other as it is, the report would print it)
      ...(e.status !== 'calibrate' && (e.before !== undefined || e.after !== undefined) ? [`${e.n}: ${e.status} gives a side`] : []),
      // a side withSides derives is not written down: only an override
      ...(e.after !== undefined && e.after === e.fix?.at(-1) ? [`${e.n}: after ${e.after} is its last fix, which withSides derives — drop it`] : []),
      ...(e.pairs ?? []).flatMap((p) => [
        // withSides throws on it too; said here with every other problem of the table at once
        ...(p.afterNotFix !== undefined && p.before === undefined ? [`${e.n}: pair after ${p.after} is no fix (afterNotFix) and gives no before`] : []),
        ...(e.status === 'calibrate' ? [] : [`${e.n}: ${e.status} has pairs`]),
        ...((e.fix ?? []).length === 0 ? [`${e.n}: pairs, but no fix of its own (no pair of its own)`] : []),
        ...(p.expect === undefined || VERDICTS.includes(p.expect) ? [] : [`${e.n}: pair ${p.after} expect ${p.expect}`]),
        ...(!(e.fix ?? []).includes(p.after) && p.afterNotFix === undefined ? [`${e.n}: pair after ${p.after} is none of its fix commits, and afterNotFix says not why`] : []),
      ]),
    ]);
    expect(bad).toEqual([]);
  });

  it('the statuses: exactly the closed set', () => {
    for (const s of ['calibrate', 'open', 'residual:anything', 'needs-cell:base', 'needs-cell:edges', 'needs-cell:presented', 'needs-cell:bars', 'needs-cell:false-covers', 'needs-cell:forms', 'needs-cell:react-native', 'needs-2b', 'needs-live', 'needs-ocr'])
      expect(STATUSES.test(s), s).toBe(true);
    for (const s of ['needs-cell:other', 'needs-cell:', 'residual:', 'needs-3', 'calibrated', 'open ', 'needs-2b:x', ''])
      expect(STATUSES.test(s), s).toBe(false);
    expect(STATUSES.source).toBe('^(calibrate|open|residual:.+|needs-cell:(base|presented|forms|edges|bars|false-covers|text|react-native)|needs-2b|needs-live|needs-ocr)$');
    expect(VERDICTS).toEqual(['CALIBRATED', 'CALIBRATED-ON-DEFECT', 'DOES-NOT-FAIL', 'STILL-RED-AFTER', 'OPEN-RED', 'OPEN-NOT-REPRODUCED', 'NOT-ASKED', 'SIDE-DOES-NOT-LOAD']);
  });

  it("a note calibrated or open names golden rows of the committed truth and the note's defect, each pair its own; any other names none", () => {
    const bad = entriesOf(table, undefined, parentNamed).flatMap((e) => {
      const runs = e.status === 'calibrate' || e.status === 'open';
      if (!runs) return [...(e.checks === undefined ? [] : [`${e.n}: ${e.status} names rows`]), ...(e.partial === undefined ? [] : [`${e.n}: ${e.status} is partial`])];
      if (e.checks === undefined || e.checks.length === 0) return [`${e.n}: no rows`];
      if (e.defect === undefined) return [`${e.n}: no defect`];
      if (e.status === 'calibrate' && (e.before === undefined || e.after === undefined)) return [`${e.n}: no before/after (no fix)`];
      return e.checks.flatMap((k) => rowProblem(k) ?? []).map((p) => `${e.n}: ${p}`);
    });
    expect(bad).toEqual([]);
  });

  it('a regression names rows of the committed truth', () => {
    const bad = table.notes.flatMap((e) => (e.regressions ?? []).flatMap((r) => (r.rows.length === 0 ? ['no rows'] : r.rows.flatMap((k) => rowProblem(k) ?? [])).map((p) => `${e.n}: ${p}`)));
    expect(bad).toEqual([]);
  });

  it('a defect pattern compiles', () => {
    for (const e of table.notes.flatMap(pairsOf)) if (e.defect !== undefined) expect(() => new RegExp(e.defect!)).not.toThrow();
  });

  // The commits against the history: each exists and each fix is in this branch — a typo'd SHA is caught here, not by a
  // run that reads green. The sides withSides derives from it are the first parents, in the table's short form; a
  // `before` the table gives is an override, never the parent it would derive anyway.
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  const history = git('rev-parse', '--verify', 'HEAD') !== undefined && git('cat-file', '-e', 'b7c44de^{commit}') !== undefined;
  it.skipIf(!history)('each commit exists; every fix is an ancestor of HEAD; a before given overrides, never repeats, its derivation', () => {
    const parentOf = gitParentOf(ROOT);
    const bad = table.notes.flatMap((e) => [
      ...[...(e.fix ?? []), e.before, e.after, ...(e.regressions ?? []).flatMap((r) => [r.broke, r.fixed]), ...(e.pairs ?? []).flatMap((p) => [p.before, p.after])]
        .filter((s): s is string => s !== undefined && git('cat-file', '-e', `${s}^{commit}`) === undefined)
        .map((s) => `${e.n}: ${s} is no commit`),
      ...(e.fix ?? []).filter((f) => git('merge-base', '--is-ancestor', f, 'HEAD') === undefined).map((f) => `${e.n}: fix ${f} is not in HEAD`),
      ...(e.fix !== undefined && e.before !== undefined && e.before === parentOf(e.fix[0]) ? [`${e.n}: before ${e.before} is ${e.fix[0]}'s first parent, which withSides derives — drop it`] : []),
      ...(e.pairs ?? [])
        .filter((p) => p.afterNotFix === undefined && p.before !== undefined && p.before === parentOf(p.after))
        .map((p) => `${e.n}: pair before ${p.before} is ${p.after}'s first parent, which withSides derives — drop it`),
    ]);
    expect(bad).toEqual([]);
  });

  // Each side withSides derives from git — and only those: a side the table gives is an override it keeps (above).
  it.skipIf(!history)("withSides from git: a side the table leaves out is the first parent of the first fix (a further pair's: of its after), as a short SHA", () => {
    const parentOf = gitParentOf(ROOT);
    const parentProblem = (what: string, side: string | undefined, of: string): string[] =>
      side !== undefined && SHA.test(side) && git('rev-parse', `${side}^{commit}`) === git('rev-parse', `${of}^1`) ? [] : [`${what}: before ${side} is not a short SHA of ${of}'s first parent`];
    const bad = table.notes.flatMap((e) => {
      const sides = withSides(e, parentOf);
      if (sides === e) return [];
      return [
        ...(e.before === undefined ? parentProblem(e.n, sides.before, e.fix![0]) : []),
        ...(e.pairs ?? []).flatMap((p, i) => (p.before === undefined ? parentProblem(`${e.n} pair ${p.after}`, sides.pairs![i].before, p.after) : [])),
      ];
    });
    expect(bad).toEqual([]);
    expect(() => parentOf('0000000')).toThrow(`calibrate: 0000000 is no commit with a first parent in ${ROOT}`);
  });

  // The anchor a derived side has outside the table: the committed report (docs/truth/calibration.md, which step 8's
  // calibrate run writes) names the sides it judged. A `fix` reordered, or an `after` changed, after that run moves a
  // side — the red side follows `fix[0]` — and is caught here until calibrate is run again and its report committed.
  it.skipIf(!history)('the committed report judged the sides the table now gives: each pair\'s before → after as calibration.md prints it', () => {
    const report = new Map(
      readFileSync(`${ROOT}docs/truth/calibration.md`, 'utf8')
        .split('\n')
        .filter((l) => l.startsWith('| '))
        .map((l) => l.split('|').map((c) => c.trim()))
        .map((c) => [c[1], c[4]] as const),
    );
    const bad = entriesOf(table, undefined, gitParentOf(ROOT))
      .filter((e) => e.status === 'calibrate')
      .flatMap((e) => (report.get(e.n)?.startsWith(`${e.before} → ${e.after}`) === true ? [] : [`${e.n}: ${e.before} → ${e.after}, the report: ${report.get(e.n) ?? 'no row'} — run calibrate in full with --out docs/truth/calibration.md and commit the report (a --note run writes .partial)`]));
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
    // a row the before side did not ask (a new capture or target) is no regression, red as it is after
    expect(regressedElsewhere(entry(), side({ [K1]: 'Tapped' }), side({ [K1]: undefined, [KX]: 'not tapped' }))).toEqual([]);
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

  it('a green row shows what the row read where golden carries it (GoldenCheck.read), else its reply\'s first line', () => {
    const KS = 'ios-iphone17-ios27/form-shared-id.wda.json amount snapshot';
    const after: SideRun = { checks: new Map([[KS, check(KS, undefined, { reply: '[\n  {', read: 'textfield c 20,146 362x34: no error' })]]) };
    const r = results([entry({ checks: [KS] })], new Map([['aaaaaaa', side({ [KS]: 'reads "IBAN*" as its error, where none is paired' })], ['bbbbbbb', after]]))[0];
    expect(calibrationReport([r])).toContain(`  - ok ${KS} — textfield c 20,146 362x34: no error`);
    expect(calibrationReport(results([entry()], new Map([['aaaaaaa', side({ [K1]: 'Tapped' })], ['bbbbbbb', side({ [K1]: undefined })]])))).toContain(`  - ok ${K1} — reply of ${K1}`);
  });

  it('an after side that is not the note\'s fix (afterNotFix) is said so in the table and the section', () => {
    const cured = results([entry({ fix: ['ccccccc'], afterNotFix: 'ccccccc fixed the device tree only' })], new Map([['aaaaaaa', side({ [K1]: 'Tapped' })], ['bbbbbbb', side({ [K1]: undefined })]]))[0];
    const report = calibrationReport([cured]);
    expect(report).toContain("| aaaaaaa → bbbbbbb (the note's fix ccccccc does not cure this cell) | CALIBRATED |");
    expect(report).toContain("- after bbbbbbb (not the note's fix: ccccccc fixed the device tree only):");
  });
});

describe('calibrate.ts — several fixes, one pair each (pairsOf)', () => {
  const K3 = 'ios-iphone17-ios27/toolbar-dismiss-short.wda.json vs tap';
  const note = entry({
    n: '7',
    fix: ['bbbbbbb', 'ddddddd'],
    defect: 'toolbar',
    partial: 'first',
    needs: 'n',
    remark: 'r',
    regressions: [{ rows: [KX], broke: 'ddddddd', why: 'w' }],
    pairs: [{ before: 'ccccccc', after: 'ddddddd', checks: [K3], defect: 'scrollable', expect: 'STILL-RED-AFTER' }],
  });

  it('a note without pairs is its one pair, unchanged', () => {
    expect(pairsOf(entry())).toEqual([entry()]);
    expect(pairsOf(entry({ pairs: [] }))).toEqual([entry()]);
  });

  it("a note with pairs: its own pair <n>.1, each further one <n>.2 … with its sides, rows, symptom and expectation; the note's needs, partial and remark the first pair's only", () => {
    const [own, second] = pairsOf(note);
    expect(own).toEqual({ ...note, pairs: undefined, n: '7.1' });
    expect('pairs' in own).toBe(false);
    expect(second).toEqual({ n: '7.2', note: 'x.md', status: 'calibrate', fix: ['bbbbbbb', 'ddddddd'], regressions: note.regressions, before: 'ccccccc', after: 'ddddddd', checks: [K3], defect: 'scrollable', expect: 'STILL-RED-AFTER' });
    expect(plan(pairsOf(note))).toEqual(['aaaaaaa', 'bbbbbbb', 'ccccccc', 'ddddddd']);
  });

  it("a live calibration goes with the pair it names (the note's own by default); a pair the note does not have is an error", () => {
    const live = (before: string, after: string, pair?: number): LiveCalibration => ({ platform: 'ios', sources: ['wda'], ...(pair !== undefined && { pair }), before, after, cases: ['dismiss:c'], verdict: 'CALIBRATED', remark: 'r', summary: 's' });
    const [own, second] = pairsOf({ ...note, live: [live('aaaaaaa', 'bbbbbbb'), live('ccccccc', 'ddddddd', 2), live('aaaaaaa', 'eeeeeee', 1)] });
    expect(own.live).toEqual([live('aaaaaaa', 'bbbbbbb'), live('aaaaaaa', 'eeeeeee', 1)]);
    expect(second.live).toEqual([live('ccccccc', 'ddddddd', 2)]);
    expect('live' in pairsOf(note)[1]).toBe(false);
    // sharing a further pair's after is no claim on it: unnamed, it is the note's own pair's
    expect(pairsOf({ ...note, live: [live('bbbbbbb', 'ddddddd')] })[0].live).toEqual([live('bbbbbbb', 'ddddddd')]);
    expect(pairsOf(entry({ live: [live('aaaaaaa', 'bbbbbbb')] }))[0].live).toEqual([live('aaaaaaa', 'bbbbbbb')]);
    expect(() => pairsOf({ ...note, live: [live('ccccccc', 'ddddddd', 3)] })).toThrow(/#7: a live calibration \(ccccccc → ddddddd\) names pair 3; the note has pairs 1–2/);
    expect(() => pairsOf(entry({ live: [live('aaaaaaa', 'bbbbbbb', 2)] }))).toThrow(/names pair 2; the note has one pair/);
    expect(() => pairsOf({ ...note, live: [live('aaaaaaa', 'bbbbbbb', 0)] })).toThrow(/names pair 0/);
  });

  it("each pair judged alone: the second fix's own symptom required red at its before, a regression counted at the pair that broke it", () => {
    const runs = new Map<string, SideRun>([
      ['aaaaaaa', side({ [K1]: 'covered by toolbar', [K3]: 'covered by toolbar', [KX]: undefined })],
      ['bbbbbbb', side({ [K1]: undefined, [K3]: 'covered by scrollable', [KX]: undefined })],
      ['ccccccc', side({ [K1]: undefined, [K3]: 'covered by scrollable', [KX]: undefined })],
      ['ddddddd', side({ [K1]: undefined, [K3]: undefined, [KX]: 'red' })],
    ]);
    const rs = results(pairsOf({ ...note, pairs: [{ ...note.pairs![0], expect: undefined }] }), runs);
    expect(rs.map((r) => [r.entry.n, r.verdict])).toEqual([['7.1', 'CALIBRATED'], ['7.2', 'CALIBRATED']]);
    expect(rs[1].elsewhere).toEqual([KX]);
    expect(failing(rs)).toEqual([]);
    // the second fix's before red for the first fix's symptom only: not this pair's defect
    const only = new Map(runs).set('ccccccc', side({ [K1]: undefined, [K3]: 'covered by toolbar', [KX]: undefined }));
    expect(results(pairsOf(note), only).map((r) => r.verdict)).toEqual(['CALIBRATED', 'DOES-NOT-FAIL']);
    // a pair's expect is its own
    expect(failing(results(pairsOf(note), runs)).map((r) => r.entry.n)).toEqual(['7.2']);
    const report = calibrationReport(rs);
    expect(report).toContain('| 7.1 | x | calibrate | aaaaaaa → bbbbbbb | CALIBRATED (partial: first) |');
    expect(report).toContain('| 7.2 | x | calibrate | ccccccc → ddddddd | CALIBRATED, regressed elsewhere: 1 row (recorded) |');
  });
});

describe('calibrate.ts — the sides from the history (withSides)', () => {
  const bare = (more: Partial<CalibrationEntry> = {}) => entry({ before: undefined, after: undefined, ...more });

  it("before is the first fix's first parent, after the last fix", () => {
    expect(withSides(bare({ fix: ['bbbbbbb'] }), parentNamed)).toEqual(entry({ before: 'bbbbbbb^1', after: 'bbbbbbb' }));
    expect(withSides(bare({ fix: ['bbbbbbb', 'ccccccc', 'ddddddd'] }), parentNamed)).toMatchObject({ before: 'bbbbbbb^1', after: 'ddddddd' });
  });

  it('a side the table gives overrides the derivation', () => {
    expect(withSides(bare({ fix: ['bbbbbbb', 'ccccccc'], after: 'bbbbbbb' }), parentNamed)).toMatchObject({ before: 'bbbbbbb^1', after: 'bbbbbbb' });
    expect(withSides(bare({ fix: ['bbbbbbb'], before: 'aaaaaaa' }), parentNamed)).toMatchObject({ before: 'aaaaaaa', after: 'bbbbbbb' });
    expect(withSides(bare({ fix: ['bbbbbbb'], after: 'eeeeeee', afterNotFix: 'w' }), parentNamed)).toMatchObject({ before: 'bbbbbbb^1', after: 'eeeeeee' });
  });

  it('a note with no fix, or one calibrate does not judge on its fixes, gets no sides', () => {
    const open = bare({ status: 'open', fix: undefined });
    expect(withSides(open, parentNamed)).toEqual(open);
    const residual = bare({ status: 'residual:the cell', fix: ['bbbbbbb'] });
    expect(withSides(residual, parentNamed)).toEqual(residual);
    expect(withSides(bare({ fix: [] }), parentNamed)).toEqual(bare({ fix: [] }));
  });

  it("a further pair's before is its after's first parent; given, it stays; with afterNotFix it must be given", () => {
    const p = { after: 'ddddddd', checks: [K2], defect: 'd' };
    const note = bare({ fix: ['bbbbbbb', 'ddddddd'], after: 'bbbbbbb', pairs: [p, { ...p, before: 'ccccccc' }] });
    expect(withSides(note, parentNamed).pairs).toEqual([{ ...p, before: 'ddddddd^1' }, { ...p, before: 'ccccccc' }]);
    expect(withSides(bare({ fix: ['bbbbbbb'], pairs: [{ ...p, after: 'eeeeeee', afterNotFix: 'w', before: 'ccccccc' }] }), parentNamed).pairs?.[0].before).toBe('ccccccc');
    expect(() => withSides(bare({ fix: ['bbbbbbb'], pairs: [{ ...p, after: 'eeeeeee', afterNotFix: 'w' }] }), parentNamed)).toThrow('calibration.json #x: the pair eeeeeee is no fix (afterNotFix) and gives no before');
  });

  it('entriesOf: the notes --note names, their sides derived, each pair with its own', () => {
    const t = { notes: [bare({ n: '1', fix: ['bbbbbbb'] }), bare({ n: '7', fix: ['bbbbbbb', 'ddddddd'], after: 'bbbbbbb', pairs: [{ after: 'ddddddd', checks: [K2], defect: 'd' }] })] };
    expect(entriesOf(t, ['7'], parentNamed).map((e) => [e.n, e.before, e.after])).toEqual([['7.1', 'bbbbbbb^1', 'bbbbbbb'], ['7.2', 'ddddddd^1', 'ddddddd']]);
    expect(plan(entriesOf(t, undefined, parentNamed))).toEqual(['bbbbbbb^1', 'bbbbbbb', 'ddddddd^1', 'ddddddd']);
    expect(() => entriesOf(t, ['9'], parentNamed)).toThrow('calibrate --note: 9 is no note of the table');
  });
});

describe('calibrate.ts — --note (notesOf)', () => {
  it('the notes named, in the table\'s order; all without --note; an unknown name is an error naming it', () => {
    const t = { notes: [entry({ n: '1' }), entry({ n: '7' }), entry({ n: 'FU1' })] };
    expect(notesOf(t, undefined).map((e) => e.n)).toEqual(['1', '7', 'FU1']);
    expect(notesOf(t, ['FU1', '1']).map((e) => e.n)).toEqual(['1', 'FU1']);
    expect(() => notesOf(t, ['7', '999', 'x'])).toThrow('calibrate --note: 999, x is no note of the table');
  });

  it('the command line refuses an unknown note before any checkout', () => {
    let err: { status: number | null; stderr: string } | undefined;
    try {
      execFileSync(process.execPath, ['--import', 'tsx', `${ROOT}scripts/truth/calibrate.ts`, '--note', '999'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      err = e as { status: number | null; stderr: string };
    }
    expect(err?.status).not.toBe(0);
    expect(err?.stderr).toContain('calibrate --note: 999 is no note of the table');
    expect(err?.stderr).not.toContain('ReferenceError');
  });
});

describe('calibrate.ts — the canary (sideRunOf)', () => {
  const json = (checks: GoldenCheck[]): GoldenJson => ({ side: '/x', results: [{ recording: 'r', checks, broken: [] }] });

  it('the open cell: a capture whose file is `open.<ext>`, nothing else that names "open"', () => {
    expect(isOpenCell('ios-iphone17-ios27/open.wda.json')).toBe(true);
    expect(isOpenCell('android-averi_lab-api33/open.xml')).toBe(true);
    for (const r of ['ios-iphone17-ios27/reopen.wda.json', 'open-run/alert-dim.xml', 'ios-iphone17-ios27/open-sheet.wda.json', 'ios/open.wda.json/x'])
      expect(isOpenCell(r), r).toBe(false);
  });

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

// A side that fails to load says why — on the console and in the report — and a failed run never overwrites the
// committed report. golden runs as a process (SideDeps.golden): faked here, as execFile rejects.
describe('calibrate.ts — a side that fails (runSide, failureOf, disposition)', () => {
  const GOOD = JSON.stringify({ side: '/x', results: [{ recording: 'r', checks: [check(OPEN, undefined), check(K1, 'Tapped')], broken: [] }] } satisfies GoldenJson);
  const killed: ProcessError = { code: null, signal: 'SIGKILL', stdout: '', stderr: 'fork: Resource temporarily unavailable\n', message: 'Command failed: node --import tsx golden.ts' };
  const exited: ProcessError = { code: 1, signal: null, stdout: 'progress\n', stderr: 'a\nb\nTypeError: x is not iterable\n    at golden.ts:12\n    at main\n', message: 'Command failed: node golden.ts\nTypeError …' };
  /** Fake deps: golden answers each call with the next of `answers` (a stdout, or an error to reject with). */
  const deps = (answers: (string | ProcessError)[], checkout: SideDeps['checkout'] = (sha) => ({ root: `/wt/${sha}` })) => {
    const calls: string[][] = [];
    const d: SideDeps = {
      golden: async (args) => {
        calls.push(args);
        const a = answers.shift();
        if (a === undefined) throw new Error('golden called once too often');
        if (typeof a === 'string') return a;
        throw Object.assign(new Error(a.message), a);
      },
      args: (root) => ['--side', root],
      checkout,
    };
    return { d, calls };
  };

  it('failureOf: the signal, the exit code or the spawn error, and the last 3 lines of stderr', () => {
    expect(failureOf(killed)).toBe('killed by SIGKILL; stderr: fork: Resource temporarily unavailable');
    expect(failureOf(exited)).toBe('exit code 1; stderr: TypeError: x is not iterable | at golden.ts:12 | at main');
    expect(failureOf({ code: 'ENOENT', message: 'spawn node ENOENT' })).toBe('spawn error ENOENT; no stderr');
  });

  it('killed by a signal, twice: run twice, the side does not load with the signal and the stderr', async () => {
    const { d, calls } = deps([killed, killed]);
    const o = await runSide('aaaaaaa', '/repo', d);
    expect(calls).toEqual([['--side', '/wt/aaaaaaa'], ['--side', '/wt/aaaaaaa']]);
    expect(o.run).toEqual({ error: 'killed by SIGKILL; stderr: fork: Resource temporarily unavailable' });
    expect(o.retried).toBe('killed by SIGKILL; stderr: fork: Resource temporarily unavailable');
    expect(sideLine('aaaaaaa', o, 0.1)).toBe(
      'calibrate: aaaaaaa DID NOT LOAD — killed by SIGKILL; stderr: fork: Resource temporarily unavailable in 0.1 s (run twice: the first golden process failed — killed by SIGKILL; stderr: fork: Resource temporarily unavailable)',
    );
  });

  it('killed once, then clean: the second run counts, and it is said it was run twice', async () => {
    const { d } = deps([killed, GOOD]);
    const o = await runSide('aaaaaaa', '/repo', d);
    expect('checks' in o.run && [...o.run.checks.keys()]).toEqual([OPEN, K1]);
    expect(sideLine('aaaaaaa', o, 2)).toBe('calibrate: aaaaaaa ran in 2.0 s (run twice: the first golden process failed — killed by SIGKILL; stderr: fork: Resource temporarily unavailable)');
  });

  it('run twice: the checkout this run created is still handed back for --remove', async () => {
    const cleanup = () => undefined;
    expect((await runSide('aaaaaaa', '/repo', deps([killed, GOOD], () => ({ root: '/wt', cleanup })).d)).cleanup).toBe(cleanup);
    expect((await runSide('aaaaaaa', '/repo', deps([killed, killed], () => ({ root: '/wt', cleanup })).d)).cleanup).toBe(cleanup);
  });

  it('killed though its JSON was out: run once more all the same', async () => {
    const { d, calls } = deps([{ ...killed, stdout: `${GOOD}\n` }, GOOD]);
    const o = await runSide('aaaaaaa', '/repo', d);
    expect(calls).toHaveLength(2);
    expect('checks' in o.run).toBe(true);
  });

  it('a non-zero exit with no JSON: run twice, its exit code and stderr tail are the reason', async () => {
    const { d } = deps([exited, exited]);
    const o = await runSide(WORKING_TREE, '/repo', d);
    expect(o.run).toEqual({ error: 'exit code 1; stderr: TypeError: x is not iterable | at golden.ts:12 | at main' });
  });

  it('exit 1 with its JSON (golden on a mismatch): one run, the side loads', async () => {
    const { d, calls } = deps([{ ...exited, stdout: `${GOOD}\n` }]);
    const o = await runSide(WORKING_TREE, '/repo', d);
    expect(calls).toEqual([['--side', '/repo']]);
    expect('checks' in o.run).toBe(true);
    expect(o.retried).toBeUndefined();
    expect(sideLine(WORKING_TREE, o, 1)).toBe('calibrate: working tree ran in 1.0 s');
  });

  it("a checkout git refuses: not loaded with git's stderr, golden never run", async () => {
    const cleanup = () => undefined;
    const { d, calls } = deps([], (sha) => {
      throw new Error(`git -C /repo rev-parse ${sha}^{commit}: fatal: ambiguous argument\n'${sha}^{commit}': unknown revision`);
    });
    const o = await runSide('zzzzzzz', '/repo', d);
    expect(calls).toEqual([]);
    expect(o.run).toEqual({ error: "no checkout: git -C /repo rev-parse zzzzzzz^{commit}: fatal: ambiguous argument 'zzzzzzz^{commit}': unknown revision" });
    expect(sideLine('zzzzzzz', o, 0)).toContain('DID NOT LOAD — no checkout: git -C /repo rev-parse');
    // a checkout this run created is handed back for --remove
    expect((await runSide('aaaaaaa', '/repo', deps([GOOD], () => ({ root: '/wt', cleanup })).d)).cleanup).toBe(cleanup);
  });

  it('--out: written only when no side failed unexpectedly — else <out>.failed, the file left as it is; exit 1 on a failing note', () => {
    const runs = (b: SideRun) => new Map([['aaaaaaa', b], ['bbbbbbb', side({ [K1]: undefined })]]);
    const ok = results([entry()], runs(side({ [K1]: 'Tapped' })));
    const lost = results([entry()], runs({ error: 'killed by SIGKILL; no stderr' }));
    const meant = results([entry({ expect: 'SIDE-DOES-NOT-LOAD' })], runs({ error: 'x' }));
    const red = results([entry()], runs(side({ [K1]: undefined })));
    // a clean full run: the report written, a stale <out>.failed of an earlier run deleted
    expect(disposition(ok, '/d/c.md')).toEqual({ path: '/d/c.md', stale: '/d/c.md.failed', code: 0 });
    expect(disposition(ok)).toEqual({ code: 0 });
    expect(disposition(lost, '/d/c.md')).toEqual({ path: '/d/c.md.failed', code: 1 });
    expect(disposition(lost)).toEqual({ code: 1 });
    expect(disposition(meant, '/d/c.md')).toEqual({ path: '/d/c.md', stale: '/d/c.md.failed', code: 0 });
    expect(disposition(red, '/d/c.md')).toEqual({ path: '/d/c.md', stale: '/d/c.md.failed', code: 1 });
  });

  it('--out with --note (some notes only): <out>.partial, the full report and any <out>.failed left as they are', () => {
    const ok = results([entry()], new Map([['aaaaaaa', side({ [K1]: 'Tapped' })], ['bbbbbbb', side({ [K1]: undefined })]]));
    const lost = results([entry()], new Map([['aaaaaaa', { error: 'x' }], ['bbbbbbb', side({ [K1]: undefined })]]));
    expect(disposition(ok, '/d/c.md', true)).toEqual({ path: '/d/c.md.partial', code: 0 });
    expect(disposition(lost, '/d/c.md', true)).toEqual({ path: '/d/c.md.partial', code: 1 });
    expect(disposition(ok, undefined, true)).toEqual({ code: 0 });
  });
});

describe('calibrate-run.ts — the sides several at once, from the cache where kept (pool, runSides)', () => {
  /** A task that waits for its own release: how many run at once, and in what order they start. */
  const gated = () => {
    let running = 0;
    let most = 0;
    const started: number[] = [];
    const release = new Map<number, () => void>();
    const task = async (i: number) => {
      started.push(i);
      most = Math.max(most, ++running);
      await new Promise<void>((done) => release.set(i, done));
      running--;
      return i * 10;
    };
    return { task, started, release, most: () => most };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('pool: at most `jobs` at once, the next started as soon as one finishes, the results in order', async () => {
    const g = gated();
    const all = pool([1, 2, 3, 4, 5], 2, g.task);
    await tick();
    expect(g.started).toEqual([1, 2]);
    g.release.get(2)!();
    await tick();
    expect(g.started).toEqual([1, 2, 3]);
    for (const i of [1, 3, 4, 5]) {
      await tick();
      g.release.get(i)!();
    }
    expect(await all).toEqual([10, 20, 30, 40, 50]);
    expect(g.most()).toBe(2);
  });

  it('pool: no more workers than items, and none for none', async () => {
    const g = gated();
    const all = pool([1], 8, g.task);
    await tick();
    g.release.get(1)!();
    expect(await all).toEqual([10]);
    expect(await pool([], 4, g.task)).toEqual([]);
  });

  const loaded = (n: number): SideRun => side({ [K1]: n === 0 ? undefined : `red ${n}` });
  /** Sides over a fake run and an in-memory cache: what was run, kept and logged. */
  const sides = (over: Partial<Sides> = {}, kept = new Map<string, SideRun>()) => {
    const ran: string[] = [];
    const puts: string[] = [];
    const log: string[] = [];
    const s: Sides = {
      run: async (sideName): Promise<SideOutcome> => {
        ran.push(sideName);
        return { run: sideName === 'bad' ? { error: 'no checkout: x' } : loaded(ran.length), cleanup: () => undefined };
      },
      cache: {
        get: async (key) => kept.get(key),
        put: async (key, run) => {
          puts.push(key);
          if (!('error' in run)) kept.set(key, run);
        },
      },
      keyOf: (sideName) => (sideName === WORKING_TREE ? undefined : `key-${sideName}`),
      reuse: true,
      jobs: 2,
      log: (line) => log.push(line),
      ...over,
    };
    return { s, ran, puts, log, kept };
  };

  it('cold: every side run and kept under its key; warm: none run, every run as kept, the hits named', async () => {
    const cold = sides();
    const first = await runSides(['aaaaaaa', 'bbbbbbb'], cold.s);
    expect(cold.ran.sort()).toEqual(['aaaaaaa', 'bbbbbbb']);
    expect(cold.puts.sort()).toEqual(['key-aaaaaaa', 'key-bbbbbbb']);
    expect(first.cached).toEqual([]);
    expect(first.cleanups).toHaveLength(2);
    const warm = sides({}, cold.kept);
    const second = await runSides(['aaaaaaa', 'bbbbbbb'], warm.s);
    expect(warm.ran).toEqual([]);
    expect(warm.puts).toEqual([]);
    expect(second.runs).toEqual(first.runs);
    expect(second.cached).toEqual(['aaaaaaa', 'bbbbbbb']);
    expect(second.cleanups).toEqual([]);
    expect(warm.log.sort()).toEqual(['calibrate: aaaaaaa from the cache', 'calibrate: bbbbbbb from the cache']);
  });

  it('--no-cache (reuse false): a kept side is run all the same, and kept afresh', async () => {
    const kept = new Map<string, SideRun>([['key-aaaaaaa', loaded(0)]]);
    const t = sides({ reuse: false }, kept);
    const { runs, cached } = await runSides(['aaaaaaa'], t.s);
    expect(t.ran).toEqual(['aaaaaaa']);
    expect(cached).toEqual([]);
    expect(runs.get('aaaaaaa')).toEqual(loaded(1));
    expect(kept.get('key-aaaaaaa')).toEqual(loaded(1));
  });

  it('a side with no key is run and not kept; one that did not load is run again next time', async () => {
    const t = sides();
    await runSides([WORKING_TREE, 'bad'], t.s);
    expect(t.puts).toEqual(['key-bad']);
    expect(t.kept.size).toBe(0);
    const again = sides({}, t.kept);
    await runSides([WORKING_TREE, 'bad'], again.s);
    expect(again.ran.sort()).toEqual(['bad', WORKING_TREE].sort());
  });

  it('the runs keyed by side whatever order they finish in, at most `jobs` at once', async () => {
    const g = gated();
    const t = sides({ jobs: 2, run: async (sideName) => ({ run: loaded(await g.task(Number(sideName))) }) });
    const all = runSides(['1', '2', '3'], t.s);
    await tick();
    expect(g.started).toEqual([1, 2]);
    // finished out of order: 2, then 3 (started in its place), then 1
    for (const i of [2, 3, 1]) {
      await tick();
      g.release.get(i)!();
    }
    const { runs } = await all;
    expect([...runs.keys()]).toEqual(['1', '2', '3']);
    expect(runs.get('3')).toEqual(loaded(30));
    expect(g.most()).toBe(2);
  });
});
