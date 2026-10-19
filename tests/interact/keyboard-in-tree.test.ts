import { beforeEach, describe, expect, it, vi } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { fillField } from '../../src/interact/fill.js';
import { AfterDismissalTap, AfterKeyboardDismissal, KeyboardWithoutDismissal, dismissKeyboard, resolveClearOfKeyboard, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { KEYBOARD_HIDE_DELAY_MS } from '../../src/interact/keyboard-model.js';
import { KEYBOARD_HIDE_CONFIRM_LOOKS } from '../../src/interact/keyboard-in-tree.js';
import { tapElement } from '../../src/interact/tap.js';
import { AmbiguityRefusal } from '../../src/interact/resolve.js';
import { bandNode, dropBand, FAST, FakeAdapter, hidesKeyboardOn, IOS_LOGIN_BAND, iosLoginFake, node, recorded } from '../helpers/fake.js';
import { readFile } from 'node:fs/promises';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';

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
 * The measured SWIFT payment form under WDA (docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md,
 * "Device check", iPhone 17, 402×874 pt), in pre-order: the title in the top bar at {135,73,131,22}, then the screen's
 * container holding the form's `scrollable 0 0 402 512` (its frame under the translucent bar, its first row at y 150,
 * `priority_select` at y 681 — centre (201,707), under the pad), then — when `toolbar` — SwiftUI's screen-sized
 * `toolbar 'Toolbar'` host, then the decimal pad's band {0,572,402,302}. A tap on the title hides the pad, as measured
 * with idb on the same screen, and the form is laid out to the screen's bottom again — until then `priority_select`
 * lies outside it, drawn nowhere (ui-tree/standing.ts, the drawn frame).
 */
const SWIFT_TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'swift_payment.form.title' } };
function swiftFormFake(toolbar: boolean): FakeAdapter {
  const full = { x: 0, y: 0, width: 402, height: 874 };
  const row = (identifier: string, y: number) => node({ role: 'button', identifier, rect: { x: 16, y, width: 370, height: 52 } });
  const form = node({
    role: 'scrollable',
    rect: { x: 0, y: 0, width: 402, height: 512 },
    children: [row('swift_payment.form.debit_select', 150), node({ role: 'textfield', identifier: 'swift_payment.form.amount_input', rect: { x: 16, y: 300, width: 370, height: 44 } }), row('swift_payment.form.priority_select', 681)],
  });
  const fake = new FakeAdapter(
    {
      form: node({
        role: 'application',
        unclippedFrames: true,
        rect: full,
        children: [
          node({
            role: 'other',
            rect: full,
            children: [
              node({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: { x: 135, y: 73, width: 131, height: 22 } }),
              node({ role: 'container', rect: full, children: [form] }),
              ...(toolbar ? [node({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect: full, children: [node({ role: 'container', rect: full })] })] : []),
            ],
          }),
          bandNode({ x: 0, y: 572, width: 402, height: 302 }),
        ],
      }),
    },
    'form',
    (tapped, self) => {
      // The title hides the keyboard, and the form, laid out above it (it ends at 512), is laid out to the screen's
      // bottom again: the select it drew nothing of is drawn.
      if (tapped !== 'swift_payment.form.title') return;
      dropBand(self.live());
      const scroll = [...everyNode(self.live())].find((n) => n.role === 'scrollable');
      if (scroll !== undefined) scroll.rect = { ...full };
    },
  );
  fake.platform = 'ios';
  fake.keyboard = undefined;
  fake.keyboardAdvice = 'ADVICE';
  return fake;
}

/**
 * The Contacts "New Contact" sheet under WDA (UIKit, iPhone 17, iOS 27, measured 2026-10-09 05:30 UTC,
 * docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md), in pre-order: the title
 * `text 'New Contact' 149 89 104 22` inside `container id:"New Contact" 0 78 402 54`, the form's `scrollable 0 62 402 812`
 * with its rows (`add pronouns` at y 692 — centre (223,703), under the keyboard), then the two `toolbar 'Toolbar'`s
 * `0 83 402 48` and `0 62 402 812` (`bar` / `sheet` say which are there), each holding ONE empty `container` of its own rect
 * (the raw `/source` at 347e70d — the first version of this fake built them childless, after the note's since-corrected
 * premise, and passed while the device still refused), then the band `0 573 402 301`.
 * Until 2026-10-09 either toolbar alone refused the title dismissal as "covered by toolbar". The fake's hit test lands
 * on the identified title container; a tap there hides the keyboard (assumed — not tried on the device).
 */
const CONTACTS_TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { role: 'text', text: 'New Contact' } };
function contactsSheetFake({ bar, sheet }: { bar: boolean; sheet: boolean }): FakeAdapter {
  const full = { x: 0, y: 0, width: 402, height: 874 };
  const SHEET = { x: 0, y: 62, width: 402, height: 812 };
  const title = node({ role: 'text', label: 'New Contact', rect: { x: 149, y: 89, width: 104, height: 22 } });
  const form = node({
    role: 'scrollable',
    rect: SHEET,
    children: [
      node({ role: 'textfield', identifier: 'First name', rect: { x: 20, y: 300, width: 360, height: 44 } }),
      node({ role: 'text', label: 'add pronouns', identifier: 'pronouns', rect: { x: 40, y: 692, width: 366, height: 22 } }),
    ],
  });
  const toolbar = (rect: Rect) => node({ role: 'toolbar', label: 'Toolbar', rect, children: [node({ role: 'container', rect })] });
  const fake = new FakeAdapter(
    {
      sheet: node({
        role: 'application',
        rect: full,
        children: [
          node({
            role: 'other',
            rect: full,
            children: [
              node({ role: 'container', identifier: 'New Contact', rect: { x: 0, y: 78, width: 402, height: 54 }, children: [title] }),
              form,
              ...(bar ? [toolbar({ x: 0, y: 83, width: 402, height: 48 })] : []),
              ...(sheet ? [toolbar(SHEET)] : []),
            ],
          }),
          bandNode({ x: 0, y: 573, width: 402, height: 301 }),
        ],
      }),
    },
    'sheet',
    hidesKeyboardOn('New Contact'),
  );
  fake.platform = 'ios';
  fake.keyboard = undefined;
  fake.keyboardAdvice = 'ADVICE';
  return fake;
}

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

    it('the tap does NOT hide the keyboard, and no other strategy is usable (the second configured one absent, no scroll view for averi\'s own): AfterDismissalTap, exactly one strategy tap, the target untapped, every strategy passed over named, and the message says the screen may have changed', async () => {
      const fake = iosFake(); // onTap does nothing: the band stays
      const events = recorded(fake);
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP, OTHER_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      expect(error).not.toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toBe(
        'Tapped id:"login_title" at (201,303) to hide the soft keyboard covering id:login_submit, but it is still up: the band [0,539][402,874] ' +
          `still contains the tap point (107,571) on ${KEYBOARD_HIDE_CONFIRM_LOOKS} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped (passed over: tap id:"twofactor_title": not found; ` +
          'a drag: no scroll view holds the target). That tap may have changed the screen (the keyboard was raised again, ' +
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

      it('a later screen-sized toolbar (WDA\'s SwiftUI toolbar host, 402×874, after the title) is not a cover: the title is tapped (docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md)', async () => {
        const fake = hiding(iosFake());
        const full = { x: 0, y: 0, width: 402, height: 874 };
        fake.live().children.push(node({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect: full, children: [node({ role: 'container', rect: full })] }));
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.taps).toEqual(['login_title', 'login_submit']);
        expect(result.keyboardHidden).toBe(HIDDEN);
      });

      it('the measured SWIFT form (device check at e9e6509): the form\'s scrollable after the title — its frame under the top bar, no content at the point — is not a cover, with or without the toolbar host; the title is tapped, then the select', async () => {
        for (const withToolbar of [true, false]) {
          const fake = swiftFormFake(withToolbar);
          const result = await tapElement(fake, 'id:swift_payment.form.priority_select', { ...FAST, dismissals: [SWIFT_TITLE_TAP] });
          expect(fake.taps).toEqual(['swift_payment.form.title', 'swift_payment.form.priority_select']);
          expect(fake.tapPoints[1]).toEqual({ x: 201, y: 707 });
          expect(result.keyboardHidden).toBe('the soft keyboard covered id:swift_payment.form.priority_select; hidden by tapping id:"swift_payment.form.title" before tapping');
        }
      });

      it('the Contacts sheet (2026-10-09): its two itemless toolbars (one empty frame each) after the title — 402×48 and 402×812, each alone, and both — are not covers; the title is tapped, then the row', async () => {
        for (const shape of [{ bar: true, sheet: true }, { bar: true, sheet: false }, { bar: false, sheet: true }]) {
          const fake = contactsSheetFake(shape);
          const result = await tapElement(fake, 'role:text text:"add pronouns"', { ...FAST, dismissals: [CONTACTS_TITLE_TAP] });
          expect(fake.taps).toEqual(['New Contact', 'pronouns']);
          expect(fake.tapPoints).toEqual([{ x: 201, y: 100 }, { x: 223, y: 703 }]);
          expect(result.keyboardHidden).toBe('the soft keyboard covered role:text text:"add pronouns"; hidden by tapping role:"text" text:"New Contact" before tapping');
        }
      });

      it('a root without a rect: the DEVICE screen judges — the tap\'s own standing (ui-tree/standing.ts#Scene, one owner)', async () => {
        const fake = iosFake();
        fake.live().rect = { x: 0, y: 0, width: 0, height: 0 };
        fake.viewportSize = { width: 402, height: 874 };
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 };
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] })).rejects.toThrow('(tap id:"login_title": off screen at (201,-48))');
        expect(fake.taps).toEqual([]);
      });

      it('no screen at all — no root rect and no device size: the on-screen check is skipped, not the strategy (fail open)', async () => {
        const fake = hiding(iosFake());
        fake.live().rect = { x: 0, y: 0, width: 0, height: 0 };
        fake.viewport = async () => {
          throw new Error('idb describe: no screen_dimensions');
        };
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 };
        await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.taps).toEqual(['login_title', 'login_submit']);
      });
    });

    /**
     * The picker asks the TAP's standing (ui-tree/standing.ts#Scene, `{ of: 'tap' }`) after its two keyboard checks:
     * a dismissal is used when a tap on it would land on its centre, unmoved — what `tap` would count as a cover is a
     * cover, and nothing else is. One test per shape whose answer that decided (docs/adr/0016-the-dismissal-picker-asks-
     * the-tap-standing.md, its before/after table), each on a constructed WDA screen or a measured dump.
     */
    describe('the tap\'s standing decides: what a tap would count as a cover, and only that (ADR 0016)', () => {
      const FULL = { x: 0, y: 0, width: 402, height: 874 };
      /** The dismissal `tap id:<id>` on `screen` (a WDA band among its root's children) after a fill: `tapped (x,y)`, or the skip clause the warning gives. A tap there hides the keyboard. */
      const pickOn = async (screen: UiNode, id: string, device?: FakeAdapter['viewportSize']): Promise<string> => {
        const fake = new FakeAdapter({ screen }, 'screen', (_id, self) => dropBand(self.live()));
        fake.viewportSize = device;
        fake.platform = 'ios';
        fake.keyboard = undefined;
        fake.keyboardAdvice = 'ADVICE';
        const result = await dismissKeyboard(fake, { ambiguous: 'refuse', dismissals: [{ kind: 'tap', target: { id } }] });
        if (result.hiddenBy !== undefined) return `tapped (${fake.tapPoints[0].x},${fake.tapPoints[0].y})`;
        return result.warning?.match(/\(tap id:"[^"]*": (.*)\) — the next tap/)?.[1] ?? `unexpected: ${JSON.stringify(result)}`;
      };
      /** The login screen's root with `children` laid in it, then the band {0,539,402,335}. */
      const screenOf = (...children: UiNode[]) => node({ role: 'container', rect: FULL, children: [...children, bandNode()] });
      const loginTitle = (rect: Rect = { x: 36, y: 291, width: 330, height: 24 }, children: UiNode[] = []) => node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect, children }); // centre (201,303)
      const dump = async (name: string) => parseWdaSource(await readFile(new URL(`../fixtures/wda-source-${name}.json`, import.meta.url), 'utf8'));

      // A pin of UNCHANGED words: every skip clause the picker gave before ADR 0016 reads the same, each in the place it
      // comes in the warning — the keyboard's own control (asked first, by the reading's `ofKeyboard`) among them.
      it('unchanged — every existing skip clause reads as before, in the order the strategies were configured', async () => {
        const text = (identifier: string, y: number, extra: Partial<UiNode> = {}) => node({ role: 'text', identifier, rect: { x: 36, y, width: 330, height: 24 }, ...extra });
        const screen = screenOf(
          node({ role: 'button', label: 'Submit', rect: { x: 36, y: 100, width: 330, height: 44 } }),
          text('twin', 160),
          text('twin', 200),
          text('kb_hint', 240, { ofKeyboard: true }), // a keyboard-owned node clear of the band: the reading's, by its mark
          text('in_band', 600), // centre (201,612), in the band {0,539,402,335}
          text('above', -60), // centre (201,-48)
          text('under_alert', 291), // centre (201,303)
          node({ role: 'text', label: 'Session expired', rect: { x: 20, y: 280, width: 362, height: 120 } }),
        );
        const fake = new FakeAdapter({ screen }, 'screen');
        fake.platform = 'ios';
        fake.keyboard = undefined;
        fake.keyboardAdvice = 'ADVICE';
        const dismissals: KeyboardDismissal[] = [
          { kind: 'tap', target: { id: 'nowhere' } },
          { kind: 'tap', target: { label: 'Submit' } },
          { kind: 'tap', target: { id: 'twin' } },
          { kind: 'tap', target: { id: 'kb_hint' } },
          { kind: 'tap', target: { id: 'in_band' } },
          { kind: 'tap', target: { id: 'above' } },
          { kind: 'tap', target: { id: 'under_alert' } },
          { kind: 'accessory' },
        ];
        const result = await dismissKeyboard(fake, { ambiguous: 'refuse', dismissals });
        expect(result.warning).toBe(
          'the soft keyboard is up and was left up: none of the configured dismissals is usable on this screen (' +
            [
              'tap id:"nowhere": not found',
              'tap label:"Submit": only interactive match (button) — a dismissal must be a non-interactive element',
              'tap id:"twin": 2 matches',
              'tap id:"kb_hint": the keyboard\'s own control',
              'tap id:"in_band": under the keyboard',
              'tap id:"above": off screen at (201,-48)',
              'tap id:"under_alert": covered by text "Session expired"',
              'accessory: no accessory toolbar on screen',
            ].join('; ') +
            ') — the next tap under it will be refused',
        );
        expect(fake.taps).toEqual([]);
      });

      // A pin of UNCHANGED behaviour (ADR 0016, row 10): a centre in a system band is skipped as `off screen at (x,y)`,
      // and the same title clear of any band is tapped.
      it('unchanged — its centre in a system band reads as off the screen, as before — iOS\'s status band (62 pt): "off screen at (x,y)", where a tap would press the status bar', async () => {
        const screen = screenOf(loginTitle({ x: 36, y: 20, width: 330, height: 24 })); // centre (201,32)
        expect(await pickOn(screen, 'login_title', { width: 402, height: 874, statusBand: 62 })).toBe('off screen at (201,32)');
        expect(await pickOn(screenOf(loginTitle({ x: 36, y: 20, width: 330, height: 24 })), 'login_title', { width: 402, height: 874 })).toBe('tapped (201,32)');
      });

      it('a title beneath an alert the tree marks — clear of the alert\'s card — is skipped naming the alert, as the tap refuses it, not "covered by" the card; the same layer unmarked is no cover there, and the title is tapped', async () => {
        const alertLayer = (mark: Partial<UiNode>) => node({ role: 'container', rect: FULL, children: [node({ role: 'container', label: 'Leave the form', rect: { x: 41, y: 365, width: 320, height: 172 }, ...mark })] });
        const form = node({ role: 'container', rect: FULL, children: [loginTitle()] });
        expect(await pickOn(screenOf(form, alertLayer({ presentation: 'alert' })), 'login_title')).toBe('an alert is presented over it ("Leave the form") — close it first');
        expect(await pickOn(screenOf(form, alertLayer({})), 'login_title')).toBe('tapped (201,303)');
      });

      it('a title listed in a scroll view but outside its frame — nothing of it drawn there — is skipped naming that scroll view, as the tap refuses it', async () => {
        const list = node({ role: 'scrollable', identifier: 'list', rect: { x: 0, y: 100, width: 402, height: 150 }, children: [loginTitle()] }); // centre (201,303), below the list's 250
        expect(await pickOn({ ...screenOf(list), unclippedFrames: true }, 'login_title')).toBe('outside its scroll view scrollable id:list (0,100 402x150) at (201,303)');
      });

      it('a later sibling drawn on the title (narrower, inside it) is its own content — measured: the RN screen\'s text "Scaffold is running." 138,479 126x18 on `placeholder_screen` 0,116 402x758 (WDA lists a view\'s texts as its siblings): picked', async () => {
        const rn = await dump('rn-myport');
        rn.children.push(bandNode());
        expect(await pickOn(rn, 'placeholder_screen')).toBe('tapped (201,495)');
      });

      it('what a sibling drawn on a childless title holds, one wrapper down, is its own content (a badge\'s text): picked', async () => {
        const badge = node({ role: 'container', rect: { x: 120, y: 291, width: 160, height: 24 }, children: [node({ role: 'text', label: 'new', rect: { x: 150, y: 295, width: 100, height: 16 } })] });
        expect(await pickOn(screenOf(loginTitle(), badge), 'login_title')).toBe('tapped (201,303)');
      });

      it('a later node of exactly the title\'s frame is the same element listed again: picked', async () => {
        expect(await pickOn(screenOf(loginTitle(), node({ role: 'image', label: 'underline', rect: { x: 36, y: 291, width: 330, height: 24 } })), 'login_title')).toBe('tapped (201,303)');
      });

      /**
       * The explicit refusal (ADR 0016, residual 1, the owner's option (b)): a labelled control of exactly the title's
       * frame, listed after it, is read by the tap as the title listed again (the `sameFrame` row) and excused — so a tap
       * at the title's centre would press "Delete account". The picker refuses a candidate whose centre an excused
       * INTERACTIVE node holds, naming it as a cover: a silently pressed control is worse than a skipped title.
       */
      it('a labelled button of exactly the title\'s frame, listed after it, holds the centre the tap would press: skipped, covered by it — nothing tapped', async () => {
        const button = node({ role: 'button', label: 'Delete account', identifier: 'delete_account', rect: { x: 36, y: 291, width: 330, height: 24 } });
        expect(await pickOn(screenOf(loginTitle(), button), 'login_title')).toBe('covered by button "Delete account"');
        // Two such controls: the one drawn on top — the last listed — is named, the one the tap would press.
        const under = node({ role: 'button', label: 'Edit', rect: { x: 36, y: 291, width: 330, height: 24 } });
        expect(await pickOn(screenOf(loginTitle(), under, button), 'login_title')).toBe('covered by button "Delete account"');
      });

      it('the title\'s own unlabelled control — a text field over its label (ADR 0014\'s measured SWIFT row), a button spanning its wrapper — is excused as no cover, but the tap would land on it: skipped, covered by the control (ADR 0016, the explicit refusal)', async () => {
        const field = node({
          role: 'container',
          rect: { x: 24, y: 431, width: 354, height: 52 },
          children: [node({ role: 'text', identifier: 'payee_label', label: 'Payee’s name', rect: { x: 42, y: 446, width: 103, height: 22 } }), node({ role: 'textfield', rect: { x: 42, y: 447, width: 318, height: 20 } })],
        });
        expect(await pickOn(screenOf(field), 'payee_label')).toBe('covered by textfield');
        const row = node({ role: 'container', rect: { x: 24, y: 280, width: 354, height: 52 }, children: [loginTitle({ x: 42, y: 291, width: 200, height: 24 }), node({ role: 'button', rect: { x: 24, y: 280, width: 354, height: 52 } })] });
        expect(await pickOn(screenOf(row), 'login_title')).toBe('covered by button');
      });

      it('a row of a scroll view the title is not in, scrolled under it (WDA lists the top bar before the scroll view it is drawn over): picked', async () => {
        const form = node({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 512 }, children: [node({ role: 'text', label: 'Beneficiary', rect: { x: 16, y: 280, width: 370, height: 52 } })] });
        expect(await pickOn(screenOf(loginTitle(), node({ role: 'container', rect: FULL, children: [form] })), 'login_title')).toBe('tapped (201,303)');
      });

      it('an INTERACTIVE row of a scroll view the title is not in, holding its centre, is excused as no cover, but the tap would press it: skipped, covered by the row (ADR 0016, the explicit refusal)', async () => {
        const form = node({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 512 }, children: [node({ role: 'button', label: 'Beneficiary', rect: { x: 16, y: 280, width: 370, height: 52 } })] });
        expect(await pickOn(screenOf(loginTitle(), node({ role: 'container', rect: FULL, children: [form] })), 'login_title')).toBe('covered by button "Beneficiary"');
        // The same row under the title's left end only, clear of its centre (201,303): the tap presses the title.
        const aside = node({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 512 }, children: [node({ role: 'button', label: 'Beneficiary', rect: { x: 16, y: 280, width: 120, height: 52 } })] });
        expect(await pickOn(screenOf(loginTitle(), node({ role: 'container', rect: FULL, children: [aside] })), 'login_title')).toBe('tapped (201,303)');
      });

      it('a keyboard-owned node outside the band (constructed: an ofKeyboard subtree over the title) is no cover — the keyboard is the band\'s, judged first: picked (ADR 0016\'s second residual); a keyboard-owned CONTROL there the tap would press: skipped, covered by it', async () => {
        const strip = (child: UiNode) => node({ role: 'other', ofKeyboard: true, rect: { x: 0, y: 280, width: 402, height: 44 }, children: [child] });
        const rect = { x: 0, y: 280, width: 402, height: 44 };
        expect(await pickOn(screenOf(loginTitle(), strip(node({ role: 'text', label: 'Suggestion', rect }))), 'login_title')).toBe('tapped (201,303)');
        expect(await pickOn(screenOf(loginTitle(), strip(node({ role: 'button', label: 'Suggestion', rect }))), 'login_title')).toBe('covered by button "Suggestion"');
      });

      it('a labelled structural wrapper partly over the title, neither holding it whole nor frames only, covers — measured: the login\'s field wrappers under their own inner `container 36,367 330x52`: skipped (ADR 0016\'s third residual)', async () => {
        const login = await dump('myport-login-keyboard');
        expect(await pickOn(login, 'login_username_field')).toBe('covered by container');
        expect(await pickOn(login, 'login_password_field')).toBe('covered by container');
      });

      it('a centre covered with a large enough piece free — where a tap would MOVE — is skipped naming the cover over the centre, not the first or the last cover of the title, nor the last node drawn there: the dismissal is never aimed off its centre', async () => {
        const wrapped = node({ role: 'container', rect: { x: 36, y: 291, width: 330, height: 24 }, children: [loginTitle()] });
        // Three covers of the title, in this order; only the middle one holds its centre (201,303). The pieces between
        // them (104x24 and 106x24) are free, so a tap would move there.
        const left = node({ role: 'image', label: 'left', rect: { x: 36, y: 291, width: 40, height: 24 } });
        const badge = node({ role: 'image', label: 'badge', rect: { x: 180, y: 291, width: 40, height: 24 } });
        const right = node({ role: 'image', label: 'right', rect: { x: 326, y: 291, width: 40, height: 24 } });
        const strip = node({ role: 'other', ofKeyboard: true, rect: { x: 0, y: 280, width: 402, height: 44 }, children: [node({ role: 'button', label: 'Suggestion', rect: { x: 0, y: 280, width: 402, height: 44 } })] });
        expect(await pickOn(screenOf(wrapped, left, badge, right, strip), 'login_title')).toBe('covered by image "badge"');
      });

      it('under a keyboard line no guard acts on (idb\'s band, read by its shape) while clear of the band WDA marks: skipped "under the keyboard" — constructed, the two never meet on a device', async () => {
        const el = (type: string, AXLabel: string | null, AXUniqueId: string | null, x: number, y: number, width: number, height: number) => ({ type, AXLabel, AXUniqueId, frame: { x, y, width, height } });
        const keys = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((k, i) => el('Button', k, null, 2 + 40 * i, 780, 38, 46));
        const flat = parseIdbDescribeAll(JSON.stringify([el('Application', 'App', null, 0, 0, 402, 874), el('StaticText', 'Note', 'note', 42, 600, 120, 20), ...keys, el('Other', null, null, 0, 590, 402, 284)]));
        flat.children.push(bandNode({ x: 0, y: 700, width: 402, height: 174 })); // the WDA band, below the note's centre (102,610)
        expect(await pickOn(flat, 'note')).toBe('under the keyboard');
      });

      // A pin of UNCHANGED behaviour: the band's `frameOver` answers before the standing is asked, so a target in the
      // measured input-accessory bar's slot is skipped under the keyboard — the bar itself never decides.
      it('unchanged — under the measured input-accessory bar (wda-source-myport-2fa-keyboard-toolbar.json: Toolbar → Other → Button "Done" at 0,518 402x48, in a keyboard Window): skipped "under the keyboard" — WDA\'s band takes in the accessory slot, so the bar, no cover of a target, never decides', async () => {
        const twofa = await dump('myport-2fa-keyboard-toolbar');
        const support = [...everyNode(twofa)].find((n) => n.label?.startsWith('Pri probléme'))!;
        support.identifier = 'support_text';
        support.rect = { ...support.rect, y: 530 }; // its centre (201,550) in the bar's slot
        expect(await pickOn(twofa, 'support_text')).toBe('under the keyboard');
      });

      it('cut to a sliver at its scroll container\'s edge: skipped in the tap\'s own words (target-text.ts#cutSliverText)', async () => {
        const clipping = node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 280, width: 402, height: 200 }, children: [loginTitle({ x: 36, y: 280, width: 330, height: 20 }, [node({ role: 'text', rect: { x: 36, y: 240, width: 330, height: 52 } })])] }); // its text runs on past the edge: the evidence of a cut
        expect(await pickOn(screenOf(clipping), 'login_title')).toBe(
          "cut at its scroll container's top edge (container 0,280 402x200); only a 330x20 part of it shows, 20 deep across that edge, under the 24 a tap needs",
        );
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
      expect(result).toEqual({ note: sentence, keyboardHidden: sentence, maskedAppend: undefined, role: 'textfield', typed: 3, readBack: { kind: 'landed' } });
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
  // the read error beneath saying why no second agreeing read came — since
  // 2026-10-09 worded "found once, but no second read came" (one more read
  // was taken past the budget, and it failed too).
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
        'waiting for element id:login_submit to hold still (found once, but no second read came within the budget to confirm its position). ' +
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
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined, maskedAppend: undefined, role: 'textfield', typed: 3, readBack: { kind: 'landed' } });
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

  it('the guard\'s answer carries the node, its note, the point to tap and the tree the node was resolved in — nothing of the keyboard (in-tree clear, and oracle hidden)', async () => {
    // The tree since 2026-10-19: the fill's proof of what the other inputs held before it typed (fill-type.ts).
    const clear = await resolveClearOfKeyboard(iosFake(), 'id:login_title', FAST);
    expect(Object.keys(clear)).toEqual(['node', 'note', 'point', 'tree']);
    const android = iosFake();
    android.attachKeyboard({ state: 'hidden' });
    const hidden = await resolveClearOfKeyboard(android, 'id:login_submit', FAST);
    expect(Object.keys(hidden)).toEqual(['node', 'note', 'point', 'tree']);
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

  it('the measured SWIFT form (device check at e9e6509), the pad left up by a fill: the form\'s scrollable over the title\'s point is not a cover — the title is tapped and the result says so', async () => {
    for (const withToolbar of [true, false]) {
      const fake = swiftFormFake(withToolbar);
      const events = recorded(fake);
      expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [SWIFT_TITLE_TAP] })).toEqual({ hiddenBy: 'tapping id:"swift_payment.form.title"' });
      expect(events).toEqual(['read', 'tap:201,84', 'read']);
    }
  });

  it('the Contacts sheet (2026-10-09), the keyboard left up by a fill: its two itemless toolbars are not covers — the title is tapped and the result says so', async () => {
    const fake = contactsSheetFake({ bar: true, sheet: true });
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [CONTACTS_TITLE_TAP] })).toEqual({ hiddenBy: 'tapping role:"text" text:"New Contact"' });
    expect(events).toEqual(['read', 'tap:201,100', 'read']);
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

  it('idb\'s number pad (run2-ios #250) — its band\'s TOP is known since round 7 (ui-tree/draw-order.ts#DrawOrder.keyboardBandTop), the keyboard is NOT: one read, nothing tapped, nothing pressed, an empty result (a blind key submitted, K5d)', async () => {
    const tree = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [{ kind: 'tap', target: { id: 'swift_payment.form.title' } }] })).toEqual({});
    expect(events).toEqual(['read']);
    expect([fake.keys, sleeps]).toEqual([[], []]);
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

  it('the strategy tap does not hide the keyboard and the next one is unusable: AfterDismissalTap — the screen was touched — naming the one passed over', async () => {
    const fake = withBand('nothing'); // the band stays
    const error = (await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP, { kind: 'tap', target: { id: 'login_password' } }] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(error.message).toBe(
      `Tapped id:"login_title" at (201,303) to hide the soft keyboard after the fill, but it is still up over [0,539][402,874] on ${KEYBOARD_HIDE_CONFIRM_LOOKS} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped ` +
        '(passed over: tap id:"login_password": only interactive match (textfield) — a dismissal must be a non-interactive element). ' +
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
