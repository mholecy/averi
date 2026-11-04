import { describe, expect, it } from 'vitest';
import { knobs, selectBlocks, type KnobSpec } from '../../../scripts/truth/batch/select.js';

// scripts/truth/batch/select.ts: which blocks a run does (ONLY=) and what its knobs are — both decided before any
// device call, and a refusal exits 2 with "nothing was done". Pure: the env is a plain record.

const BLOCKS = ['lab', 'kf', 'lvd62', 'T6', 'E5'] as const;

describe('selectBlocks — ONLY= (batch-2 on; validated since batch-10/11: b11-dry knob-only, only-mixed)', () => {
  it('no ONLY, or an empty one, wants every block in the batch\'s order', () => {
    expect(selectBlocks(BLOCKS, undefined)).toEqual({ ok: true, wanted: [...BLOCKS], warnings: [] });
    expect(selectBlocks(BLOCKS, '')).toEqual({ ok: true, wanted: [...BLOCKS], warnings: [] });
  });

  it('keeps the batch\'s order, not ONLY\'s, and each block once', () => {
    expect(selectBlocks(BLOCKS, 'E5,lab,E5')).toEqual({ ok: true, wanted: ['lab', 'E5'], warnings: [] });
  });

  it('commas or spaces between names (the README writes `lab kf lvd62 T6 E5`)', () => {
    expect(selectBlocks(BLOCKS, ' kf, T6  lab ')).toEqual({ ok: true, wanted: ['lab', 'kf', 'T6'], warnings: [] });
  });

  it('only-mixed: an unknown name is a WARN and ignored, the known ones run (batch-10/11)', () => {
    expect(selectBlocks(BLOCKS, 'kf,D99')).toEqual({
      ok: true,
      wanted: ['kf'],
      warnings: ["WARN ONLY names 'D99', which is not a block of this batch (lab, kf, lvd62, T6, E5): ignored"],
    });
  });

  it('a name differing only in case is not the block (t6 is not T6)', () => {
    expect(selectBlocks(BLOCKS, 't6,kf')).toMatchObject({ ok: true, wanted: ['kf'] });
  });

  it('knob-only: ONLY naming no block refuses to start, nothing done (batch-10/11)', () => {
    expect(selectBlocks(BLOCKS, 'D99,x')).toEqual({
      ok: false,
      errors: ["WARN ONLY names 'D99', which is not a block of this batch (lab, kf, lvd62, T6, E5): ignored", "WARN ONLY names 'x', which is not a block of this batch (lab, kf, lvd62, T6, E5): ignored", 'ERROR ONLY=D99,x names no block of this batch — nothing was done'],
    });
    expect(selectBlocks(BLOCKS, ' , ')).toEqual({ ok: false, errors: ['ERROR ONLY= ,  names no block of this batch — nothing was done'] });
  });
});

/** batch-12's knobs, a sample of each kind. */
const SPEC = {
  counts: {
    KF_RUNS: { default: 1, min: 1 },
    E5C_LAUNCH_RUNS: { default: 5, min: 0 },
    E5C_MIN_LAUNCH: { default: 4, min: 0 },
    LVD62_SAMPLE_MS: { default: 50, min: 20, why: "0 is refused: lv-d62's drop gate judges swipe 1 by the samples" },
    E5_TAP: { default: 1, min: 0, max: 1 },
    B_INSTALL: { default: 600, min: 30, unit: 'seconds' },
    D62_FLING_PX: { default: 440, min: 50, max: 2000 },
  },
  texts: {
    M_D43: { default: '', pattern: /^[0-9a-f]{7,40}$/, what: 'a commit sha (7–40 hex digits) or empty' },
  },
  atMost: [{ low: 'E5C_MIN_LAUNCH', high: 'E5C_LAUNCH_RUNS', why: 'a PASS could never be shown' }],
} satisfies KnobSpec;

describe('knobs — every knob checked before anything is done (batch-10 → batch-12)', () => {
  it('the defaults when the env names none, or names one empty (zsh `${K:-d}` reads empty as unset)', () => {
    expect(knobs(SPEC, { KF_RUNS: '' })).toEqual({
      ok: true,
      values: { KF_RUNS: 1, E5C_LAUNCH_RUNS: 5, E5C_MIN_LAUNCH: 4, LVD62_SAMPLE_MS: 50, E5_TAP: 1, B_INSTALL: 600, D62_FLING_PX: 440, M_D43: '' },
    });
  });

  it('reads whole numbers from the env, leading zeros included', () => {
    expect(knobs(SPEC, { KF_RUNS: '3', E5_TAP: '0', B_INSTALL: '0900' })).toMatchObject({ ok: true, values: { KF_RUNS: 3, E5_TAP: 0, B_INSTALL: 900 } });
  });

  it('a count must be a whole number: a sign, a fraction, an exponent, hex, spaces or words are refused', () => {
    for (const v of ['-1', '+3', '3.0', '1e3', '0x10', ' 3', '3 ', 'three', '١']) {
      expect(knobs(SPEC, { KF_RUNS: v }), v).toEqual({ ok: false, errors: [`ERROR KF_RUNS=${v}: a whole number >= 1 is needed — nothing was done`] });
    }
  });

  it('a count beyond a safe integer is refused, not rounded', () => {
    expect(knobs(SPEC, { KF_RUNS: '99999999999999999999' })).toMatchObject({ ok: false });
  });

  it('the floor, inclusive: at it passes, under it is refused', () => {
    expect(knobs(SPEC, { KF_RUNS: '1', E5C_LAUNCH_RUNS: '0', E5C_MIN_LAUNCH: '0' })).toMatchObject({ ok: true });
    expect(knobs(SPEC, { KF_RUNS: '0' })).toEqual({ ok: false, errors: ['ERROR KF_RUNS=0: a whole number >= 1 is needed — nothing was done'] });
  });

  it("LVD62_SAMPLE_MS 0 is refused with its reason (batch-12: lv-d62's drop gate needs the samples)", () => {
    expect(knobs(SPEC, { LVD62_SAMPLE_MS: '0' })).toEqual({
      ok: false,
      errors: ["ERROR LVD62_SAMPLE_MS=0: a whole number >= 20 is needed (0 is refused: lv-d62's drop gate judges swipe 1 by the samples) — nothing was done"],
    });
    expect(knobs(SPEC, { LVD62_SAMPLE_MS: '20' })).toMatchObject({ ok: true });
  });

  it('a ceiling, inclusive: E5_TAP is 0 or 1; a range names both ends', () => {
    expect(knobs(SPEC, { E5_TAP: '2' })).toEqual({ ok: false, errors: ['ERROR E5_TAP=2: 0 or 1 — nothing was done'] });
    expect(knobs(SPEC, { D62_FLING_PX: '2000' })).toMatchObject({ ok: true });
    expect(knobs(SPEC, { D62_FLING_PX: '2001' })).toEqual({ ok: false, errors: ['ERROR D62_FLING_PX=2001: a whole number from 50 to 2000 is needed — nothing was done'] });
    expect(knobs(SPEC, { D62_FLING_PX: '49' })).toEqual({ ok: false, errors: ['ERROR D62_FLING_PX=49: a whole number from 50 to 2000 is needed — nothing was done'] });
  });

  it('a bound names its unit (batch-11: "a whole number of seconds >= 30")', () => {
    expect(knobs(SPEC, { B_INSTALL: '29' })).toEqual({ ok: false, errors: ['ERROR B_INSTALL=29: a whole number of seconds >= 30 is needed — nothing was done'] });
  });

  it('a cross-knob check: a minimum above its runs could never PASS (batch-11 D62_MIN_TRIGGER, batch-12 E5C_MIN_LAUNCH)', () => {
    expect(knobs(SPEC, { E5C_MIN_LAUNCH: '5', E5C_LAUNCH_RUNS: '5' })).toMatchObject({ ok: true });
    expect(knobs(SPEC, { E5C_MIN_LAUNCH: '6', E5C_LAUNCH_RUNS: '5' })).toEqual({
      ok: false,
      errors: ['ERROR E5C_MIN_LAUNCH=6 > E5C_LAUNCH_RUNS=5: a PASS could never be shown — nothing was done'],
    });
  });

  it('a cross-knob check is skipped when either side is already refused (one error, the real one)', () => {
    expect(knobs(SPEC, { E5C_MIN_LAUNCH: 'x' })).toEqual({ ok: false, errors: ['ERROR E5C_MIN_LAUNCH=x: a whole number >= 0 is needed — nothing was done'] });
  });

  it('a text knob matches its pattern or is empty (batch-11 M_D43: a sha or nothing)', () => {
    expect(knobs(SPEC, { M_D43: 'cb011fe5' })).toMatchObject({ ok: true, values: { M_D43: 'cb011fe5' } });
    expect(knobs(SPEC, { M_D43: 'HEAD~1' })).toEqual({ ok: false, errors: ['ERROR M_D43=HEAD~1: a commit sha (7–40 hex digits) or empty — nothing was done'] });
  });

  it('a text pattern matches the whole value, anchored or not (review round 1: an unanchored sha pattern let `xxcb011fe5yy` in)', () => {
    const spec = { texts: { SHA: { default: '', pattern: /[0-9a-f]{7,40}/, what: 'a commit sha' } } } satisfies KnobSpec;
    expect(knobs(spec, { SHA: 'xxcb011fe5yy' })).toEqual({ ok: false, errors: ['ERROR SHA=xxcb011fe5yy: a commit sha — nothing was done'] });
    expect(knobs(spec, { SHA: 'cb011fe5' })).toMatchObject({ ok: true, values: { SHA: 'cb011fe5' } });
    const alt = { texts: { K: { default: '', pattern: /a|b/, what: 'a or b' } } } satisfies KnobSpec;
    expect(knobs(alt, { K: 'ax' })).toMatchObject({ ok: false });
    expect(knobs(alt, { K: 'b' })).toMatchObject({ ok: true });
    expect(knobs({ texts: { K: { default: '', pattern: /^ab$/i, what: 'ab' } } }, { K: 'AB' })).toMatchObject({ ok: true });
  });

  it('a pattern with the g, m or y flag is refused when the spec is read: lastIndex would make one value pass once and fail the next time; m would match one line of a value', () => {
    for (const pattern of [/a/g, /a/y, /a/m, /a/im]) {
      expect(() => knobs({ texts: { K: { default: '', pattern, what: 'a' } } }, {}), String(pattern)).toThrow(`K's pattern ${pattern} has the g, m or y flag`);
    }
  });

  it('the values are typed from the spec: a count a number, a text a string, an unknown knob no key', () => {
    const r = knobs(SPEC, {});
    if (!r.ok) throw new Error('refused');
    const runs: number = r.values.KF_RUNS;
    const sha: string = r.values.M_D43;
    // @ts-expect-error a knob the spec does not declare
    void r.values.NOPE;
    expect([runs, sha]).toEqual([1, '']);
  });

  it('every error at once, in the spec\'s order, so one rerun fixes them all', () => {
    expect(knobs(SPEC, { E5_TAP: '9', KF_RUNS: '0' })).toEqual({
      ok: false,
      errors: ['ERROR KF_RUNS=0: a whole number >= 1 is needed — nothing was done', 'ERROR E5_TAP=9: 0 or 1 — nothing was done'],
    });
  });

  it('a spec whose default breaks its own rule, or whose cross check names no count, is a programming error', () => {
    expect(() => knobs({ counts: { K: { default: 0, min: 1 } } }, {})).toThrow(/K's default 0 breaks its own rule/);
    expect(() => knobs({ counts: { K: { default: 2, min: 0, max: 1 } } }, {})).toThrow(/K's default 2 breaks its own rule/);
    expect(() => knobs({ counts: { K: { default: 1.5, min: 0 } } }, {})).toThrow(/K's default 1.5 breaks its own rule/);
    expect(() => knobs({ counts: { K: { default: 1, min: 2, max: 1 } } }, {})).toThrow(/K's default 1 breaks its own rule/);
    expect(() => knobs({ texts: { T: { default: 'x', pattern: /^\d+$/, what: 'digits' } } }, {})).toThrow(/T's default "x" breaks its own rule/);
    expect(() => knobs({ counts: { K: { default: 1, min: 0 } }, atMost: [{ low: 'K', high: 'L', why: '' }] }, {})).toThrow(/atMost names L, which is no count knob/);
    expect(() => knobs({ counts: { K: { default: 1, min: 0 } }, atMost: [{ low: 'J', high: 'K', why: '' }] }, {})).toThrow(/atMost names J, which is no count knob/);
  });

  it('a spec of counts only, or of texts only, needs no cross check', () => {
    expect(knobs({ counts: { K: { default: 1, min: 0 } } }, { K: '2' })).toEqual({ ok: true, values: { K: 2 } });
    expect(knobs({ texts: { T: { default: '', pattern: /^\d+$/, what: 'digits' } } }, { T: '7' })).toEqual({ ok: true, values: { T: '7' } });
    expect(() => knobs({ atMost: [{ low: 'A', high: 'B', why: '' }] }, {})).toThrow(/atMost names A, which is no count knob/);
  });

  it('a knob name the env cannot hold is refused when the spec is read', () => {
    for (const name of ['kf-runs', 'xK', 'K-x', '1K', '']) expect(() => knobs({ counts: { [name]: { default: 1, min: 0 } } }, {}), name).toThrow(`knob name ${JSON.stringify(name)}`);
    expect(() => knobs({ counts: { K: { default: 1, min: 0 } }, texts: { K: { default: '', pattern: /x/, what: '' } } }, {})).toThrow(/knob K is declared twice/);
  });
});
