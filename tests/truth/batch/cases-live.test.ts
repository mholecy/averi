import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeness, incompleteLine, runFiles, runsIn, selectorOf, writeCases, type Asked } from '../../../scripts/truth/batch/cases.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { liveTableOf } from '../../../scripts/truth/batch/live-table.js';
import { casesOnMain, cellsOnMain } from '../../../scripts/truth/batch/preconditions.js';
import { summarize, THIS_CHECKOUT } from '../../../scripts/truth/live-cases.js';

// casesOnMain, cellsOnMain and completeness over this checkout's own live-cases.ts and catalog, read the way a batch
// reads main's (live-table.ts#liveTableOf: a dynamic import of the checkout's file, never a grep). Kept apart from
// cases.test.ts and preconditions.test.ts: the mutation run's sandbox holds scripts/truth/batch/ alone, not
// live-cases.ts and what it imports. No device, no network: temp run folders with fixture logs.

const ROOT = join(import.meta.dirname, '..', '..', '..');
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-cases-live-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('casesOnMain over the real live-cases table (batch-11.sh:235–242: kf1–kf3, p7w/p7/b1d/b7 — grepped there)', () => {
  it('kf1–kf3 on Android, p7w, p7, b1d and b7 on iOS: ok (batch-11\'s prechecks)', async () => {
    const table = liveTableOf(ROOT);
    expect(await casesOnMain({ ids: ['kf1', 'kf2', 'kf3'], platform: 'android', table })).toEqual({ ok: true });
    expect(await casesOnMain({ ids: ['p7w', 'p7', 'b1d', 'b7'], platform: 'ios', table })).toEqual({ ok: true });
  });

  it('an id the table lacks, and one it holds for the other platform only (p7w is iOS\'s): both named — a grep would have passed p7w (T2 S3 decision)', async () => {
    const table = liveTableOf(ROOT);
    expect(await casesOnMain({ ids: ['kf1', 'no-such-case', 'p7w'], platform: 'android', table })).toEqual({ ok: false, why: "live case(s) no-such-case, p7w not on main's live-cases.ts (android, native app, groups forms)" });
  });
});

describe('cellsOnMain over the real catalog (batch-11.sh:233, batch-12.sh:343)', () => {
  it('batch-11\'s cells are main\'s; a made-up one is named (batch-11\'s and batch-12\'s cells_have)', async () => {
    const table = liveTableOf(ROOT);
    expect(await cellsOnMain({ ids: ['open', 'form-basic', 'form-prefilled', 'form-keyboard-floating', 'carousel-lazy-free', 'carousel-recycler-free'], table })).toEqual({ ok: true });
    expect(await cellsOnMain({ ids: ['open', 'no-such-cell'], table })).toEqual({ ok: false, why: "cell(s) no-such-cell not in main's catalog (fixtures/apps/cells.json)" });
  });
});

describe('completeness over the real selector and summarize\'s own header (b11-analyze.ts:1–23)', () => {
  const KF: Asked = { platform: 'android', app: 'native', sources: ['uiautomator'], cases: ['kf1', 'kf2', 'kf3'] };
  /** A summary in summarize's shape: its real header line, then one line per case under its source. */
  const summary = (ids: string[]) => {
    const header = summarize({ platform: 'android', sources: [], results: [], side: THIS_CHECKOUT }).lines.slice(0, 2);
    return [...header, '', '## uiautomator', ...ids.map((id) => `- ok ${id} form-keyboard-floating: says — why`), ''].join('\n');
  };
  const put = (name: string, ids: string[]) => {
    writeCases(nodeFs, dir, name, KF);
    const f = runFiles(dir, name);
    writeFileSync(f.record, '{"platform":"android","side":"this checkout","results":[]}');
    writeFileSync(f.log, summary(ids));
    writeFileSync(f.summary, summary(ids));
  };

  it('kf1–kf3 all in the summary: complete; kf3 missing: named; a .cases that never ran: INCONCLUSIVE in the block\'s line (batch-9: never an invisible gap)', async () => {
    const select = selectorOf(liveTableOf(ROOT));
    put('android-kf-1', ['kf1', 'kf2', 'kf3']);
    put('android-kf-2', ['kf1', 'kf2']);
    writeCases(nodeFs, dir, 'android-kf-3', KF);
    const runs = await Promise.all(runsIn(nodeFs, dir).map(async (name) => ({ name, result: await completeness({ dir, name, select }) })));
    expect(runs.map((r) => [r.name, r.result.ok])).toEqual([
      ['android-kf-1', true],
      ['android-kf-2', false],
      ['android-kf-3', false],
    ]);
    expect(incompleteLine('kf live verdict', runs)).toBe(
      'kf live verdict: INCONCLUSIVE — 2 of 3 run(s) incomplete: android-kf-2 — uiautomator: kf3 missing from the summary | android-kf-3 — asked but never ran (no record, log or summary beside its .cases)',
    );
  });

  it('a table that does not load (no live-cases.ts at that checkout): named, never thrown (review round 1)', async () => {
    const r = await casesOnMain({ ids: ['kf1'], platform: 'android', table: liveTableOf(dir) });
    expect(r.ok === false && r.why).toMatch(/^main's live cases could not be read: /);
  });

  it('no case asked: every forms case main runs on Android under uiautomator must be there (batch-11\'s live_run, --groups forms)', async () => {
    const select = selectorOf(liveTableOf(ROOT));
    const all = await select({ ...KF, cases: [] }, 'uiautomator');
    expect(all).toEqual(expect.arrayContaining(['kf1', 'kf2', 'kf3', 'p7']));
    expect(all).not.toContain('p7w');
  });
});
