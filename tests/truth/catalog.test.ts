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
      'forms/form-basic',
      'forms/form-errors',
      'forms/form-keyboard',
      'forms/form-prefilled',
      'forms/form-picker',
      'forms/form-shared-id',
      'edges/scroll-bounded',
      'edges/scroll-sticky',
      'edges/scroll-bounded-flush',
      'edges/scroll-sticky-cut',
      'edges/scroll-sticky-view',
      'edges/scroll-top-edge',
      'bars/bands',
      'bars/bands-three-button',
      'bars/pinned-bar',
      'bars/tabbar-floating',
      'bars/tabbar-hidden-push',
      'bars/fab',
      'false-covers/own-parts',
      'false-covers/toolbar-dismiss',
      'false-covers/toolbar-dismiss-bar',
      'false-covers/toolbar-dismiss-short',
    ]);
  });

  const file = (family: FamilyFile['family'], ...ids: string[]): FamilyFile => ({ family, note: '', cells: ids.map((id) => ({ id, layer: 'none', targets: [] })) });
  const all = (over: FamilyFile[] = []) => FAMILIES.map((f) => over.find((o) => o.family === f) ?? file(f));

  it('refuses a cell in two families, a family named in a cell, a missing or unknown family', () => {
    expect(() => buildCatalog(all([file('base', 'x'), file('edges', 'x')]))).toThrow('cell x is in base.json and edges.json');
    expect(() => buildCatalog(all([{ family: 'bars', note: '', cells: [{ id: 'y', family: 'bars', layer: 'none', targets: [] }] }]))).toThrow('names a family');
    expect(() => buildCatalog(all().filter((f) => f.family !== 'bars'))).toThrow('no file for family bars');
    expect(() => buildCatalog([...all(), { family: 'nope' as never, note: '', cells: [] }])).toThrow('no family nope');
  });

  it('lays out an array-free object and a plain array on one line, the rest one member per line', () => {
    expect(formatJson({ a: [{ t: 'A', e: { x: 1 } }, 2], b: ['p', 'q'], c: [] })).toBe(
      '{\n  "a": [\n    { "t": "A", "e": { "x": 1 } },\n    2\n  ],\n  "b": ["p", "q"],\n  "c": []\n}',
    );
  });

  it('selects by family, by cell, by both; a name that matches nothing is an error', async () => {
    const c = await loadCatalog();
    expect(selectCells(c, {}).length).toBe(c.cells.length);
    expect(selectCells(c, { families: ['presented'] }).map((x) => x.id)).toEqual(['sheet-medium', 'alert-dim', 'sheet-medium-edges', 'sheet-background', 'sheet-long-list', 'sheet-long-list-short', 'dim-cover', 'blur-menu', 'blur-menu-grouped']);
    expect(selectCells(c, { cells: ['open', 'form-picker'] }).map((x) => x.id)).toEqual(['open', 'form-picker']);
    expect(selectCells(c, { families: ['presented', 'base'], cells: ['open', 'form-picker', 'alert-dim'] }).map((x) => x.id)).toEqual(['open', 'alert-dim']);
    expect(() => selectCells(c, { families: ['edgez'] })).toThrow('no family edgez');
    expect(() => selectCells(c, { cells: ['nope'] })).toThrow('no cell nope');
    // A family with no cell yet (here: edges with its cells left out — every family gains cells in phase 3).
    expect(() => selectCells({ ...c, cells: c.cells.filter((x) => x.family !== 'edges') }, { families: ['edges'] })).toThrow('no cell selected: families edges, cells any');
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
