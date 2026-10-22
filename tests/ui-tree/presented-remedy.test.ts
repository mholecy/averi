import { describe, expect, it } from 'vitest';
import { presentedLayerName, presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';

// The presented clause, per kind of marked layer (ui-tree/standing.ts#presentedRemedy, #presentedStop): a layer the
// source types is named by its kind and label; a `screen` layer, or none marked, gets the presented screen's words.

describe('presentedRemedy / presentedStop — the words per kind of presented layer', () => {
  it('an alert, an action sheet and a popover are named by kind and label, and a swipe would land on it', () => {
    expect(presentedRemedy('it', { kind: 'alert', label: 'Exit confirmation' })).toBe('an alert is presented over it ("Exit confirmation") — close it first');
    expect(presentedRemedy('the element', { kind: 'actionSheet', label: 'Discard?' })).toBe('an action sheet is presented over the element ("Discard?") — close it first');
    expect(presentedRemedy('it', { kind: 'popover' })).toBe('a popover is presented over it — close it first');
    expect(presentedStop({ kind: 'actionSheet', label: 'Discard?' })).toBe('an action sheet is presented over it ("Discard?") — close it first, and a swipe would land on the action sheet');
    expect(presentedStop({ kind: 'popover' })).toBe('a popover is presented over it — close it first, and a swipe would land on the popover');
  });

  it('a `screen` layer reads as any presented screen: a modal or a sheet, which a swipe on it may dismiss', () => {
    expect(presentedRemedy('it', { kind: 'screen' })).toBe(presentedRemedy('it'));
    expect(presentedStop({ kind: 'screen' })).toBe(presentedStop());
    expect(presentedStop()).toBe('a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it');
  });

  it('a `backdrop` (an in-window backdrop, one empty element WDA lists over the screen) names that evidence and the way out when a screenshot shows no menu', () => {
    const evidence = "a menu's backdrop is presented over it (an empty element WDA lists over the whole screen, after the screen's content) — close it first";
    const noMenu = 'if a screenshot shows no menu up, the backdrop is an overlay that lets touches through:';
    expect(presentedRemedy('it', { kind: 'backdrop' })).toBe(`${evidence}; no scroll moves it out from under that backdrop; ${noMenu} tap it by coordinates`);
    expect(presentedRemedy('the element', { kind: 'backdrop' })).toBe(
      "a menu's backdrop is presented over the element (an empty element WDA lists over the whole screen, after the screen's content) — close it first; " +
        `${noMenu} judge the element on that screenshot`,
    );
    expect(presentedStop({ kind: 'backdrop' })).toBe(`${evidence}; no scroll moves it out from under that backdrop, and a swipe on it may close the menu; ${noMenu} swipe and tap by coordinates`);
    expect(presentedLayerName({ kind: 'backdrop' })).toBe("a menu's backdrop");
  });
});
