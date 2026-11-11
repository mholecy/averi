import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { fieldRefetch, findAgain, sameField, type TwinGuard } from '../../src/interact/fill-refetch.js';
import { screenIdentity } from '../../src/ui-tree/read-tree.js';
import { node } from '../helpers/fake.js';

/**
 * A28 FK1: the fill's reads of its field — by the selector, else by identity under the screen guard, else why lost.
 * End to end through fillField: fill.test.ts (`sameField matches exactly one node…`, the `lost` read-backs).
 */

const AT = { x: 0, y: 100, width: 300, height: 40 };
const field = (value: string | null = null, extra: Partial<UiNode> = {}) => node({ role: 'textfield', identifier: 'f', rect: { ...AT }, value, ...extra });
/** A screen: the field (or another node at its place) among nodes with these ids. */
const tree = (children: UiNode[], ids: string[] = ['title']): UiNode =>
  node({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children: [...ids.map((identifier, i) => node({ role: 'text', identifier, rect: { x: 0, y: 300 + i * 20, width: 100, height: 20 } })), ...children] });

describe('sameField — exactly one node of the chosen role, id and rect', () => {
  const chosen = field('old');
  it('one twin, whatever its value: found', () => {
    const twin = field('new');
    expect(sameField(tree([twin]), chosen)).toBe(twin);
  });
  it('two twins: none', () => expect(sameField(tree([field('a'), field('b')]), chosen)).toBeUndefined());
  it.each([
    ['another role', { role: 'text' }],
    ['another id', { identifier: 'g' }],
    ['another rect (moved)', { rect: { ...AT, y: AT.y + 1 } }],
    ['another size', { rect: { ...AT, width: AT.width - 1 } }],
  ])('%s: none', (_, extra) => expect(sameField(tree([field('x', extra)]), chosen)).toBeUndefined());
});

describe('findAgain — the selector, the twin under its guard, the why of a lost field', () => {
  const chosen = field('old');
  const before = tree([field('old')]);
  const typing: TwinGuard = { phase: 'typing', screen: screenIdentity(before) };

  it("the selector's match first, whatever the guard", () => {
    const match = field('by selector', { identifier: 'other' });
    for (const guard of [{ phase: 'before-typing' } as const, typing, { phase: 'typing-unread', resolvedOn: undefined } as const]) {
      expect(findAgain(tree([field('twin')], ['elsewhere']), match, chosen, guard)).toEqual({ node: match });
    }
  });

  it('before typing: the twin, on any screen', () => {
    const twin = field('new');
    expect(findAgain(tree([twin], ['elsewhere']), undefined, chosen, { phase: 'before-typing' })).toEqual({ node: twin });
  });

  it('before typing, no single twin: unmatched', () => {
    expect(findAgain(tree([], ['elsewhere']), undefined, chosen, { phase: 'before-typing' })).toEqual({ lost: 'unmatched' });
  });

  it('after typing on the same screen: the twin', () => {
    const twin = field('new');
    expect(findAgain(tree([twin]), undefined, chosen, typing)).toEqual({ node: twin });
  });

  it('after typing on the same screen, no single twin: unmatched', () => {
    expect(findAgain(tree([field('a'), field('b')]), undefined, chosen, typing)).toEqual({ lost: 'unmatched' });
  });

  it('after typing on another screen (an id came): screen-changed — its twin not asked', () => {
    expect(findAgain(tree([field('new')], ['title', 'error']), undefined, chosen, typing)).toEqual({ lost: 'screen-changed' });
  });

  it('after typing with no read before it: never the twin — unmatched without the resolved screen', () => {
    expect(findAgain(tree([field('new')]), undefined, chosen, { phase: 'typing-unread', resolvedOn: undefined })).toEqual({ lost: 'unmatched' });
  });

  it('after typing with no read before it, the read skipped: the resolved screen words it — the same screen unmatched, another screen-changed', () => {
    const resolvedOn = screenIdentity(before);
    expect(findAgain(tree([field('new')]), undefined, chosen, { phase: 'typing-unread', resolvedOn })).toEqual({ lost: 'unmatched' });
    expect(findAgain(tree([field('new')], ['next']), undefined, chosen, { phase: 'typing-unread', resolvedOn })).toEqual({ lost: 'screen-changed' });
  });
});

describe('fieldRefetch — the reads, and the guard typing sets', () => {
  /** An adapter whose reads return `screens` in turn (the last one repeated). */
  const reading = (...screens: UiNode[]) => {
    let reads = 0;
    return { uiTree: async () => structuredClone(screens[Math.min(reads++, screens.length - 1)]) };
  };
  const unreadable = (e: Error) => new Error(`wrapped: ${e.message}`);
  const VALUE = 'role:textfield value:"old"'; // a value selector: it stops matching once the field changes
  const OPTS = { ambiguous: 'first' as const };
  const chosen = field('old');

  it('no read yet: lastTree undefined; a read keeps its tree', async () => {
    const same = tree([field('old')]);
    const reads = fieldRefetch({ adapter: reading(same), target: VALUE, resolve: OPTS, chosen, unreadable });
    expect(reads.lastTree()).toBeUndefined();
    expect(await reads.read()).toEqual({ node: field('old') });
    expect(reads.lastTree()).toEqual(same);
  });

  it('typing after a read: the guard is that read\'s screen — a twin on it found, on another lost as screen-changed', async () => {
    const reads = fieldRefetch({ adapter: reading(tree([field('old')]), tree([field('new')]), tree([field('newer')], ['title', 'error'])), target: VALUE, resolve: OPTS, chosen, unreadable });
    await reads.read();
    reads.typingStarts();
    expect(await reads.read()).toEqual({ node: field('new') });
    expect(await reads.read()).toEqual({ lost: 'screen-changed' });
  });

  it('the guard is set once: a later typing (a retype) keeps the first screen', async () => {
    const reads = fieldRefetch({ adapter: reading(tree([field('old')]), tree([field('new')], ['next']), tree([field('new')])), target: VALUE, resolve: OPTS, chosen, unreadable });
    await reads.read();
    reads.typingStarts();
    expect(await reads.read()).toEqual({ lost: 'screen-changed' });
    reads.typingStarts(); // the screen read last is `next`'s: not the guard
    expect(await reads.read()).toEqual({ node: field('new') });
  });

  it('typing with no read before it: the twin never asked; the resolved screen words the why', async () => {
    const resolvedOn = screenIdentity(tree([field('old')]));
    const same = fieldRefetch({ adapter: reading(tree([field('new')])), target: VALUE, resolve: OPTS, chosen, resolvedOn, unreadable });
    same.typingStarts();
    expect(await same.read()).toEqual({ lost: 'unmatched' });
    const other = fieldRefetch({ adapter: reading(tree([field('new')], ['next'])), target: VALUE, resolve: OPTS, chosen, resolvedOn, unreadable });
    other.typingStarts();
    expect(await other.read()).toEqual({ lost: 'screen-changed' });
    const unworded = fieldRefetch({ adapter: reading(tree([field('new')], ['next'])), target: VALUE, resolve: OPTS, chosen, unreadable });
    unworded.typingStarts();
    expect(await unworded.read()).toEqual({ lost: 'unmatched' });
  });

  it('typing with no read before it, then a retype after reads: the twin stays off — the guard is set once', async () => {
    const reads = fieldRefetch({ adapter: reading(tree([field('new')])), target: VALUE, resolve: OPTS, chosen, unreadable });
    reads.typingStarts();
    expect(await reads.read()).toEqual({ lost: 'unmatched' });
    reads.typingStarts(); // a read is there now: still not the guard
    expect(await reads.read()).toEqual({ lost: 'unmatched' });
  });

  it('before typing: the twin on any screen', async () => {
    const reads = fieldRefetch({ adapter: reading(tree([field('')], ['next'])), target: VALUE, resolve: OPTS, chosen, unreadable });
    expect(await reads.read()).toEqual({ node: field('') });
  });

  it("a tree that cannot be read throws the caller's error", async () => {
    const reads = fieldRefetch({ adapter: { uiTree: async () => Promise.reject(new Error('device gone')) }, target: VALUE, resolve: OPTS, chosen, unreadable });
    await expect(reads.read()).rejects.toThrow('wrapped: ');
    expect(reads.lastTree()).toBeUndefined();
  });
});
