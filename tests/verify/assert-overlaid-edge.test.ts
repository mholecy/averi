import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { Verifier } from '../../src/verify/assert.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

// THE PIXEL ASSERT ON A NODE COMPOSE CUT AT AN OVERLAY (ui-tree/standing.ts#OverlaidEdge): the tree shows the pinned
// button only by the cut, so the assert fails closed naming it, saying the element may run on
// under it — never a PASS on the cut rect's own colour. The lab's real captures and screenshots.
// docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const ANDROID = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
const dump = (cell: string): UiNode => parseDump(readFileSync(new URL(`${cell}.xml`, ANDROID), 'utf8'));

const colourOn = async (cell: string, id: string, expected: string): Promise<{ passed: boolean; detail: string | undefined }> => {
  const fake = new FakeAdapter({ s: dump(cell) }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  fake.nextScreenshot = readFileSync(new URL(`${cell}.png`, ANDROID));
  const r = await new Verifier(fake, { pollMs: 300 }).assert({ element: { id }, color: { expected }, timeout: '1s' });
  return { passed: r.pass, detail: r.detail };
};

const RUNS_ON = "drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the rest of the element may lie under that container";

describe('the colour assert on a node cut at an overlay fails closed naming it', () => {
  it('pinned-bar P under Continue (in no scroll view): the cut named, and the clear-child advice', async () => {
    const { passed, detail } = await colourOn('pinned-bar', 'lab.pinned-bar.P', '#E53935');
    expect(passed).toBe(false);
    expect(detail).toContain(`container id:lab.pinned-bar.continue (66,1956 948x154) meets the element's bottom edge (element 127,1846 825x110), ${RUNS_ON}`);
    expect(detail).toContain('assert something in it that lies clear of that; failing closed, color unchecked');
  });
  it('bands Q above N\'s touch target, exactly as wide: no overlay — the colour is measured', async () => {
    expect((await colourOn('bands', 'lab.bands.Q', '#FB8C00')).passed).toBe(true);
  });
});
