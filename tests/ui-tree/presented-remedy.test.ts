import { describe, expect, it } from 'vitest';
import { noScrollHelps, noScrollRemedyText, orderRemedyText, presentedLayerName, presentedRemedy, presentedStop, type Remedy } from '../../src/ui-tree/standing.js';

// The presented clause, per kind of marked layer (ui-tree/standing.ts#presentedRemedy, #presentedStop): a layer the
// source types is named by its kind and label; a `screen` layer, or none marked, gets the presented screen's words.

describe('presentedRemedy / presentedStop / presentedLayerName — the words per kind of presented layer', () => {
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
    // The way out in a parenthesis right after "close it first", so what a caller appends ("; nothing was tapped",
    // ", so none was sent") follows the refusal's own clause, never the way out.
    expect(presentedRemedy('it', { kind: 'backdrop' })).toBe(`${evidence} (${noMenu} tap the target by its coordinates (its centre from ui_snapshot)); no scroll moves it out from under that backdrop`);
    expect(presentedRemedy('the element', { kind: 'backdrop' })).toBe(
      "a menu's backdrop is presented over the element (an empty element WDA lists over the whole screen, after the screen's content) — close it first " +
        `(${noMenu} judge the element on that screenshot); no scroll moves the element out from under that backdrop`,
    );
    expect(presentedStop({ kind: 'backdrop' })).toBe(`${evidence} (${noMenu} swipe, then tap the target, by coordinates); no scroll moves it out from under that backdrop, and a swipe on it may close the menu`);
    expect(presentedLayerName({ kind: 'backdrop' })).toBe("a menu's backdrop");
  });

  it('presentedLayerName, the layer in one phrase for a sentence already in a parenthesis: a typed layer by its article, kind and label; a `screen` layer or none, a sheet or modal', () => {
    expect(presentedLayerName({ kind: 'dialog', label: 'Rename' })).toBe('a dialog "Rename"');
    expect(presentedLayerName({ kind: 'dialog' })).toBe('a dialog');
    expect(presentedLayerName({ kind: 'alert', label: 'Delete?' })).toBe('an alert "Delete?"');
    expect(presentedLayerName({ kind: 'screen' })).toBe('a sheet or modal');
    expect(presentedLayerName(undefined)).toBe('a sheet or modal');
  });

  it('a dialog is named as the other typed layers are, in the remedy and the stop', () => {
    expect(presentedRemedy('it', { kind: 'dialog', label: 'Rename' })).toBe('a dialog is presented over it ("Rename") — close it first');
    expect(presentedStop({ kind: 'dialog' })).toBe('a dialog is presented over it — close it first, and a swipe would land on the dialog');
  });
});

describe('orderRemedyText / noScrollRemedyText — the words of a cover listed in reading order with the node', () => {
  it('`seenOver`: a menu or popover closed first; for a touch no scroll moves it out, for the pixel assert a part clear of it', () => {
    expect(orderRemedyText({ of: 'seenOver' }, 'touch')).toBe('if it is a menu or a popover, close it first; no scroll moves it out from under it');
    expect(orderRemedyText({ of: 'seenOver' }, 'pixel')).toBe('if it is a menu or a popover, close it first; else assert something in the element that lies clear of it');
  });

  it('`unordered`: no scroll tells the order — see a screenshot, or why one could not tell; each purpose its way out', () => {
    expect(orderRemedyText({ of: 'unordered' }, 'touch')).toBe(
      'no scroll tells which is on top: see a screenshot — if the other is drawn over it (a menu, a popover), close it first; if it is the one on top, tap it by coordinates',
    );
    expect(orderRemedyText({ of: 'unordered', why: 'both blurred' }, 'pixel')).toBe(
      'no scroll tells which is on top: a screenshot could not tell either (both blurred) — if the other is drawn over the element (a menu, a popover), close it first; if the element is the one on top, assert something in it that lies clear of the other',
    );
  });

  it('noScrollRemedyText words each no-scroll remedy as its own text does; noScrollHelps holds exactly those three', () => {
    expect(noScrollRemedyText({ of: 'seenOver' }, 'touch')).toBe(orderRemedyText({ of: 'seenOver' }, 'touch'));
    expect(noScrollRemedyText({ of: 'bothPinned' }, 'pixel')).toMatch(/^no scroll moves the element out from under that: neither lies in a scroll view/);
    const every: readonly Remedy[] = [{ of: 'unordered' }, { of: 'seenOver' }, { of: 'bothPinned' }, { of: 'presented' }, { of: 'keyboard' }, { of: 'fixed', what: 'screen' }, { of: 'pinned' }, { of: 'stuck' }, { of: 'scroll' }];
    expect(every.filter(noScrollHelps).map((r) => r.of)).toEqual(['unordered', 'seenOver', 'bothPinned']);
  });
});
