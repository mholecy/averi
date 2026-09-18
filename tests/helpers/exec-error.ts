import { ExecError } from '../../src/adapters/exec.js';

/**
 * Build an ExecError the way `exec.ts` builds one: when the child wrote
 * nothing to stderr, `exec.ts:60` substitutes node's `err.message`
 * ("Command failed: <cmd>\n"), so a real ExecError NEVER has a blank `stderr`.
 * A fixture built with `new ExecError(cmd, 1, '')` is a shape production
 * cannot emit — a guard written against it passed its test and was dead on a
 * device (2026-09-18 review, BLOCKER). Use this instead of the constructor
 * whenever a test needs "the command exited non-zero".
 */
export const execErrorLikeExec = (cmd: string, code: number | null, stderr: string, timedOut = false): ExecError =>
  new ExecError(cmd, code, stderr || `Command failed: ${cmd}\n`, timedOut);
