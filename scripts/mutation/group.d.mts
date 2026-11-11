// The types of group.mjs (plain JS so that stryker.config.mjs can load it without tsx), for mutate.ts and the tests.

export declare const GROUPS: readonly ['core', 'scene', 'lab'];
export type Group = (typeof GROUPS)[number];
export declare const GROUP_ENV: 'AVERI_MUTATE_GROUP';
export declare const GROUP_WORDS: string;
export declare function isGroup(name: unknown): name is Group;

/** One scope.json entry: a mutated module's direct tests (globs), its floor, its baseline and its group. */
export interface ScopeEntry {
  readonly tests: readonly string[];
  readonly floor: number;
  readonly baseline: string;
  readonly group: Group;
}
/** scripts/mutation/scope.json, its groups checked (scopeErrors) before it is used. */
export type Scope = Readonly<Record<string, ScopeEntry>>;

export interface GroupFiles {
  incremental: string;
  json: string;
  html: string;
  tempDir: string;
}

export declare function readScopeFile(): Scope;
export declare function scopeErrors(scope: Readonly<Record<string, { group?: unknown }>>): string[];
export declare function groupScope<T extends { group?: unknown }>(scope: Readonly<Record<string, T>>, group: string): Record<string, T>;
export declare function filesOf(group: Group | undefined): GroupFiles;
export declare function scopeOf<T extends { tests: readonly string[]; group?: unknown }>(
  env: Readonly<Record<string, string | undefined>>,
  scope?: Readonly<Record<string, T>>,
): { group: Group | undefined; scope: Record<string, T>; tests: string[]; files: GroupFiles };
