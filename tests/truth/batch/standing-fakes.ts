import type { ChooserPremise } from '../../../scripts/truth/chooser-premise.js';
import { D68_SPREAD, UNAIMABLE_LEGS } from '../../../scripts/truth/live-carousel.js';
import { summarize, THIS_CHECKOUT, type Case, type Result as LiveResult } from '../../../scripts/truth/live-cases.js';
import type { Source } from '../../../scripts/truth/live-forms.js';
import type { LiveVerdict } from '../../../scripts/truth/live-visibility.js';

// A standing batch's live run as main judges it (standing.test.ts alone): a result per case, synthesized, through
// live-cases.ts#summarize's own lines, exit code and failure reasons. Its own file: no other lab test imports
// live-cases.ts (its case tables are a heavy import, paid by every mutant's run of the lab group).

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

/**
 * live-cases.ts#summarize over these results, a run of this checkout (a rejudge's when `rejudgedFrom` names its
 * record).
 */
export const liveSummary = (platform: 'android' | 'ios', results: readonly LiveResult[], o: { rejudgedFrom?: string; premise?: ChooserPremise } = {}) =>
  summarize({ platform, sources: [...new Set(results.map((r) => r.source))], results, side: THIS_CHECKOUT, ...o });
