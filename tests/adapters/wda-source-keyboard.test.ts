import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { MAX_BAND_FRACTION, parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { everyNode, KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
import { resolveNow } from '../../src/interact/resolve.js';
import { findAll, isInteractive, tapPoint } from '../../src/ui-tree/selectors.js';
import { isBareTree } from '../../src/ui-tree/bare-tree.js';
import { keyboardInTree, partOfKeyboard } from '../../src/ui-tree/soft-keyboard.js';

/**
 * WDA `GET /source?format=json` of finportal's MyPort (`sk.finportal.myport`)
 * on the iPhone 17 simulator, iOS 26.5, WDA 16.1.7, 402×874 pt, captured
 * 2026-10-07 for docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md
 * ("Measured 2026-10-07", both passes; the K1/K2/K3 and 2FA names are that
 * note's). SHRUNK from the 350–460 KB raw dumps to the fields the parser
 * reads — `type`, `label`, `rawIdentifier`, `value`, `rect`, `isVisible`,
 * `children` (the string `frame`/`nativeFrame`, `name`, `traits`,
 * `isEnabled`, `isAccessible`, `isFocused`, `customActions`,
 * `placeholderValue` and `isNativeAccessibilityElement` dropped; the
 * envelope's `sessionId` nulled) — with the WHOLE tree kept, every key of
 * the keyboard included, one element per line indented by depth. One value
 * scrubbed: the real username typed into `login_username` in the no-bar
 * capture is `user@example` here. Nothing else touched.
 * - wda-source-myport-login-keyboard-bar.json (K1): `login_password` focused,
 *   keyboard up WITH the AutoFill "Passwords" bar — the bug's case. The
 *   `Keyboard` {0,583,402,233} is `isVisible=1`; the bar is a sibling
 *   `SystemInputAssistantView` at 539–583; the union `Other` {0,539,402,335}.
 * - wda-source-myport-login-keyboard.json (K2): the same, WITHOUT the bar;
 *   the union `Other` is {0,566,402,308} — and the screenshot's pixels put
 *   the keyboard's grey from 566, 17 pt above the keys, so the bug note's
 *   "covered ≈583–874" was the Keyboard rect, not the drawn area.
 * - wda-source-myport-2fa-keyboard-toolbar.json (2FA, up): the number pad
 *   with the app's `inputAccessoryView` Toolbar "Done" (518–566) in ANOTHER
 *   Window (`isVisible=0`, the Toolbar's own `isVisible=1`); the union
 *   {0,518,402,356} includes the toolbar's slot.
 * - wda-source-myport-2fa-keyboard-parked.json (2FA, parked): the simulator
 *   has decided a hardware keyboard is typing — `Keyboard` {0,891,402,233}
 *   `isVisible=0`, below the screen; the Toolbar stays on screen at 826–874.
 * - wda-source-myport-login-no-keyboard.json (K3): nothing focused — one
 *   Window, no `Keyboard` node.
 */
const fixture = (name: string) => readFile(new URL(`../fixtures/wda-source-myport-${name}.json`, import.meta.url), 'utf8');
const LOGIN_BAR = parseWdaSource(await fixture('login-keyboard-bar'));
const LOGIN_NO_BAR = parseWdaSource(await fixture('login-keyboard'));
const TWOFA_TOOLBAR = parseWdaSource(await fixture('2fa-keyboard-toolbar'));
const TWOFA_PARKED = parseWdaSource(await fixture('2fa-keyboard-parked'));
const LOGIN_NONE = parseWdaSource(await fixture('login-no-keyboard'));

const bands = (tree: UiNode): UiNode[] => [...everyNode(tree)].filter((n) => n.role === KEYBOARD_ROLE);
const only = (tree: UiNode, selector: string): UiNode => {
  const found = findAll(tree, selector);
  expect(found).toHaveLength(1);
  return found[0];
};

/** Synthetic WDA node in the measured field shape; override per test. */
function el(type: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, rawIdentifier: null, label: null, value: null, rect: { x: 0, y: 0, width: 402, height: 874 }, isVisible: '1', children: [], ...over };
}
/** A Window holding the measured keyboard shape: full-screen wrapper > union > wrapper > Keyboard. */
const keyboardWindow = (union: Record<string, unknown>, keyboard: Record<string, unknown> = {}) =>
  el('Window', {
    children: [
      el('Other', {
        children: [
          el('Other', {
            rect: { x: 0, y: 539, width: 402, height: 335 },
            ...union,
            children: [
              el('Other', { rect: { x: 0, y: 583, width: 402, height: 233 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 }, ...keyboard })] }),
            ],
          }),
        ],
      }),
    ],
  });

describe('parseWdaSource — the on-screen keyboard\'s band carries KEYBOARD_ROLE (2026-10-07)', () => {
  it.each([
    ['login, keyboard with the AutoFill bar (K1)', LOGIN_BAR, { x: 0, y: 539, width: 402, height: 335 }],
    ['login, keyboard without the bar (K2): 17 pt above the Keyboard rect, where the drawn grey begins', LOGIN_NO_BAR, { x: 0, y: 566, width: 402, height: 308 }],
    ['2FA number pad with the accessory toolbar: the toolbar slot included', TWOFA_TOOLBAR, { x: 0, y: 518, width: 402, height: 356 }],
  ])('%s → exactly one keyboard node, its rect the union reaching the screen bottom', (_name, tree, band) => {
    const found = bands(tree);
    expect(found).toHaveLength(1);
    expect(found[0].rect).toEqual(band);
    expect(found[0].rect.y + found[0].rect.height).toBe(874);
    // The band is the real `Other` WDA reported — unlabeled, unidentified, with the keyboard among its children — not a synthetic node.
    expect(found[0]).toMatchObject({ label: null, identifier: null });
    expect(found[0].children.length).toBeGreaterThan(0);
    expect(keyboardInTree(tree)).toEqual({ state: 'shown', frame: band });
  });

  it.each([
    ['nothing focused, no Keyboard node (K3)', LOGIN_NONE],
    ['parked keyboard: isVisible=0 at y 891 on an 874 pt screen; the accessory toolbar still on screen is NOT a band (stage A residual)', TWOFA_PARKED],
  ])('%s → no keyboard node, the tree reads unknown', (_name, tree) => {
    expect(bands(tree)).toEqual([]);
    expect(keyboardInTree(tree)).toEqual({ state: 'unknown' });
  });

  it('the parked Keyboard element and its keys are still in the tree, as containers and others — nothing is dropped', () => {
    const keyboard = [...everyNode(TWOFA_PARKED)].find((n) => n.rect.y === 891 && n.rect.height === 233 && n.children.length === 1);
    expect(keyboard).toMatchObject({ role: 'container' });
    expect(only(TWOFA_PARKED, 'id:Toolbar')).toMatchObject({ role: 'other', rect: { x: 0, y: 826, width: 402, height: 48 } });
  });

  it('the `Keyboard` element itself stays a container, and its keys stay `other` — only the band node changes role', () => {
    const band = bands(LOGIN_BAR)[0];
    const keyboard = [...everyNode(band)].find((n) => n !== band && n.rect.y === 583 && n.rect.height === 233 && n.children.length === 1);
    expect(keyboard?.role).toBe('container');
    const keys = findAll(LOGIN_BAR, 'label:q');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.role).toBe('other');
  });

  it('the measured bug: login_submit resolves as before, and its centre lies inside the band WITH the bar and WITHOUT it', () => {
    for (const tree of [LOGIN_BAR, LOGIN_NO_BAR]) {
      const submit = resolveNow(tree, 'id:login_submit', { ambiguous: 'refuse' });
      expect(submit?.node).toMatchObject({ role: 'button', rect: { x: 36, y: 547, width: 141, height: 48 } });
      const at = tapPoint(submit!.node);
      expect(at).toEqual({ x: 107, y: 571 });
      const band = bands(tree)[0].rect;
      expect(at.y >= band.y && at.y < band.y + band.height).toBe(true);
    }
    // …while with no keyboard the same point is clear of anything.
    expect(resolveNow(LOGIN_NONE, 'id:login_submit', { ambiguous: 'refuse' })?.node.rect).toEqual({ x: 36, y: 547, width: 141, height: 48 });
  });

  it('the new role changes no selector behaviour: not interactive, not preferred, matched only by role:keyboard', () => {
    const band = bands(LOGIN_BAR)[0];
    expect(isInteractive(band)).toBe(false);
    expect(findAll(LOGIN_BAR, 'role:keyboard')).toEqual([band]);
    // The password field's title shares its id (the measured iOS convention): the field still wins, the band plays no part.
    expect(resolveNow(LOGIN_BAR, 'id:login_password', { ambiguous: 'refuse' })?.node.role).toBe('textfield');
    expect(isBareTree(LOGIN_BAR)).toBe(false);
  });

  it.each([
    ['login, keyboard with the bar (K1)', LOGIN_BAR, [undefined, true, true]],
    ['login, keyboard without the bar (K2)', LOGIN_NO_BAR, [undefined, true, true]],
    ['2FA number pad with the toolbar: the toolbar\'s Window (inputView beside it) and the keyboard\'s', TWOFA_TOOLBAR, [undefined, true, true]],
    ['2FA parked: the keyboard\'s Window only — the toolbar\'s holds no inputView (residual; no band, nothing refused)', TWOFA_PARKED, [undefined, undefined, true]],
    ['nothing focused (K3): one Window, no mark', LOGIN_NONE, [undefined]],
  ])('%s → `ofKeyboard` on the keyboard-side Windows only', (_name, tree, marks) => {
    expect(tree.children.map((w) => w.ofKeyboard)).toEqual(marks);
    expect([...everyNode(tree)].filter((n) => n.ofKeyboard === true)).toHaveLength(marks.filter(Boolean).length);
  });

  it.each([
    ['2FA toolbar: the inputAccessoryView Done {317,523} — in a different Window than the band', TWOFA_TOOLBAR, 'label:Done', true],
    ['2FA toolbar: the Toolbar itself', TWOFA_TOOLBAR, 'id:Toolbar', true],
    ['2FA toolbar: a digit key', TWOFA_TOOLBAR, 'label:1', true],
    ['K1: the Passwords bar', LOGIN_BAR, 'label:Passwords', true],
    ['K1: a key', LOGIN_BAR, 'label:q', true],
    ['K1: dictation', LOGIN_BAR, 'id:dictation', true],
    ['K1: the app\'s submit under the band is NOT the keyboard', LOGIN_BAR, 'id:login_submit', false],
    ['2FA toolbar: the app\'s submit', TWOFA_TOOLBAR, 'id:twofactor_submit', false],
  ])('partOfKeyboard — %s → %s', (_name, tree, selector, expected) => {
    const found = findAll(tree, selector);
    expect(found.length).toBeGreaterThan(0);
    for (const n of found) expect(partOfKeyboard(tree, n)).toBe(expected);
  });

  it('keeps every node of the dumps (225 / 216 / 174 / 170 / 159 — the measured counts)', () => {
    expect([LOGIN_BAR, LOGIN_NO_BAR, TWOFA_TOOLBAR, TWOFA_PARKED, LOGIN_NONE].map((t) => [...everyNode(t)].length)).toEqual([225, 216, 174, 170, 159]);
  });

  it('the fixtures carry no real credential — the one filled username was replaced by a placeholder', () => {
    expect(only(LOGIN_NO_BAR, 'role:textfield id:login_username').value).toBe('user@example');
    // …and the filled password reads as a fixed 8 bullets, not the real password's length.
    expect(only(LOGIN_NO_BAR, 'role:textfield id:login_password').value).toBe('••••••••');
  });
});

describe('keyboardMarks — the band rule on synthetic shapes', () => {
  const root = (...windows: Record<string, unknown>[]) => parseWdaSourceValue(el('Application', { children: windows }));

  it('the band is the FIRST ancestor below the Window that is a band of it — not the deepest', () => {
    const tree = root(keyboardWindow({ rect: { x: 0, y: 500, width: 402, height: 374 } }));
    expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 500, width: 402, height: 374 }]);
  });

  describe('the fail-safe (review 2026-10-07): a wrapper merely smaller than its Window is walked past, never crowned', () => {
    it('the bound is 60 % of the window height; the measured bands are 38–41 %', () => {
      expect(MAX_BAND_FRACTION).toBe(0.6);
      for (const tree of [LOGIN_BAR, LOGIN_NO_BAR, TWOFA_TOOLBAR]) expect(bands(tree)[0].rect.height / 874).toBeLessThan(0.42);
    });

    it.each([
      ['a safe-area inset: starts 1 pt below the top, nearly full height', { x: 0, y: 1, width: 402, height: 873 }],
      ['a fractional edge on raw rects: 873.67 of 874, from y 0.33', { x: 0, y: 0.33, width: 402, height: 873.67 }],
      ['a Stage Manager / split frame: exactly 60 % of the window', { x: 0, y: 100, width: 402, height: 874 * 0.6 }],
      ['starts AT the window top, however short', { x: 0, y: 0, width: 402, height: 300 }],
    ])('%s → walked past; the union below it is the band', (_name, wrapper) => {
      const tree = root(
        el('Window', {
          children: [el('Other', { rect: wrapper, children: [el('Other', { rect: { x: 0, y: 539, width: 402, height: 335 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] })],
        }),
      );
      expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 539, width: 402, height: 335 }]);
    });

    it('with no band-shaped ancestor at all the Keyboard\'s own rect is the band — exempt from the bound, since a keyboard that tall really covers that much', () => {
      const tree = root(
        el('Window', {
          children: [el('Other', { rect: { x: 0, y: 1, width: 402, height: 873 }, children: [el('Keyboard', { rect: { x: 0, y: 200, width: 402, height: 674 } })] })],
        }),
      );
      expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 200, width: 402, height: 674 }]);
    });

    it('a band one point under the bound is a band', () => {
      const tree = root(keyboardWindow({ rect: { x: 0, y: 350, width: 402, height: 874 * 0.6 - 1 } }));
      expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 350, width: 402, height: Math.round(874 * 0.6 - 1) }]);
    });
  });

  it('a Keyboard with no band-shaped ancestor gets its own rect — never nothing while it is on screen', () => {
    const tree = root(el('Window', { children: [el('Other', { children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] }));
    expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 583, width: 402, height: 233 }]);
  });

  it('a Keyboard that is isVisible=0 on screen, or isVisible=1 below the screen, emits nothing — both halves are required', () => {
    expect(bands(root(keyboardWindow({}, { isVisible: '0' })))).toEqual([]);
    expect(bands(root(keyboardWindow({ rect: { x: 0, y: 891, width: 402, height: 233 } }, { rect: { x: 0, y: 891, width: 402, height: 233 } })))).toEqual([]);
    expect(bands(root(keyboardWindow({}, { rect: { x: 0, y: 583, width: 0, height: 0 } })))).toEqual([]);
  });

  it('a keyboard that intersects the screen only partly (sliding in) is on screen', () => {
    const tree = root(keyboardWindow({ rect: { x: 0, y: 800, width: 402, height: 300 } }, { rect: { x: 0, y: 844, width: 402, height: 233 } }));
    expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 800, width: 402, height: 300 }]);
  });

  it('an ancestor without a usable rect is skipped, never crowned as a 0×0 band', () => {
    const tree = root(
      el('Window', {
        children: [el('Other', { rect: undefined, children: [el('Other', { rect: { x: 0, y: 539, width: 402, height: 335 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] })],
      }),
    );
    expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 539, width: 402, height: 335 }]);
  });

  it('with no Window ancestor the root stands in for it; a Keyboard that IS the root is its own band', () => {
    const noWindow = parseWdaSourceValue(el('Application', { children: [el('Other', { rect: { x: 0, y: 539, width: 402, height: 335 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] }));
    expect(bands(noWindow).map((n) => n.rect)).toEqual([{ x: 0, y: 539, width: 402, height: 335 }]);
    const alone = parseWdaSourceValue(el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } }));
    expect(alone.role).toBe(KEYBOARD_ROLE);
  });

  it('the keyboard\'s own UI: the Window holding a Keyboard, and the Window holding an inputView element, carry `ofKeyboard`; nothing else does', () => {
    const tree = root(
      el('Window', { children: [el('Button', { rawIdentifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } })] }),
      el('Window', { children: [el('Other', { rawIdentifier: 'Toolbar', rect: { x: 0, y: 518, width: 402, height: 48 } }), el('Other', { rawIdentifier: 'inputView', rect: { x: 0, y: 566, width: 402, height: 308 } })] }),
      keyboardWindow({}),
    );
    expect(tree.children.map((w) => w.ofKeyboard)).toEqual([undefined, true, true]);
    expect([...everyNode(tree)].filter((n) => n.ofKeyboard === true)).toHaveLength(2); // the roots only, not every key
    expect(partOfKeyboard(tree, only(tree, 'id:Toolbar'))).toBe(true);
    expect(partOfKeyboard(tree, only(tree, 'id:submit'))).toBe(false);
  });

  it('a parked Keyboard\'s Window is marked too (it is still its Window); without any Window the Keyboard or inputView element itself is', () => {
    const parked = root(keyboardWindow({ rect: { x: 0, y: 891, width: 402, height: 233 } }, { rect: { x: 0, y: 891, width: 402, height: 233 }, isVisible: '0' }));
    expect(parked.children[0].ofKeyboard).toBe(true);
    expect(bands(parked)).toEqual([]);
    const bare = parseWdaSourceValue(el('Application', { children: [el('Other', { rawIdentifier: 'inputView', rect: { x: 0, y: 566, width: 402, height: 308 } }), el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] }));
    expect(bare.ofKeyboard).toBeUndefined(); // the root is NOT marked — that would make every target the keyboard's
    expect(bare.children.map((n) => n.ofKeyboard)).toEqual([undefined, true]); // an inputView without a Window cannot be judged band-shaped: unmarked
  });

  /**
   * Review round 2: `rawIdentifier` is app-settable (a React Native testID).
   * An app element named `inputView` must not mark the APP's Window and
   * exempt every target in it from the guard. Two guards, each pinned.
   */
  describe('an app element named inputView does not disable the guard', () => {
    const appWindow = (...children: Record<string, unknown>[]) => el('Window', { children: [el('Other', { children })] });
    const submit = () => el('Button', { rawIdentifier: 'submit', rect: { x: 36, y: 547, width: 141, height: 48 } });

    it('the K1 dump with login_card renamed to inputView (the reviewer\'s case): the app\'s Window stays unmarked, login_submit is not the keyboard\'s, the band is as before', async () => {
      const renamed = (await fixture('login-keyboard-bar')).replace('"rawIdentifier":"login_card"', '"rawIdentifier":"inputView"');
      const tree = parseWdaSource(renamed);
      expect(findAll(tree, 'id:inputView').map((n) => n.rect)).toEqual([
        { x: 16, y: 211, width: 370, height: 400 }, // the card, now so named — in the app's Window
        { x: 0, y: 539, width: 402, height: 335 }, // UIKit's real placeholder, in the input-host Window
      ]);
      expect(tree.children.map((w) => w.ofKeyboard)).toEqual([undefined, true, true]);
      expect(partOfKeyboard(tree, only(tree, 'id:login_submit'))).toBe(false);
      expect(bands(tree)[0].rect).toEqual({ x: 0, y: 539, width: 402, height: 335 });
    });

    it('guard (a), the shape: an inputView that is not band-shaped in its window — not full width, not flush with the bottom, or too tall — marks nothing, even in a later Window', () => {
      for (const rect of [
        { x: 16, y: 539, width: 370, height: 335 }, // inset from the sides
        { x: 0, y: 500, width: 402, height: 300 }, // ends above the bottom
        { x: 0, y: 1, width: 402, height: 873 }, // nearly the whole window
      ]) {
        const tree = root(appWindow(submit()), el('Window', { children: [el('Other', { rawIdentifier: 'inputView', rect })] }));
        expect(tree.children.map((w) => w.ofKeyboard)).toEqual([undefined, undefined]);
      }
    });

    it('guard (b), the window: a band-shaped inputView inside the Application\'s FIRST Window (the app\'s own) marks nothing; the same element in a later Window marks that one', () => {
      const placeholder = () => el('Other', { rawIdentifier: 'inputView', rect: { x: 0, y: 539, width: 402, height: 335 } });
      const first = root(appWindow(submit(), placeholder()), keyboardWindow({}));
      expect(first.children.map((w) => w.ofKeyboard)).toEqual([undefined, true]);
      expect(partOfKeyboard(first, only(first, 'id:submit'))).toBe(false);
      const later = root(appWindow(submit()), el('Window', { children: [placeholder()] }), keyboardWindow({}));
      expect(later.children.map((w) => w.ofKeyboard)).toEqual([undefined, true, true]);
    });

    it('the Keyboard-type rule is unconditional (the type is UIKit\'s): a Keyboard in the first Window still marks it', () => {
      const tree = root(el('Window', { children: [el('Other', { rect: { x: 0, y: 539, width: 402, height: 335 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] }));
      expect(tree.children[0].ofKeyboard).toBe(true);
    });
  });

  it('a window without a usable rect leaves visibility to decide, and the band falls back to the Keyboard', () => {
    const tree = parseWdaSourceValue(
      el('Window', { rect: undefined, children: [el('Other', { rect: { x: 0, y: 539, width: 402, height: 335 }, children: [el('Keyboard', { rect: { x: 0, y: 583, width: 402, height: 233 } })] })] }),
    );
    expect(bands(tree).map((n) => n.rect)).toEqual([{ x: 0, y: 583, width: 402, height: 233 }]);
  });

  it('isVisible arrives as the string "1" (measured) — a numeric 1 is accepted, anything else is not visible', () => {
    expect(bands(root(keyboardWindow({}, { isVisible: 1 })))).toHaveLength(1);
    expect(bands(root(keyboardWindow({}, { isVisible: 'true' })))).toEqual([]);
    expect(bands(root(keyboardWindow({}, { isVisible: undefined })))).toEqual([]);
  });

  it('the band node keeps everything else WDA reported about it: rect rounded, children, label and identifier', () => {
    const tree = root(keyboardWindow({ rect: { x: 0, y: 538.6, width: 402, height: 335.4 }, rawIdentifier: 'kb_host', label: 'Keyboard host' }));
    const band = bands(tree)[0];
    expect(band).toMatchObject({ role: KEYBOARD_ROLE, identifier: 'kb_host', label: 'Keyboard host', rect: { x: 0, y: 539, width: 402, height: 335 } });
    expect(band.children).toHaveLength(1);
  });
});
