import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every committed live record is replayed: tests/truth/live-rejudge.test.ts names it — a quoted row (`'<record>'`), or
 * a template (`` `…/<prefix>-${n}.json` ``) — or it is exempt below, with the reason it cannot be judged by
 * `live.ts --rejudge`. Without this, a row dropped from live-rejudge.test.ts left a record no test reads, and nothing
 * failed (T3's review round 1, MINOR-1).
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

/** The record names live-rejudge.test.ts quotes, and its templates as patterns. */
function named(source: string): { names: Set<string>; templates: RegExp[] } {
  const names = new Set([...source.matchAll(/'([\w.-]+\.jsonl?)'/g)].map((m) => m[1]));
  const templates = [...source.matchAll(/`[^`]*\/([\w.$-]*\$\{[^`]*\.jsonl?)`/g)].map(
    (m) => new RegExp(`^${m[1].split(/\$\{[^}]*\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\w.-]+')}$`),
  );
  return { names, templates };
}

const records = readdirSync(RECORDS).filter((f) => /\.jsonl?$/.test(f));
const isNamed = (source: string, record: string) => {
  const { names, templates } = named(source);
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
    expect(isNamed(source, 'ios-wda-forms-l7-1.json')).toBe(true);
    expect(isNamed(source.replace("'ios-wda-forms-l7-1.json'", "''"), 'ios-wda-forms-l7-1.json')).toBe(false);
    expect(isNamed('readFileSync(`../../docs/truth/live-records/android-vis-r1023-lv2-${n}.json`)', 'android-vis-r1023-lv2-7.json')).toBe(true);
    expect(isNamed('readFileSync(`../../docs/truth/live-records/android-vis-r1023-lv2-${n}.json`)', 'android-vis-r1023-lv1-7.json')).toBe(false);
  });
});
