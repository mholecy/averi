import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { dismissKeyboard, resolveClearOfKeyboard, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { seenLook, withNote } from '../../src/interact/keyboard-model.js';
import { judgeRead } from '../../src/interact/scroll-read.js';
import { FAST, hidesKeyboardOn, iosLoginFake, node } from '../helpers/fake.js';

// ONE SCENE PER LOOK (ui-tree/look.ts#Look, carried by interact/keyboard-model.ts#SeenLook): a look carries its tree's
// scene, derived on first use, and every judgement of that look reads it — the tap's (interact/tap-judgement.ts#judgeTap)
// and the dismissal picker's (interact/keyboard-dismissal.ts#configuredStrategy) — none derives its own (the scroll read builds
// its own look, once a read). The Look's own contract is pinned in tests/ui-tree/look.test.ts; here, that the guard's
// looks are what the judgements read. Counted here as the walks sceneOf (ui-tree/standing.ts) makes, one per tree it is
// handed, and the readings readKeyboard (ui-tree/keyboard-cover.ts) builds, one per look; the guard's sleeps are not
// waited on.
const { walked, readings } = vi.hoisted(() => ({ walked: [] as UiNode[], readings: [] as (UiNode | undefined)[] }));
vi.mock('../../src/ui-tree/standing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui-tree/standing.js')>();
  return { ...real, sceneOf: (tree: UiNode) => (walked.push(tree), real.sceneOf(tree)) };
});
vi.mock('../../src/ui-tree/keyboard-cover.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui-tree/keyboard-cover.js')>();
  return { ...real, readKeyboard: (...args: Parameters<typeof real.readKeyboard>) => (readings.push(args[1]), real.readKeyboard(...args)) };
});
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));
beforeEach(() => {
  walked.length = 0;
  readings.length = 0;
});

const TITLE: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };

describe('a seen look carries its scene', () => {
  const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', identifier: 'b', rect: { x: 10, y: 10, width: 100, height: 40 } })] });
  const resolved = { node: tree.children[0], tree };

  it('a look with its keyboard sentence (withNote) is the same look: its scene, not a second one', () => {
    const look = seenLook({}, resolved);
    const cleared = withNote(look, 'the soft keyboard covered b; gone on the second look');
    expect(walked).toEqual([]);
    expect(cleared.look).toBe(look.look);
    expect(cleared.look.scene).toBe(look.look.scene);
    expect(walked).toEqual([tree]);
  });
});

describe('the keyboard guard and the dismissal: one walk per look judged', () => {
  it('the clear path: the first look, judged once — the on-screen rule and the aim read one scene', async () => {
    const fake = iosLoginFake({ band: null });
    await resolveClearOfKeyboard(fake, 'id:login_submit', FAST);
    expect(walked).toHaveLength(1);
  });

  it('a dismissal tap: the first look (judged), the second (the picker), the confirming one (judged) — three walks', async () => {
    const fake = iosLoginFake({ onTap: hidesKeyboardOn('login_title') });
    const clear = await resolveClearOfKeyboard(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE] });
    expect(clear.keyboardHidden).toBeDefined();
    expect(walked).toHaveLength(3);
  });

  it("dismissKeyboard: its one tree read's scene, the picker's", async () => {
    const fake = iosLoginFake({ onTap: hidesKeyboardOn('login_title') });
    expect(await dismissKeyboard(fake, { ambiguous: 'refuse', dismissals: [TITLE] })).toEqual({ hiddenBy: 'tapping id:"login_title"' });
    expect(walked).toHaveLength(1);
  });
});

describe('the in-tree guard handing the target back clear: judged on its second look, not a third', () => {
  /** Let the `n`th tree read (1-based) see the live screen changed by `change`. */
  const onRead = (fake: ReturnType<typeof iosLoginFake>, n: number, change: (live: UiNode) => void) => {
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === n) change(fake.live());
      return real();
    };
  };
  it.each([
    ['the keyboard gone on the second look', (live: UiNode): void => void live.children.splice(3), 'gone on the second look'],
    ['still up, the target moved out from under it', (live: UiNode): void => void (live.children[2].rect.y = 400), 'still up on the second look, but no longer over it'],
  ] as const)('%s: two looks, two readings, two walks — the cleared look\'s scene is the one its reading was taken with', async (_name, change, said) => {
    const fake = iosLoginFake();
    onRead(fake, 3, change);
    const clear = await resolveClearOfKeyboard(fake, 'id:login_submit', FAST);
    expect(clear.keyboardHidden).toBe(`the soft keyboard covered id:login_submit; ${said}`);
    expect(readings).toHaveLength(2);
    expect(walked).toEqual(readings);
  });
});

describe("scroll_until's read: one look, one walk", () => {
  it('judgeRead walks its tree once, and its facts\' scene and keyboard read after it walk nothing more', () => {
    const BOX = { x: 0, y: 0, width: 402, height: 874 };
    const target = node({ role: 'button', identifier: 't', rect: { x: 0, y: 300, width: 402, height: 50 } });
    const tree = node({ role: 'container', rect: BOX, children: [node({ role: 'scrollable', rect: BOX, children: [target] })] });
    const j = judgeRead({ tree, found: [target], ofKeyboard: () => false, remedy: { dismissal: 'none', advice: undefined } }, { box: BOX, boxes: [BOX], oriented: BOX, from: 'device' }, false);
    if ('ask' in j) throw new Error('asked');
    for (let i = 0; i < 3; i++) {
      void j.facts.scene.order;
      j.facts.keyboard.line();
    }
    expect(walked).toEqual([tree]);
  });
});
