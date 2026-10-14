import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import type { Recording } from '../../scripts/differential/corpus.js';
import { compareRecording } from '../../scripts/differential/differential.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';
import { COMPOSE } from '../helpers/android-dumps.js';

// The differential over the committed sample — three tests/fixtures trees, one per raw source kind — through the tool
// interface: the same code on both sides differs nowhere, and a side whose parser reads one node differently differs
// exactly where a tool reads that node. Capped to a few targets a tree: this is the harness's own test, not a run.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const IPHONE = { width: 402, height: 874 };

let side: Side;
let sample: Recording[];
beforeAll(async () => {
  installFakeDevice();
  installVirtualClock();
  side = await loadSide(ROOT);
  sample = [
    { id: 'sample/wda-source-skeleton-login.json', run: 'sample', file: 'wda-source-skeleton-login.json', platform: 'ios', source: 'wda', form: 'raw', screen: IPHONE, payload: await fixture('wda-source-skeleton-login.json') },
    { id: 'sample/idb-swift-form-continue.json', run: 'sample', file: 'idb-swift-form-continue.json', platform: 'ios', source: 'idb', form: 'raw', screen: IPHONE, payload: await fixture('idb-swift-form-continue.json') },
    { id: 'sample/compose-sign-in.xml', run: 'sample', file: 'compose-sign-in.xml', platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn },
  ];
});

describe('compareRecording', () => {
  it('the same code on both sides: every call of every variant answers alike on the sample', async () => {
    for (const r of sample) {
      const result = await compareRecording(r, side, side, { cap: 3 });
      expect([r.id, result.parser, result.diffs.map((d) => `${d.variant} ${d.call.tool}`)]).toEqual([r.id, 'exercised', []]);
      expect(result.calls).toBeGreaterThan(10);
      expect(Object.keys(result.perTool).sort()).toEqual(['assert', 'scroll_until', 'swipe', 'tap', 'ui_snapshot']);
    }
  });

  it('a NEW whose WDA parser moves one node off the screen: the snapshot differs, and every call that targets that node, and nothing else', async () => {
    const login = sample[0];
    const moved: Side = {
      ...side,
      parseWdaSourceValue: (value) => {
        const tree = side.parseWdaSourceValue(value);
        const walk = (n: UiNode): UiNode | undefined => (n.label === 'Log in' ? n : n.children.map(walk).find(Boolean));
        const node = walk(tree)!;
        node.rect = { ...node.rect, y: node.rect.y + 2000 };
        return tree;
      },
    };
    const result = await compareRecording(login, side, moved, { cap: 5, tools: new Set(['ui_snapshot', 'tap']) });
    const differing = [...new Set(result.diffs.map((d) => `${d.call.tool} ${String(d.call.args.selector ?? '')}`))];
    expect(differing).toEqual(['ui_snapshot ', 'tap text:"Log in"']);
    const tap = result.diffs.find((d) => d.call.tool === 'tap' && d.variant === 'screen')!;
    expect(tap.old.device.filter((c) => c.startsWith('idb ui tap'))).toHaveLength(1);
    expect(tap.new.device.filter((c) => c.startsWith('idb ui tap'))).toEqual([]);
  });
});
