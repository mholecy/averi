import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { LIVE_GOLDEN_HEADER, StepLog, stepWordOf, terminalOf } from '../../../scripts/truth/batch/steps.js';
import { summaryLines, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/steps.ts: the run's own output. The runner writes `<name>.out` and steps.log itself — never
// through `| tee`, whose death with the Ctrl-C took batch-11's output with it — and the terminal gets only the
// start line and the SUMMARY. Real files in a temp dir; a fixed clock.

let out: string;
let meta: string;
let terminal: string[];
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'batch-steps-'));
  meta = join(out, 'meta', 'run-1');
  mkdirSync(meta, { recursive: true });
  terminal = [];
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

const clock = () => new Date(2026, 10, 4, 9, 44, 26);
const open = (over: Partial<Parameters<typeof StepLog.open>[1]> = {}) =>
  StepLog.open(nodeFs, {
    name: 'batch-n',
    runId: '1',
    blocks: ['kf', 'E5'],
    outFile: join(meta, 'batch-n.out'),
    stepsFile: join(out, 'steps.log'),
    latestOut: join(out, 'batch-n.out'),
    terminal: (t) => terminal.push(t),
    clock,
    ...over,
  });
const text = (p: string) => readFileSync(p, 'utf8');

describe('StepLog.open — its own .out, a steps.log section of its own, a pointer on the terminal', () => {
  it('the terminal gets the .out\'s path at the start; the .out and steps.log get the run\'s header', () => {
    open();
    expect(terminal).toEqual([`batch-n run 1: blocks kf,E5 — writing ${join(meta, 'batch-n.out')} (also ${join(out, 'batch-n.out')}); tail -f it; the SUMMARY follows here at the end.\n`]);
    expect(text(join(out, 'steps.log'))).toBe('09:44:26 ---- batch-n run 1, blocks kf,E5\n');
    expect(text(join(meta, 'batch-n.out'))).toBe('09:44:26 ---- batch-n run 1, blocks kf,E5\n');
  });

  it('steps.log is appended: an earlier run\'s section stays', () => {
    writeFileSync(join(out, 'steps.log'), '08:00:00 ---- batch-n run 0, blocks kf\n08:00:01 ERROR old\n');
    open();
    expect(text(join(out, 'steps.log'))).toBe('08:00:00 ---- batch-n run 0, blocks kf\n08:00:01 ERROR old\n09:44:26 ---- batch-n run 1, blocks kf,E5\n');
  });

  it('the .out is created, never overwritten: one that exists refuses (a run folder is never reused)', () => {
    writeFileSync(join(meta, 'batch-n.out'), 'earlier');
    expect(() => open()).toThrow(/batch-n\.out already exists/);
    expect(text(join(meta, 'batch-n.out'))).toBe('earlier');
  });

  it('the latest-out link points at this run\'s .out, replacing an earlier link', () => {
    open();
    expect(lstatSync(join(out, 'batch-n.out')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(out, 'batch-n.out'))).toBe(join(meta, 'batch-n.out'));
    const meta2 = join(out, 'meta', 'run-2');
    mkdirSync(meta2);
    open({ runId: '2', outFile: join(meta2, 'batch-n.out') });
    expect(readlinkSync(join(out, 'batch-n.out'))).toBe(join(meta2, 'batch-n.out'));
  });

  it('a plain file where the link goes (an old tee\'d output) is kept, never replaced, and the run says so', () => {
    writeFileSync(join(out, 'batch-n.out'), 'a tee\'d output');
    const log = open();
    expect(text(join(out, 'batch-n.out'))).toBe("a tee'd output");
    expect(text(join(meta, 'batch-n.out'))).toContain(`WARN ${join(out, 'batch-n.out')} not pointed at this run: a file, not a link, is there`);
    expect(log.errors()).toEqual([]);
    expect(terminal[0]).not.toContain('(also');
  });

  it('a link that cannot be made is a WARN, and the run goes on', () => {
    writeFileSync(`${join(out, 'batch-n.out')}.${process.pid}.new`, 'in the way');
    open();
    expect(text(join(meta, 'batch-n.out'))).toMatch(/WARN .*batch-n\.out not pointed at this run: the link could not be made \(EEXIST/);
  });

  it('a .out that cannot be created for another reason throws that reason, never "already exists"', () => {
    const denied = { ...nodeFs, createExclusive: () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); } };
    expect(() => StepLog.open(denied, { name: 'b', runId: '1', blocks: [], outFile: join(meta, 'b.out'), stepsFile: join(out, 'steps.log'), terminal: () => {} })).toThrow(/^EACCES: permission denied$/);
  });

  it('with no clock given, the time of day now', () => {
    const log = StepLog.open(nodeFs, { name: 'b', runId: '1', blocks: [], outFile: join(meta, 'b.out'), stepsFile: join(out, 'steps.log'), terminal: () => {} });
    log.note('NOTE x');
    expect(text(join(out, 'steps.log'))).toMatch(/^\d\d:\d\d:\d\d ---- b run 1, blocks \n\d\d:\d\d:\d\d NOTE x\n$/);
  });

  it('no latest link asked: none made', () => {
    open({ latestOut: undefined });
    expect(text(join(meta, 'batch-n.out'))).not.toContain('WARN');
    expect(terminal[0]).toBe(`batch-n run 1: blocks kf,E5 — writing ${join(meta, 'batch-n.out')}; tail -f it; the SUMMARY follows here at the end.\n`);
  });
});

describe('StepLog — print, note, step, error', () => {
  it('print goes to the .out only; note is timed and goes to the .out and steps.log; neither to the terminal', () => {
    const log = open();
    log.print('== kf live ==');
    log.note('NOTE kf: one');
    expect(text(join(meta, 'batch-n.out')).split('\n').slice(1)).toEqual(['== kf live ==', '09:44:26 NOTE kf: one', '']);
    expect(text(join(out, 'steps.log')).split('\n').slice(1)).toEqual(['09:44:26 NOTE kf: one', '']);
    expect(terminal).toHaveLength(1);
  });

  it('step pads its word as the batches do', () => {
    const log = open();
    log.step('OK', 'kf analyze');
    log.step('FAIL', 'E5 restore (exit 3) — see restore.log');
    expect(text(join(out, 'steps.log')).split('\n').slice(1, 3)).toEqual(['09:44:26 OK   kf analyze', '09:44:26 FAIL E5 restore (exit 3) — see restore.log']);
  });

  it('a line with a line break is refused: steps.log is read line by line', () => {
    const log = open();
    expect(() => log.note('one\ntwo')).toThrow(/a line holds a line break/);
    expect(() => log.print('one\rtwo')).toThrow(/a line holds a line break/);
  });

  it("errors(): this run's ERROR lines only, as written, for the SUMMARY (an earlier run's are not this run's)", () => {
    writeFileSync(join(out, 'steps.log'), '08:00:01 ERROR old\n');
    const log = open();
    log.error('E5: the lab is not installed');
    log.step('ERROR', 'kf: no record');
    log.note('OK   fine');
    log.note('E5 cleanup: ERROR — the lab not proven installed');
    log.note('NOTE an ERROR mid-line');
    expect(log.errors()).toEqual(['09:44:26 ERROR E5: the lab is not installed', '09:44:26 ERROR kf: no record']);
  });
});

describe('StepLog.summary — the SUMMARY to the .out, then to the terminal', () => {
  const s: Summary = { name: 'batch-n', runId: '1', checkout: 'OK checkout', labs: [], blocks: [], protectedLines: [], restore: { file: 'R', written: [] }, errors: [] };

  it('appends it to summary.txt when one is given (batch-12\'s meta/summary.txt): the end\'s and a later abort\'s both kept', () => {
    const log = open({ summaryFile: join(meta, 'summary.txt') });
    log.summary(['======== SUMMARY', 'one', '======== SUMMARY end (run 1)']);
    log.summary(['======== SUMMARY', 'two', '======== SUMMARY end (run 1, INTERRUPTED)']);
    expect(text(join(meta, 'summary.txt'))).toBe('======== SUMMARY\none\n======== SUMMARY end (run 1)\n======== SUMMARY\ntwo\n======== SUMMARY end (run 1, INTERRUPTED)\n');
  });

  it('writes summaryLines to both, the marker unchanged', () => {
    const log = open();
    log.summary(summaryLines(s));
    const expected = '======== SUMMARY\nOK checkout\nRESTORE: none — everything dirty was put back and verified\n======== SUMMARY end (run 1)\n';
    expect(text(join(meta, 'batch-n.out')).endsWith(expected)).toBe(true);
    expect(terminal.at(-1)).toBe(expected);
  });
});

describe('the terminal gone (the tee\'s EPIPE of batch-11) never stops the run\'s own output', () => {
  it('a terminal that throws is dropped: the .out and steps.log go on, the SUMMARY lands in the .out', () => {
    let calls = 0;
    const log = open({
      terminal: () => {
        calls += 1;
        throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
      },
    });
    log.note('NOTE after');
    log.summary(['======== SUMMARY', '======== SUMMARY end (run 1)']);
    expect(calls).toBe(1);
    const o = text(join(meta, 'batch-n.out'));
    expect(o).toContain('09:44:26 NOTE the terminal is gone (write EPIPE): this run writes only to');
    expect(o.endsWith('======== SUMMARY\n======== SUMMARY end (run 1)\n')).toBe(true);
    expect(text(join(out, 'steps.log'))).toContain('NOTE after');
  });
});

describe('a terminal that says it is gone is dropped too, the same as one that throws', () => {
  it("'gone' from the terminal: no further write, a NOTE, the files go on", () => {
    let calls = 0;
    const log = open({ terminal: () => ((calls += 1), 'gone') });
    log.summary(['======== SUMMARY', '======== SUMMARY end (run 1)']);
    expect(calls).toBe(1);
    expect(text(join(meta, 'batch-n.out'))).toContain('NOTE the terminal is gone (closed): this run writes only to');
  });
});

describe('terminalOf — the default terminal: a synchronous write to fd 1, safe when the reader is gone', () => {
  const failing = (code: string) => () => {
    throw Object.assign(new Error(`${code}: x`), { code });
  };

  it('writes the whole text, piece by piece when the fd takes less', () => {
    const got: string[] = [];
    const term = terminalOf(7, (fd, buf) => {
      expect(fd).toBe(7);
      got.push(buf.subarray(0, 3).toString());
      return Math.min(3, buf.length);
    });
    expect(term('abcdefgh')).toBeUndefined();
    expect(got.join('')).toBe('abcdefgh');
  });

  it('EPIPE (the reader closed its end) and EBADF (no fd 1) say gone, never throw', () => {
    expect(terminalOf(1, failing('EPIPE'))('x')).toBe('gone');
    expect(terminalOf(1, failing('EBADF'))('x')).toBe('gone');
  });

  it('EAGAIN (a non-blocking pipe, full) is waited out, and the text still lands whole', () => {
    let tries = 0;
    const got: string[] = [];
    const term = terminalOf(1, (_fd, buf) => {
      tries += 1;
      if (tries <= 2) throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' });
      got.push(buf.toString());
      return buf.length;
    });
    expect(term('abc')).toBeUndefined();
    expect(got).toEqual(['abc']);
  });

  it('a pipe that stays full past the bound is gone, not a hang: exactly `tries` writes, a wait of `waitMs` between each', () => {
    let calls = 0;
    const full = () => {
      calls += 1;
      throw Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' });
    };
    const started = Date.now();
    expect(terminalOf(1, full, { waitMs: 25, tries: 3 })('x')).toBe('gone');
    expect(calls).toBe(3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('any other failure is thrown, for StepLog to drop the terminal and say why', () => {
    expect(() => terminalOf(1, failing('EIO'))('x')).toThrow(/^EIO: x$/);
  });
});

describe('stepWordOf — the judged exit-1 rule (batch-11): live.ts exit 1 is DONE only with its `# Live golden:` header', () => {
  it('exit 0 is OK, judged or not', () => {
    expect(stepWordOf(0)).toBe('OK');
    expect(stepWordOf(0, { judged: true, log: '' })).toBe('OK');
  });

  it('exit 1 with the header in its log, when the step is judged: DONE (a MISMATCH its analyzer judges)', () => {
    expect(stepWordOf(1, { judged: true, log: `<!-- averi -->\n${LIVE_GOLDEN_HEADER} 3 cases, 2 ok\n` })).toBe('DONE');
    expect(LIVE_GOLDEN_HEADER).toBe('# Live golden:');
  });

  it('exit 1 without the header (live.ts died before judging), the header not at a line\'s start, or a step not judged: FAIL', () => {
    expect(stepWordOf(1, { judged: true, log: 'Error: no device\n' })).toBe('FAIL');
    expect(stepWordOf(1, { judged: true, log: 'x # Live golden: 3 cases\n' })).toBe('FAIL');
    expect(stepWordOf(1, { judged: false, log: '# Live golden: 3 cases\n' })).toBe('FAIL');
    expect(stepWordOf(1)).toBe('FAIL');
  });

  it('any other exit is FAIL, the header or not (142: the bound\'s alarm)', () => {
    for (const code of [2, 127, 130, 142]) expect(stepWordOf(code, { judged: true, log: '# Live golden: x\n' }), String(code)).toBe('FAIL');
  });
});
