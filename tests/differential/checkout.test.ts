import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeRoot } from '../../scripts/differential/checkout.js';

// checkout.ts: the side a git ref names is a worktree under --worktrees. One found in place is used only when it is a
// checkout of that commit — calibrate.ts and golden.ts would otherwise replay whatever it holds as the commit.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

describe('codeRoot — a directory in place under the checkout name', () => {
  const head = (() => {
    try {
      return execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD~1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  })();
  it.skipIf(head === undefined)('is refused unless it is a checkout of the wanted commit — never replayed as that commit, never created over', () => {
    const dir = mkdtempSync(join(tmpdir(), 'averi-checkout-'));
    try {
      const root = join(dir, `differential-cal-${head!.slice(0, 7)}`);
      mkdirSync(root);
      expect(() => codeRoot(ROOT, head!, 'cal', dir)).toThrow('no checkout of its own');
      execFileSync('git', ['init', '-q', root]);
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);
      expect(() => codeRoot(ROOT, head!, 'cal', dir)).toThrow(`not ${head!.slice(0, 7)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('codeRoot — a directory in place inside another checkout', () => {
  it.skipIf(!existsSync(join(ROOT, '.git')))('is refused: git answers for the checkout around it, not for the directory', () => {
    const sha = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dir = mkdtempSync(join(tmpdir(), 'averi-checkout-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']);
      mkdirSync(join(dir, `differential-cal-${sha.slice(0, 7)}`));
      expect(() => codeRoot(ROOT, sha, 'cal', dir)).toThrow('no checkout of its own');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('codeRoot — a git command that fails', () => {
  it("throws with git's own stderr: a side that cannot be checked out says why", () => {
    expect(() => codeRoot(ROOT, 'no-such-ref-at-all', 'cal', tmpdir())).toThrow(/^git -C .* rev-parse no-such-ref-at-all\^\{commit\}: .*no-such-ref-at-all/);
    // a worktree git cannot create (its directory under a plain file): git's reason, not a bare "Command failed"
    const dir = mkdtempSync(join(tmpdir(), 'averi-checkout-'));
    try {
      writeFileSync(join(dir, 'file'), '');
      expect(() => codeRoot(ROOT, 'HEAD', 'cal', join(dir, 'file'))).toThrow(/^git -C .* worktree add --detach .*: .*file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
