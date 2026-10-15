import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';

// What the WDA parser marks as the element of a PRESENTED LAYER (`UiNode.presentation`): the source's own word that a
// layer is presented over the screen beneath, read from the element's type — an `Alert` today.

/** A synthetic WDA element: visible and accessible unless overridden. */
const el = (type: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type,
  rawIdentifier: null,
  label: null,
  value: null,
  rect: { x: 0, y: 0, width: 402, height: 874 },
  isVisible: '1',
  isAccessible: '1',
  children: [],
  ...over,
});

const all = (tree: UiNode): UiNode[] => [...everyNode(tree)];

describe('UiNode.presentation — the element of a presented layer, as WDA types it', () => {
  it('an `Alert` is marked "alert" and keeps its role, label and rect; nothing around or inside it is marked', () => {
    const button = el('Button', { label: 'Discard', rect: { x: 205, y: 473, width: 140, height: 48 } });
    const alert = el('Alert', { label: 'Exit confirmation', rect: { x: 41, y: 365, width: 320, height: 172 }, children: [button] });
    const tree = parseWdaSourceValue(el('Application', { children: [el('Window', { children: [el('Other'), el('Other', { children: [el('Other'), alert] })] })] }));
    const marked = all(tree).filter((n) => n.presentation !== undefined);
    expect(marked.map((n) => [n.role, n.label, n.rect, n.presentation])).toEqual([['container', 'Exit confirmation', { x: 41, y: 365, width: 320, height: 172 }, 'alert']]);
  });

  it('no other type is marked — a `Sheet`, a `Popover`, an `Other` the screen\'s size', () => {
    const tree = parseWdaSourceValue(el('Application', { children: [el('Window', { children: [el('Other'), el('Sheet'), el('Popover')] })] }));
    expect(all(tree).filter((n) => n.presentation !== undefined)).toEqual([]);
  });
});
