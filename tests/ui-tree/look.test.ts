import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import { lookAt, lookOn } from '../../src/ui-tree/look.js';
import { readFile } from 'node:fs/promises';
import { node } from '../helpers/fake.js';

// ONE LOOK per read (ui-tree/look.ts), through its interface: the scene derived once, and the keyboard position over
// that scene and the look's reading, built once. What
// each verb does with a look is pinned through the verb (tap-judgement, look-scene, pixel-chrome, scroll-read,
// keyboard-line-agreement); here, what a look is.
const { walked } = vi.hoisted(() => ({ walked: [] as UiNode[] }));
vi.mock('../../src/ui-tree/standing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui-tree/standing.js')>();
  return { ...real, sceneOf: (tree: UiNode) => (walked.push(tree), real.sceneOf(tree)) };
});

const BOX = { x: 0, y: 0, width: 402, height: 874 };
const tree = (): UiNode => node({ role: 'container', rect: { ...BOX }, children: [node({ role: 'button', identifier: 'b', rect: { x: 10, y: 10, width: 100, height: 40 } })] });
const NO_KEYBOARD = { ofKeyboard: () => false };
/** idb's number pad as recorded: its band's top at 589, its key `5`. */
const pad = async (): Promise<UiNode> =>
  parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));

describe('the scene — derived on first use, once', () => {
  it('nothing walked until asked; then one walk, however often it is read, and the keyboard position reads the same scene', () => {
    walked.length = 0;
    const t = tree();
    const look = lookAt(t, NO_KEYBOARD);
    expect(walked).toEqual([]);
    const scene = look.scene;
    expect(look.scene).toBe(scene);
    look.keyboard.line();
    expect(walked).toEqual([t]);
  });
  it('the keyboard position first: it builds the look\'s scene, and the scene read after it is that one', () => {
    walked.length = 0;
    const t = tree();
    const look = lookAt(t, NO_KEYBOARD);
    look.keyboard.line();
    expect(walked).toEqual([t]);
    void look.scene;
    expect(walked).toEqual([t]);
  });
});

describe('the keyboard — one position over the look\'s scene and its reading', () => {
  it('built once: the same position however often it is read, its reading\'s line asked once', async () => {
    const BAND = { x: 0, y: 500, width: 402, height: 374 };
    const cover: KeyboardCover = { rects: [BAND], top: BAND, band: BAND, remedy: { dismissal: 'back', advice: undefined } };
    const asked = { cover: 0, corroborated: 0 };
    const look = lookAt(tree(), { ofKeyboard: () => false, cover: async () => (asked.cover++, cover), corroborated: async () => (asked.corroborated++, true) });
    expect(look.keyboard).toBe(look.keyboard);
    expect(await look.keyboard.readingLine()).toEqual({ y: 500, witnessed: true });
    expect(await look.keyboard.readingLine()).toEqual({ y: 500, witnessed: true });
    expect(asked).toEqual({ cover: 1, corroborated: 1 });
  });
  it('idb\'s band from the scene\'s draw order: a row under its line, a key of it under none and owned', async () => {
    const t = await pad();
    const look = lookAt(t, NO_KEYBOARD);
    const key = [...(function* all(n: UiNode): Generator<UiNode> { yield n; for (const c of n.children) yield* all(c); })(t)].find((n) => n.role === 'button' && n.label === '5')!;
    expect(look.keyboard.line()).toEqual({ y: 589, witnessed: false });
    expect(look.keyboard.line(key)).toBeUndefined();
    expect(look.keyboard.owns(key)).toBe(true);
  });
  it('`owns` asks the look\'s reading: a node its `ofKeyboard` claims is the keyboard\'s own', () => {
    const t = tree();
    const look = lookAt(t, { ofKeyboard: (n: UiNode) => n === t.children[0] });
    expect(look.keyboard.owns(t.children[0])).toBe(true);
    expect(look.keyboard.owns(t)).toBe(false);
  });
  it('lookOn: the adapter\'s reading off the look\'s tree — no oracle, the in-tree reading and its remedy', () => {
    const look = lookOn({ keyboardAdvice: 'ADV' }, tree());
    expect(look.reading.remedy).toEqual({ dismissal: 'none', advice: 'ADV' });
  });
});
