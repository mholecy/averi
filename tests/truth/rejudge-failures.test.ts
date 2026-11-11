import { describe, expect, it } from 'vitest';
import { FAILURES_SUFFIX, failuresJson, failuresOf } from '../../scripts/truth/rejudge-failures.js';

// scripts/truth/rejudge-failures.ts: the `.rejudge.json` format (A21) — a rejudge's failure reasons, written by
// live.ts --rejudge --failures, read back by the standing batches' judge (batch/standing.ts), fail closed.

describe('failuresJson and failuresOf — a rejudge\'s failure reasons as data beside its summary (A21)', () => {
  it('the suffix beside a run\'s name', () => {
    expect(FAILURES_SUFFIX).toBe('.rejudge.json');
  });

  it('written as one JSON object; read back whole', () => {
    expect(failuresJson(['MISMATCH lc1', 'a — b'])).toBe('{"failures":["MISMATCH lc1","a — b"]}\n');
    expect(failuresOf(failuresJson(['MISMATCH lc1', 'a — b']))).toEqual(['MISMATCH lc1', 'a — b']);
    expect(failuresOf(failuresJson([]))).toEqual([]);
  });

  it('fail closed: no text, no JSON, or not its shape is undefined — never "no failure"', () => {
    for (const text of [undefined, '', 'not json', 'null', '5', '"x"', '[]', '{}', '{"failures":"x"}', '{"failures":[1]}', '{"failures":["a",null]}']) {
      expect(failuresOf(text), String(text)).toBeUndefined();
    }
  });
});
