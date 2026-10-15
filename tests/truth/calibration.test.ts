import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GoldenCheck } from '../../scripts/differential/golden.js';
import { captureOf, plan, STATUSES, verdictOf, type Calibration, type CalibrationEntry, type SideRun } from '../../scripts/truth/calibrate.js';

// The calibration table (scripts/truth/calibration.json) — data, pinned here: its shape, and that every bug note is in
// it, as a note calibrated (or why it cannot be) or as one excluded with its class. The run itself (calibrate.ts) needs
// git checkouts of old commits and is not a vitest test; its verdicts are pure and tested below.

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

describe('calibration.json', () => {
  it('every bug note of docs/bugs is in the table — calibrated, or excluded with its class — and none twice', () => {
    const listed = [...table.notes.map((e) => e.note), ...table.excluded.map((e) => e.note)];
    expect(listed.filter((n, i) => listed.indexOf(n) !== i)).toEqual([]);
    expect(readdirSync(`${ROOT}docs/bugs`).filter((f) => f.endsWith('.md') && !listed.includes(f))).toEqual([]);
  });

  it('each note: a unique number, a known status; its commits short SHAs', () => {
    const ns = table.notes.map((e) => e.n);
    expect(ns.filter((n, i) => ns.indexOf(n) !== i)).toEqual([]);
    const bad = table.notes.flatMap((e) => [
      ...(STATUSES.test(e.status) ? [] : [`${e.n}: status ${e.status}`]),
      ...[...(e.fix ?? []), e.before, e.after].filter((s): s is string => s !== undefined && !SHA.test(s)).map((s) => `${e.n}: ${s} is no short SHA`),
      ...(e.after !== undefined && !(e.fix ?? []).includes(e.after) ? [`${e.n}: after ${e.after} is none of its fix commits`] : []),
    ]);
    expect(bad).toEqual([]);
  });

  it('a note calibrated or open names golden rows of the committed truth; any other names none', () => {
    const bad = table.notes.flatMap((e) => {
      const runs = e.status === 'calibrate' || e.status === 'open';
      if (!runs) return e.checks === undefined ? [] : [`${e.n}: ${e.status} names rows`];
      if (e.checks === undefined || e.checks.length === 0) return [`${e.n}: no rows`];
      if (e.status === 'calibrate' && (e.before === undefined || e.after === undefined)) return [`${e.n}: no before/after`];
      return e.checks.flatMap((k) => {
        const [capture, target, verb, ...rest] = k.split(' ');
        if (rest.length > 0 || target === undefined || !VERBS.has(verb)) return [`${e.n}: ${k} is not "<run>/<file> <target> <verb>"`];
        return captures.has(capture) ? [] : [`${e.n}: ${capture} is no truth capture of ${table.corpus}`];
      });
    });
    expect(bad).toEqual([]);
  });

  it('a defect pattern compiles', () => {
    for (const e of table.notes) if (e.defect !== undefined) expect(() => new RegExp(e.defect!)).not.toThrow();
  });
});

describe('calibrate.ts — the verdicts', () => {
  const k = 'ios-iphone17-ios27/form-keyboard.wda.json vs tap';
  const entry = (more: Partial<CalibrationEntry> = {}): CalibrationEntry => ({ n: 'x', note: 'x.md', status: 'calibrate', fix: ['bbbbbbb'], before: 'aaaaaaa', after: 'bbbbbbb', checks: [k], ...more });
  const side = (mismatch: string | undefined): SideRun => {
    const c: GoldenCheck = { recording: 'ios-iphone17-ios27/form-keyboard.wda.json', target: 'vs', verb: 'tap', says: '', reply: '', ...(mismatch !== undefined && { mismatch }) };
    return { checks: new Map([[k, c]]) };
  };
  const none: SideRun = { checks: new Map() };

  it.each([
    ['red before, green after', entry(), side('Tapped'), side(undefined), 'CALIBRATED'],
    ['green before: a hole', entry(), side(undefined), side(undefined), 'DOES-NOT-FAIL'],
    ['red after', entry(), side('Tapped'), side('Tapped'), 'STILL-RED-AFTER'],
    ['red before with the defect, red after without it', entry({ defect: 'under the keyboard' }), side('not in the tree: touched down under the keyboard'), side('not in the tree: never appeared'), 'CALIBRATED-ON-DEFECT'],
    ['red before without the defect: it does not fail for the note', entry({ defect: 'under the keyboard' }), side('not in the tree: never appeared'), side(undefined), 'DOES-NOT-FAIL'],
    ['a row not asked', entry(), none, side(undefined), 'NOT-ASKED'],
    ['a side that did not load', entry(), { error: 'boom' }, side(undefined), 'SIDE-DOES-NOT-LOAD'],
  ] as const)('%s', (_, e, before, after, want) => {
    expect(verdictOf(e, before, after)).toBe(want);
  });

  it('an open note: red at HEAD, or not reproduced', () => {
    const open = entry({ status: 'open', before: undefined, after: undefined, fix: undefined });
    expect(verdictOf(open, side('Tapped'))).toBe('OPEN-RED');
    expect(verdictOf(open, side(undefined))).toBe('OPEN-NOT-REPRODUCED');
  });

  it("the plan: each side once, with the union of the captures its notes need; an open note's at HEAD", () => {
    const sides = plan([
      entry({ checks: ['r/a.json x tap'] }),
      entry({ before: 'bbbbbbb', after: 'ccccccc', fix: ['ccccccc'], checks: ['r/b.json y tap'] }),
      entry({ status: 'open', checks: ['r/c.json z tap'] }),
      entry({ status: 'needs-live', checks: undefined }),
    ]);
    expect(Object.fromEntries([...sides].map(([s, c]) => [s, [...c]]))).toEqual({
      aaaaaaa: ['r/a.json'],
      bbbbbbb: ['r/a.json', 'r/b.json'],
      ccccccc: ['r/b.json'],
      HEAD: ['r/c.json'],
    });
    expect(captureOf('r/a.json x tap')).toBe('r/a.json');
  });
});
