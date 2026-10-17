import type { UiNode } from '../../src/adapters/types.js';
import { node } from './fake.js';

/**
 * Hand-built trees with a PRESENTED LAYER over a list screen, shared by the presentation module's tests
 * (tests/ui-tree/presentation.test.ts) and draw order's, which reads it (tests/ui-tree/draw-order-marked-layers.test.ts):
 * the list beneath, a page sheet's layer marked `screen`, a popover's layer typed `actionSheet`, and the app's Window
 * under a root whose source judged presented layers. Each builder returns fresh nodes.
 */

export const IPHONE = { x: 0, y: 0, width: 402, height: 874 };
export const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** The app's Window with `layers`, under a root whose source judged presented layers. */
export const judged = (...layers: UiNode[]): UiNode => node({ role: 'container', label: 'Example', rect: IPHONE, presentationsJudged: true, children: [node({ role: 'container', rect: IPHONE, children: layers })] });

/** The list screen beneath: a title in the status strip's height above the sheet, and a row low on the screen. */
export const list = () => {
  const title = node({ role: 'text', identifier: 'title', label: 'Contacts', rect: rect(20, 20, 100, 30) });
  const row = node({ role: 'button', identifier: 'row', label: 'Kate Bell', rect: rect(20, 700, 362, 52) });
  return { title, row, layer: node({ role: 'container', rect: IPHONE, children: [title, row] }) };
};

/**
 * A page sheet's layer marked `screen`: its nav bar's Cancel, and its form with a field and a row over the list's row.
 */
export const sheet = () => {
  const cancel = node({ role: 'button', label: 'Cancel', rect: rect(16, 72, 70, 36) });
  const field = node({ role: 'textfield', identifier: 'first_name', rect: rect(20, 300, 362, 44) });
  const addPhone = node({ role: 'button', label: 'add phone', rect: rect(20, 690, 362, 52) });
  const form = node({ role: 'scrollable', rect: rect(0, 118, 402, 756), children: [field, addPhone] });
  const layer = node({ role: 'container', rect: IPHONE, presentation: 'screen', children: [node({ role: 'container', rect: rect(0, 62, 402, 56), children: [cancel] }), form] });
  return { cancel, field, addPhone, form, layer };
};

/**
 * A popover's layer typed `actionSheet`: its dim `dismiss popup`, then the popover holding the action sheet, the
 * element.
 */
export const popover = () => {
  const dim = node({ role: 'container', identifier: 'PopoverDismissRegion', label: 'dismiss popup', rect: IPHONE });
  const discard = node({ role: 'button', label: 'Discard Changes', rect: rect(10, 160, 240, 44) });
  const element = node({ role: 'other', label: 'Are you sure?', rect: rect(10, 78, 240, 169), presentationElement: true, children: [discard] });
  const layer = node({ role: 'container', rect: IPHONE, presentation: 'actionSheet', children: [dim, node({ role: 'container', rect: rect(10, 78, 240, 169), children: [element] })] });
  return { dim, discard, element, layer };
};
