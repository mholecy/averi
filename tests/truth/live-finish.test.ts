import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DeviceLabel } from '../../scripts/truth/device-state.js';
import { finishRun, type Closer } from '../../scripts/truth/live-finish.js';
import type { RunRecord } from '../../scripts/truth/live-cases.js';

// live.ts's finish (scripts/truth/live-finish.ts, D82): the record is written before anything closes, every closer is
// tried whatever the one before it threw, and a failed close is one stderr line, never a throw. T16's first live smoke
// (2026-11-10) lost its record: the emulator went offline during the after read, `am force-stop` in AndroidLab#close
// threw `adb: device offline`, and the write came after it.

const OFFLINE = 'adb: device offline';
const made: string[] = [];
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'live-finish-'));
  made.push(d);
  return d;
};
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));
/** A record with one case ran (its reads beside the point here). */
const ran = (): RunRecord => ({ platform: 'android', side: 'this checkout', results: [{ id: 'lv-d62-control', source: 'uiautomator' } as unknown as RunRecord['results'][number]] });
/** T16's smoke: the before read taken, the after read failed. */
const label: DeviceLabel = { error: `after: ${OFFLINE}`, side: 'after' };

/** A closer that logs its turn (and whether the record was on disk then), and throws `fails` when given. */
function closer(name: string, log: string[], path: string | undefined, fails?: string): Closer {
  return {
    name,
    async close() {
      log.push(`${name}${path !== undefined && existsSync(path) ? ' (record written)' : ''}`);
      if (fails !== undefined) throw new Error(fails);
    },
  };
}

describe('finishRun: the record before the closes (D82)', () => {
  it("T16's smoke: lab.close() throws `adb: device offline` — the record is written with the cases and the label, both closers tried, one line said, nothing thrown", async () => {
    const path = join(dir(), 'smoke-1.json');
    const log: string[] = [];
    const lines: string[] = [];
    const record = ran();
    await expect(
      finishRun({
        record,
        recordPath: path,
        deviceLabel: () => label,
        closers: [closer('mcp', log, path), closer('lab (am force-stop)', log, path, OFFLINE)],
        note: (l) => lines.push(l),
      }),
    ).resolves.toBeUndefined();
    const written = JSON.parse(readFileSync(path, 'utf8')) as RunRecord;
    expect(written.results.map((r) => r.id)).toEqual(['lv-d62-control']);
    expect(written.deviceLabel).toEqual(label);
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
    // Written before the first closer ran; each closer ran once, in order.
    expect(log).toEqual(['mcp (record written)', 'lab (am force-stop) (record written)']);
    expect(lines).toEqual([`close: lab (am force-stop) failed — ${OFFLINE}`]);
    // The caller's record holds the label too (the summary reads it).
    expect(record.deviceLabel).toEqual(label);
  });

  it('a first closer that throws does not skip the next: the MCP close failing still force-stops the lab', async () => {
    const path = join(dir(), 'r.json');
    const log: string[] = [];
    const lines: string[] = [];
    await finishRun({
      record: ran(),
      recordPath: path,
      closers: [closer('mcp', log, path, 'transport gone'), closer('lab (am force-stop)', log, path, OFFLINE)],
      note: (l) => lines.push(l),
    });
    expect(log).toEqual(['mcp (record written)', 'lab (am force-stop) (record written)']);
    expect(lines).toEqual(['close: mcp failed — transport gone', `close: lab (am force-stop) failed — ${OFFLINE}`]);
  });

  it('a closer that throws a non-Error is said as a string', async () => {
    const lines: string[] = [];
    const throwsString: Closer = {
      name: 'lab',
      close: () => Promise.reject('gone'),
    };
    await finishRun({ record: ran(), closers: [throwsString], note: (l) => lines.push(l) });
    expect(lines).toEqual(['close: lab failed — gone']);
  });

  it('no `--record`: nothing written, the closers still run, nothing said when they succeed; no labelling leaves the record without a deviceLabel', async () => {
    const log: string[] = [];
    const lines: string[] = [];
    const record = ran();
    await finishRun({ record, closers: [closer('mcp', log, undefined), closer('lab', log, undefined)], note: (l) => lines.push(l) });
    expect(log).toEqual(['mcp', 'lab']);
    expect(lines).toEqual([]);
    expect('deviceLabel' in record).toBe(false);
  });

  it('a record write that fails still throws (the evidence is lost: loud) — said at once, then every closer ran, so node can exit', async () => {
    const path = join(dir(), 'no-such-dir', 'r.json');
    const log: string[] = [];
    const lines: string[] = [];
    await expect(
      finishRun({ record: ran(), recordPath: path, closers: [closer('mcp', log, path), closer('lab', log, path, OFFLINE)], note: (l) => lines.push(l) }),
    ).rejects.toThrow(/ENOENT/);
    expect(log).toEqual(['mcp', 'lab']);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith(`record: ${path} not written — ENOENT: `)).toBe(true);
    expect(lines[1]).toBe(`close: lab failed — ${OFFLINE}`);
  });

  it("review round 1: the write's failure is said even when a case's throw is what live.ts's finally lets through", async () => {
    // live.ts: `try { cases } finally { await finishRun(…) }` — here the case's error first, the finish's throw last.
    const path = join(dir(), 'no-such-dir', 'r.json');
    const lines: string[] = [];
    const run = async (): Promise<void> => {
      try {
        throw new Error('case lv-d62-control threw');
      } finally {
        await finishRun({ record: ran(), recordPath: path, closers: [], note: (l) => lines.push(l) });
      }
    };
    await expect(run()).rejects.toThrow(/ENOENT/);
    expect(lines).toEqual([expect.stringMatching(/^record: .*r\.json not written — ENOENT: /)]);
  });
});
