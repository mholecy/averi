import { describe, expect, it } from 'vitest';
import {
  EXIT,
  exitCodeOf,
  failsIn,
  interruptedBlock,
  parseVerdictLine,
  stepLine,
  SUMMARY_MARKER,
  summaryLines,
  VERDICTS,
  verdictLine,
  type Summary,
} from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/words.ts: the words a device batch speaks — its step words, its verdicts, the verdict line, the
// SUMMARY and the exit code. Pure: strings in, strings out. The titles name the fix and the batch that found it.

const base: Summary = {
  name: 'batch-n',
  runId: '20261104-094426-2763',
  checkout: "OK checkout: main's HEAD f7ea6e07, clean",
  labs: ['LAB android: OK — the installed APK is main\'s'],
  blocks: [
    { block: 'kf', lines: ['kf live verdict: PASS — kf1, kf2, kf3 ok'] },
    { block: 'E5', lines: ['E5 cleanup: OK — exit 5', 'E5 verdict: PASS — a PASS, c PASS'] },
  ],
  protectedLines: ["OK   com.apple.launchservices.schemeapproval's key unchanged"],
  restore: { file: 'RESTORE.txt', written: [] },
  errors: [],
};

describe('verdictLine — one verdict, `<label>: <VERDICT> — <why>`', () => {
  it('formats the label, the word and the reason as every batch since batch-2 does', () => {
    expect(verdictLine('kf live verdict', 'INCONCLUSIVE', 'the premise does not hold')).toBe('kf live verdict: INCONCLUSIVE — the premise does not hold');
    expect(verdictLine('lv-d62 pre d62 drop', 'REPRODUCED', '3 false "fully visible"')).toBe('lv-d62 pre d62 drop: REPRODUCED — 3 false "fully visible"');
    expect(verdictLine('E5 verdict', 'PASS')).toBe('E5 verdict: PASS');
  });

  it('refuses a label with a colon or a line break, and a reason with a line break: the exit rule reads to the first colon, the SUMMARY line by line', () => {
    expect(() => verdictLine('E5: a', 'PASS')).toThrow(/label "E5: a" holds a colon or a line break/);
    expect(() => verdictLine('E5\na', 'PASS')).toThrow(/label "E5\\na" holds a colon or a line break/);
    expect(() => verdictLine('', 'PASS')).toThrow(/label "" is empty/);
    expect(() => verdictLine('E5 verdict', 'PASS', 'one\ntwo')).toThrow(/reason of "E5 verdict" holds a line break/);
    expect(() => verdictLine('E5 verdict', 'PASS', 'one\rtwo')).toThrow(/line break/);
  });

  it('refuses a word outside the vocabulary (a typo would read as no verdict at all)', () => {
    expect(() => verdictLine('E5 verdict', 'PASSED' as never)).toThrow(/"PASSED" is not a verdict word \(PASS, FAIL, INCONCLUSIVE, REPRODUCED, OBSERVED, SKIP, INTERRUPTED, OK, ERROR\)/);
  });

  it('the vocabulary: block verdicts, the abort\'s INTERRUPTED, and the cleanup lines\' OK and ERROR', () => {
    expect(VERDICTS).toEqual(['PASS', 'FAIL', 'INCONCLUSIVE', 'REPRODUCED', 'OBSERVED', 'SKIP', 'INTERRUPTED', 'OK', 'ERROR']);
  });
});

describe('parseVerdictLine — the line back to its parts', () => {
  it('reads what verdictLine writes, the reason optional', () => {
    expect(parseVerdictLine('E5 cleanup: FAIL — a lab default')).toEqual({ label: 'E5 cleanup', verdict: 'FAIL', why: 'a lab default' });
    expect(parseVerdictLine('E5 verdict: PASS')).toEqual({ label: 'E5 verdict', verdict: 'PASS', why: undefined });
  });

  it('reads no verdict in a word outside the vocabulary, a word run on, or a line with no label', () => {
    expect(parseVerdictLine('kf panel: HOLDS — the measured panel')).toBeUndefined();
    expect(parseVerdictLine('E5 verdict: PASSED')).toBeUndefined();
    expect(parseVerdictLine('E5 verdict: PASS— x')).toBeUndefined();
    expect(parseVerdictLine(': PASS')).toBeUndefined();
    expect(parseVerdictLine('E5 verdict PASS')).toBeUndefined();
  });
});

describe('stepLine — a step word, padded as batch-1 to batch-12 pad it', () => {
  it('OK, DONE, FAIL, WARN, NOTE, SKIP and ERROR line up', () => {
    expect(stepLine('OK', 'kf analyze')).toBe('OK   kf analyze');
    expect(stepLine('DONE', 'kf live')).toBe('DONE kf live');
    expect(stepLine('ERROR', 'E5: the lab is not installed')).toBe('ERROR E5: the lab is not installed');
    expect(stepLine('SKIP', 'T6')).toBe('SKIP T6');
  });
});

describe("failsIn — batch-12's exit rule, `^[^:]+: FAIL( |$)`, plus the step form", () => {
  it('a FAIL verdict with a tail that is no reason still fails, as under batch-12\'s rule', () => {
    expect(failsIn('lv-d62 verdict: FAIL 2/3 dropped')).toBe(true);
    expect(failsIn('kf live verdict: FAIL (1 of 3 MISMATCH)')).toBe(true);
    expect(failsIn('(before the interrupt) E5 cleanup: FAIL — x')).toBe(true);
  });

  it('a PASS with a tail, and a FAIL after a colon-free lead that is not the first colon, do not', () => {
    expect(failsIn('E5 verdict: PASS 3/3')).toBe(false);
    expect(failsIn('D55 note: see x: FAIL')).toBe(false);
    expect(failsIn(': FAIL')).toBe(false);
  });

  it('a FAIL verdict line, and a FAIL step line (a FAIL protected-key line would have exited 0 under batch-12\'s regex)', () => {
    expect(failsIn('E5 cleanup: FAIL — a lab default')).toBe(true);
    expect(failsIn('LAB android: FAIL — the guard refused emulator-5554')).toBe(true);
    expect(failsIn("FAIL com.apple.launchservices.schemeapproval's key changed")).toBe(true);
    expect(failsIn('FAIL')).toBe(true);
  });

  it('not a PASS, an INCONCLUSIVE, an ERROR, nor a word that only starts with FAIL', () => {
    for (const line of ['E5 verdict: PASS', 'kf live verdict: INCONCLUSIVE — FAIL later', '09:44:26 ERROR kf: FAIL', 'kf panel: FAILS — covers the submit', 'FAILS nothing', 'E5 c verdict: ERROR — FAIL']) {
      expect(failsIn(line), line).toBe(false);
    }
  });
});

describe('summaryLines — the SUMMARY, its marker unchanged so the waiting rule holds', () => {
  it('fixed order: marker, checkout, lab lines, each block\'s verdict lines, the protected-key lines, RESTORE, this run\'s ERRORs, end marker (batch-6 → batch-12)', () => {
    const errors = ['09:50:01 ERROR E5: one thing'];
    expect(summaryLines({ ...base, errors })).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD f7ea6e07, clean",
      "LAB android: OK — the installed APK is main's",
      'kf live verdict: PASS — kf1, kf2, kf3 ok',
      'E5 cleanup: OK — exit 5',
      'E5 verdict: PASS — a PASS, c PASS',
      "OK   com.apple.launchservices.schemeapproval's key unchanged",
      'RESTORE: none — everything dirty was put back and verified',
      '09:50:01 ERROR E5: one thing',
      '======== SUMMARY end (run 20261104-094426-2763)',
    ]);
    expect(SUMMARY_MARKER).toBe('======== SUMMARY');
  });

  it('each line once: identical lines — the same ERROR line twice, a verdict line twice — print once (batch-6\'s `awk \'!seen[$0]++\'`)', () => {
    const lines = summaryLines({ ...base, blocks: [{ block: 'kf', lines: ['kf live verdict: PASS', 'kf live verdict: PASS'] }], errors: ['09:50:01 ERROR x', '09:50:01 ERROR x'] });
    expect(lines.filter((l) => l === 'kf live verdict: PASS')).toHaveLength(1);
    expect(lines.filter((l) => l === '09:50:01 ERROR x')).toHaveLength(1);
  });

  it('a RESTORE written by this run prints its file, then what this run wrote into it — its header line and every hand line (batch-12 cat the file)', () => {
    const written = ['batch-n run 1 ended 2026-11-04 10:00:00; state to put back by hand:', 'E5 (Android): adb -s emulator-5554 shell pm path dev.averi.lab', 'lvd62: git worktree prune'];
    const lines = summaryLines({ ...base, restore: { file: 'out/RESTORE.txt', written } });
    expect(lines.slice(-5)).toEqual([
      'RESTORE: state not provably put back — out/RESTORE.txt:',
      'batch-n run 1 ended 2026-11-04 10:00:00; state to put back by hand:',
      'E5 (Android): adb -s emulator-5554 shell pm path dev.averi.lab',
      'lvd62: git worktree prune',
      '======== SUMMARY end (run 20261104-094426-2763)',
    ]);
  });

  it('interrupted: the INTERRUPTED line after the checkout, a finished block\'s verdicts as judged, an unfinished one INTERRUPTED with its lines so far marked (batch-12\'s on_abort)', () => {
    const lines = summaryLines({
      ...base,
      interrupted: { at: '10:12:00' },
      blocks: [
        { block: 'kf', lines: ['kf live verdict: PASS'] },
        { block: 'E5', lines: ['E5 a verdict: PASS'], interrupted: true },
      ],
    });
    expect(lines).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD f7ea6e07, clean",
      'INTERRUPTED: batch-n run 20261104-094426-2763 was interrupted at 10:12:00',
      "LAB android: OK — the installed APK is main's",
      'kf live verdict: PASS',
      '(before the interrupt) E5 a verdict: PASS',
      'E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)',
      "OK   com.apple.launchservices.schemeapproval's key unchanged",
      'RESTORE: none — everything dirty was put back and verified',
      '======== SUMMARY end (run 20261104-094426-2763, INTERRUPTED)',
    ]);
  });

  it('a SUMMARY line with a line break in it is refused (a split line would hide a FAIL from the exit rule)', () => {
    expect(() => summaryLines({ ...base, labs: ['LAB android: OK\nE5 verdict: FAIL'] })).toThrow(/a SUMMARY line holds a line break/);
    expect(() => summaryLines({ ...base, restore: { file: 'R', written: ['one\ntwo'] } })).toThrow(/a SUMMARY line holds a line break/);
  });
});

describe('interruptedBlock — an unfinished block in the abort SUMMARY', () => {
  it('keeps its lines so far, marked, then says INTERRUPTED and how to rerun it', () => {
    expect(interruptedBlock('lvd62', ['lv-d62 main drop: PASS'])).toEqual(['(before the interrupt) lv-d62 main drop: PASS', 'lvd62: INTERRUPTED — its records are not complete, not judged (rerun ONLY=lvd62)']);
  });

  it('a block not judged for a reason of its own (the abort\'s judging budget spent): `not judged (<why>; rerun ONLY=…)`', () => {
    expect(interruptedBlock('kf', [], "the abort's judging budget of 120 s was spent")).toEqual(["kf: INTERRUPTED — not judged (the abort's judging budget of 120 s was spent; rerun ONLY=kf)"]);
  });

  it('a BlockReport\'s `why` reaches the SUMMARY line', () => {
    const lines = summaryLines({ name: 'b', runId: '1', checkout: 'OK c', labs: [], protectedLines: [], restore: { file: 'R', written: [] }, errors: [], interrupted: { at: '10:00:00' }, blocks: [{ block: 'kf', lines: [], interrupted: true, why: 'its judge failed: x' }] });
    expect(lines).toContain('kf: INTERRUPTED — not judged (its judge failed: x; rerun ONLY=kf)');
  });
});

describe('exitCodeOf — 0, 1 on a FAIL or a RESTORE, 130 when interrupted (batch-12; batch-11 exited 0 whatever its verdicts)', () => {
  it('0 when every line passes and nothing is left to put back', () => {
    expect(exitCodeOf(base)).toBe(EXIT.ok);
    expect(EXIT).toEqual({ ok: 0, failed: 1, refused: 2, interrupted: 130 });
  });

  it('1 on a FAIL in any block, lab or protected-key line', () => {
    expect(exitCodeOf({ ...base, blocks: [{ block: 'E5', lines: ['E5 cleanup: FAIL — a lab default'] }] })).toBe(1);
    expect(exitCodeOf({ ...base, labs: ['LAB android: FAIL — not in adb devices'] })).toBe(1);
    expect(exitCodeOf({ ...base, protectedLines: ['FAIL the key changed'] })).toBe(1);
    expect(exitCodeOf({ ...base, checkout: 'FAIL checkout' })).toBe(1);
  });

  it('1 when this run wrote a RESTORE, every verdict a PASS', () => {
    expect(exitCodeOf({ ...base, restore: { file: 'R', written: ['h; state to put back by hand:', 'E5: by hand'] } })).toBe(1);
  });

  it('an ERROR line, an INCONCLUSIVE or a SKIP alone is not a FAIL: 0', () => {
    expect(exitCodeOf({ ...base, errors: ['09:00:00 ERROR kf: FAIL'], blocks: [{ block: 'T6', lines: ['T6 verdict: INCONCLUSIVE — not possible', 'T6 x: SKIP'] }] })).toBe(0);
  });

  it('130 when interrupted, whatever its verdicts and RESTORE', () => {
    const interrupted = { ...base, interrupted: { at: '10:12:00' } };
    expect(exitCodeOf(interrupted)).toBe(130);
    expect(exitCodeOf({ ...interrupted, restore: { file: 'R', written: ['x'] }, blocks: [{ block: 'E5', lines: ['E5 verdict: FAIL'] }] })).toBe(130);
  });
});
