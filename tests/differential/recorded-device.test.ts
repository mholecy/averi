import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import type { Recording } from '../../scripts/differential/corpus.js';
import { deviceCalls, installFakeDevice } from '../../scripts/differential/fake-device.js';
import { loadSide, recordedAdapter, type Side } from '../../scripts/differential/side.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';

// The recorded device: a side's own adapter over a recorded payload — the iOS tree-source seam (RecordedTreeSource
// for WDA, the side's IdbTreeSource over the fake device for idb) and Android's exec (the side's AndroidAdapter, its
// dump answered by the fake device). What a tool reads through it must be what the live source would have read.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const IPHONE = { width: 402, height: 874 };
const PIXEL = { width: 1080, height: 2220 };

const recording = (over: Partial<Recording> & Pick<Recording, 'platform' | 'source' | 'form' | 'payload'>): Recording => ({
  id: 'sample/tree',
  run: 'sample',
  file: 'tree',
  ...over,
});

const all = (tree: UiNode): UiNode[] => [...everyNode(tree)];
const at = (n: UiNode) => `${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`;

let side: Side;
beforeAll(async () => {
  installFakeDevice();
  side = await loadSide(ROOT);
});

describe('a raw WDA capture is read through the side\'s own WDA parser', () => {
  it('the pushed SWIFT form: the tab host\'s four buttons a pushed screen hides are `hidden`, at their old place', async () => {
    const adapter = recordedAdapter(side, recording({ platform: 'ios', source: 'wda', form: 'raw', payload: await fixture('wda-capture-swift-form-pushed.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    const tree = await adapter.uiTree();
    const tabs = all(tree).filter((n) => n.identifier?.startsWith('nav.tab_'));
    expect(tabs.map((n) => [n.identifier, at(n).split(' ')[0].split(',')[1], n.hidden])).toEqual([
      ['nav.tab_home', '711', true],
      ['nav.tab_transactions', '711', true],
      ['nav.tab_cards', '711', true],
      ['nav.tab_more', '711', true],
    ]);
    expect(adapter.treeSourceKind).toBe('wda');
  });

  it('Contacts New Contact: the content WDA parks at the sheet\'s origin is placed at its cell, below the screen', async () => {
    const adapter = recordedAdapter(side, recording({ platform: 'ios', source: 'wda', form: 'raw', payload: await fixture('wda-capture-contacts-new-contact.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    const tree = await adapter.uiTree();
    expect(all(tree).filter((n) => n.role === 'text' && n.label === 'add instant message').map(at)).toEqual(['20,1306 362x52']);
  });

  it('each read is a fresh graph: a write into one tree is not in the next', async () => {
    const adapter = recordedAdapter(side, recording({ platform: 'ios', source: 'wda', form: 'raw', payload: await fixture('wda-source-skeleton-login.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    const first = await adapter.uiTree();
    first.children.length = 0;
    expect((await adapter.uiTree()).children.length).toBeGreaterThan(0);
  });
});

describe('a raw idb capture is read by the side\'s IdbTreeSource, its describe-all answered by the fake device', () => {
  it('the flat list under a synthetic 0x0 root marked flatList, one child per element', async () => {
    const adapter = recordedAdapter(side, recording({ platform: 'ios', source: 'idb', form: 'raw', payload: await fixture('idb-swift-form-continue.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    const tree = await adapter.uiTree();
    expect([tree.flatList, at(tree), tree.children.length, adapter.treeSourceKind]).toEqual([true, '0,0 0x0', 9, 'idb']);
    expect(deviceCalls()).toEqual(['idb ui describe-all --json']);
  });
});

describe('a raw uiautomator dump is read by the side\'s AndroidAdapter, the dump answered by the fake device', () => {
  it('the same tree the adapter\'s parser makes of the XML', async () => {
    const adapter = recordedAdapter(side, recording({ platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn }), { platform: 'android', screen: PIXEL, frame: PIXEL });
    expect(await adapter.uiTree()).toEqual(parseDump(COMPOSE.signIn));
    expect(deviceCalls()).toEqual(['adb uiautomator dump']);
  });
});

describe('a normalized capture is served as it is', () => {
  it('iOS and Android alike, a fresh copy per read', async () => {
    const tree = { role: 'container', label: null, identifier: 'root', value: null, rect: { x: 0, y: 0, width: 10, height: 10 }, children: [] };
    for (const [platform, source] of [['ios', 'wda'], ['ios', 'idb'], ['android', 'uiautomator']] as const) {
      const adapter = recordedAdapter(side, recording({ platform, source, form: 'normalized', payload: JSON.stringify(tree) }), { platform, screen: IPHONE, frame: IPHONE });
      const read = await adapter.uiTree();
      expect([platform, source, read]).toEqual([platform, source, tree]);
      read.identifier = 'written';
      expect((await adapter.uiTree()).identifier).toBe('root');
    }
  });
});

describe('the fake device records what a tool would have sent', () => {
  it('a tap and a swipe on each platform, as the adapter words them', async () => {
    const ios = recordedAdapter(side, recording({ platform: 'ios', source: 'wda', form: 'raw', payload: await fixture('wda-source-skeleton-login.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    await ios.tap(10, 20);
    await ios.swipe({ x: 1, y: 2 }, { x: 3, y: 4 });
    expect(deviceCalls()).toEqual(['idb ui tap 10 20', 'idb ui swipe 1 2 3 4 --duration 0.3']);
    const android = recordedAdapter(side, recording({ platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn }), { platform: 'android', screen: PIXEL, frame: PIXEL });
    await android.tap(10, 20);
    expect(deviceCalls()).toEqual(['adb shell input tap 10 20']);
  });

  it('a screenshot is a PNG of the device\'s screen; with no screen the size query fails', async () => {
    const ios = recordedAdapter(side, recording({ platform: 'ios', source: 'wda', form: 'raw', payload: await fixture('wda-source-skeleton-login.json') }), { platform: 'ios', screen: IPHONE, frame: IPHONE });
    const png = await ios.screenshot();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([402, 874]);
    expect(await ios.viewport()).toMatchObject(IPHONE);
    const blind = recordedAdapter(side, recording({ platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn }), { platform: 'android', screen: undefined, frame: PIXEL });
    await expect(blind.viewport()).rejects.toThrow(/wm size/);
  });

  it('Android: a shown keyboard is the docked Gboard\'s band until `back` hides it', async () => {
    const android = recordedAdapter(side, recording({ platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn }), { platform: 'android', screen: PIXEL, frame: PIXEL, keyboard: 'shown' });
    expect(await android.keyboard!.state()).toEqual({ state: 'shown', frame: { x: 0, y: 1398, width: 1080, height: 822 } });
    await android.pressKey('back');
    expect((await android.keyboard!.state()).state).toBe('hidden');
    expect(deviceCalls()).toEqual(['adb shell dumpsys window displays', 'adb shell input keyevent 4', 'adb shell dumpsys window displays']);
  });
});
