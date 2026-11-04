import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Main's live-cases table, as preconditions.ts and cases.ts read it: selectCases (the cases a run takes) and catalogOf
 * (the lab's cells). Loaded from the checkout's own scripts/truth/live-cases.ts by a dynamic import, as b11-analyze.ts
 * did — never a grep, and never a static import: the mutation run's sandbox holds scripts/truth/batch/ alone (ADR
 * 0038's T2 amendment). A load that fails (a missing file, a syntax error) is its caller's to name: the callers catch
 * it and say "main's live cases could not be read". Out of the mutation run: its one call is the import, which only
 * tests/truth/batch/cases-live.test.ts makes.
 */

export interface LiveCases {
  selectCases(s: { platform: 'ios' | 'android'; app: string; groups: readonly string[]; only?: readonly string[] }): Promise<readonly { id: string; sources?: readonly string[] }[]>;
  catalogOf(): Promise<{ cells: readonly { id: string }[] }>;
}

/** The table, loaded when asked. */
export type LiveTable = () => Promise<LiveCases>;

/** The checkout `repo`'s live-cases.ts as a LiveTable (Node caches the module: loaded once however often asked). */
export const liveTableOf =
  (repo: string): LiveTable =>
  async () =>
    (await import(pathToFileURL(join(resolve(repo), 'scripts/truth/live-cases.ts')).href)) as LiveCases;
