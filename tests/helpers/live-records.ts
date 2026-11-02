import { readFileSync } from 'node:fs';
import type { LabState } from '../../scripts/truth/schema.js';

/**
 * A committed live record (docs/truth/live-records, scripts/truth/live.ts `--record`) as the tests read it: the run's
 * platform and side, and each case's reads — the launch, the state after the calls, a forms case's read 3 s later.
 */
export interface LiveRecord {
  platform: 'ios' | 'android';
  app?: string;
  side: string;
  results: RecordedCase[];
}

export interface RecordedCase {
  source: string;
  id: string;
  skip?: string;
  replies: string[];
  launched: LabState;
  after?: (LabState | undefined)[];
  state: LabState;
  late?: LabState;
}

/** A record of docs/truth/live-records by its file name. */
export const readLiveRecord = (file: string): LiveRecord =>
  JSON.parse(readFileSync(new URL(`../../docs/truth/live-records/${file}`, import.meta.url), 'utf8')) as LiveRecord;

/** A recorded case by its source and id. */
export const recordedCase = (record: LiveRecord, source: string, id: string): RecordedCase =>
  record.results.find((r) => r.source === source && r.id === id)!;

/** The case with the app's field `tag` holding `value` — in the state after the calls and in the later read, if any. */
export function withFieldValue(r: RecordedCase, tag: string, value: string): RecordedCase {
  const set = (s: LabState): LabState => ({ ...s, fields: { ...s.fields, [tag]: { ...s.fields?.[tag]!, value } } });
  return { ...r, state: set(r.state), ...(r.late !== undefined && { late: set(r.late) }) };
}

/**
 * batch-3 G's raw `idb ui describe-all --json` inside held-no-spinner's spinner phase (D50): the Application and
 * SwiftUI's ProgressView — flat as the idb parser reads it, or the `--nested` capture taken a moment later.
 */
export const idbSpinnerDescribeAll = (nested = false): string =>
  readFileSync(new URL(`../../docs/truth/live-records/ios-idb-held-no-spinner-describe-all${nested ? '-nested' : ''}-d30-1.json`, import.meta.url), 'utf8');

type IdbRaw = Record<string, unknown> & { children?: IdbRaw[] };

/** The recorded spinner element itself (the record's one `GenericElement`), from the flat or the nested capture. */
export const recordedSpinner = (nested = false): Record<string, unknown> => {
  const all = (els: IdbRaw[]): IdbRaw[] => els.flatMap((e) => [e, ...all(e.children ?? [])]);
  const spinner = all(JSON.parse(idbSpinnerDescribeAll(nested)) as IdbRaw[]).find((e) => e.type === 'GenericElement');
  if (spinner === undefined) throw new Error('the spinner record lists no GenericElement');
  const { children: _children, ...element } = spinner;
  return element;
};
