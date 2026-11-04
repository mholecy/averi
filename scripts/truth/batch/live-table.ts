import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { firstLineOf, messageOf } from './words.js';

/**
 * Main's live-cases table, as preconditions.ts and cases.ts read it: selectCases (the cases a run takes) and catalogOf
 * (the lab's cells). Loaded from the checkout's own scripts/truth/live-cases.ts by a dynamic import, as b11-analyze.ts
 * did — never a grep, and never a static import: the mutation run's sandbox holds scripts/truth/batch/ alone (ADR
 * 0038's T2 amendment). A load that fails (a missing file, a syntax error) is named by its callers, never thrown.
 */

/**
 * What a run is selected by (live-cases.ts's `Selection`, the part this module asks): its own type, since a `.cases`
 * names its app as a string read from JSON, where live-cases.ts takes its narrower LabApp.
 */
export interface LiveSelection {
  platform: 'ios' | 'android';
  app: string;
  groups: readonly string[];
  /** `--cases`: these ids only. */
  only?: readonly string[];
}

/** The groups a live run takes when it names none: batch-11's live_run ran `--groups forms`. */
export const DEFAULT_GROUPS: readonly string[] = ['forms'];

export interface LiveCases {
  selectCases(s: LiveSelection): Promise<readonly { id: string; sources?: readonly string[] }[]>;
  catalogOf(): Promise<{ cells: readonly { id: string }[] }>;
}

/** The table, loaded when asked. */
export type LiveTable = () => Promise<LiveCases>;

/** The checkout `repo`'s live-cases.ts as a LiveTable (Node caches the module: loaded once however often asked). */
export const liveTableOf =
  (repo: string): LiveTable =>
  async () =>
    (await import(pathToFileURL(join(resolve(repo), 'scripts/truth/live-cases.ts')).href)) as LiveCases;

/** Why main's table was not had: its load (a missing file, a syntax error) or one of its reads failed. */
export const unreadLive = (e: unknown): string => `main's live cases could not be read: ${firstLineOf(messageOf(e))}`;

/** The table loaded, or why not (`unreadLive`): a load that fails is said, never thrown. */
export async function loadTable(table: LiveTable): Promise<{ live: LiveCases } | { why: string }> {
  try {
    return { live: await table() };
  } catch (e) {
    return { why: unreadLive(e) };
  }
}
