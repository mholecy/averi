import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { resolveNow } from '../../src/interact/resolve.js';
import { findAll } from '../../src/ui-tree/selectors.js';
import type { UiNode } from '../../src/adapters/types.js';

/** The one node a selector matches in a fixture — a mismatch is a fixture bug, not a resolution question. */
const findOne = (tree: UiNode, selector: string): UiNode => {
  const found = findAll(tree, selector);
  expect(found).toHaveLength(1);
  return found[0];
};

const fixture = (name: string) =>
  readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

// Real /source dumps (iPhone 17 / iOS 26.5, WDA 16.1.7, captured 2026-08-12).
const RN_MYPORT = await fixture('wda-source-rn-myport.json');
const SKELETON_LOGIN = await fixture('wda-source-skeleton-login.json');
// The same app's login screen, nothing focused (captured 2026-10-07; the
// keyboard fixtures' K3 — see wda-source-keyboard.test.ts for the capture).
const MYPORT_LOGIN = await fixture('wda-source-myport-login-no-keyboard.json');

function flatten(root: UiNode): UiNode[] {
  const out: UiNode[] = [];
  const walk = (n: UiNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Synthetic WDA node with the measured field shape; override per test. */
function el(type: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type,
    rawIdentifier: null,
    label: '',
    value: null,
    rect: { x: 0, y: 0, width: 100, height: 20 },
    isVisible: '1',
    isEnabled: '1',
    children: [],
    ...over,
  };
}

describe('parseWdaSource — RN fixture (the idb-invisible identifiers)', () => {
  const tree = parseWdaSource(RN_MYPORT);
  const nodes = flatten(tree);

  it('keeps the whole nested tree, including invisible nodes, but the text echoes (31 of 35)', () => {
    // 35 elements in the dump; the 4 unidentified StaticText children that
    // echo their <Text> parent (placeholder_title/status/gateway/scope) are
    // dropped since 2026-10-08 (wda-source.ts#isTextEcho).
    expect(nodes).toHaveLength(31);
  });

  it('root is the Application node normalized to container, not a synthetic wrapper', () => {
    expect(tree).toMatchObject({ role: 'container', label: 'MyPort', identifier: null });
    expect(tree.rect).toEqual({ x: 0, y: 0, width: 402, height: 874 });
  });

  it('surfaces the RN host view: an Other node WITH rawIdentifier becomes a container with id', () => {
    const screen = nodes.find((n) => n.identifier === 'placeholder_screen');
    expect(screen).toMatchObject({ role: 'container', label: null });
    // Selectors must resolve it — this is the id idb could not see at all.
    expect(findOne(tree, 'id:placeholder_screen')).toBe(screen);
  });

  it('surfaces static-text identifiers idb dropped, with labels intact', () => {
    const byId = (id: string) => nodes.find((n) => n.identifier === id);
    expect(byId('placeholder_title')).toMatchObject({ role: 'text', label: 'MyPort' });
    expect(byId('placeholder_status')).toMatchObject({ role: 'text', label: 'Scaffold is running.' });
    expect(byId('placeholder_gateway')).toMatchObject({ role: 'text' });
    expect(byId('placeholder_scope')).toMatchObject({ role: 'text', label: 'Scope: b2b' });
  });

  it('produces integer rects throughout', () => {
    for (const n of nodes) {
      for (const v of [n.rect.x, n.rect.y, n.rect.width, n.rect.height]) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

describe('parseWdaSource — native skeleton fixture', () => {
  const tree = parseWdaSource(SKELETON_LOGIN);
  const nodes = flatten(tree);

  it('parses the full tree (34 nodes)', () => {
    expect(nodes).toHaveLength(34);
  });

  it('maps native types: Button→button, Image→image, StaticText→text', () => {
    expect(nodes.filter((n) => n.role === 'button')).toHaveLength(13);
    expect(nodes.filter((n) => n.role === 'image')).toHaveLength(4);
    expect(nodes.filter((n) => n.role === 'text')).toHaveLength(3);
    // Not `find(label === ...)`: an ancestor Other carries the propagated label too.
    expect(nodes.some((n) => n.role === 'button' && n.label === 'Password login')).toBe(true);
  });

  it('maps the structural NavigationBar to container, keeping its identifier', () => {
    const nav = nodes.find((n) => n.identifier === '_TtGC7SwiftUI32NavigationStackHosting');
    expect(nav?.role).toBe('container');
  });

  it('resolution under WDA label propagation: the interactive Button wins over its label-carrying ancestor', () => {
    // The nested tree surfaces what idb's flat list hid: an ancestor `Other`
    // carries the same propagated label as its Button descendant. A text:
    // selector matches both — the shared resolution policy (interact/resolve.ts)
    // must disambiguate to the Button.
    const matches = findAll(tree, 'text:"Password login"');
    expect(matches.length).toBeGreaterThan(1); // the ambiguity is real in this fixture
    const resolved = resolveNow(tree, 'text:"Password login"', { ambiguous: 'refuse' }); // the tools' mode — and it does not need to refuse
    expect(resolved?.node.role).toBe('button');
    expect(resolved?.note).toContain('picked the only interactive one');
  });
});

describe('parseWdaSource — a React Native <Text> is one element, not its echo (2026-10-08)', () => {
  // WDA reports every RN <Text> as a StaticText (the testID's) holding ONE
  // unidentified StaticText with the identical label, value and rect. Kept,
  // the copy read "Prihlásenie Prihlásenie" in the text table's tree
  // fallback and a text: selector matched twice (wda-source.ts#isTextEcho).
  const tree = parseWdaSource(MYPORT_LOGIN);

  it('login_title on the real capture is a leaf text node carrying the id, label and value', () => {
    const title = findOne(tree, 'id:login_title');
    expect(title).toMatchObject({
      role: 'text', label: 'Prihlásenie', value: 'Prihlásenie',
      rect: { x: 36, y: 291, width: 330, height: 24 }, children: [],
    });
  });

  it('no StaticText in any MyPort capture keeps an echo child', async () => {
    const names = ['wda-source-rn-myport.json', 'wda-source-myport-login-no-keyboard.json', 'wda-source-myport-login-keyboard.json',
      'wda-source-myport-login-keyboard-bar.json', 'wda-source-myport-2fa-keyboard-toolbar.json', 'wda-source-myport-2fa-keyboard-parked.json'];
    for (const name of names) {
      const texts = flatten(parseWdaSource(await fixture(name))).filter((n) => n.role === 'text');
      expect(texts.length, name).toBeGreaterThan(0);
      expect(texts.filter((n) => n.children.length > 0), name).toEqual([]);
    }
  });

  it('text:"Prihlásenie" resolves to login_title alone — no ambiguity note, no refusal', () => {
    expect(findAll(tree, 'text:"Prihlásenie"')).toHaveLength(1);
    const resolved = resolveNow(tree, 'text:"Prihlásenie"', { ambiguous: 'refuse' });
    expect(resolved?.node.identifier).toBe('login_title');
    expect(resolved?.note).toBeUndefined();
    expect(resolveNow(tree, 'text:"Prihlásenie"', { ambiguous: 'first' })?.note).toBeUndefined();
  });

  const rect = { x: 36, y: 291, width: 330, height: 24 };
  const text = (over: Record<string, unknown> = {}) => el('StaticText', { label: 'Prihlásenie', value: 'Prihlásenie', rect, ...over });

  it('the synthetic echo is dropped, empty and null strings alike', () => {
    expect(parseWdaSourceValue(text({ rawIdentifier: 'login_title', children: [text()] })).children).toEqual([]);
    expect(parseWdaSourceValue(text({ value: null, children: [text({ value: '', rawIdentifier: '' })] })).children).toEqual([]);
  });

  it.each([
    ['a child with another label', text({ children: [text({ label: 'Prihlásiť sa' })] })],
    ['a child with another value', text({ children: [text({ value: 'other' })] })],
    ['an identified child', text({ children: [text({ rawIdentifier: 'login_title_inner' })] })],
    ['two echo children', text({ children: [text(), text()] })],
    ['a child of another type', text({ children: [el('Other', { label: 'Prihlásenie', value: 'Prihlásenie', rect })] })],
    ['a non-StaticText parent', el('Other', { label: 'Prihlásenie', value: 'Prihlásenie', rect, children: [text()] })],
    ['a Button parent', el('Button', { label: 'Prihlásenie', value: 'Prihlásenie', rect, children: [text()] })],
  ])('keeps the child as WDA reported it: %s', (_name, raw) => {
    const node = parseWdaSourceValue(raw);
    const expected = (raw.children as unknown[]).length;
    expect(node.children).toHaveLength(expected);
  });

  it.each(['x', 'y', 'width', 'height'] as const)('keeps a child whose rect differs in %s alone', (side) => {
    const node = parseWdaSourceValue(text({ children: [text({ rect: { ...rect, [side]: rect[side] + 5 } })] }));
    expect(node.children).toHaveLength(1);
    expect(node.children[0].rect[side]).toBe(rect[side] + 5);
  });

  it('keeps the whole subtree of a child that has a child of its own (not its echo)', () => {
    const node = parseWdaSourceValue(text({ children: [text({ children: [text({ label: 'Prihlásiť sa' })] })] }));
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toMatchObject({ label: 'Prihlásenie', children: [{ label: 'Prihlásiť sa', value: 'Prihlásenie', children: [] }] });
    expect(node.children[0].children).toHaveLength(1);
  });

  it('collapses an (unmeasured) chain of three identical StaticTexts whole, never half-way', () => {
    const node = parseWdaSourceValue(text({ rawIdentifier: 'login_title', children: [text({ children: [text()] })] }));
    expect(node).toMatchObject({ identifier: 'login_title', label: 'Prihlásenie', children: [] });
  });
});

describe('parseWdaSource — normalization and input shapes', () => {
  it('accepts the {value, sessionId} envelope and a bare root identically', () => {
    const root = el('Window', { children: [el('Button', { label: 'OK' })] });
    const enveloped = parseWdaSource(JSON.stringify({ value: root, sessionId: 'ABC-123' }));
    const bare = parseWdaSource(JSON.stringify(root));
    expect(enveloped).toEqual(bare);
    expect(enveloped.children[0]).toMatchObject({ role: 'button', label: 'OK' });
  });

  it('parseWdaSourceValue takes the already-parsed payload', () => {
    const tree = parseWdaSourceValue({ value: el('Application'), sessionId: 'X' });
    expect(tree.role).toBe('container');
  });

  it("a bare node's own string `value` field does not trip the envelope unwrap", () => {
    const tree = parseWdaSourceValue(el('TextField', { value: 'alice' }));
    expect(tree).toMatchObject({ role: 'textfield', value: 'alice' });
  });

  it('maps unknown types to "other"', () => {
    expect(parseWdaSourceValue(el('SomeFutureType')).role).toBe('other');
  });

  it('normalizes empty strings to null for label, value, and identifier', () => {
    const tree = parseWdaSourceValue(el('StaticText', { label: '', value: '', rawIdentifier: '' }));
    expect(tree).toMatchObject({ label: null, value: null, identifier: null });
  });

  it('tolerates missing children and missing rect', () => {
    const tree = parseWdaSourceValue({ type: 'Other' });
    expect(tree.children).toEqual([]);
    expect(tree.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(parseWdaSourceValue(el('Other', { children: null })).children).toEqual([]);
  });

  it('rounds rect values', () => {
    const tree = parseWdaSourceValue(
      el('Button', { rect: { x: 20.5, y: 699.6, width: 350.4, height: 48 } }),
    );
    expect(tree.rect).toEqual({ x: 21, y: 700, width: 350, height: 48 });
  });

  it('keeps invisible nodes (isVisible "0") — the assert layer relies on them', () => {
    const tree = parseWdaSourceValue(
      el('Window', { children: [el('Button', { rawIdentifier: 'offscreen', isVisible: '0' })] }),
    );
    expect(tree.children.find((n) => n.identifier === 'offscreen')).toBeDefined();
  });

  it('rejects payloads with no element root', () => {
    expect(() => parseWdaSource('{"sessionId":"X"}')).toThrow(/no element root/);
    expect(() => parseWdaSource('[1,2,3]')).toThrow(/no element root/);
    expect(() => parseWdaSource('"nope"')).toThrow(/no element root/);
  });
});

describe('parseWdaSource — field error pairing on the nested tree', () => {
  // Measured convention (payment form, 2026-08-05): the field's title AND its
  // validation message share the field's accessibilityIdentifier — title
  // above, error below. In the nested tree they live in DIFFERENT branches.
  const form = (extraTexts: Record<string, unknown>[] = []) =>
    el('Window', {
      children: [
        el('Other', {
          children: [
            el('StaticText', {
              rawIdentifier: 'amount', label: 'Amount',
              rect: { x: 20, y: 380, width: 100, height: 18 },
            }),
            el('TextField', {
              rawIdentifier: 'amount', label: 'Amount', value: '5',
              rect: { x: 20, y: 400, width: 350, height: 44 },
            }),
          ],
        }),
        el('Other', {
          children: [
            el('StaticText', {
              rawIdentifier: 'amount', label: 'Value is too small',
              rect: { x: 20, y: 448, width: 200, height: 16 },
            }),
            ...extraTexts,
          ],
        }),
      ],
    });

  it('attaches a same-identifier text below the field from another branch; the title above is not an error', () => {
    const tree = parseWdaSourceValue(form());
    const field = findOne(tree, 'role:textfield id:amount');
    expect(field.error).toBe('Value is too small');
  });

  it('nearest candidate below wins when there are two', () => {
    const tree = parseWdaSourceValue(
      form([
        el('StaticText', {
          rawIdentifier: 'amount', label: 'Further away',
          rect: { x: 20, y: 600, width: 200, height: 16 },
        }),
      ]),
    );
    expect(findOne(tree, 'role:textfield id:amount').error).toBe('Value is too small');
  });

  it('leaves error unset when nothing with the same identifier sits below', () => {
    const tree = parseWdaSourceValue(
      el('Window', {
        children: [
          el('TextField', {
            rawIdentifier: 'note',
            rect: { x: 20, y: 500, width: 350, height: 44 },
          }),
        ],
      }),
    );
    expect(findOne(tree, 'id:note').error).toBeUndefined();
  });
});
