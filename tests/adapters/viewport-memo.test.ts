import { describe, expect, it } from 'vitest';
import type { DeviceScreen } from '../../src/adapters/types.js';
import { ViewportMemo } from '../../src/adapters/viewport-memo.js';

/**
 * The memo behind both adapters' viewport() (adapters/viewport-memo.ts):
 * a success is kept, a read in flight is shared, a failure is dropped, and
 * `fresh` replaces the memo (the parity code review's A3, 2026-10-07).
 */
describe('ViewportMemo', () => {
  const scripted = (...answers: (DeviceScreen | Error)[]) => {
    let reads = 0;
    const memo = new ViewportMemo(async () => {
      const answer = answers[Math.min(reads++, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    });
    return { memo, reads: () => reads };
  };

  it('keeps a success: one read, however many callers', async () => {
    const { memo, reads } = scripted({ width: 1, height: 2 });
    await Promise.all([memo.get(), memo.get()]);
    await memo.get();
    expect(reads()).toBe(1);
  });

  it('drops a failure once it settles: the next call reads again', async () => {
    const { memo, reads } = scripted(new Error('offline'), { width: 1, height: 2 });
    await expect(memo.get()).rejects.toThrow('offline');
    expect(await memo.get()).toEqual({ width: 1, height: 2 });
    expect(reads()).toBe(2);
  });

  it('shares a failing read while it is in flight, then forgets it', async () => {
    const { memo, reads } = scripted(new Error('offline'), { width: 1, height: 2 });
    const [a, b] = [memo.get(), memo.get()];
    await expect(a).rejects.toThrow('offline');
    await expect(b).rejects.toThrow('offline');
    expect(reads()).toBe(1);
    expect(await memo.get()).toEqual({ width: 1, height: 2 });
  });

  it('fresh reads again over a kept success and becomes the memo; a failed fresh read is not kept', async () => {
    const { memo, reads } = scripted({ width: 1, height: 2 }, { width: 3, height: 4 }, new Error('gone'), { width: 5, height: 6 });
    expect(await memo.get()).toEqual({ width: 1, height: 2 });
    expect(await memo.get({ fresh: true })).toEqual({ width: 3, height: 4 });
    expect(await memo.get()).toEqual({ width: 3, height: 4 });
    await expect(memo.get({ fresh: true })).rejects.toThrow('gone');
    expect(await memo.get()).toEqual({ width: 5, height: 6 });
    expect(reads()).toBe(4);
  });
});
