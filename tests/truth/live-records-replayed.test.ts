import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every committed live record is replayed: tests/truth/live-rejudge.test.ts runs a rejudge on it — passes it to
 * `rejudgeInProcess` or `rejudgeCli` by name or by a template (`${n}` a run number), or lists it as a row of an
 * `it.each` table whose callback passes its first parameter to one of them (`replayed`, below) — or it is exempt
 * below, with the reason it cannot be judged by `live.ts --rejudge`. A record a test only reads is not replayed.
 * Without this, a row dropped from live-rejudge.test.ts left a record no test rejudges, and nothing failed (T3's
 * review rounds 1 and 2).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECORDS = `${ROOT}docs/truth/live-records`;

/** The records no `--rejudge` can judge, each with its reason. */
const EXEMPT: Readonly<Record<string, string>> = {
  'android-hint-everywhere-9fa59ae-asserts.json': "round 7's A3 scratch driver's assert replies: no live.ts case id in it",
  'android-hint-everywhere-e726c77-asserts.json': "round 7's A3 scratch driver's assert replies: no live.ts case id in it",
  'android-k7-fully-eyes-direct.jsonl': 'averi driven directly over MCP (k7 with `fully: true`), no run record',
  'ios-idb-held-no-spinner-describe-all-d30-1.json': "batch-3's raw idb describe-all of the held-no-spinner's spinner, no run record",
  'ios-idb-held-no-spinner-describe-all-nested-d30-1.json': "batch-3's raw idb describe-all (nested) of the held-no-spinner's spinner, no run record",
  'ios-wda-kbscroll-r23-1.json': "round 7's A1 keyboard scroll probe from a scratch copy of the harness: its ids (ks-*) are no live.ts case",
  'ios-wda-kbscroll-r23-2.json': "round 7's A1 keyboard scroll probe from a scratch copy of the harness: its ids (ks-*) are no live.ts case",
  'ios-wda-kbscroll-r23-ios-stop-1.json': "round 7's A1 keyboard scroll probe from a scratch copy of the harness: its ids (ks-*) are no live.ts case",
  'ios-wda-kbscroll-r23-ios-stop-2.json': "round 7's A1 keyboard scroll probe from a scratch copy of the harness: its ids (ks-*) are no live.ts case",
};

/** The index just past the string, template or line comment that starts at `i`, or `i` when none does. */
function skipLiteral(src: string, i: number): number {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') return src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
  if (c !== "'" && c !== '"' && c !== '`') return i;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === c) return j + 1;
  }
  return src.length;
}

/** The index of the bracket closing the one at `open` (`[` or `{`), strings, templates and line comments skipped. */
function closing(src: string, open: number): number {
  const [o, c] = src[open] === '[' ? ['[', ']'] : ['{', '}'];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const past = skipLiteral(src, i);
    if (past !== i) {
      i = past - 1;
      continue;
    }
    if (src[i] === o) depth++;
    else if (src[i] === c && --depth === 0) return i;
  }
  return src.length;
}

/** `${…}` placeholders as digits alone: a template names the runs `-1`, `-2`, …, never `-group`. */
const templatePattern = (template: string) => new RegExp(`^${template.split(/\$\{[^}]*\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\d+')}$`);

const REJUDGE = String.raw`rejudge(?:InProcess|Cli)\(\s*`;

/**
 * The records a rejudge runs on in `source` (live-rejudge.test.ts): those passed to `rejudgeInProcess` or `rejudgeCli`
 * by name or by a template, and the rows (their first element) of an `it.each` table whose callback passes its first
 * parameter to one of them (a row `['<record>', …]` or a bare `'<record>'`). A record a test only reads, or a row of a
 * table that feeds no rejudge, is not one.
 */
function replayed(source: string): { names: Set<string>; templates: RegExp[] } {
  const names = new Set([...source.matchAll(new RegExp(`${REJUDGE}'([\\w.-]+\\.jsonl?)'`, 'g'))].map((m) => m[1]));
  const templates = [...source.matchAll(new RegExp(`${REJUDGE}\`(?:[^\`]*/)?([\\w.$-]*\\$\\{[^\`]*\\.jsonl?)\``, 'g'))].map((m) => templatePattern(m[1]));
  for (const each of source.matchAll(/it\.each\(\s*\[/g)) {
    const open = each.index + each[0].length - 1;
    const close = closing(source, open);
    const arrow = /\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*=>\s*\{/.exec(source.slice(close));
    if (arrow === null) continue;
    const bodyOpen = close + arrow.index + arrow[0].length - 1;
    const body = source.slice(bodyOpen, closing(source, bodyOpen) + 1);
    if (!new RegExp(`${REJUDGE}${arrow[1]}\\b`).test(body)) continue;
    const table = source.slice(open, close + 1);
    // A row is `['<record>', …]` or the bare `'<record>'`: every record named in the table is one of its rows.
    for (const m of table.matchAll(/'([\w.-]+\.jsonl?)'/g)) names.add(m[1]);
    for (const m of table.matchAll(/`(?:[^`]*\/)?([\w.$-]*\$\{[^`]*\.jsonl?)`/g)) templates.push(templatePattern(m[1]));
  }
  return { names, templates };
}

const records = readdirSync(RECORDS).filter((f) => /\.jsonl?$/.test(f));
const isNamed = (source: string, record: string) => {
  const { names, templates } = replayed(source);
  return names.has(record) || templates.some((t) => t.test(record));
};

describe('every committed live record is replayed by live-rejudge.test.ts, or exempt with a reason', () => {
  const source = readFileSync(`${ROOT}tests/truth/live-rejudge.test.ts`, 'utf8');

  it('each record in docs/truth/live-records is named by a rejudge row or template, or exempt', () => {
    expect(records.filter((r) => !isNamed(source, r) && EXEMPT[r] === undefined)).toEqual([]);
  });

  it('each exempt record exists, is named by no row, and has a reason', () => {
    for (const [record, why] of Object.entries(EXEMPT)) {
      expect(records, record).toContain(record);
      expect(isNamed(source, record), record).toBe(false);
      expect(why.length, record).toBeGreaterThan(10);
    }
  });

  it('the rule bites: a row dropped from the source leaves its record unnamed; a template names each of its runs', () => {
    const drop = (row: string) => {
      expect(source.split(row).length - 1, row).toBe(1);
      return source.replace(row, '');
    };
    for (const [record, row] of [
      ['ios-wda-forms-l7-1.json', "    ['ios-wda-forms-l7-1.json', 'forms', { cases: 18, ok: 17, loud: 0, mismatches: 1 }],\n"],
      ['android-vis-r1023-lv2-3.json', "    ['android-vis-r1023-lv2-3.json', 'visibility', { cases: 7, ok: 7, loud: 0, mismatches: 0 }],\n"],
      ['android-vis-r1023-lv2-group.json', "    ['android-vis-r1023-lv2-group.json', { cases: 140, ok: 130, loud: 6, mismatches: 4 }],\n"],
      ['cal7-d928789-1.json', "    ['cal7-d928789-1.json', 'dismissal', { cases: 8, ok: 3, loud: 5, mismatches: 0 }],\n"],
    ] as const) {
      expect(isNamed(source, record), record).toBe(true);
      expect(isNamed(drop(row), record), record).toBe(false);
    }
  });

  it('only a rejudge names a record: a template or a row that feeds no rejudge does not; a placeholder is digits alone', () => {
    // The flush probe's field check reads android-vis-r1023-lv2-${n}.json without rejudging it.
    expect(isNamed('it.each([1, 2])(\'x\', (n) => { readFileSync(`../../docs/truth/live-records/android-vis-r1023-lv2-${n}.json`); });', 'android-vis-r1023-lv2-1.json')).toBe(false);
    expect(isNamed("it.each([['a-1.json', 1]] as const)('%s', (record) => { readLiveRecord(record); });", 'a-1.json')).toBe(false);
    expect(isNamed("it.each([['a-1.json', 1]] as const)('%s', async (record, want) => { await rejudgeInProcess(record, 'forms'); });", 'a-1.json')).toBe(true);
    expect(isNamed("it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });", 'a-1.json')).toBe(true);
    expect(isNamed("it('x', async () => { await rejudgeCli('a-1.json', 'forms'); });", 'a-1.json')).toBe(true);
    const template = 'it.each([1, 2])(\'x\', async (n) => { await rejudgeInProcess(`lv2-${n}.json`, \'visibility\'); });';
    expect(isNamed(template, 'lv2-7.json')).toBe(true);
    expect(isNamed(template, 'lv2-group.json')).toBe(false);
  });
});
