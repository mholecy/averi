import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { dismissKeyboard, resolveClearOfKeyboard, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { withNote, withScene } from '../../src/interact/keyboard-model.js';
import { FAST, hidesKeyboardOn, iosLoginFake, node } from '../helpers/fake.js';

// ONE SCENE PER LOOK (interact/keyboard-model.ts#withScene): a look carries its tree's scene, derived on first use, and
// every judgement of that look in interact/ reads it — the tap's (interact/tap-judgement.ts#judgeTap) and the dismissal picker's
// (interact/keyboard-in-tree.ts#pickDismissal) — none derives its own. Counted here as the walks sceneOf
// (ui-tree/standing.ts) makes, one per tree it is handed; the guard's sleeps are not waited on.
const { walked } = vi.hoisted(() => ({ walked: [] as UiNode[] }));
vi.mock('../../src/ui-tree/standing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui-tree/standing.js')>();
  return { ...real, sceneOf: (tree: UiNode) => (walked.push(tree), real.sceneOf(tree)) };
});
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));
beforeEach(() => {
  walked.length = 0;
});

const TITLE: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };

describe('a look carries its scene', () => {
  const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', identifier: 'b', rect: { x: 10, y: 10, width: 100, height: 40 } })] });
  const resolved = { node: tree.children[0], tree };

  it('derived on first use, once, however often it is read', () => {
    const look = withScene(resolved);
    expect(walked).toEqual([]);
    const scene = look.scene;
    expect(look.scene).toBe(scene);
    expect(walked).toEqual([tree]);
  });

  it('a look with its keyboard sentence (withNote) is the same look: its scene, not a second one', () => {
    const look = withScene(resolved);
    const cleared = withNote(look, 'the soft keyboard covered b; gone on the second look');
    expect(walked).toEqual([]);
    expect(cleared.scene).toBe(look.scene);
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
