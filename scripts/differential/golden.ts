import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import type { Recording } from './corpus.js';
import { configFor, connect } from './differential.js';
import { expectations, formExpectations, replyKind, sent, type ReplyKind, type Verb } from './golden-spec.js';
import type { Side } from './side.js';
import { pct, type CellTruth } from '../truth/schema.js';
import { consistency, controlConsistency, outOfProcessKeyboard } from '../truth/truth.js';

/**
 * The golden mode (docs/plans/2026-10-15-ground-truth-lab-app.md): ground-truth captures (scripts/truth/capture.ts)
 * replayed through ONE side, the fake device serving the screenshot the device showed, and each verb's answer judged
 * against what the truth implies (golden-spec.ts) — not against another checkout. A mismatch is a bug found without a
 * device round; a target whose truth's sources disagree is a broken cell, reported and not judged.
 *
 *   node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth [--side <git ref | path>] [--worktrees <dir>]
 *
 * The side defaults to this checkout. Exit code 1 on a mismatch or a broken target.
 */

export interface GoldenCheck {
  recording: string;
  target: string;
  verb: Verb;
  says: string;
  /** undefined: as the truth implies. */
  mismatch?: string;
  reply: string;
  /** What kind of reply it is (golden-spec.ts#replyKind): the ratchet pins it for a known mismatch. */
  kind: ReplyKind;
  /** The taps and swipes the device was sent (golden-spec.ts#sent): the ratchet pins them for a known mismatch. */
  calls: string[];
}

export interface GoldenResult {
  recording: string;
  checks: GoldenCheck[];
  /** Targets and controls whose truth's sources disagree (scripts/truth/truth.ts#consistency, #controlConsistency). */
  broken: string[];
}

export async function goldenRecording(recording: Recording, side: Side): Promise<GoldenResult> {
  if (recording.truth === undefined || recording.screenshot === undefined) throw new Error(`golden: ${recording.id} names no truth or screenshot`);
  const truth = JSON.parse(await readFile(recording.truth, 'utf8')) as CellTruth;
  const screenshot = await readFile(recording.screenshot);
  const png = PNG.sync.read(screenshot);
  const result: GoldenResult = { recording: recording.id, checks: [], broken: [] };
  const profile = {
    platform: recording.platform,
    screen: recording.screen ?? truth.screen,
    frame: { width: png.width, height: png.height },
    screenshot,
    ...(recording.app !== undefined && { app: recording.app }),
  };
  const config = await configFor(recording, undefined);
  const c = await connect(side, recording, profile);
  try {
    for (const t of truth.targets) {
      const why = consistency(t);
      if (why !== undefined) {
        result.broken.push(`${t.tag}: ${why}`);
        continue;
      }
      for (const e of expectations(recording.platform, t)) {
        const outcome = await c.call(e.call, config);
        const mismatch = e.judge(outcome);
        result.checks.push({ recording: recording.id, target: t.tag, verb: e.verb, says: e.says, ...(mismatch !== undefined && { mismatch }), reply: outcome.reply, kind: replyKind(outcome), calls: sent(outcome) });
      }
    }
    // A form cell: its rows are judged unless a control's probe disagrees with its frame — then the cell is broken.
    const brokenControls = (truth.form?.controls ?? []).flatMap((c) => {
      const why = controlConsistency(c, outOfProcessKeyboard(recording.platform, truth.form?.keyboard?.frame));
      return why === undefined ? [] : [`${c.tag}: ${why}`];
    });
    result.broken.push(...brokenControls);
    if (brokenControls.length === 0) {
      for (const e of formExpectations(recording.platform, truth)) {
        const outcome = await c.call(e.call, config);
        const mismatch = e.judge(outcome);
        result.checks.push({ recording: recording.id, target: e.target, verb: e.verb, says: e.says, ...(mismatch !== undefined && { mismatch }), reply: outcome.reply, kind: replyKind(outcome), calls: sent(outcome) });
      }
    }
  } finally {
    await c.close();
  }
  return result;
}

/** The report: per capture, each target's verbs `ok` or `MISMATCH`, and the broken targets. */
export function goldenReport(results: readonly GoldenResult[]): string {
  const checks = results.flatMap((r) => r.checks);
  const bad = checks.filter((c) => c.mismatch !== undefined);
  const lines = [`# Golden: ${checks.length} checks, ${bad.length} mismatches, ${results.reduce((a, r) => a + r.broken.length, 0)} broken targets`, ''];
  for (const r of results) {
    lines.push(`## ${r.recording}`);
    for (const b of r.broken) lines.push(`- BROKEN ${b}`);
    for (const c of r.checks) lines.push(c.mismatch === undefined ? `- ok ${c.target} ${c.verb}: ${c.says}` : `- MISMATCH ${c.target} ${c.verb}: expected ${c.says} — ${c.mismatch}`);
    lines.push('');
  }
  return lines.join('\n');
}

export { pct };

// --- the command line ---

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { corpus: { type: 'string' }, side: { type: 'string' }, worktrees: { type: 'string' } } });
  if (values.corpus === undefined) throw new Error('usage: golden.ts --corpus <dir> [--side <ref|path>] [--worktrees <dir>]');
  // The checkout first: git runs before the fake device refuses every process.
  const { codeRoot } = await import('./checkout.js');
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const code = codeRoot(repo, values.side ?? repo, 'golden', resolve(values.worktrees ?? tmpdir()));
  const cleanup = code.cleanup === undefined ? undefined : (await import('node:child_process')).execFileSync.bind(null, 'git', ['-C', repo, 'worktree', 'remove', '--force', code.root], { stdio: 'ignore' });
  const { installFakeDevice } = await import('./fake-device.js');
  const { installVirtualClock } = await import('./clock.js');
  installFakeDevice();
  installVirtualClock();
  const { loadSide } = await import('./side.js');
  const { loadCorpus } = await import('./corpus.js');
  try {
    const side = await loadSide(code.root);
    const corpus = (await loadCorpus(resolve(values.corpus))).filter((r) => r.truth !== undefined);
    const results: GoldenResult[] = [];
    for (const r of corpus) results.push(await goldenRecording(r, side));
    console.log(goldenReport(results));
    if (results.some((r) => r.broken.length > 0 || r.checks.some((c) => c.mismatch !== undefined))) process.exitCode = 1;
  } finally {
    cleanup?.();
  }
}
