import { ExecError } from '../../src/adapters/exec.js';
import { shownCommand } from '../../src/adapters/failure-text.js';

/**
 * Build an ExecError the way `exec.ts` builds one: when the child wrote
 * nothing to stderr, `exec.ts:60` substitutes node's `err.message`
 * ("Command failed: <cmd>\n"), so a real ExecError NEVER has a blank `stderr`.
 * A fixture built with `new ExecError(cmd, 1, '')` is a shape production
 * cannot emit — a guard written against it passed its test and was dead on a
 * device (2026-09-18 review, BLOCKER). Use this instead of the constructor
 * whenever a test needs "the command exited non-zero".
 */
export const execErrorLikeExec = (
  cmd: string,
  code: number | null,
  stderr: string,
  opts: {
    timedOut?: boolean;
    /** What the command printed to stdout before failing (monkey's diagnosis lives there). */
    stdout?: string;
  } = {},
): ExecError => new ExecError(cmd, code, stderr || `Command failed: ${cmd}\n`, opts.timedOut ?? false, Buffer.from(opts.stdout ?? ''));

/**
 * A failed typing's ExecError as exec throws it since A17: `cmd args` shown with `<typed text>` at the indexes the call
 * declared (ExecOptions.typed — a fake ExecFn passes its `opts?.typed`), node's own line standing in for a silent
 * child as execErrorLikeExec says. A fake that threw `[cmd, ...args].join(' ')` would put the text in the command.
 */
export const typingExecError = (
  cmd: string,
  args: readonly string[],
  typed: readonly number[] | undefined,
  code: number | null,
  stderr: string,
): ExecError => execErrorLikeExec(shownCommand(cmd, args, typed), code, stderr);
