import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A side's code root: a path that holds averi's src/, or a git ref checked out detached in a worktree under
 * `worktrees` (named for its role, so OLD and NEW at one commit are two checkouts), node_modules linked in. Only a
 * worktree this run created is removed afterwards (`cleanup`) — one found in place is someone's, and stays. A directory
 * found in place under the checkout's name is used only when it is a checkout of the wanted commit: its own top level,
 * its HEAD that commit — anything else is refused, not replayed as that commit.
 */
export function codeRoot(repo: string, spec: string, role: string, worktrees: string): { root: string; cleanup?: () => void } {
  if (existsSync(join(spec, 'src/mcp/tools.ts'))) return { root: resolve(spec) };
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const full = git('-C', repo, 'rev-parse', `${spec}^{commit}`);
  const sha = full.slice(0, 7);
  const root = join(worktrees, `differential-${role}-${sha}`);
  if (existsSync(root)) {
    let top: string | undefined;
    let head: string | undefined;
    try {
      top = git('-C', root, 'rev-parse', '--show-toplevel');
      head = git('-C', root, 'rev-parse', 'HEAD');
    } catch {
      // not a git checkout: refused below
    }
    if (top === undefined || realpathSync(top) !== realpathSync(root)) throw new Error(`checkout: ${root} is in place but no checkout of its own — remove it or pick another directory`);
    if (head !== full) throw new Error(`checkout: ${root} is in place at ${head?.slice(0, 7)}, not ${sha} — remove it or pick another directory`);
    return { root };
  }
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', root, full], { stdio: 'ignore' });
  symlinkSync(realpathSync(join(repo, 'node_modules')), join(root, 'node_modules'));
  return { root, cleanup: () => execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', root], { stdio: 'ignore' }) };
}
