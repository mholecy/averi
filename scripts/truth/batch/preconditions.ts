import { GIT_SECS, NOT_STARTED, TIMED_OUT, type CallResult, type Run } from './bounded.js';
import { nodeFs } from './io.js';
import type { LiveCases, LiveTable } from './live-table.js';
import { firstLineOf, messageOf, nameInLine, verdictLine } from './words.js';

/**
 * A block's preconditions, each shown or not before the block runs: the checkout is main's clean HEAD; a commit the
 * block needs is an ancestor of it; the live cases and lab cells it uses are main's. One that is not shown makes the
 * block INCONCLUSIVE, naming why (`preconditionLine`) — never a number from a run whose premise does not hold
 * (batch-2-README: "it gives INCONCLUSIVE rather than a number"). batch-12 refused to start on a failed checkout or
 * ancestry instead; which a batch does with the result is its own (the runner, S6), the result is the same.
 *
 * Every answer is git's, read through a bounded call (bounded.ts, git's own 30 s bound): never a grep of a symbol in
 * the sources (batch-11-README:101), and never git run unbounded, as batch-11's was. The cases and cells are read from
 * main's own live-cases.ts table and catalog (live-table.ts#liveTableOf), never grepped (batch-11.sh:228).
 *
 * A why is one short line an agent can act on: it names the sha, the file or the case id, and git's own first line of
 * stderr when git said something. A name holding a line break is JSON-quoted in it (words.ts#nameInLine): the block's
 * line never breaks, and making it never throws.
 */

/** A precondition: shown, or why not. */
export type Precondition = { ok: true } | { ok: false; why: string };

/** The checkout's: shown with the commit HEAD is (the SUMMARY's checkout line names it), or why not. */
export type CheckoutPrecondition = { ok: true; head: string } | { ok: false; why: string };

/** A commit sha as a batch's knob takes it (batch-11.sh:80, M_D43): 7 to 40 lowercase hex digits. */
export const SHA_FORMAT = /^[0-9a-f]{7,40}$/;

/** How many modified paths a why names before it says how many more. */
export const SHOWN_PATHS = 3;

/** A commit as a why names it: its first 8 hex digits (the repo's own merge lines' length). */
export const shortSha = (sha: string): string => sha.slice(0, 8);

/**
 * The variables that tell git which repo, worktree or index to use. A batch started from inside a git hook inherits
 * GIT_DIR and GIT_INDEX_FILE, and git would then read that repo, not the one named: they are dropped from every call.
 */
const REPO_LOCATING = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'] as const;

/**
 * Config given through the env (`git -c` passes GIT_CONFIG_PARAMETERS down; GIT_CONFIG_COUNT with its KEY_n/VALUE_n
 * pairs): a `core.worktree` there would point git at another worktree. Dropped too; the config files' own variables
 * (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM) are kept.
 */
const ENV_CONFIG = /^GIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/;

/** `env` (process.env by default) without the repo-locating variables and the env's config: a copy, the one given unchanged. */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const name of REPO_LOCATING) delete copy[name];
  for (const name of Object.keys(copy)) if (ENV_CONFIG.test(name)) delete copy[name];
  return copy;
}

/** Where git reads and how it is called: the repo, the Run (a Calls' bounded or a scope's run), its env and bound. */
export interface Git {
  repo: string;
  run: Run;
  /** The env git gets, without its repo-locating variables (gitEnv); none: process.env's. */
  env?: NodeJS.ProcessEnv;
  /** Each call's bound in seconds; none: git's own (bounded.ts#boundFor, GIT_SECS). */
  secs?: number;
}

/** `(<prefix><first line>)` after a why, or nothing when git said nothing. */
const said = (err: string, prefix = ''): string => (firstLineOf(err) === '' ? '' : ` (${prefix}${firstLineOf(err)})`);

/** git `-C <repo> …args`, bounded, in the cleaned env. */
const git = (g: Git, args: readonly string[]): Promise<CallResult> => g.run('git', ['-C', g.repo, ...args], { env: gitEnv(g.env), secs: g.secs });

/**
 * Why a call did not answer at all — past its bound, or not started — or undefined when git ran and exited. `call`
 * names it (`rev-parse HEAD`). Exit 142 alone counts as past the bound: the shell's code, as bounded.ts gives it.
 */
function unanswered(g: Git, call: string, r: CallResult): string | undefined {
  if (r.timedOut || r.code === TIMED_OUT) return `git timed out (${call}, past its ${g.secs ?? GIT_SECS} s bound)`;
  if (r.code === NOT_STARTED) return `git could not be started${said(r.err)}`;
  return undefined;
}

/** `exit <code>`, and `: <git's first line>` when it said one. */
const exitOf = (r: CallResult): string => `exit ${r.code}${firstLineOf(r.err) === '' ? '' : `: ${firstLineOf(r.err)}`}`;

/**
 * The repo named is the top of its checkout (`git rev-parse --show-toplevel`, both sides by real path): a folder inside
 * another checkout would have git read that one. Undefined when it is, else why not.
 */
async function notTop(g: Git): Promise<string | undefined> {
  const top = await git(g, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return failed(g, 'rev-parse --show-toplevel', top);
  const at = firstLineOf(top.out);
  return nodeFs.real(at) === nodeFs.real(g.repo) ? undefined : `${nameInLine(g.repo)} is not the top of a git checkout (top is ${at})`;
}

/** Why a call that git ran failed: past its bound, not started, or its exit and git's first line. */
const failed = (g: Git, call: string, r: CallResult): string => unanswered(g, call, r) ?? `git ${call} failed (${exitOf(r)})`;

/**
 * The paths `git status --porcelain -z` lists, each once: an entry is `XY <path>`, NUL-ended; a rename or a copy (R or
 * C in either column) is followed by its origin path, which is skipped.
 */
function changedPaths(porcelainZ: string): string[] {
  const entries = porcelainZ.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === '') continue;
    paths.push(nameInLine(entry.slice(3)));
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return paths;
}

/** The modified paths as a why names them: the first SHOWN_PATHS, then how many more. */
function named(paths: readonly string[]): string {
  const shown = paths.slice(0, SHOWN_PATHS).join(', ');
  return paths.length > SHOWN_PATHS ? `${shown} and ${paths.length - SHOWN_PATHS} more` : shown;
}

/**
 * The checkout runs main as committed: HEAD is the commit refs/heads/main is — a detached HEAD on that commit too, since
 * the code is the same — and no tracked file is modified, staged or not (`git status --porcelain
 * --untracked-files=no`: an untracked file is allowed, as in batch-11 and batch-12). HEAD ≠ main and modified files
 * are both said when both hold (one rerun fixes both). First the repo named must be the top of its checkout; that not
 * shown, or HEAD unreadable, ends it: nothing else is asked.
 */
export async function checkout(g: Git): Promise<CheckoutPrecondition> {
  const outside = await notTop(g);
  if (outside !== undefined) return { ok: false, why: outside };
  const head = await git(g, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head.code !== 0) return { ok: false, why: failed(g, 'rev-parse HEAD', head) };
  const headSha = head.out.trim();
  const whys: string[] = [];
  const main = await git(g, ['rev-parse', '--verify', 'refs/heads/main^{commit}']);
  if (main.code !== 0) whys.push(unanswered(g, 'rev-parse main', main) ?? `the repo has no branch main (git rev-parse: ${exitOf(main)})`);
  else {
    const mainSha = main.out.trim();
    if (mainSha !== headSha) whys.push(`the checkout's HEAD (${shortSha(headSha)}) is not main's (${shortSha(mainSha)}) — git switch main, then rerun`);
  }
  // --no-optional-locks: a read of the status never takes the index lock (batch-11.sh:211).
  const status = await git(g, ['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=no']);
  if (status.code !== 0) whys.push(failed(g, 'status', status));
  else {
    const paths = changedPaths(status.out);
    if (paths.length > 0) whys.push(`the checkout has ${paths.length} modified tracked file(s) (${named(paths)}) — the batch runs main as committed`);
  }
  return whys.length === 0 ? { ok: true, head: headSha } : { ok: false, why: whys.join('; ') };
}

/**
 * A commit the block needs is an ancestor of HEAD (batch-4's first ancestry gate, batch-11's D43 one): its sha's format
 * first, by batch-11's knob rule — no git call for one that breaks it — then `git cat-file -e <sha>^{commit}` (it names
 * one commit of this repo; after the repo is shown to be the top of its checkout), then `git merge-base --is-ancestor <sha> HEAD` (exit 1: not an ancestor; any other failure is
 * git's, never "not an ancestor"). `what` names it as the batch does (`M_D43`): `M_D43=<sha> …`, `M_D43 is not set`.
 */
export async function ancestor(g: Git & { sha: string; what?: string }): Promise<Precondition> {
  const { sha, what } = g;
  if (sha === '') return { ok: false, why: `${what ?? 'the commit'} is not set` };
  if (!SHA_FORMAT.test(sha)) return { ok: false, why: `${what === undefined ? '' : `${what}=`}${JSON.stringify(sha)} is not a commit sha (7–40 hex digits)` };
  const it = what === undefined ? sha : `${what}=${sha}`;
  const outside = await notTop(g);
  if (outside !== undefined) return { ok: false, why: outside };
  const known = await git(g, ['cat-file', '-e', `${sha}^{commit}`]);
  if (known.code !== 0) return { ok: false, why: unanswered(g, 'cat-file', known) ?? `${it} names no commit of this repo${said(known.err, 'git: ')}` };
  const merged = await git(g, ['merge-base', '--is-ancestor', sha, 'HEAD']);
  if (merged.code === 0) return { ok: true };
  if (merged.code === 1) return { ok: false, why: `${it} is not an ancestor of HEAD (not merged into main yet)` };
  return { ok: false, why: failed(g, 'merge-base', merged) };
}

/** `ids` each once, in the order given, that `have` lacks, each as a line may name it. */
const missingOf = (ids: readonly string[], have: ReadonlySet<string>): string[] => [...new Set(ids)].filter((id) => !have.has(id)).map(nameInLine);

/** Why main's table was not had: its load (a missing file, a syntax error) or its own read failed. */
export const unreadLive = (e: unknown): string => `main's live cases could not be read: ${firstLineOf(messageOf(e))}`;

/** The table loaded, or why not. */
async function load(table: LiveTable): Promise<{ live: LiveCases } | { why: string }> {
  try {
    return { live: await table() };
  } catch (e) {
    return { why: unreadLive(e) };
  }
}

/**
 * The live cases a block runs are main's: selectCases (live-cases.ts) picks each id for the platform, the lab app
 * (native by default) and the groups (forms by default: batch-11's live_run runs `--groups forms`) — the table, never
 * a grep. Every id it does not pick is named. No id is never a pass: a block judged on no case proves nothing. A table
 * that does not load or read is said, never thrown.
 */
export async function casesOnMain({ ids, platform, app = 'native', groups = ['forms'], table }: { ids: readonly string[]; platform: 'ios' | 'android'; app?: string; groups?: readonly string[]; table: LiveTable }): Promise<Precondition> {
  if (ids.length === 0) return { ok: false, why: 'no live case id given' };
  let picked: readonly { id: string }[];
  try {
    picked = await (await table()).selectCases({ platform, app, groups, only: ids });
  } catch (e) {
    return { ok: false, why: unreadLive(e) };
  }
  const missing = missingOf(ids, new Set(picked.map((c) => c.id)));
  return missing.length === 0 ? { ok: true } : { ok: false, why: `live case(s) ${missing.join(', ')} not on main's live-cases.ts (${platform}, ${app} app, groups ${groups.join(', ')})` };
}

/** The lab cells a block uses are in main's catalog (batch-11's and batch-12's cells_have): every one missing named. */
export async function cellsOnMain({ ids, table }: { ids: readonly string[]; table: LiveTable }): Promise<Precondition> {
  if (ids.length === 0) return { ok: false, why: 'no cell id given' };
  const loaded = await load(table);
  if ('why' in loaded) return { ok: false, why: loaded.why };
  let cells: readonly { id: string }[];
  try {
    cells = (await loaded.live.catalogOf()).cells;
  } catch (e) {
    return { ok: false, why: `main's catalog could not be read: ${firstLineOf(messageOf(e))}` };
  }
  const missing = missingOf(ids, new Set(cells.map((c) => c.id)));
  return missing.length === 0 ? { ok: true } : { ok: false, why: `cell(s) ${missing.join(', ')} not in main's catalog (fixtures/apps/cells.json)` };
}

/**
 * The block's verdict line when a precondition is not shown: `<label>: INCONCLUSIVE — precondition: <why>`, every
 * failed one's why in order, `; ` between them, on one line (words.ts#verdictLine refuses a line break). Undefined when
 * all are shown. INCONCLUSIVE is no FAIL to the exit rule (words.ts#failsIn), whatever the why says.
 */
export function preconditionLine(label: string, results: readonly (Precondition | CheckoutPrecondition)[]): string | undefined {
  const whys = results.flatMap((r) => (r.ok ? [] : [r.why]));
  return whys.length === 0 ? undefined : verdictLine(label, 'INCONCLUSIVE', `precondition: ${whys.join('; ')}`);
}
