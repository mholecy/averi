// @ts-check
import { readFileSync } from 'node:fs';

/**
 * The mutation run's groups: each scope.json entry names one (`core`, `android`, `scene` or `lab`), and one Stryker
 * process mutates one group, against that group's tests only, with an incremental file, reports and temp dir of its
 * own. Plain JS, so that stryker.config.mjs (loaded by node, no tsx) reads it as vitest.mutation.config.ts and
 * mutate.ts do. Why the groups and which module is in which:
 * docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md, the T2b-2 part (`scene`: its A25 amendment; `android`:
 * its A27 amendment).
 */

/** The groups, in the order a run without `--group` runs them. */
export const GROUPS = /** @type {const} */ (['core', 'android', 'scene', 'lab']);
/** The variable mutate.ts sets for each Stryker process it starts: the group that process mutates. */
export const GROUP_ENV = 'AVERI_MUTATE_GROUP';

const SCOPE = 'scripts/mutation/scope.json';
/** The groups in words, for a line naming them: `core, android, scene or lab`. */
export const GROUP_WORDS = `${GROUPS.slice(0, -1).join(', ')} or ${GROUPS[GROUPS.length - 1]}`;

/**
 * Whether `name` is one of GROUPS.
 * @param {unknown} name
 * @returns {name is typeof GROUPS[number]}
 */
export const isGroup = (name) => /** @type {readonly unknown[]} */ (GROUPS).includes(name);

/** scope.json as written: its groups are checked by scopeErrors, never here. */
export const readScopeFile = () => JSON.parse(readFileSync(new URL('./scope.json', import.meta.url), 'utf8'));

/**
 * The scope's group errors: an entry without a group or with one not in GROUPS, and a group no entry names (its run
 * would mutate nothing). None for a good scope. Pure.
 * @param {Record<string, { group?: unknown }>} scope
 * @returns {string[]}
 */
export function scopeErrors(scope) {
  const errors = [];
  for (const [file, { group }] of Object.entries(scope)) {
    if (group === undefined) errors.push(`${file}: has no group in ${SCOPE} (${GROUP_WORDS})`);
    else if (!isGroup(group)) {
      errors.push(`${file}: group ${JSON.stringify(group)} in ${SCOPE} is not ${GROUP_WORDS}`);
    }
  }
  for (const group of GROUPS) {
    if (!Object.values(scope).some((m) => m.group === group)) errors.push(`group ${group}: no module in ${SCOPE}`);
  }
  return errors;
}

/**
 * The entries of one group. Pure.
 * @template {{ group?: unknown }} T
 * @param {Readonly<Record<string, T>>} scope
 * @param {string} group
 * @returns {Record<string, T>}
 */
export const groupScope = (scope, group) => Object.fromEntries(Object.entries(scope).filter(([, m]) => m.group === group));

/**
 * One Stryker process's part: the group `env` names (GROUP_ENV), its entries, their tests (each once) and its files.
 * No group in `env` — Stryker started by hand, not through mutate.ts — is the whole scope under the unsuffixed names.
 * Throws on a group not in GROUPS and on a scope with group errors: no run over the wrong modules.
 * @param {Readonly<Record<string, string | undefined>>} env
 * @param {Record<string, { tests: readonly string[], group?: unknown }>} [scope]
 */
export function scopeOf(env, scope = readScopeFile()) {
  const errors = scopeErrors(scope);
  if (errors.length > 0) throw new Error(`${SCOPE}: ${errors.join('; ')}`);
  const group = env[GROUP_ENV];
  if (group !== undefined && !isGroup(group)) {
    throw new Error(`${GROUP_ENV}=${group}: not a mutation group (${GROUP_WORDS})`);
  }
  const own = group === undefined ? scope : groupScope(scope, group);
  return { group, scope: own, tests: [...new Set(Object.values(own).flatMap((m) => m.tests))], files: filesOf(group) };
}

/**
 * A group's own files — its incremental file, its JSON and HTML reports, its temp dir — each suffixed `-<group>`;
 * no group: the unsuffixed names. Pure.
 * @param {string | undefined} group
 */
export function filesOf(group) {
  const suffix = group === undefined ? '' : `-${group}`;
  return {
    incremental: `reports/mutation/stryker-incremental${suffix}.json`,
    json: `reports/mutation/mutation${suffix}.json`,
    html: `reports/mutation/mutation${suffix}.html`,
    tempDir: `node_modules/.stryker-tmp${suffix}`,
  };
}
