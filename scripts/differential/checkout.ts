import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * A side's code root: a path that holds averi's src/, or a git ref checked out detached in a worktree under
 * `worktrees` (named for its role, so OLD and NEW at one commit are two checkouts), node_modules linked in. Only a
 * worktree this run created is removed afterwards — one found in place is someone's, and stays.
 */
export function codeRoot(repo: string, spec: string, role: string, worktrees: string): { root: string; cleanup?: () => void } {
  if (existsSync(join(spec, 'src/mcp/tools.ts'))) return { root: resolve(spec) };
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', '--short', `${spec}^{commit}`], { encoding: 'utf8' }).trim();
  const root = join(worktrees, `differential-${role}-${sha}`);
  if (existsSync(root)) return { root };
  execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', root, sha], { stdio: 'ignore' });
  symlinkSync(realpathSync(join(repo, 'node_modules')), join(root, 'node_modules'));
  return { root, cleanup: () => execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', root], { stdio: 'ignore' }) };
}
