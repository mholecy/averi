import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Asked } from '../../../scripts/truth/batch/cases.js';
import {
  backstopLine,
  checkoutLine,
  configOf,
  DETAIL_CHARS,
  detailLines,
  detailsLines,
  deviceArgs,
  ERROR_LINES_SHOWN,
  errorLinesIn,
  logErrors,
  hasVerdictOf,
  judgedNothingLine,
  liveCalls,
  REJUDGE_SECS,
  linesIn,
  linesOf,
  labLine,
  liveArgs,
  liveStepText,
  MODULE_REPO,
  NOT_READ_CHECKOUT,
  NOT_RUN,
  needsLine,
  recordFiles,
  recordGap,
  recordOf,
  rejudgeArgs,
  stepsOfRun,
  WHERE_SHOWN,
} from '../../../scripts/truth/batch/runner-lines.js';
import { exitCodeOf, failsIn, type Summary } from '../../../scripts/truth/batch/words.js';

// scripts/truth/batch/runner-lines.ts: the runner's pure half — its config from argv and env, every line it writes of
// its own (the checkout, the lab lines, a block not run, the backstop), the non-live records' rule, the ERROR lines
// it collects, the details printout and live.ts's argv. Strings in, strings out. The titles name the fix and the batch
// that found it; tests/truth/batch/runner.test.ts runs them inside runBatch.

const env = (over: Record<string, string> = {}) => ({ ...over });

describe('configOf — the out folder and the device ids from argv, then env; nothing literal (t2-analysis §5)', () => {
  it('--out, --udid, --serial and --repo read; the env given kept for the knobs', () => {
    const e = env({ KF_RUNS: '2' });
    expect(configOf(['--out', '/o', '--udid', 'U-1', '--serial', 'emulator-5554', '--repo', '/r'], e)).toEqual({
      ok: true,
      config: { out: '/o', repo: '/r', udid: 'U-1', serial: 'emulator-5554', env: e },
    });
  });

  it('the env is the fallback (AVERI_BATCH_OUT, AVERI_LAB_UDID, AVERI_LAB_SERIAL); argv wins over it; an empty variable is unset', () => {
    expect(configOf([], env({ AVERI_BATCH_OUT: '/e', AVERI_LAB_UDID: 'U-e', AVERI_LAB_SERIAL: 'S-e' }), '/r')).toEqual({
      ok: true,
      config: { out: '/e', repo: '/r', udid: 'U-e', serial: 'S-e', env: { AVERI_BATCH_OUT: '/e', AVERI_LAB_UDID: 'U-e', AVERI_LAB_SERIAL: 'S-e' } },
    });
    const r = configOf(['--out', '/a', '--serial', 'S-a'], env({ AVERI_BATCH_OUT: '/e', AVERI_LAB_SERIAL: 'S-e', AVERI_LAB_UDID: '' }), '/r');
    expect(r.ok && r.config).toEqual({ out: '/a', repo: '/r', serial: 'S-a', env: expect.anything() });
    expect(r.ok && 'udid' in r.config).toBe(false);
  });

  it('no device id given: none in the config, not an empty one (a need for it fails, S6b)', () => {
    const r = configOf(['--out', '/o'], env(), '/r');
    expect(r.ok && Object.keys(r.config).sort()).toEqual(['env', 'out', 'repo']);
  });

  it('the repo defaults to the checkout this module lives in (live-cases.ts\'s ROOT)', () => {
    const r = configOf(['--out', '/o'], env());
    expect(r.ok && r.config.repo).toBe(MODULE_REPO);
    expect(MODULE_REPO).toBe(join(import.meta.dirname, '..', '..', '..'));
  });

  it('no out folder: refused, exit 2, nothing done (analysis §5: "a missing out exits 2")', () => {
    expect(configOf([], env(), '/r')).toEqual({ ok: false, errors: ['ERROR no out folder: pass --out <dir> or set AVERI_BATCH_OUT — nothing was done'] });
    expect(configOf([], env({ AVERI_BATCH_OUT: '' }), '/r').ok).toBe(false);
  });

  it('a relative out or repo refused: the RESTORE hand lines name absolute paths', () => {
    expect(configOf(['--out', 'o', '--repo', 'r'], env())).toEqual({
      ok: false,
      errors: ['ERROR the out folder o is not an absolute path — nothing was done', 'ERROR the repo r is not an absolute path — nothing was done'],
    });
    expect(configOf([], env({ AVERI_BATCH_OUT: 'rel' }), '/r')).toEqual({ ok: false, errors: ['ERROR the out folder rel is not an absolute path — nothing was done'] });
  });

  it('an unknown option, a flag without its value, a flag twice: each refused, every error at once, in order', () => {
    expect(configOf(['--outt', '/o', '--udid', '--serial', 'S', '--serial', 'T', '--out'], env(), '/r')).toEqual({
      ok: false,
      errors: [
        'ERROR --outt is no option of a batch (--out, --repo, --udid, --serial) — nothing was done',
        'ERROR /o is no option of a batch (--out, --repo, --udid, --serial) — nothing was done',
        'ERROR --udid needs a value — nothing was done',
        'ERROR --serial is given twice — nothing was done',
        'ERROR --out needs a value — nothing was done',
        'ERROR no out folder: pass --out <dir> or set AVERI_BATCH_OUT — nothing was done',
      ],
    });
  });

  it('an option named with a line break is quoted, never a broken refusal line', () => {
    const r = configOf(['--o\nut'], env(), '/r');
    expect(!r.ok && r.errors[0]).toBe('ERROR "--o\\nut" is no option of a batch (--out, --repo, --udid, --serial) — nothing was done');
  });
});

describe('checkoutLine — the SUMMARY\'s first line (batch-11.sh:254–256)', () => {
  it('shown: OK, main\'s HEAD by its short sha, clean', () => {
    expect(checkoutLine({ ok: true, head: 'f7ea6e07'.padEnd(40, '0') })).toBe("OK checkout: main's HEAD f7ea6e07, clean");
  });

  it('not shown: ERROR with S3\'s why, and what it means — every block INCONCLUSIVE, the SUMMARY still written (S3: never refuse silently)', () => {
    expect(checkoutLine({ ok: false, why: "the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun" })).toBe(
      "ERROR checkout: the checkout's HEAD (aaaaaaaa) is not main's (bbbbbbbb) — git switch main, then rerun — every block INCONCLUSIVE, none run",
    );
  });

  it('the abort\'s checkout line before the checkout was read says so', () => {
    expect(NOT_READ_CHECKOUT).toBe('NOTE checkout: not read before the interrupt');
  });
});

describe('labLine and needsLine — a need checked once, its lab line in the SUMMARY; a block whose need failed not run (spec S6a)', () => {
  it('LAB <need>: OK — how; ERROR — why', () => {
    expect(labLine('android', { ok: true, how: 'emulator-5554, averi_lab' })).toBe('LAB android: OK — emulator-5554, averi_lab');
    expect(labLine('ios', { ok: false, why: 'no lab simulator booted' })).toBe('LAB ios: ERROR — no lab simulator booted');
  });

  it('a why or how holding a line break keeps its first line: the SUMMARY line never breaks, and making it never throws', () => {
    expect(labLine('ios', { ok: false, why: 'simctl failed\nstack…' })).toBe('LAB ios: ERROR — simctl failed');
    expect(labLine('ios', { ok: true, how: 'booted\r\nmore' })).toBe('LAB ios: OK — booted');
  });

  it('INCONCLUSIVE naming each failed need and its why, `; ` between, in the block\'s order (batch-11\'s "noandroid", "b2-noios")', () => {
    expect(needsLine('kf live verdict', [{ need: 'android', why: 'adb unreachable' }])).toBe('kf live verdict: INCONCLUSIVE — android: adb unreachable');
    expect(needsLine('B2 verdict', [{ need: 'ios', why: 'a' }, { need: 'android', why: 'b\nc' }])).toBe('B2 verdict: INCONCLUSIVE — ios: a; android: b');
  });

  it('INCONCLUSIVE never fails the run (words.ts exit rule)', () => {
    expect(failsIn(needsLine('kf live verdict', [{ need: 'android', why: 'FAIL to boot' }]))).toBe(false);
  });
});

describe('backstopLine — a wanted block with no verdict line says why (batch-10/11, batch-11.sh:689–696)', () => {
  it('nothing asked: batch-11\'s words, "not run (see the ERROR lines)"', () => {
    expect(backstopLine('D62 verdict', [])).toBe('D62 verdict: INCONCLUSIVE — not run (see the ERROR lines)');
    expect(NOT_RUN).toBe('not run (see the ERROR lines)');
  });

  it('runs asked, some incomplete: S3\'s incompleteLine, every incomplete run and why', () => {
    expect(backstopLine('kf live verdict', [{ name: 'android-kf-1', result: { ok: false, why: 'no record (android-kf-1.json)' } }, { name: 'e5-c', result: { ok: true } }])).toBe(
      'kf live verdict: INCONCLUSIVE — 1 of 2 run(s) incomplete: android-kf-1 — no record (android-kf-1.json)',
    );
  });

  it('every run complete, yet no verdict line: the analyzer wrote none — said, never a silent gap', () => {
    expect(backstopLine('E5 verdict', [{ name: 'a', result: { ok: true } }, { name: 'c', result: { ok: true } }])).toBe(
      'E5 verdict: INCONCLUSIVE — its 2 run(s) are complete, but no verdict line was written (see the ERROR lines)',
    );
  });
});

describe('hasVerdictOf — the backstop\'s test: a line of the block\'s own label (batch-11\'s `grep -q \'^D62 verdict:\'`)', () => {
  it('a line starting `<label>:` counts, whatever follows (an analyzer\'s `FAIL 2/3 dropped` too)', () => {
    expect(hasVerdictOf(['D62 verdict: PASS'], 'D62 verdict')).toBe(true);
    expect(hasVerdictOf(['lv-d62 verdict: FAIL 2/3 dropped'], 'lv-d62 verdict')).toBe(true);
  });

  it('another label, or the label run on, does not: a cleanup or compare line is no verdict of the block', () => {
    expect(hasVerdictOf(['D43 WDA-window compare: OK — …', 'D43 live verdictX: PASS', 'x D43 live verdict: PASS'], 'D43 live verdict')).toBe(false);
    expect(hasVerdictOf([], 'D43 live verdict')).toBe(false);
  });
});

describe('recordOf and recordGap — a non-live block\'s own record, apart from the live runs\' .cases (S3 review: batch-12\'s E5/T6 `{"runs":N}`)', () => {
  it('a record is `{kind: "runs", runs: <whole number>}`', () => {
    expect(recordOf({ kind: 'runs', runs: 3 })).toEqual({ kind: 'runs', runs: 3 });
    expect(recordOf({ kind: 'runs', runs: 0 })).toEqual({ kind: 'runs', runs: 0 });
    for (const bad of [null, undefined, 3, 'runs', [], { runs: 3 }, { kind: 'run', runs: 3 }, { kind: 'runs', runs: -1 }, { kind: 'runs', runs: 1.5 }, { kind: 'runs', runs: '3' }, { kind: 'runs' }]) {
      expect(recordOf(bad)).toBeUndefined();
    }
  });

  it('its two files: `<name>.asked.json` (written first) and `<name>.done.json`, never the live run\'s `.cases` or `.json`', () => {
    expect(recordFiles('/d', 'e5-c')).toEqual({ asked: join('/d', 'e5-c.asked.json'), done: join('/d', 'e5-c.done.json') });
  });

  it('complete only when what was recorded matches what was asked', () => {
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"kind":"runs","runs":3}')).toBeUndefined();
  });

  it('nothing recorded, fewer or more runs recorded: each said with both counts', () => {
    expect(recordGap('c', '{"kind":"runs","runs":3}', undefined)).toBe('asked 3 run(s), nothing recorded (no c.done.json)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"kind":"runs","runs":2}')).toBe('asked 3 run(s), recorded 2');
    expect(recordGap('c', '{"kind":"runs","runs":1}', '{"kind":"runs","runs":2}')).toBe('asked 1 run(s), recorded 2');
  });

  it('a file that is no record (no JSON, another shape, unreadable) is a gap naming it, never a pass', () => {
    expect(recordGap('c', undefined, '{"kind":"runs","runs":3}')).toBe('c.asked.json is unreadable: what it was asked is unknown');
    expect(recordGap('c', '{', '{"kind":"runs","runs":3}')).toBe('c.asked.json is no record of runs (kind "runs", runs: a whole number)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', '{"runs":3}')).toBe('c.done.json is no record of runs (kind "runs", runs: a whole number)');
    expect(recordGap('c', '{"kind":"runs","runs":3}', 'x')).toBe('c.done.json is no record of runs (kind "runs", runs: a whole number)');
  });
});

describe('errorLinesIn — the ERROR lines a block\'s log or analyze.txt holds (batch-12.sh:668, `grep -h \'^ERROR\'`)', () => {
  it('every line starting with ERROR, in order, CR dropped; an ERROR inside a line is not one (S1: a step line\'s word)', () => {
    expect(errorLinesIn('ok\nERROR a\r\n  ERROR not at the start\nE5 cleanup: ERROR — x\nERROR b\nERRORS c\n')).toEqual(['ERROR a', 'ERROR b', 'ERRORS c']);
    expect(errorLinesIn('')).toEqual([]);
  });

  it('a lone CR ends a line too (a progress line a terminal overwrites): no ERROR line holds a break, so the SUMMARY never refuses it', () => {
    expect(errorLinesIn('50%\rERROR a\r60%\rERROR b\r\nERROR c\rok')).toEqual(['ERROR a', 'ERROR b', 'ERROR c']);
  });
});

describe('logErrors — this run\'s ERROR lines from its logs, counted across them all, bounded (T2 S6a review rounds 1–3)', () => {
  const log = (name: string, text: string | undefined, why?: string) => ({ name, path: `/o/${name}`, text, ...(why === undefined ? {} : { why }) });
  const times = (n: number, line: string) => Array.from({ length: n }, () => line).join('\n');

  it('one line per distinct ERROR, run-wide, in first-seen order; repeated: its total and where (the reviewer\'s 50 in p, 1 in q, 2 in r); once: bare', () => {
    expect(logErrors([log('kf/p.log', `${times(50, 'ERROR same')}\nERROR only here`), log('kf/q.log', 'ERROR same'), log('E5/r.log', times(2, 'ERROR same'))])).toEqual([
      'ERROR same (×53, in kf/p.log, kf/q.log, E5/r.log)',
      'ERROR only here',
    ]);
    expect(logErrors([log('a.log', times(2, 'ERROR x'))])).toEqual(['ERROR x (×2, in a.log)']);
  });

  it('more than WHERE_SHOWN files: the first 3, then how many more', () => {
    expect(WHERE_SHOWN).toBe(3);
    expect(logErrors(['a', 'b', 'c', 'd', 'e'].map((n) => log(`${n}.log`, 'ERROR x')))).toEqual(['ERROR x (×5, in a.log, b.log, c.log, +2 more)']);
  });

  it('each cut so the whole is at most DETAIL_CHARS, `…` the last of what is cut; at most ERROR_LINES_SHOWN distinct, then how many more and where', () => {
    expect(ERROR_LINES_SHOWN).toBe(20);
    const long = `ERROR ${'x'.repeat(800)}`;
    expect(logErrors([log('a.log', long)])).toEqual([`${[...long].slice(0, DETAIL_CHARS - 1).join('')}…`]);
    expect(logErrors([log('a.log', `ERROR ${'y'.repeat(DETAIL_CHARS - 6)}`)])).toEqual([`ERROR ${'y'.repeat(DETAIL_CHARS - 6)}`]);
    const [cut] = logErrors([log('a.log', times(2, long))]);
    expect([...cut]).toHaveLength(DETAIL_CHARS);
    expect(cut.endsWith('… (×2, in a.log)')).toBe(true);
    const got = logErrors([log('a.log', Array.from({ length: 21 }, (_, i) => `ERROR e${i}`).join('\n')), log('b.log', 'ERROR e0\nERROR f1\nERROR f2'), log('c.log', 'ERROR e0')]);
    expect(got).toHaveLength(21);
    expect(got[0]).toBe('ERROR e0 (×3, in a.log, b.log, c.log)');
    expect(got[19]).toBe('ERROR e19');
    expect(got[20]).toBe('… 3 more distinct ERROR lines (in a.log, b.log)');
    expect(logErrors([log('c.log', Array.from({ length: 20 }, (_, i) => `ERROR z${i}`).join('\n'))])).toHaveLength(20);
  });

  it('a log that could not be read: a NOTE naming its path, with what is known of why, never silently skipped', () => {
    expect(logErrors([log('kf/stuck.log', undefined), log('kf/full.log', undefined, 'a folder'), log('kf/a.log', 'ok\n')])).toEqual([
      'NOTE /o/kf/stuck.log not read: unreadable',
      'NOTE /o/kf/full.log not read: unreadable: a folder',
    ]);
  });
});

describe('liveCalls — live.ts\'s and its rejudge\'s calls: each bounded, from the checkout, logged beside the run (batch-11.sh:473–481)', () => {
  it('live.ts by the secs given, the rejudge by rejudgeSecs, else REJUDGE_SECS (120 s: batch-11 ran it unbounded)', () => {
    const files = { log: '/d/a.log', summary: '/d/a.rejudge.txt' };
    expect(REJUDGE_SECS).toBe(120);
    expect(liveCalls({ repo: '/r', secs: 60, files })).toEqual({ live: { secs: 60, cwd: '/r', log: '/d/a.log' }, rejudge: { secs: 120, cwd: '/r', log: '/d/a.rejudge.txt' } });
    expect(liveCalls({ repo: '/r', secs: 60, rejudgeSecs: 30, files }).rejudge.secs).toBe(30);
  });
});

describe('judgedNothingLine — a block the abort judged whose judge wrote no verdict of its label (T2 S6a review round 1)', () => {
  it('INCONCLUSIVE, saying so: no wanted block is ever missing from the abort SUMMARY', () => {
    expect(judgedNothingLine('T6 verdict')).toBe('T6 verdict: INCONCLUSIVE — interrupted: its judge wrote no verdict');
  });
});

describe('linesOf and linesIn — what a probe, a judge or an analyzer hands in, as lines (T2 S6a: the SUMMARY refuses a break)', () => {
  it('split at CR LF, LF and a lone CR, in order', () => {
    expect(linesOf('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('linesIn: each text\'s lines, empty ones dropped', () => {
    expect(linesIn(['kf live verdict: PASS\r\n', '', 'x\n\ny'])).toEqual(['kf live verdict: PASS', 'x', 'y']);
  });
});

describe('stepsOfRun — this run\'s part of steps.log (batch-11.sh:700, `sed -n "/ batch-11 run $RUN_ID,/,$p"`)', () => {
  const steps = ['09:00:00 ---- batch-n run 1, blocks kf', '09:00:01 OK   old', '09:44:26 ---- batch-n run 2, blocks kf,E5', '09:44:27 OK   kf live x', '09:44:28 ERROR y', ''].join('\n');
  it('from this run\'s header to the end; an earlier run\'s steps left out', () => {
    expect(stepsOfRun(steps, 'batch-n', '2')).toEqual(['09:44:26 ---- batch-n run 2, blocks kf,E5', '09:44:27 OK   kf live x', '09:44:28 ERROR y']);
  });

  it('no header of this run (another batch\'s, a run id that is a prefix): none', () => {
    expect(stepsOfRun(steps, 'batch-m', '2')).toEqual([]);
    expect(stepsOfRun('09:44:26 ---- batch-n run 22, blocks kf\nx', 'batch-n', '2')).toEqual([]);
  });
});

describe('detailLines and detailsLines — the details printout before the SUMMARY (batch-11.sh:698–716)', () => {
  it('a file\'s lines, those starting `==` left out (step banners), empty ones too, each indented and cut at 700 code points', () => {
    expect(DETAIL_CHARS).toBe(700);
    const long = `E5 ${'x'.repeat(800)}`;
    expect(detailLines({ file: 'a.log' }, `== E5 a ==\nE5 a verdict: PASS\n\n${long}\n==> a banner\nE5 total ==\r\nE5 x\rE5 y`)).toEqual(['   E5 a verdict: PASS', `   ${long.slice(0, 700)}`, '   E5 total ==', '   E5 x', '   E5 y']);
  });

  it('`match` keeps the lines it matches only (a g flag holds no state: `search`); `cut` sets the length', () => {
    const match = /^D55/g;
    expect(detailLines({ file: 'p.log', match, cut: 5 }, 'D55 one\nx D55\nD55b two\nD55 three')).toEqual(['   D55 o', '   D55b ', '   D55 t']);
  });

  it('a cut never splits a surrogate pair', () => {
    expect(detailLines({ file: 'a', cut: 2 }, 'a😀b')).toEqual(['   a😀']);
  });

  it('the printout: the header, the checkout, this run\'s steps, each block\'s folder and details, the DONE line', () => {
    expect(
      detailsLines({
        checkout: "OK checkout: main's HEAD f7ea6e07, clean",
        runId: '2',
        stepsFile: '/o/steps.log',
        steps: ['09:44:26 ---- batch-n run 2, blocks kf'],
        blocks: [
          { id: 'kf', dir: '/o/kf/run-2', lines: ['   kf live verdict: PASS'] },
          { id: 'E5', dir: '/o/E5/run-2', lines: [] },
        ],
        out: '/o',
      }),
    ).toEqual([
      '',
      '================================ details ================================',
      "OK checkout: main's HEAD f7ea6e07, clean",
      '-- steps of this run (2; the whole log: /o/steps.log)',
      '09:44:26 ---- batch-n run 2, blocks kf',
      '-- kf (/o/kf/run-2/)',
      '   kf live verdict: PASS',
      '-- E5 (/o/E5/run-2/)',
      '== DONE — all outputs in /o/<block>/run-2 ==',
    ]);
  });
});

describe('deviceArgs, liveArgs and rejudgeArgs — live_run\'s argv (batch-11.sh:473–481): live.ts with its record, then its rejudge', () => {
  const kf: Asked = { platform: 'android', app: 'native', sources: ['uiautomator'], cases: ['kf1', 'kf2', 'kf3'] };
  const p7w: Asked = { platform: 'ios', app: 'native', sources: ['wda', 'idb'], cases: ['p7w'], groups: ['forms', 'ensure'] };

  it('android: --serial alone (live.ts runs uiautomator); ios: --udid and --sources', () => {
    expect(deviceArgs(kf, { serial: 'emulator-5554', udid: 'U' })).toEqual({ args: ['--serial', 'emulator-5554'] });
    expect(deviceArgs(p7w, { serial: 'emulator-5554', udid: 'U' })).toEqual({ args: ['--udid', 'U', '--sources', 'wda,idb'] });
  });

  it('the device id not given: why, and nothing to run (never a run against a default device)', () => {
    expect(deviceArgs(kf, { udid: 'U' })).toEqual({ why: 'no lab emulator serial given (--serial or AVERI_LAB_SERIAL)' });
    expect(deviceArgs(p7w, { serial: 'S' })).toEqual({ why: 'no lab simulator udid given (--udid or AVERI_LAB_UDID)' });
  });

  it('live.ts from the checkout under test, its groups (forms by default), its cases, its record', () => {
    expect(liveArgs({ repo: '/r', asked: kf, device: ['--serial', 'S'], record: '/d/k.json' })).toEqual([
      '--import', 'tsx', join('/r', 'scripts/truth/live.ts'), '--serial', 'S', '--groups', 'forms', '--cases', 'kf1,kf2,kf3', '--record', '/d/k.json',
    ]);
    expect(liveArgs({ repo: '/r', asked: { ...p7w, app: 'react-native', cases: [] }, device: ['--udid', 'U'], record: '/d/p.json' })).toEqual([
      '--import', 'tsx', join('/r', 'scripts/truth/live.ts'), '--udid', 'U', '--app', 'react-native', '--groups', 'forms,ensure', '--record', '/d/p.json',
    ]);
  });

  it('the rejudge: main\'s judges over the record, the same groups', () => {
    expect(rejudgeArgs({ repo: '/r', asked: kf, record: '/d/k.json' })).toEqual(['--import', 'tsx', join('/r', 'scripts/truth/live.ts'), '--rejudge', '/d/k.json', '--groups', 'forms']);
    expect(rejudgeArgs({ repo: '/r', asked: p7w, record: '/d/p.json' }).slice(-2)).toEqual(['--groups', 'forms,ensure']);
  });

  it('the step\'s text: OK bare; DONE and FAIL with why and the log to read (batch-11.sh:234–237)', () => {
    expect(liveStepText('kf live a', { word: 'OK', why: 'exit 0' }, '/d/a.log')).toBe('kf live a');
    expect(liveStepText('kf live a', { word: 'DONE', why: 'exit 1: judged' }, '/d/a.log')).toBe('kf live a (exit 1: judged) — see /d/a.log');
    expect(liveStepText('kf live a', { word: 'FAIL', why: 'exit 2' }, '/d/a.log')).toBe('kf live a (exit 2) — see /d/a.log');
  });
});

describe('the lines meet words.ts\'s exit rule', () => {
  it('a SUMMARY of a failed checkout, failed needs and backstops alone exits 0: INCONCLUSIVE and ERROR never fail the run', () => {
    const s: Summary = {
      name: 'b',
      runId: '1',
      checkout: checkoutLine({ ok: false, why: 'x' }),
      labs: [labLine('ios', { ok: false, why: 'y' })],
      blocks: [{ block: 'kf', lines: [needsLine('kf live verdict', [{ need: 'android', why: 'z' }]), backstopLine('D62 verdict', [])] }],
      protectedLines: [],
      restore: { file: 'R', written: [] },
      errors: [],
    };
    expect(exitCodeOf(s)).toBe(0);
  });
});
