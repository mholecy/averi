import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { holdTracker } from '../../src/flow/hold-tracker.js';
import { isBareTree } from '../../src/ui-tree/bare-tree.js';
import { showsProgress } from '../../src/ui-tree/read-tree.js';

/**
 * The second look's hold (D2, docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-rung.md), on
 * explicit timestamps: a rendered tree that keeps one fingerprint across reads spanning holdMs has held; a change, a
 * bare read or a spinner starts it over.
 */
const node = (role: string, label: string | null, children: UiNode[] = [], height = 100): UiNode => ({
  role, label, identifier: null, value: null, rect: { x: 0, y: 0, width: 400, height }, children,
});
const screen = (text: string): UiNode => node('container', null, [node('text', text, [], 40)], 800);
const LOGIN = screen('Sign in');
const HOME = screen('Overview');
const BARE = node('container', null, [node('container', null)], 800);
const SPINNER = node('container', null, [node('text', 'Sign in', [], 40), node('progress', null, [], 40)], 800);

describe('holdTracker', () => {
  it('the fixtures: rendered screens, a bare one, a spinner on the login screen', () => {
    expect([isBareTree(LOGIN), isBareTree(HOME), isBareTree(BARE), isBareTree(SPINNER)]).toEqual([false, false, true, false]);
    expect(showsProgress(SPINNER)).toBe(true);
  });

  it('holds once the same tree is read again holdMs after it was first read — and says how long', () => {
    const t = holdTracker(2000);
    expect(t.observe(LOGIN, 1000)).toBeUndefined();
    expect(t.observe(structuredClone(LOGIN), 2500)).toBeUndefined();
    expect(t.observe(structuredClone(LOGIN), 3400)).toBe(2400);
  });

  it('the exact boundary: holdMs after the first read holds, one ms short does not', () => {
    const short = holdTracker(2000);
    short.observe(LOGIN, 0);
    expect(short.observe(LOGIN, 1999)).toBeUndefined();
    const exact = holdTracker(2000);
    exact.observe(LOGIN, 0);
    expect(exact.observe(LOGIN, 2000)).toBe(2000);
  });

  it('a changed fingerprint starts the hold over from that read', () => {
    const t = holdTracker(2000);
    t.observe(LOGIN, 0);
    expect(t.observe(HOME, 1500)).toBeUndefined();
    expect(t.observe(HOME, 3000)).toBeUndefined(); // 1.5 s since HOME was first read
    expect(t.observe(HOME, 3500)).toBe(2000);
  });

  it('a bare read starts it over', () => {
    const t = holdTracker(2000);
    t.observe(LOGIN, 0);
    expect(t.observe(BARE, 1000)).toBeUndefined();
    expect(t.observe(LOGIN, 2500)).toBeUndefined();
    expect(t.observe(LOGIN, 4500)).toBe(2000);
  });

  it('a spinner read starts it over, and a spinner never holds', () => {
    const t = holdTracker(2000);
    t.observe(LOGIN, 0);
    expect(t.observe(SPINNER, 1000)).toBeUndefined();
    expect(t.observe(LOGIN, 2500)).toBeUndefined();
    const spinning = holdTracker(2000);
    for (const at of [0, 1000, 2000, 3000, 9000]) expect(spinning.observe(SPINNER, at)).toBeUndefined();
  });
});
