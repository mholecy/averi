import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { fillField } from '../../src/interact/fill.js';
import { AfterDismissalTap, AfterKeyboardDismissal, KeyboardWithoutDismissal, dismissKeyboard, resolveClearOfKeyboard, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { KEYBOARD_HIDE_DELAY_MS } from '../../src/interact/keyboard-model.js';
import { KEYBOARD_HIDE_CONFIRM_LOOKS } from '../../src/interact/keyboard-in-tree.js';
import { tapElement } from '../../src/interact/tap.js';
import { AmbiguityRefusal } from '../../src/interact/resolve.js';
import { dropBand, FAST, FakeAdapter, hidesKeyboardOn, IOS_LOGIN_BAND, iosLoginFake, node, recorded } from '../helpers/fake.js';
import { readFile } from 'node:fs/promises';
import { parseWdaSource } from '../../src/adapters/wda-source.js';

// The IN-TREE model (interact/keyboard-in-tree.ts: iOS under WDA, the adapter
// has no keyboard oracle), through the module's interface — tapElement,
// fillField, resolveClearOfKeyboard, dismissKeyboard — on the fake without
// one. The window model's pins are tests/interact/keyboard-window.test.ts;
// the two files were one until 2026-10-07 (the keyboard-model review).
//
// The one sleep owner (util/sleep.ts) is recorded, not waited on (as in
// fill.test.ts): the hide delay is asserted as a delay in a sequence.
const { sleeps } = vi.hoisted(() => ({ sleeps: [] as number[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
}));
beforeEach(() => {
  sleeps.length = 0;
});

/**
 * The in-tree keyboard (2026-10-07, docs/bugs/2026-10-05-ios-tap-lands-on-
 * soft-keyboard.md): the measured iOS login, in points — `login_submit` at
 * {36,547,141,48} (centre 107,571), the keyboard's band {0,539,402,335}
 * with the AutoFill bar, as the WDA source marks it (role `keyboard`,
 * tests/adapters/wda-source-keyboard.test.ts pins the parser). No oracle on
 * the adapter: the guard reads the band off the tree that resolved the
 * target, takes a second look when it covers, and there is nothing to press.
 */
describe('tapElement — an in-tree keyboard (no oracle) covering the target: a refusal, nothing sent (2026-10-07)', () => {
  /** The adapter's own sentence (DeviceAdapter.keyboardAdvice) — quoted, never composed, by the guard. */
  const ADVICE = 'no key hides it here, says the adapter';
  const iosFake = (band: Rect | null = IOS_LOGIN_BAND) => iosLoginFake({ band, keyboardAdvice: ADVICE });
  /** Let the Nth tree read (1-based) see the screen changed by `change` — the keyboard leaving, the target going — without touching the live screen's earlier reads. */
  const onRead = (fake: FakeAdapter, n: number, change: (live: UiNode) => void) => {
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === n) change(fake.live());
      return real();
    };
  };
  /** The refusal's shape; `configured` is the stage B clause — "no dismissal is configured", or the list that was and is not on screen. */
  const refusal = (configured: string) =>
    'The soft keyboard covers id:login_submit: the band it draws over [0,539][402,874] contains the tap point (107,571) on two looks ' +
    `${KEYBOARD_HIDE_DELAY_MS}ms apart; this adapter cannot hide it on its own (${ADVICE}), and ${configured}. Nothing was tapped: the tap would have pressed the ` +
    'keyboard and been reported done. From the MCP tools: hide the keyboard first, then tap id:login_submit again. In a flow: hide it ' +
    'with a step before this one (a tap: on an element the keyboard does not cover), configure a dismissal for the guard to tap, or lay the screen out so id:login_submit is not under the keyboard';
  const REFUSAL = refusal('no dismissal is configured');

  it('the bug: the target\'s centre inside the band on both looks → KeyboardWithoutDismissal; no tap, no key, no oracle, four reads and the hide delay between the looks', async () => {
    const fake = iosFake();
    const events = recorded(fake);
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error).not.toBeInstanceOf(AfterKeyboardDismissal); // nothing was pressed
    expect(error.message).toBe(REFUSAL);
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; no dismissal, nothing sent');
    expect(events).toEqual(['read', 'read', 'read', 'read']); // two settle reads per look; the band came from those, no read of its own
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
  });

  it('an adapter without a sentence of its own: the refusal says only that it cannot hide it on its own', async () => {
    const fake = iosFake();
    fake.keyboardAdvice = undefined;
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/; this adapter cannot hide it on its own, and no dismissal is configured\. Nothing was tapped/);
  });

  /**
   * Stage B (2026-10-07): the configured dismissals. The guard's two looks
   * are as above; on the second covering look the first usable strategy is
   * tapped ONCE, the hide delay waited, the target resolved a third time
   * and the band read off that look. The measured facts behind the
   * strategies: a tap on the title hid the keyboard without submitting
   * (K5b), the accessory Done hid the 2FA pad (K4), the return key submits
   * (K5d). The fake's `onTap` plays the app: the title tap drops the band.
   */
  describe('stage B — a configured dismissal is tapped first, once, and the target tapped after a third look', () => {
    const TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };
    const OTHER_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'twofactor_title' } };
    const ACCESSORY: KeyboardDismissal = { kind: 'accessory' };
    /** The screen reacts to the dismissal tap as the measured app did (K5b): the keyboard's band is gone on the next read. */
    const hiding = (fake: FakeAdapter, on = 'login_title') => {
      fake.onTap = (id, self) => {
        if (id === on) dropBand(self.live());
      };
      return fake;
    };
    const HIDDEN = 'the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" before tapping';

    it('the configured title hides the keyboard: the title tapped at its centre, the hide delay, a third look, then the target — both taps in order, the note says so', async () => {
      const fake = hiding(iosFake());
      const events = recorded(fake);
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'tap:107,571']);
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(fake.keys).toEqual([]);
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(result).toEqual({ note: HIDDEN, keyboardHidden: HIDDEN });
    });

    it('the target is tapped where the THIRD look finds it: a layout that moves when the keyboard goes is followed', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') {
          dropBand(self.live());
          self.live().children[2].rect.y = 600; // centre (107,624)
        }
      };
      await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 624 }]);
    });

    it('the first strategy is absent from the screen: the second is used; the order is the config\'s', async () => {
      const fake = hiding(iosFake());
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [OTHER_TAP, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    it('every strategy absent: the refusal names them, in order, and nothing is tapped', async () => {
      const fake = iosFake();
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [OTHER_TAP, ACCESSORY] }).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
      expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toBe(refusal('none of the configured dismissals is usable on this screen (tap id:"twofactor_title": not found; accessory: no accessory toolbar on screen)'));
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; no dismissal, nothing sent');
      expect(fake.taps).toEqual([]);
    });

    it('none configured (undefined, or an empty list): the stage A refusal, saying no dismissal is configured', async () => {
      for (const dismissals of [undefined, []]) {
        const fake = iosFake();
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals })).rejects.toThrow(REFUSAL);
        expect(fake.taps).toEqual([]);
      }
    });

    it('a configured element whose centre lies UNDER the band is skipped — it would be the very tap the guard refuses — and the next strategy is used', async () => {
      const fake = hiding(iosFake());
      fake.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 600, width: 330, height: 24 } })); // centre (201,612): in the band
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_footer' } }, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
      // …and alone it is as good as absent.
      const alone = iosFake();
      alone.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 600, width: 330, height: 24 } }));
      await expect(tapElement(alone, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_footer' } }] })).rejects.toThrow(
        'none of the configured dismissals is usable on this screen (tap id:"login_footer": under the keyboard)',
      );
      expect(alone.taps).toEqual([]);
    });

    it('the tap does NOT hide the keyboard: AfterDismissalTap, exactly one strategy tap, no second strategy, the target untapped, and the message says the screen may have changed', async () => {
      const fake = iosFake(); // onTap does nothing: the band stays
      const events = recorded(fake);
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP, OTHER_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      expect(error).not.toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toBe(
        'Tapped id:"login_title" at (201,303) to hide the soft keyboard covering id:login_submit, but it is still up: the band [0,539][402,874] ' +
          `still contains the tap point (107,571) on ${KEYBOARD_HIDE_CONFIRM_LOOKS} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. That tap may have changed the screen (the keyboard was raised again, ` +
          'or the element did something of its own) — look at it (ui_snapshot / screenshot) before retrying. From the MCP tools: hide the keyboard ' +
          'another way, then tap id:login_submit again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out ' +
          'so id:login_submit is not under it',
      );
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; tapped id:"login_title" to hide it, still covered');
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'read', 'read']); // two confirming looks after the tap, each a settled resolution
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(fake.taps).toEqual(['login_title']);
      expect(fake.keys).toEqual([]);
    });

    it('the target does not come back after the dismissal tap: AfterDismissalTap wrapping the timeout, saying what was tapped and that the screen may have changed', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') self.live().children = self.live().children.filter((c) => c.identifier !== 'login_submit');
      };
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      expect(error.message).toBe(
        'After tapping id:"login_title" at (201,303) to hide the soft keyboard that covered id:login_submit at (107,571): Timed out after 200ms ' +
          'waiting for element id:login_submit to appear. That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot)',
      );
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; tapped id:"login_title" to hide it, and the look after it failed');
      expect((error.cause as Error).message).toBe('Timed out after 200ms waiting for element id:login_submit to appear');
      expect(fake.taps).toEqual(['login_title']);
    });

    it('an ambiguous refusal on the look after the dismissal tap keeps its headline and says below it what was tapped', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') {
          dropBand(self.live());
          self.live().children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 200, y: 400, width: 100, height: 40 } }));
        }
      };
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [TITLE_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      const lines = error.message.split('\n');
      expect(lines[0]).toBe('Selector matches 2 elements: id:login_submit');
      expect(lines.at(-1)).toBe(
        '(This was the look after tapping id:"login_title" at (201,303) to hide the soft keyboard that covered id:login_submit at (107,571). ' +
          'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot))',
      );
      expect(error.cause).toBeInstanceOf(AmbiguityRefusal);
    });

    it('an ambiguous STRATEGY under refuse mode counts as absent (the guard never picks one of two titles); under first mode the first is taken', async () => {
      const twoTitles = () => {
        const fake = hiding(iosFake());
        fake.live().children.push(node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { x: 36, y: 330, width: 330, height: 24 } }));
        return fake;
      };
      const refused = twoTitles();
      await expect(tapElement(refused, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [TITLE_TAP] })).rejects.toThrow(
        'none of the configured dismissals is usable on this screen (tap id:"login_title": 2 matches)',
      );
      expect(refused.taps).toEqual([]);
      const first = twoTitles();
      const result = await tapElement(first, 'id:login_submit', { ...FAST, ambiguous: 'first', dismissals: [TITLE_TAP] });
      expect(first.tapPoints[0]).toEqual({ x: 201, y: 303 });
      expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" (2 matches, the first) before tapping'); // the choice is in the trace
    });

    it('a configured element that is the keyboard\'s OWN UI is skipped even where it lies outside the band (constructed: an ofKeyboard subtree above the band) — the band check alone would let it through', async () => {
      const fake = hiding(iosFake());
      fake.live().children.push(
        node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'text', identifier: 'kb_hide', rect: { x: 300, y: 500, width: 60, height: 30 } })] }), // centre (330,515): above the band at 539; a text, so not dropped as interactive
      );
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'kb_hide' } }, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    it('the strategies are judged on the SECOND look\'s tree: a title that is only there by then is used', async () => {
      const fake = hiding(iosFake());
      const title = fake.live().children.shift()!; // no title on the first look…
      onRead(fake, 3, (live) => live.children.unshift(title)); // …and there from the second look on
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    /**
     * Review round 1: the resolution policy prefers the sole interactive
     * match, so a `tap: { text: "Sign in" }` on a screen where a title and a
     * BUTTON share the label would have tapped the button — the one thing a
     * dismissal must never do. Interactive matches are dropped before any
     * choice, in both ambiguity modes and on both callers.
     */
    describe('a dismissal is never an interactive element', () => {
      const shared = () => {
        const fake = hiding(iosFake(), 'login_heading');
        fake.live().children.push(
          node({ role: 'text', identifier: 'login_heading', label: 'Sign in', rect: { x: 36, y: 200, width: 330, height: 30 } }), // centre (201,215)
          node({ role: 'button', identifier: 'login_cta', label: 'Sign in', rect: { x: 36, y: 400, width: 330, height: 48 } }), // the control: the same label, above the band
        );
        return fake;
      };
      const BY_TEXT: KeyboardDismissal = { kind: 'tap', target: { text: 'Sign in' } };

      it('tapElement under refuse: a title and a button sharing the label → the TITLE is tapped, never the button', async () => {
        const fake = shared();
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [BY_TEXT] });
        expect(fake.taps).toEqual(['login_heading', 'login_submit']);
        expect(fake.tapPoints[0]).toEqual({ x: 201, y: 215 });
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping text:"Sign in" before tapping');
      });

      it('dismissKeyboard under first: the same — the title, never the button', async () => {
        const fake = shared();
        expect(await dismissKeyboard(fake, { ambiguous: 'first', dismissals: [BY_TEXT] })).toEqual({ hiddenBy: 'tapping text:"Sign in"' });
        expect(fake.taps).toEqual(['login_heading']);
      });

      it.each([
        ['a label only a button carries', { label: 'Submit' } as const, 'tap label:"Submit": only interactive match (button) — a dismissal must be a non-interactive element'],
        ['role: button (refused by the config schema; interact/ must still never act on it)', { role: 'button' } as const, 'tap role:"button": only interactive matches (button, button) — a dismissal must be a non-interactive element'],
      ])('only controls match — %s: the strategy is absent with the reason, nothing tapped', async (_name, target, reason) => {
        const fake = shared();
        fake.live().children.find((c) => c.identifier === 'login_cta')!.label = 'Submit';
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target }] })).rejects.toThrow(
          `none of the configured dismissals is usable on this screen (${reason})`,
        );
        expect(fake.taps).toEqual([]);
      });
    });

    /**
     * Review round 1: "there" is not "on screen" — WDA keeps off-screen nodes
     * in the tree, and a title scrolled above the viewport or under an
     * alert's text is still found by its selector. The tap point must lie
     * inside the root's rect and must not be drawn over by later content.
     */
    describe('a dismissal must be on screen and not drawn over', () => {
      const title = (fake: FakeAdapter) => fake.live().children[0];

      it('scrolled above the viewport (negative y): skipped as off screen, the next strategy used', async () => {
        const fake = hiding(iosFake(), 'login_footer');
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 }; // centre (201,-48)
        fake.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 500, width: 330, height: 24 } }));
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP, { kind: 'tap', target: { id: 'login_footer' } }] });
        expect(fake.taps).toEqual(['login_footer', 'login_submit']);
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping id:"login_footer" before tapping');
        const alone = iosFake();
        title(alone).rect = { x: 36, y: -60, width: 330, height: 24 };
        await expect(tapElement(alone, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] })).rejects.toThrow('(tap id:"login_title": off screen at (201,-48))');
        expect(alone.taps).toEqual([]);
      });

      it('below the screen, or past its right edge: off screen too; on the last row or column: on screen', async () => {
        const at = async (rect: Rect) => {
          const fake = hiding(iosFake());
          title(fake).rect = rect;
          return tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] }).then(() => 'tapped', (e: unknown) => (e as Error).message.match(/\(tap id:"login_title": (.*?\))\)/)?.[1]);
        };
        expect(await at({ x: 36, y: 900, width: 330, height: 24 })).toBe('off screen at (201,912)');
        expect(await at({ x: 400, y: 100, width: 100, height: 24 })).toBe('off screen at (450,112)');
        expect(await at({ x: 0, y: 500, width: 2, height: 2 })).toBe('tapped'); // (1,501)
        expect(await at({ x: 400, y: 100, width: 2, height: 2 })).toBe('tapped'); // (401,101): the last column of a 402-wide screen
      });

      it('drawn over by later content (an alert\'s text over the title): skipped naming what covers it', async () => {
        const fake = iosFake();
        fake.live().children.push(node({ role: 'text', label: 'Session expired', rect: { x: 20, y: 280, width: 362, height: 120 } })); // a sheet's text over (201,303)
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] })).rejects.toThrow('(tap id:"login_title": covered by text "Session expired")');
        expect(fake.taps).toEqual([]);
      });

      it('a later full-screen structural wrapper, an earlier sibling, an ancestor, the node\'s own descendants and the keyboard\'s UI do NOT count as cover', async () => {
        const fake = hiding(iosFake());
        const [heading] = fake.live().children.splice(0, 1);
        fake.live().children.unshift(
          node({ role: 'image', label: 'background', rect: { x: 0, y: 0, width: 402, height: 874 } }), // earlier sibling: beneath
          node({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [{ ...heading, children: [node({ role: 'text', label: 'inner', rect: { ...heading.rect } })] }] })] }), // ancestors and a descendant
        );
        fake.live().children.push(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 } })); // a later Window's wrapper: structural
        fake.onTap = (id, self) => {
          if (id === 'login_title') dropBand(self.live());
        };
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 571 }]);
        expect(result.keyboardHidden).toBe(HIDDEN);
      });

      it('a root without a rect (no screen to judge by) skips the on-screen check, not the strategy', async () => {
        const fake = hiding(iosFake());
        fake.live().rect = { x: 0, y: 0, width: 0, height: 0 };
        fake.viewportSize = { width: 402, height: 874 };
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 };
        await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.taps).toEqual(['login_title', 'login_submit']);
      });
    });

    it('the keyboard is gone only on the SECOND confirming look after the dismissal tap (a hide animation caught mid-way): the target is tapped, not refused', async () => {
      const fake = iosFake();
      let reads = 0;
      const real = fake.uiTree.bind(fake);
      fake.uiTree = async () => {
        if (++reads === 7) dropBand(fake.live()); // looks 1–2: reads 1–4; the tap; look 3 (first confirm): reads 5–6 still covered; look 4: reads 7–8 clear
        return real();
      };
      const events = recorded(fake);
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'read', 'read', 'tap:107,571']);
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(result.keyboardHidden).toBe(HIDDEN);
      expect(KEYBOARD_HIDE_CONFIRM_LOOKS).toBe(2);
    });

    it('after the dismissal tap the band STAYS but the target has moved above it: the `clear` row on the confirming look — the target is tapped once, after ONE look, and the note says the keyboard is still up, not hidden', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') self.live().children[2].rect.y = 400; // the layout re-flows, the band does not go: centre (107,424) above 539
      };
      const events = recorded(fake);
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'tap:107,424']);
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      const sentence = 'the soft keyboard covered id:login_submit; tapped id:"login_title", and the keyboard is still up but no longer over it';
      expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
    });

    it('the keyboard LEAVES by the second look: no strategy is tapped at all — the dismissals are read only where stage A would refuse', async () => {
      const fake = iosFake();
      onRead(fake, 3, dropBand);
      await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_submit']);
    });

    it('fillField: a field under the band is focused after the configured dismissal, the text typed, the result says so', async () => {
      const fake = hiding(iosFake());
      fake.live().children[1].rect = { x: 90, y: 600, width: 222, height: 20 };
      const result = await fillField(fake, 'id:login_password', 'abc', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_password']);
      expect(fake.typed).toEqual(['abc']);
      const sentence = 'the soft keyboard covered id:login_password; hidden by tapping id:"login_title" before tapping';
      expect(result).toEqual({ note: sentence, keyboardHidden: sentence, warning: undefined });
    });

    describe('on the real dumps', () => {
      const fixture = async (name: string) => parseWdaSource(await readFile(new URL(`../fixtures/wda-source-myport-${name}.json`, import.meta.url), 'utf8'));

      it('the keyboard\'s own `done` RETURN key (id Done, label done, y 752 — it SUBMITS, K5d) is never chosen, however it is named: a Button, so dropped as interactive before any other check, and the refusal says so', async () => {
        for (const name of ['login-keyboard', 'login-keyboard-bar']) {
          const fake = new FakeAdapter({ dump: await fixture(name) }, 'dump');
          fake.platform = 'ios';
          fake.keyboard = undefined;
          const dismissals: KeyboardDismissal[] = [{ kind: 'tap', target: { id: 'Done' } }, { kind: 'tap', target: { label: 'done' } }, { kind: 'accessory' }];
          await expect(resolveClearOfKeyboard(fake, 'id:login_submit', { ...FAST, dismissals })).rejects.toThrow(
            'none of the configured dismissals is usable on this screen (tap id:"Done": only interactive match (button) — a dismissal must be a non-interactive element; ' +
              'tap label:"done": only interactive match (button) — a dismissal must be a non-interactive element; accessory: no accessory toolbar on screen)',
          );
          expect(fake.taps).toEqual([]);
        }
      });

      it('K1 with the title configured: the title {36,291} is tapped, and once the app hides the keyboard (the dump swapped for K3, nothing focused) login_submit is tapped at (107,571)', async () => {
        const fake = new FakeAdapter({ up: await fixture('login-keyboard-bar'), down: await fixture('login-no-keyboard') }, 'up', (id, self) => {
          if (id === 'login_title') self.current = 'down';
        });
        fake.platform = 'ios';
        fake.keyboard = undefined;
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [ACCESSORY, TITLE_TAP] }); // no accessory on the login screen: the title
        expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 571 }]);
        expect(fake.taps).toEqual(['login_title', 'login_submit_label']); // the fake's hit test lands on the deepest identified node: the button's label, inside the button
        expect(result.keyboardHidden).toBe(HIDDEN);
      });

      it('the 2FA pad with the accessory configured: a target constructed under the band (the real submit sits above it, the screen shrinks to 518) is reached through Done {317,523} → the pad hidden (the dump swapped for the parked one)', async () => {
        const up = await fixture('2fa-keyboard-toolbar');
        const submit = up.children[0].children[0].children[0]; // the app's Window's wrapper: a button of the app's, under the band
        submit.children.push(node({ role: 'button', identifier: 'twofactor_footer', rect: { x: 36, y: 600, width: 330, height: 48 } }));
        const down = await fixture('2fa-keyboard-parked');
        down.children[0].children[0].children[0].children.push(node({ role: 'button', identifier: 'twofactor_footer', rect: { x: 36, y: 600, width: 330, height: 48 } }));
        const fake = new FakeAdapter({ up, down }, 'up', (id, self) => {
          if (id === 'Toolbar') self.current = 'down'; // the fake's hit test lands on the identified Toolbar; Done itself has no identifier
        });
        fake.platform = 'ios';
        fake.keyboard = undefined;
        const result = await tapElement(fake, 'id:twofactor_footer', { ...FAST, dismissals: [TITLE_TAP, ACCESSORY] }); // no login_title on 2FA: the accessory
        expect(fake.tapPoints).toEqual([{ x: 349, y: 542 }, { x: 201, y: 624 }]);
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:twofactor_footer; hidden by tapping the accessory toolbar\'s "Done" before tapping');
      });
    });
  });

  it('the keyboard LEAVES between the looks (still sliding away after the step before): the tap lands on the second look\'s node, with a note', async () => {
    const fake = iosFake();
    onRead(fake, 3, dropBand);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:107,571']);
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
    const sentence = 'the soft keyboard covered id:login_submit; gone on the second look';
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
    expect(fake.keys).toEqual([]);
  });

  it('the band STAYS but the target has moved above it by the second look (the keyboard-avoiding layout re-flowed): the `clear` row — the target is tapped where it is now, no strategy tapped, and the note says the keyboard is still up (review round 1 of the keyboard-model refactor: "LEAVES" above drops the band and so pins `unknown`, not `clear`)', async () => {
    const fake = iosFake();
    onRead(fake, 3, (live) => {
      live.children[2].rect.y = 400; // centre (107,424): above the band at 539, which is still in the tree
    });
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }] });
    expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:107,424']);
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
    expect(fake.taps).toEqual(['login_submit']);
    expect(fake.keys).toEqual([]);
    const sentence = 'the soft keyboard covered id:login_submit; still up on the second look, but no longer over it';
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
  });

  it('the band is read from the read that SETTLED the target (the second agreeing one), not the first: band in read 1, none in read 2 → no second look, no delay, no note', async () => {
    const fake = iosFake();
    onRead(fake, 2, dropBand);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'tap:107,571']);
    expect(sleeps).toEqual([FAST.pollMs]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('the target VANISHES by the second look: the settle timeout, wrapped so the trace shows the first look found it covered — and that nothing was pressed', async () => {
    const fake = iosFake();
    onRead(fake, 3, (live) => {
      live.children = live.children.filter((c) => c.identifier !== 'login_submit');
    });
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toBe(
      'After the soft keyboard covered id:login_submit at (107,571) on a first look, the second look failed: Timed out after 200ms ' +
        'waiting for element id:login_submit to appear. Nothing was pressed; the screen is as the step found it',
    );
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; nothing sent, and the second look failed');
    expect((error.cause as Error).message).toBe('Timed out after 200ms waiting for element id:login_submit to appear');
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
  });

  // The read that installs the dead tree still returned a tree holding the
  // target, so the second look DID find it once: since 2026-10-08 that is
  // the "found, but never held still" sentence, not the never-found one, with
  // the read error beneath saying why no second agreeing read came.
  it('a second look that reads a dead tree keeps the read error beneath the headline', async () => {
    const fake = iosFake();
    onRead(fake, 3, () => {
      fake.uiTree = async () => {
        throw new Error('device offline');
      };
    });
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as Error;
    expect(error.message.split('\n')).toEqual([
      'After the soft keyboard covered id:login_submit at (107,571) on a first look, the second look failed: Timed out after 200ms ' +
        'waiting for element id:login_submit to hold still (found, but never at the same position in two consecutive reads). ' +
        'Nothing was pressed; the screen is as the step found it',
      '  (last UI tree read failed: device offline)',
    ]);
  });

  it('a refusal on the second look (refuse mode, a second interactive match revealed) keeps its FIRST line as the headline and says below it that nothing was pressed', async () => {
    const fake = iosFake();
    onRead(fake, 3, (live) => {
      live.children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 200, y: 400, width: 100, height: 40 } }));
    });
    const error = (await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse' }).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    const lines = error.message.split('\n');
    expect(lines[0]).toBe('Selector matches 2 elements: id:login_submit');
    expect(lines.at(-1)).toBe('(This was the second look, after the soft keyboard covered id:login_submit at (107,571) on a first look. Nothing was pressed)');
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; nothing sent, and the second look failed');
    expect(error.cause).toBeInstanceOf(AmbiguityRefusal);
    expect(fake.taps).toEqual([]);
  });

  it('an app element named inputView (an RN testID) does not disable the guard: the K1 dump with login_card renamed still refuses login_submit', async () => {
    const renamed = (await readFile(new URL('../fixtures/wda-source-myport-login-keyboard-bar.json', import.meta.url), 'utf8')).replace('"rawIdentifier":"login_card"', '"rawIdentifier":"inputView"');
    const fake = new FakeAdapter({ dump: parseWdaSource(renamed) }, 'dump');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    const error = (await resolveClearOfKeyboard(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toContain('the band it draws over [0,539][402,874] contains the tap point (107,571)');
  });

  it('a target clear of the band (the title) is tapped as before: two reads, no delay, no note', async () => {
    const fake = iosFake();
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_title', FAST);
    expect(events).toEqual(['read', 'read', 'tap:201,303']);
    expect(sleeps).toEqual([FAST.pollMs]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('no band in the tree (no keyboard on screen, or an idb tree): exactly what happened before — the tap lands on the centre', async () => {
    const fake = iosFake(null);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'tap:107,571']);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('the band is half-open like a frame: a centre on its top row (539) is covered, one point above (538) is clear', async () => {
    const at = async (centreY: number) => {
      const fake = iosFake();
      fake.live().children[2].rect = { x: 36, y: centreY - 24, width: 141, height: 48 };
      return tapElement(fake, 'id:login_submit', FAST).then(() => 'tapped', (e: unknown) => (e as Error).name);
    };
    expect(await at(539)).toBe('KeyboardWithoutDismissal');
    expect(await at(538)).toBe('tapped');
  });

  it('the band without the bar ({0,566,402,308}, the K2 shape) still covers the centre at 571', async () => {
    const fake = iosFake({ x: 0, y: 566, width: 402, height: 308 });
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/the band it draws over \[0,566\]\[402,874\] contains the tap point \(107,571\)/);
    expect(fake.taps).toEqual([]);
  });

  it('fillField: a field under the band on both looks is refused before the focus tap — nothing tapped, nothing typed', async () => {
    const fake = iosFake();
    fake.live().children[1].rect = { x: 90, y: 600, width: 222, height: 20 };
    await expect(fillField(fake, 'id:login_password', 'abc', FAST)).rejects.toBeInstanceOf(KeyboardWithoutDismissal);
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
    expect(fake.keys).toEqual([]);
  });

  it('fillField: a field clear of the band is focused and typed into, asking nothing', async () => {
    const fake = iosFake();
    const result = await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 489 }]);
    expect(fake.typed).toEqual(['abc']);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined, warning: undefined });
  });

  it('an ElementSpec target is named in the flow vocabulary, in the message and the trace line', async () => {
    const fake = iosFake();
    const error = (await resolveClearOfKeyboard(fake, { id: 'login_submit' }, FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error.traceLine).toBe('the soft keyboard covered id:"login_submit"; no dismissal, nothing sent');
    expect(error.message).toMatch(/^The soft keyboard covers id:"login_submit": /);
  });

  it('the band must have area: a zero-area keyboard node is not a keyboard on screen', async () => {
    const fake = iosFake({ x: 0, y: 539, width: 0, height: 0 });
    await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.taps).toEqual(['login_submit']);
  });

  it('an adapter WITH an oracle never reads the tree for the keyboard: the oracle says hidden, the band in the tree changes nothing (Android untouched)', async () => {
    const fake = iosFake();
    fake.platform = 'android';
    fake.attachKeyboard({ state: 'hidden' });
    const events = recorded(fake);
    await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'tap:107,571']);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
  });

  it('the guard\'s answer carries the node and its note only — never the tree the resolution rode in on (in-tree clear, and oracle hidden)', async () => {
    const clear = await resolveClearOfKeyboard(iosFake(), 'id:login_title', FAST);
    expect(Object.keys(clear)).toEqual(['node', 'note']);
    const android = iosFake();
    android.attachKeyboard({ state: 'hidden' });
    const hidden = await resolveClearOfKeyboard(android, 'id:login_submit', FAST);
    expect(Object.keys(hidden)).toEqual(['node', 'note']);
  });

  it('the resolution note of the node tapped is kept, unchanged, when the band does not cover it', async () => {
    const fake = iosFake();
    fake.live().children.push(node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { x: 36, y: 320, width: 330, height: 24 } }));
    fake.live().children.push(node({ role: 'button', identifier: 'login_title', label: 'x', rect: { x: 36, y: 350, width: 30, height: 24 } }));
    const result = await tapElement(fake, 'id:login_title', FAST);
    expect(result.note).toBe('3 matches; picked the only interactive one (button)');
    expect(result.keyboardHidden).toBeUndefined();
  });

  /**
   * The keyboard's OWN controls (review 2026-10-07): a tap on a key, on the
   * accessory toolbar's Done, on the Passwords bar or on dictation lands
   * inside the band and is what the user does — an OTP digit, the one
   * non-submitting dismissal. The WDA source marks their Windows
   * (`ofKeyboard`); the guard reads them as not covered. On the REAL dumps.
   */
  describe('the keyboard\'s own controls are tappable on the real dumps — only the app\'s element under the band is refused', () => {
    const fixture = async (name: string) => parseWdaSource(await readFile(new URL(`../fixtures/wda-source-myport-${name}.json`, import.meta.url), 'utf8'));
    const onDump = async (name: string) => {
      const fake = new FakeAdapter({ dump: await fixture(name) }, 'dump');
      fake.platform = 'ios';
      fake.keyboard = undefined;
      return fake;
    };
    const resolves = async (name: string, selector: string) => {
      const fake = await onDump(name);
      const events = recorded(fake);
      const { node: found, keyboardHidden } = await resolveClearOfKeyboard(fake, selector, FAST);
      expect(events).toEqual(['read', 'read']); // one look, no delay
      expect(keyboardHidden).toBeUndefined();
      return found;
    };

    it.each([
      ['2fa-keyboard-toolbar', 'label:Done', { x: 317, y: 523, width: 64, height: 38 }], // the inputAccessoryView Done — the natural non-submitting dismissal, in a DIFFERENT Window than the band
      ['2fa-keyboard-toolbar', 'id:Toolbar', { x: 0, y: 518, width: 402, height: 48 }],
      ['2fa-keyboard-toolbar', 'label:1', { x: 4, y: 590, width: 133, height: 54 }], // an OTP digit
      ['login-keyboard-bar', 'label:Passwords', { x: 30, y: 539, width: 342, height: 44 }],
      ['login-keyboard-bar', 'label:q', { x: 4, y: 590, width: 40, height: 54 }],
      ['login-keyboard-bar', 'id:dictation', { x: 325, y: 805, width: 69, height: 70 }],
      ['login-keyboard', 'id:dictation', { x: 325, y: 805, width: 69, height: 70 }],
    ])('%s: %s resolves clear, inside the band', async (name, selector, rect) => {
      expect((await resolves(name, selector)).rect).toEqual(rect);
    });

    it.each([
      ['login-keyboard-bar', '[0,539][402,874]'],
      ['login-keyboard', '[0,566][402,874]'],
    ])('%s: login_submit (centre 107,571) is still refused, naming the band %s', async (name, band) => {
      const fake = await onDump(name);
      const error = (await resolveClearOfKeyboard(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
      expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toContain(`the band it draws over ${band} contains the tap point (107,571)`);
    });

    it('the parked dump (no band): the toolbar\'s Done and the app\'s submit both resolve clear', async () => {
      expect((await resolves('2fa-keyboard-parked', 'label:Done')).rect).toEqual({ x: 317, y: 831, width: 64, height: 38 });
      expect((await resolves('2fa-keyboard-parked', 'id:twofactor_submit')).rect).toEqual({ x: 225, y: 501, width: 141, height: 49 });
    });
  });
});

/**
 * Stage B (2026-10-07): the in-tree dismissal after a fill. One tree read;
 * a band → the configured strategy tapped once and one re-read to confirm;
 * no band → nothing. `enter` is never pressed on this path any more: it was
 * measured to SUBMIT the login from the password field (K5d).
 */
describe('dismissKeyboard — the in-tree model (no oracle), stage B', () => {
  const TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };
  const withBand = (reactsTo = 'login_title') => iosLoginFake({ onTap: hidesKeyboardOn(reactsTo) });
  const FIRST = { ambiguous: 'first' as const };

  it('a band in the tree and a usable strategy: ONE tap at its centre, the hide delay, one re-read — the band gone, the result says what hid it; no key', async () => {
    const fake = withBand();
    const events = recorded(fake);
    const result = await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] });
    expect(events).toEqual(['read', 'tap:201,303', 'read']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS]);
    expect(fake.keys).toEqual([]);
    expect(result).toEqual({ hiddenBy: 'tapping id:"login_title"' });
  });

  it('a tap strategy matching TWO neutral nodes: under `first` the first is tapped and the result says which; under `refuse` it is skipped with the count — a warning, no tap', async () => {
    const BY_LABEL: KeyboardDismissal = { kind: 'tap', target: { text: 'Prihlásenie' } };
    /** A second title with the same label, clear of the band, after the first in tree order. */
    const twoTitles = () => {
      const fake = withBand();
      fake.live().children.push(node({ role: 'text', identifier: 'login_heading', label: 'Prihlásenie', rect: { x: 36, y: 330, width: 330, height: 24 } }));
      return fake;
    };
    const first = twoTitles();
    const events = recorded(first);
    expect(await dismissKeyboard(first, { ambiguous: 'first', dismissals: [BY_LABEL] })).toEqual({ hiddenBy: 'tapping text:"Prihlásenie" (2 matches, the first)' });
    expect(events).toEqual(['read', 'tap:201,303', 'read']);
    expect(first.taps).toEqual(['login_title']);
    const refuse = twoTitles();
    expect(await dismissKeyboard(refuse, { ambiguous: 'refuse', dismissals: [BY_LABEL] })).toEqual({
      warning: 'the soft keyboard is up and was left up: none of the configured dismissals is usable on this screen (tap text:"Prihlásenie": 2 matches) — the next tap under it will be refused',
    });
    expect(refuse.taps).toEqual([]);
    expect(refuse.keys).toEqual([]);
  });

  it('no band in the tree (none on screen, the keyboard parked by the HID typing, an idb tree): one read, nothing tapped, nothing pressed, an empty result', async () => {
    const fake = withBand();
    dropBand(fake.live());
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({});
    expect(events).toEqual(['read']);
    expect(fake.keys).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('a band and nothing usable: a WARNING, not a throw — none configured, or none on screen — and nothing is pressed or tapped', async () => {
    const none = withBand();
    expect(await dismissKeyboard(none, FIRST)).toEqual({ warning: 'the soft keyboard is up and was left up: no dismissal is configured — the next tap under it will be refused' });
    expect(await dismissKeyboard(none, { ...FIRST, dismissals: [] })).toEqual({ warning: 'the soft keyboard is up and was left up: no dismissal is configured — the next tap under it will be refused' });
    const absent = withBand();
    expect(await dismissKeyboard(absent, { ...FIRST, dismissals: [{ kind: 'tap', target: { id: 'twofactor_title' } }, { kind: 'accessory' }] })).toEqual({
      warning:
        'the soft keyboard is up and was left up: none of the configured dismissals is usable on this screen (tap id:"twofactor_title": not found; accessory: no accessory toolbar on screen) — the next tap under it will be refused',
    });
    for (const fake of [none, absent]) {
      expect(fake.keys).toEqual([]);
      expect(fake.taps).toEqual([]);
    }
  });

  it('the strategy tap does not hide the keyboard: AfterDismissalTap — the screen was touched — and no second strategy', async () => {
    const fake = withBand('nothing'); // the band stays
    const error = (await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP, { kind: 'tap', target: { id: 'login_password' } }] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(error.message).toBe(
      `Tapped id:"login_title" at (201,303) to hide the soft keyboard after the fill, but it is still up over [0,539][402,874] on ${KEYBOARD_HIDE_CONFIRM_LOOKS} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. ` +
        'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot). ' +
        'In a flow: configure a dismissal that hides the keyboard on THIS screen, or drop dismissKeyboard from this fill',
    );
    expect(error.traceLine).toBe('the soft keyboard was up after the fill; tapped id:"login_title" to hide it, still up');
    expect(fake.taps).toEqual(['login_title']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS, KEYBOARD_HIDE_DELAY_MS]); // two confirming reads, then the refusal
  });

  it('a confirming read that THROWS after the strategy tap (WDA or idb gone): AfterDismissalTap — the guard\'s one wrap — saying what was tapped, the read\'s error as the cause, no second read or tap (review 2026-10-07 #1)', async () => {
    const fake = withBand();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      reads++;
      if (fake.taps.length > 0) throw new Error('WDA /source failed: connection refused\n(the session is gone)');
      return real();
    };
    const error = (await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(error.message).toBe(
      'After tapping id:"login_title" at (201,303) to hide the soft keyboard after the fill: WDA /source failed: connection refused. ' +
        'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot)\n' +
        '(the session is gone)',
    );
    expect(error.traceLine).toBe('the soft keyboard was up after the fill; tapped id:"login_title" to hide it, and the read after it failed');
    expect((error.cause as Error).message).toBe('WDA /source failed: connection refused\n(the session is gone)');
    expect(fake.taps).toEqual(['login_title']);
    expect(fake.keys).toEqual([]);
    expect(reads).toBe(2); // the dismissal's read, then the first confirming read — which ends it: no second confirming read
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS]);
  });

  it('the band is gone only on the SECOND confirming read (a hide animation caught mid-way): hidden, not a refusal', async () => {
    const fake = withBand('nothing');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === 3) dropBand(fake.live()); // read 1: the band; read 2 (first confirm): still; read 3: gone
      return real();
    };
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({ hiddenBy: 'tapping id:"login_title"' });
    expect(events).toEqual(['read', 'tap:201,303', 'read', 'read']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS, KEYBOARD_HIDE_DELAY_MS]);
  });

  it('`enter` is never in the keys on this path, with or without a band or a strategy', async () => {
    for (const fake of [withBand(), withBand('nothing')]) {
      await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] }).catch(() => undefined);
      await dismissKeyboard(fake, FIRST).catch(() => undefined);
      expect(fake.keys).toEqual([]);
    }
  });

  it('the oracle path reads no dismissal and no tree: with them passed, Android presses back on the window state and taps nothing', async () => {
    const fake = withBand();
    fake.attachKeyboard({ state: 'shown', frame: IOS_LOGIN_BAND }, 'shown');
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({});
    expect(events).toEqual(['keyboard?', 'witness?', 'key:back']);
    expect(fake.taps).toEqual([]);
  });
});
