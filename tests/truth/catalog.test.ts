import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCatalog, captureRefusal, CATALOG_FILE, formatJson, generatedCatalog, loadCatalog, readFamilies, selectCells, type FamilyFile } from '../../scripts/truth/catalog.js';
import { FAMILIES } from '../../scripts/truth/schema.js';

// The catalog both lab apps bundle (fixtures/apps/cells.json) is generated from one file per family
// (fixtures/apps/cells/<family>.json): committed up to date, every family filed once, every cell in one family.

describe('the cell catalog', () => {
  it('the committed cells.json is what the family files generate (run scripts/truth/catalog.ts)', async () => {
    expect(await readFile(CATALOG_FILE, 'utf8')).toBe(await generatedCatalog());
  });

  it('has one file per family, named for it', async () => {
    expect((await readFamilies()).map((f) => f.family).sort()).toEqual([...FAMILIES].sort());
  });

  it('stamps each cell with its family, families in their order; the phase-1/1b cells where phase 3 put them', async () => {
    const c = await loadCatalog();
    expect(c.cells.map((x) => `${x.family}/${x.id}`)).toEqual([
      'base/open',
      'presented/sheet-medium',
      'presented/alert-dim',
      'presented/sheet-medium-edges',
      'presented/sheet-background',
      'presented/sheet-long-list',
      'presented/sheet-long-list-short',
      'presented/dim-cover',
      'presented/blur-menu',
      'presented/blur-menu-grouped',
      'presented/blur-menu-stacked',
      'presented/blur-menu-unhidden',
      'presented/chooser-over-list',
      'presented/dialog-fullscreen',
      'presented/bottom-sheet-dialog',
      'presented/dialog-views-fullscreen',
      'forms/form-basic',
      'forms/form-errors',
      'forms/form-keyboard',
      'forms/form-keyboard-floating',
      'forms/form-prefilled',
      'forms/form-picker',
      'forms/form-shared-id',
      'forms/form-format',
      'forms/form-grouped',
      'edges/scroll-bounded',
      'edges/scroll-bounded-footer',
      'edges/scroll-sticky',
      'edges/scroll-bounded-flush',
      'edges/scroll-sticky-cut',
      'edges/scroll-sticky-rest',
      'edges/scroll-sticky-view',
      'edges/scroll-top-edge',
      'edges/scroll-top-edge-end',
      'edges/carousel-in-list',
      'edges/scroll-collapsing',
      'bars/bands',
      'bars/bands-three-button',
      'bars/pinned-bar',
      'bars/tabbar-floating',
      'bars/tabbar-dense',
      'bars/tabbar-hidden-push',
      'bars/fab',
      'false-covers/own-parts',
      'false-covers/toolbar-dismiss',
      'false-covers/toolbar-dismiss-bar',
      'false-covers/toolbar-dismiss-short',
      'false-covers/tap-catcher-beneath',
      'false-covers/tap-catcher-stacked',
      'text/text-sample',
      'text/text-under-bar',
      'text/text-nav-cut',
      'react-native/rn-field',
      'react-native/rn-banner',
      'react-native/rn-format',
      'react-native/rn-format-eager',
      'held/held-no',
      'held/held-no-spinner',
    ]);
  });

  it('the held cells carry their phases\' lengths (Held.swift, Held.kt read them): 6 s bare; the spinner\'s 4 s on held-no-spinner alone', async () => {
    const c = await loadCatalog();
    expect(c.cells.filter((x) => x.family === 'held').map((x) => [x.id, x.held])).toEqual([
      ['held-no', { bareMs: 6000 }],
      ['held-no-spinner', { bareMs: 6000, spinnerMs: 4000 }],
    ]);
  });

  const file = (family: FamilyFile['family'], ...ids: string[]): FamilyFile => ({ family, note: '', cells: ids.map((id) => ({ id, layer: 'none', targets: [] })) });
  const all = (over: FamilyFile[] = []) => FAMILIES.map((f) => over.find((o) => o.family === f) ?? file(f));

  it('refuses a cell in two families, a family named in a cell, a missing or unknown family', () => {
    expect(() => buildCatalog(all([file('base', 'x'), file('edges', 'x')]))).toThrow('cell x is in base.json and edges.json');
    expect(() => buildCatalog(all([{ family: 'bars', note: '', cells: [{ id: 'y', family: 'bars', layer: 'none', targets: [] }] }]))).toThrow('names a family');
    expect(() => buildCatalog(all().filter((f) => f.family !== 'bars'))).toThrow('no file for family bars');
    expect(() => buildCatalog([...all(), { family: 'nope' as never, note: '', cells: [] }])).toThrow('no family nope');
    const both = { tag: 'I', color: '#000000', slot: 0, declared: 'open' as const, text: 'Close', label: 'Close' };
    expect(() => buildCatalog(all([{ family: 'false-covers', note: '', cells: [{ id: 'z', layer: 'none', targets: [both] }] }]))).toThrow("cell z's I names both a text and a label");
  });

  it('lays out an array-free object and a plain array on one line, the rest one member per line', () => {
    expect(formatJson({ a: [{ t: 'A', e: { x: 1 } }, 2], b: ['p', 'q'], c: [] })).toBe(
      '{\n  "a": [\n    { "t": "A", "e": { "x": 1 } },\n    2\n  ],\n  "b": ["p", "q"],\n  "c": []\n}',
    );
  });

  it('selects by family, by cell, by both; a name that matches nothing is an error', async () => {
    const c = await loadCatalog();
    expect(selectCells(c, {}).length).toBe(c.cells.length);
    expect(selectCells(c, { families: ['presented'] }).map((x) => x.id)).toEqual(['sheet-medium', 'alert-dim', 'sheet-medium-edges', 'sheet-background', 'sheet-long-list', 'sheet-long-list-short', 'dim-cover', 'blur-menu', 'blur-menu-grouped', 'blur-menu-stacked', 'blur-menu-unhidden', 'chooser-over-list', 'dialog-fullscreen', 'bottom-sheet-dialog', 'dialog-views-fullscreen']);
    expect(selectCells(c, { cells: ['open', 'form-picker'] }).map((x) => x.id)).toEqual(['open', 'form-picker']);
    expect(selectCells(c, { families: ['presented', 'base'], cells: ['open', 'form-picker', 'alert-dim'] }).map((x) => x.id)).toEqual(['open', 'alert-dim']);
    expect(() => selectCells(c, { families: ['edgez'] })).toThrow('no family edgez');
    expect(() => selectCells(c, { cells: ['nope'] })).toThrow('no cell nope');
    // A family with no cell yet (here: edges with its cells left out — every family gains cells in phase 3).
    expect(() => selectCells({ ...c, cells: c.cells.filter((x) => x.family !== 'edges') }, { families: ['edges'] })).toThrow('no cell selected: families edges, cells any');
  });
});

describe('form-format\'s date and phone fields (D37): what f11–f14 fill', () => {
  it('date reformats as a dotted date under a mask placeholder with no letter or digit; phone does not, under a `+421` placeholder', async () => {
    const form = (await loadCatalog()).cells.find((c) => c.id === 'form-format')!.form!;
    expect(form.fields.map((f) => f.tag)).toEqual(['iban', 'amount', 'ibanShown', 'date', 'phone']);
    const field = (tag: string) => form.fields.find((f) => f.tag === tag)!;
    expect(field('date')).toMatchObject({ kind: 'text', placeholder: '__.__.____', format: 'date' });
    expect(field('phone')).toMatchObject({ kind: 'text', placeholder: '+421' });
    expect(field('phone').format).toBeUndefined();
    expect(field('date').formatIn).toBeUndefined();
  });
});

describe('L7: form-grouped and rn-format-eager, their own cells beside the captured form-format and rn-format (D60, D37 `+421`)', () => {
  it('form-grouped: ibanEager (group4eager) under form-format\'s IBAN placeholder, phoneGrouped (phone3) under a `+421` one, the submit; on both platforms', async () => {
    const cell = (await loadCatalog()).cells.find((c) => c.id === 'form-grouped')!;
    expect(cell).toMatchObject({ family: 'forms', layer: 'none', targets: [] });
    expect(cell.platforms).toBeUndefined();
    const form = cell.form!;
    expect(form.fields.map((f) => f.tag)).toEqual(['ibanEager', 'phoneGrouped']);
    const field = (tag: string) => form.fields.find((f) => f.tag === tag)!;
    expect(field('ibanEager')).toMatchObject({ kind: 'iban', placeholder: 'SK00 0000 0000 …', format: 'group4eager' });
    expect(field('phoneGrouped')).toMatchObject({ kind: 'text', placeholder: '+421', format: 'phone3' });
    expect(form.fields.map((f) => f.formatIn)).toEqual([undefined, undefined]);
    expect(form.submit).toEqual({ tag: 'submit', title: 'Send payment' });
  });

  it('rn-format-eager: E an IBAN (group4eager) and P a phone (phone3), text targets laid as rn-format\'s', async () => {
    const cell = (await loadCatalog()).cells.find((c) => c.id === 'rn-format-eager')!;
    expect(cell.family).toBe('react-native');
    expect(cell.targets.map((t) => [t.tag, t.slot, t.text, t.format, t.declared])).toEqual([
      ['E', 0, 'IBAN', 'group4eager', 'open'],
      ['P', 1, 'Phone', 'phone3', 'open'],
    ]);
  });

  it('form-format and rn-format keep their fields: the captured cells do not move', async () => {
    const cells = (await loadCatalog()).cells;
    expect(cells.find((c) => c.id === 'form-format')!.form!.fields.map((f) => [f.tag, f.format])).toEqual([['iban', 'group4'], ['amount', 'thousands'], ['ibanShown', 'group4'], ['date', 'date'], ['phone', undefined]]);
    expect(cells.find((c) => c.id === 'rn-format')!.targets.map((t) => [t.tag, t.format])).toEqual([['G', 'group4'], ['A', 'thousands']]);
  });
});

describe('captureRefusal: a cell captured only where it is built, and on Android under its navigation mode', () => {
  it('platforms, and the navigation mode on Android only', () => {
    expect(captureRefusal({}, 'ios', undefined)).toBeUndefined();
    expect(captureRefusal({ platforms: ['android'] }, 'ios', undefined)).toBe('built for android only');
    expect(captureRefusal({ platforms: ['android'] }, 'android', 'gesture')).toBeUndefined();
    expect(captureRefusal({ navigation: 'gesture' }, 'ios', undefined)).toBeUndefined();
    expect(captureRefusal({ navigation: 'gesture' }, 'android', 'gesture')).toBeUndefined();
    expect(captureRefusal({ navigation: 'gesture' }, 'android', 'three-button')).toBe('captured under gesture navigation only, the device is in three-button mode');
    expect(captureRefusal({ navigation: 'three-button' }, 'android', undefined)).toBe('captured under three-button navigation only, the device is in an unknown mode');
  });
});
