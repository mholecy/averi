import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { parseDump } from '../helpers/android-dumps.js';
import { play } from '../helpers/rounds.js';

// THE SCREEN-CHANGED STOP over REAL consecutive reads (ui-tree/read-tree.ts#ScreenChange): every pair of trees the
// fixtures hold of ONE screen read before and after it moved — never a `changed` stop, whichever way the stroke between
// them went. The pairs, each played both ways round (before → after, after → before) and with both directions of
// stroke:
// - idb, mp-native's SWIFT form scrolled under its top bar, the device check's six positions (pos1 → … → pos6);
// - WDA, the lab's sheet-long-list at rest, scrolled 273 and 522 (round 6's captures);
// - the lab's scroll-top-edge page at rest and scrolled to its end (scroll-top-edge-end, the same page: its ids carry
//   the cell's name, given back the page's here), under uiautomator, idb and WDA;
// - Android, the lab's form with the keyboard up and after `back` hid it (form-keyboard, form-keyboard-floating).
// A target not in either tree, so the round strokes once after the first read and asks the second.
// What holds them unchanged is the identity: every pair keeps an id. With the identity's condition dropped, 18 of the
// 48 plays touch down on nothing either tree names or scrolls (idb's flat lists, WDA's frames over the screen) and read
// `changed` — the touch-down condition alone would not do (mutation-checked on the slice's review).

const FIXTURES = new URL('../fixtures/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, FIXTURES), 'utf8');
const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const PIXEL: DeviceScreen = { width: 1080, height: 2220, statusBand: 66 };
const asPage = (text: string): string => text.replaceAll('lab.scroll-top-edge-end.', 'lab.scroll-top-edge.');

type Sequence = { name: string; screen: DeviceScreen; reads: readonly UiNode[] };

const sequences = (): Sequence[] => {
  const positions = JSON.parse(read('idb-swift-form-scrolled-under-top-bar.json')).positions as Record<string, unknown>;
  const truth = (cell: string, ext: string, page = false): string => (page ? asPage : (t: string) => t)(read(`truth/${ext.endsWith('.xml') ? 'android-averi_lab-api33' : 'ios-iphone17-ios27'}/${cell}${ext}`));
  return [
    { name: 'idb SWIFT form pos1…pos6', screen: IPHONE, reads: Object.values(positions).map((v) => parseIdbDescribeAll(JSON.stringify(v))) },
    {
      name: 'WDA sheet-long-list 0, 273, 522',
      screen: IPHONE,
      reads: ['wda-capture-lab-sheet-long-list.json', 'wda-capture-lab-sheet-long-list-scrolled-273.json', 'wda-capture-lab-sheet-long-list-scrolled-522.json'].map((f) => parseWdaSource(read(f))),
    },
    { name: 'uiautomator scroll-top-edge, at rest and at its end', screen: PIXEL, reads: [parseDump(truth('scroll-top-edge', '.xml')), parseDump(truth('scroll-top-edge-end', '.xml', true))] },
    { name: 'idb scroll-top-edge, at rest and at its end', screen: IPHONE, reads: [parseIdbDescribeAll(truth('scroll-top-edge', '.idb.json')), parseIdbDescribeAll(truth('scroll-top-edge-end', '.idb.json', true))] },
    { name: 'WDA scroll-top-edge, at rest and at its end', screen: IPHONE, reads: [parseWdaSource(truth('scroll-top-edge', '.wda.json')), parseWdaSource(truth('scroll-top-edge-end', '.wda.json', true))] },
    { name: 'uiautomator form-keyboard, keyboard up and after back', screen: PIXEL, reads: [parseDump(truth('form-keyboard', '.xml')), parseDump(truth('form-keyboard', '.after-back.xml'))] },
    { name: 'uiautomator form-keyboard-floating, keyboard up and after back', screen: PIXEL, reads: [parseDump(truth('form-keyboard-floating', '.xml')), parseDump(truth('form-keyboard-floating', '.after-back.xml'))] },
  ];
};

/** Every consecutive pair of a sequence, both ways round. */
const pairs = (s: Sequence): { name: string; screen: DeviceScreen; before: UiNode; after: UiNode }[] =>
  s.reads.slice(1).flatMap((after, i) => {
    const before = s.reads[i];
    return [
      { name: `${s.name}: ${i + 1} → ${i + 2}`, screen: s.screen, before, after },
      { name: `${s.name}: ${i + 2} → ${i + 1}`, screen: s.screen, before: after, after: before },
    ];
  });

describe('real consecutive reads of one screen: never `changed`', () => {
  const all = sequences().flatMap(pairs);

  it('covers 24 pairs of 7 sequences — idb 12, WDA 6, uiautomator 6 — each played with both directions', () => {
    expect(all).toHaveLength(24);
  });

  it.each(all.flatMap((p) => (['down', 'up'] as const).map((direction) => [`${p.name}, ${direction}`, p, direction] as const)))('%s', (_name, p, direction) => {
    const played = play({ direction, fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: p.screen }, [{ tree: p.before, found: [] }, { tree: p.after, found: [] }]);
    expect(played.steps[0].do).toBe('stroke');
    expect(played.outcome?.kind).not.toBe('changed');
  });
});
