import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { Verifier, type AssertSpec } from '../../src/verify/assert.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';

// EVERY ASSERT'S NOT-FOUND SAYS WHAT THE LAST READ SAW (verify/poll-verdict.ts#notFound, over ui-tree/miss.ts#missOf):
// on a source that lists the active window only, and on a tree whose root is marked presented, the headline carries
// the miss's note — each assert kind's, on the lab's real captures. The headline alone would tell the agent the
// element is missing from a screen the tree never listed.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const ANDROID = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const dump = (cell: string): UiNode => parseDump(readFileSync(new URL(`${cell}.xml`, ANDROID), 'utf8'));
const idb = (cell: string): UiNode => parseIdbDescribeAll(readFileSync(new URL(`${cell}.idb.json`, IOS), 'utf8'));

const PRESENTED_DIALOG = 'not found within 1 s (a dialog is presented over it, and the tree lists only that window — close it first)';
const PRESENTED_LAYER = 'not found within 1 s (a sheet or modal is presented over it, and the tree lists only that layer — close it first)';

const engine = { recognize: async () => [] };
const ghost = { id: 'ghost' };
/** Every assert kind that can miss its element, with the same absent target. */
const KINDS: Record<string, AssertSpec> = {
  exists: { element: ghost, timeout: '1s' },
  text: { element: ghost, text: 'x', timeout: '1s' },
  match: { element: ghost, match: 'x', timeout: '1s' },
  error: { element: ghost, error: 'x', timeout: '1s' },
  rect: { element: ghost, rect: { x: 100, frameWidth: 1000 }, timeout: '1s' },
  color: { element: ghost, color: { expected: '#FFFFFF' }, timeout: '1s' },
  ocr: { element: ghost, ocr: { text: 'x' }, timeout: '1s' },
};

const detailOn = async (tree: UiNode, spec: AssertSpec): Promise<string | undefined> =>
  (await new Verifier(new FakeAdapter({ s: tree }, 's'), { pollMs: 300, ocr: { engine } }).assert(spec)).detail;

describe("every assert's not-found carries the last read's miss note", () => {
  for (const [kind, spec] of Object.entries(KINDS)) {
    it(`${kind}: on uiautomator's active window (open.xml), the note that the tree lists only the active window`, async () => {
      expect(await detailOn(dump('open'), spec)).toBe(
        'not found within 1 s (the tree lists only the active window: if a sheet or a dialog is open over the screen, close it first)',
      );
    });

    it(`${kind}: on uiautomator's presented dialog (alert-dim.xml), the note that the dialog is presented and alone in the tree`, async () => {
      expect(await detailOn(dump('alert-dim'), spec)).toBe(PRESENTED_DIALOG);
    });

    it(`${kind}: on idb's list marked presented (sheet-medium.idb.json), the note that the layer is presented and alone in the tree`, async () => {
      expect(await detailOn(idb('sheet-medium'), spec)).toBe(PRESENTED_LAYER);
    });
  }
});
