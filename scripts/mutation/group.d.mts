// The types of group.mjs (plain JS so that stryker.config.mjs can load it without tsx), for mutate.ts and the tests.

export declare const GROUPS: readonly ['core', 'lab'];
export type Group = (typeof GROUPS)[number];
export declare const GROUP_ENV: 'AVERI_MUTATE_GROUP';

export interface ScopeEntry {
  tests: string[];
  floor: number;
  baseline: string;
  group: string;
}

export declare function readScopeFile(): Record<string, ScopeEntry>;
export declare function scopeErrors(scope: Readonly<Record<string, { group?: unknown }>>): string[];
export declare function groupScope<T extends { group?: unknown }>(scope: Readonly<Record<string, T>>, group: string): Record<string, T>;
export declare function scopeOf<T extends { tests: readonly string[]; group?: unknown }>(
  env: Readonly<Record<string, string | undefined>>,
  scope?: Readonly<Record<string, T>>,
): {
  group: Group | undefined;
  scope: Record<string, T>;
  tests: string[];
  files: { incremental: string; json: string; html: string; tempDir: string };
};
