import { join } from 'node:path';
import { isEexist, type BatchFs } from './io.js';
import { plainSegment } from './run-dir.js';

/**
 * A non-live block's records (T2 S6a; batch-12's E5 and T6 wrote `{"runs":N}` as a `.cases`, which S3 keeps for live
 * runs): what a run is asked, written before it runs (`<name>.asked.json`), and what it did, once done
 * (`<name>.done.json`), each written once, never overwritten. A run is complete when what it recorded is what it was
 * asked (runner.ts reads every record's gap beside every live run's completeness, one rule on both paths). One kind of
 * record for now; another is a new member of the union.
 */

export interface RunsRecord {
  kind: 'runs';
  runs: number;
}
export type BlockRecord = RunsRecord;

/** `v` as a record, or undefined: kind `runs` and a whole number of runs, 0 or more. */
export function recordOf(v: unknown): BlockRecord | undefined {
  const r = (v ?? {}) as Record<string, unknown>;
  return r.kind === 'runs' && Number.isSafeInteger(r.runs) && (r.runs as number) >= 0 ? { kind: 'runs', runs: r.runs as number } : undefined;
}

const ASKED = '.asked.json';

/** A record's two files: what it was asked, written first, and what it did (`.asked.json`, `.done.json`). */
export const recordFiles = (dir: string, name: string) => ({ asked: join(dir, `${name}${ASKED}`), done: join(dir, `${name}.done.json`) });

const NO_RECORD = 'is no record of runs (kind "runs", runs: a whole number)';

/** The text's record, or undefined when it is none (no JSON or another shape). */
function parsedRecord(text: string): BlockRecord | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    // no JSON: no record
  }
  return recordOf(v);
}

/**
 * Why the record `name` is not complete, or undefined when it is: what it recorded is what it was asked. Its asked file
 * unreadable or no record, nothing recorded, a done file that is no record, another count — each said.
 */
export function recordGap(name: string, askedText: string | undefined, doneText: string | undefined): string | undefined {
  if (askedText === undefined) return `${name}.asked.json is unreadable: what it was asked is unknown`;
  const asked = parsedRecord(askedText);
  if (asked === undefined) return `${name}.asked.json ${NO_RECORD}`;
  if (doneText === undefined) return `asked ${asked.runs} run(s), nothing recorded (no ${name}.done.json)`;
  const done = parsedRecord(doneText);
  if (done === undefined) return `${name}.done.json ${NO_RECORD}`;
  return done.runs === asked.runs ? undefined : `asked ${asked.runs} run(s), recorded ${done.runs}`;
}

/** The records a block's folder asked: the name of each `<name>.asked.json`, sorted. */
export const recordsIn = (fs: BatchFs, dir: string): string[] =>
  fs
    .list(dir)
    .filter((n) => n.endsWith(ASKED))
    .map((n) => n.slice(0, -ASKED.length));

/** The record `name` in `dir`: its gap (recordGap over its files), or undefined when complete. */
export function recordGapIn(fs: BatchFs, dir: string, name: string): string | undefined {
  const f = recordFiles(dir, name);
  return recordGap(name, fs.read(f.asked), fs.read(f.done));
}

/** `record` as a file's text; a name that is no plain segment or a value that is no record is the batch's mistake. */
function recordText(name: string, record: BlockRecord): string {
  plainSegment('run name', name);
  if (recordOf(record) === undefined) throw new Error(`${name}: ${JSON.stringify(record)} is no record of runs`);
  return `${JSON.stringify(record)}\n`;
}

/** A new file, or a throw naming what is never overwritten. */
function writeOnce(fs: BatchFs, path: string, text: string, what: string): void {
  try {
    fs.createExclusive(path, text);
  } catch (e) {
    if (isEexist(e)) throw new Error(`${path} already exists: what a run ${what} is never overwritten`);
    throw e;
  }
}

/** What a run is asked, before it runs: `<name>.asked.json`, written once. */
export function writeAsked(fs: BatchFs, dir: string, name: string, record: BlockRecord): void {
  writeOnce(fs, recordFiles(dir, name).asked, recordText(name, record), 'was asked');
}

/** What it did, once done: `<name>.done.json`, written once, and only after its asks. */
export function writeDone(fs: BatchFs, dir: string, name: string, record: BlockRecord): void {
  const f = recordFiles(dir, name);
  const text = recordText(name, record);
  if (!fs.exists(f.asked)) throw new Error(`${name}: recorded before it was asked (asks first)`);
  writeOnce(fs, f.done, text, 'recorded');
}
