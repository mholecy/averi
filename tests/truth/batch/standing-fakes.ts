import { writeFileSync } from 'node:fs';
import { failuresJson } from '../../../scripts/truth/batch/cases.js';
import type { ChooserPremise } from '../../../scripts/truth/chooser-premise.js';
import { D68_SPREAD, UNAIMABLE_LEGS } from '../../../scripts/truth/live-carousel.js';
import { summarize, THIS_CHECKOUT, type Case, type Result as LiveResult } from '../../../scripts/truth/live-cases.js';
import type { Source } from '../../../scripts/truth/live-forms.js';
import type { LiveVerdict } from '../../../scripts/truth/live-visibility.js';
import type { Answer } from './lab-fakes.js';

// The standing batches' live runs as main judges them (lab-run.test.ts, lab-run-ios.test.ts, standing.test.ts): a
// result per case, synthesized, through live-cases.ts#summarize's own lines, exit code and failure reasons — and the
// rejudge's `--failures` file written as scripts/truth/live.ts writes it. Apart from lab-fakes.ts: the other lab tests
// need no live-cases.ts (its case tables are a heavy import, paid by every mutant's run).

/** One case's result as a live run judged it, synthesized: its id, source, group and verdict (an ok one by default). */
export const liveResult = (id: string, source: Source, verdict: LiveVerdict = { outcome: 'ok', why: 'fine' }, group: Case['group'] = 'forms'): LiveResult => ({
  source,
  c: { id, group, cell: 'form-basic', says: 'says', calls: [], judge: () => verdict },
  verdict,
  replies: [],
});

/** The carousel's unaimable legs, every one ended hedged (D68_SPREAD's acceptance): the hedged ceiling's MISMATCH. */
export const hedgedLegs = (source: Source): LiveResult[] =>
  UNAIMABLE_LEGS.map((id) => liveResult(id, source, { outcome: 'ok', why: 'hedged', accepted: { id: D68_SPREAD.id, residual: D68_SPREAD.residual } }, 'carousel'));

/** live-cases.ts#summarize over these results, a run of this checkout (a rejudge's when `rejudgedFrom` names its record). */
export const liveSummary = (platform: 'android' | 'ios', results: readonly LiveResult[], o: { rejudgedFrom?: string; premise?: ChooserPremise } = {}) =>
  summarize({ platform, sources: [...new Set(results.map((r) => r.source))], results, side: THIS_CHECKOUT, ...o });

/**
 * `live.ts --rejudge <record> … --failures <file>` as main answers it, over these results: live-cases.ts#summarize's
 * own lines and exit code, and its failure reasons written where `--failures` names (scripts/truth/live.ts's rejudge).
 */
export function rejudgeAnswer(args: readonly string[], platform: 'android' | 'ios', results: readonly LiveResult[], premise?: ChooserPremise): Answer {
  const s = liveSummary(platform, results, { rejudgedFrom: args[args.indexOf('--rejudge') + 1], premise });
  const at = args.indexOf('--failures');
  if (at >= 0) writeFileSync(args[at + 1], failuresJson(s.failures));
  return { code: s.exitCode, out: `${s.lines.join('\n')}\n`, err: '' };
}
