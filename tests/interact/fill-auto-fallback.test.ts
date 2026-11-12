import { describe, expect, it, vi } from 'vitest';
import { AutoTreeSource, type WdaSide } from '../../src/adapters/auto-tree-source.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbTreeSource } from '../../src/adapters/ios-tree-source.js';
import { fillField, FillValueFailure } from '../../src/interact/fill.js';
import { typeIntoFocused } from '../../src/interact/type-text.js';
import { NO_EYES } from '../helpers/eyes.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * A41a review M2: under `treeSource: auto` the fill's first check of the value runs against WDA_TYPEABLE (no read has
 * made the choice yet); the resolution's read then falls back to idb. A value only WebDriverAgent types is refused
 * there — before the focus tap and the clear — and never reaches `idb ui text`.
 */
const DESCRIBE_ALL = 'idb ui describe-all --json --udid AAAA-1111';
const FORM = JSON.stringify([
  { type: 'Application', AXLabel: 'AveriLab', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { type: 'TextField', AXLabel: 'Name', AXUniqueId: 'lab.name', AXValue: '', frame: { x: 20, y: 200, width: 362, height: 44 } },
]);

function fallenBack() {
  const calls: string[] = [];
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    return { stdout: Buffer.from(full === DESCRIBE_ALL ? FORM : ''), stderr: '' };
  };
  const wda: WdaSide = {
    kind: 'wda',
    bringUp: () => Promise.reject(new Error('WebDriverAgent requires the appium-webdriveragent package, an optional dependency')),
    read: () => Promise.reject(new Error('never read')),
    applicationLabel: () => Promise.reject(new Error('never asked')),
    typeText: () => Promise.reject(new Error('never typed')),
    dispose: () => Promise.resolve(),
  };
  const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: new AutoTreeSource({ wda, idb: new IdbTreeSource({ udid: 'AAAA-1111', exec }) }) });
  return { adapter, calls };
}

describe('a fill under treeSource auto whose first read falls back to idb (A41a review M2)', () => {
  it('a value only WebDriverAgent types is refused after the resolution read — nothing tapped, cleared or typed', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { adapter, calls } = fallenBack();
    const err = await fillField(adapter, 'id:lab.name', 'Šťastný', { ambiguous: 'first', clear: true, timeoutMs: 200, pollMs: 2, eyes: NO_EYES }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FillValueFailure);
    expect((err as FillValueFailure).fillValue).toBe('refused');
    expect((err as Error).message).toMatch(/^cannot type U\+0160 .*Refused before anything was sent — nothing tapped, cleared or typed/s);
    expect(calls).toContain(DESCRIBE_ALL);
    // Reads only (the tree, the screen's description) — no tap, no key, no text.
    expect(calls.filter((c) => /^idb ui (tap|text|key|swipe)/.test(c))).toEqual([]);
    expect(calls.every((c) => c === DESCRIBE_ALL || c === 'idb describe --json --udid AAAA-1111')).toBe(true);
    errors.mockRestore();
  });

  it('the adapter\'s backstop: a text that needs WDA reaching typeText after the fallback is refused as ADR 0037 words it, nothing sent', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { adapter, calls } = fallenBack();
    await adapter.uiTree(); // the choice: idb
    await expect(adapter.typeText('Šťastný')).rejects.toThrow(/^cannot type U\+0160 .*Refused before anything was sent/s);
    await expect(typeIntoFocused(adapter, 'Šťastný')).rejects.toThrow(/^cannot type U\+0160/);
    expect(calls.filter((c) => c.startsWith('idb ui text'))).toEqual([]);
    errors.mockRestore();
  });
});
