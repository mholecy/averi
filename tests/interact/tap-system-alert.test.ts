import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { iosStatusBand } from '../../src/adapters/ios-status-band.js';
import type { UiNode } from '../../src/adapters/types.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { AmbiguityRefusal } from '../../src/interact/resolve.js';
import { tapElement, type TapAdapter } from '../../src/interact/tap.js';
import { OffScreenRefusal } from '../../src/interact/tap-judgement.js';

// D57 (ADR 0032's D57 amendment): the alert replies advise `tap text:"<label>"` first, so the real tapElement — the
// MCP `tap` tool's selector path, with its `ambiguous` option `'refuse'` — is pinned over the captured "Open in
// “AveriLab”?" trees (batch-5 D49A: idb over SpringBoard, WDA over SpringBoard, WDA with Contacts beneath). No tap code
// is D57's: idb lists the alert alone, and on WDA the alert is the marked top layer, so each label resolves to the
// alert's own Button at its centre (batch-7 B observed the same on a device in 8 cases, one run each). A minimal tap
// adapter, since the fake's tap needs an id.

const json = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const IDB_SB = JSON.stringify(
  ((await json('idb-springboard-open-in-alert.json')) as { elements: unknown[] }).elements,
);
const WDA_SB = await json('wda-capture-springboard-open-in-alert.json');
const WDA_CT = ((await json('wda-capture-contacts-open-in-alert.json')) as { value: unknown }).value;

/** Each source's tree of the alert, parsed afresh on every read (the guard may mark what it reads). */
const TREES: Record<string, () => UiNode> = {
  'idb over SpringBoard': () => parseIdbDescribeAll(IDB_SB),
  'WDA over SpringBoard': () => parseWdaSourceValue(WDA_SB),
  'WDA over Contacts': () => parseWdaSourceValue(WDA_CT),
};

/** The lab simulator's screen (iPhone 17, iOS 27.0), as the captures were read. */
const SCREEN = { width: 402, height: 874 };

/** A tap adapter over a static tree: every read is `read()`, every tap recorded, no keyboard. */
function alertDevice(read: () => UiNode) {
  const taps: string[] = [];
  const adapter: TapAdapter = {
    uiTree: async () => read(),
    tap: async (x, y) => void taps.push(`${x},${y}`),
    swipe: async () => undefined,
    keyboard: undefined,
    keyboardAdvice: 'tap outside the field',
    pressKey: async () => undefined,
    viewport: async () => ({ ...SCREEN, statusBand: iosStatusBand(SCREEN) }),
    settleCadenceMs: undefined,
  };
  return { adapter, taps };
}

/** Its `ambiguous` option `'refuse'`, as the MCP tap passes it (mcp/tools.ts), with a short timeout and cadence. */
const OPTS = { ambiguous: 'refuse', timeoutMs: 300, pollMs: 1 } as const;

describe("tap text:\"<label>\" over iOS's system alert — the alert's own Button, at its centre (D57)", () => {
  for (const [source, read] of Object.entries(TREES)) {
    it(`${source}: text:"Cancel" taps (127, 474), text:"Open" taps (275, 474), once each, with no note`, async () => {
      for (const [label, at] of [
        ['Cancel', '127,474'],
        ['Open', '275,474'],
      ]) {
        const { adapter, taps } = alertDevice(read);
        expect(await tapElement(adapter, `text:"${label}"`, OPTS)).toEqual({});
        expect(taps).toEqual([at]);
      }
    });
  }

  it('WDA over Contacts: the hidden breadcrumb "Return to AveriLab" is refused, the alert named', async () => {
    const { adapter, taps } = alertDevice(TREES['WDA over Contacts']);
    const refused = tapElement(adapter, 'text:"Return to AveriLab"', OPTS);
    await expect(refused).rejects.toThrow(OffScreenRefusal);
    await expect(refused).rejects.toThrow(
      /an alert is presented over it \("Open in “AveriLab”\?"\) — close it first; nothing was tapped/,
    );
    expect(taps).toEqual([]);
  });

  it('a second, hidden "Cancel" Button outside the alert: refused as ambiguous, both named', async () => {
    const { adapter, taps } = alertDevice(() => {
      const tree = TREES['WDA over Contacts']();
      const behind: UiNode = {
        role: 'button',
        label: 'Cancel',
        identifier: null,
        value: null,
        rect: { x: 10, y: 600, width: 80, height: 40 },
        children: [],
        hidden: true,
      };
      return { ...tree, children: [behind, ...tree.children] };
    });
    const refusal = await tapElement(adapter, 'text:"Cancel"', OPTS).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(AmbiguityRefusal);
    // Both matches named, one line each: the one behind and the alert's own.
    const named = (refusal as Error).message.split('\n').filter((l) => l.trim() === 'button id=null label="Cancel"');
    expect((refusal as Error).message).toMatch(/^Selector matches 2 elements: text:"Cancel"\n/);
    expect(named).toHaveLength(2);
    expect(taps).toEqual([]);
  });
});
