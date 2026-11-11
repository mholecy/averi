import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultDisplayFocus, parseFocusedWindow } from '../../src/adapters/android-wm.js';
import { chooserInFocus } from '../../src/adapters/android-chooser.js';

// A27: ONE `mCurrentFocus` reader for both of its readers — parseFocusedWindow, which wants the focused window's hash
// (to find its block in `dumpsys window windows`), and the chooser's focus read (defaultDisplayFocus), which wants its
// component. Before A27 each had its own regex, and they did not read one line alike: the hash reader took any
// `Window{<hash> …`, the component reader only `Window{<hash> u<user> <pkg>/<class>}`. These tests pin where they
// differ, so the one reader keeps both answers as they were (no fixture shows a line the two would read differently:
// every real line is `Window{<hash> u0 …}`).

const dumpOf = (cell: string): string => readFileSync(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.windows.txt`, import.meta.url), 'utf8');
const SCREEN = { width: 1080, height: 2220 };
const STACKED = { of: 'stacked', frame: { x: 0, y: 66, width: 1080, height: 2087 }, screen: SCREEN };
const FOCUS_LINE = /mCurrentFocus=Window\{([0-9a-f]+) [^}]*\}/;

/** dialog-fullscreen's dump with its focus line's record after the hash rewritten (the window's block keeps its own). */
const focusRecordAs = (tail: string): string => {
  const dump = dumpOf('dialog-fullscreen');
  const hash = FOCUS_LINE.exec(dump)?.[1];
  expect(hash).toBeDefined();
  return dump.replace(FOCUS_LINE, `mCurrentFocus=Window{${hash} ${tail}}`);
};

describe('the focus line, read once: the window\'s hash for parseFocusedWindow, its component for the chooser', () => {
  it('a recorded line (`Window{<hash> u0 <pkg>/<class>}`): both read it', () => {
    expect(parseFocusedWindow(dumpOf('dialog-fullscreen'))).toEqual(STACKED);
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}\n')).toEqual({
      window: 'android/com.android.internal.app.ResolverActivity',
    });
  });

  it('a window named by a title, not a component (`Window{<hash> u0 Some Title}`): its hash is read, no component', () => {
    expect(parseFocusedWindow(focusRecordAs('u0 Dialog Title'))).toEqual(STACKED);
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 u0 Dialog Title}\n')).toEqual({});
  });

  it('a record with no user token (`Window{<hash> <pkg>/<class>}`, never captured): its hash is read, no component — the two old regexes\' difference, kept', () => {
    expect(parseFocusedWindow(focusRecordAs('dev.averi.lab/dev.averi.lab.MainActivity'))).toEqual(STACKED);
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 android/com.android.internal.app.ResolverActivity}\n')).toEqual({});
    expect(chooserInFocus('  mCurrentFocus=Window{56b9ca0 android/com.android.internal.app.ResolverActivity}\n')).toBeUndefined();
  });

  it('two focus lines in one block, the first a title (never captured): the hash is the first line\'s, the component the first one named', () => {
    const lines = '  mCurrentFocus=Window{1111111 u0 Dialog Title}\n  mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}\n';
    expect(defaultDisplayFocus(lines)).toEqual({ window: 'android/com.android.internal.app.ResolverActivity' });
    const dump = focusRecordAs('u0 Dialog Title');
    expect(parseFocusedWindow(dump.replace('mCurrentFocus=', 'mCurrentFocus=Window{2222222 u0 dev.averi.lab/dev.averi.lab.Other}\n  mCurrentFocus='))).toEqual({ of: 'unknown' });
  });

  it('the focused activity beside the window: `mFocusedApp`\'s component, in either API\'s shape', () => {
    const app = 'dev.averi.lab/.MainActivity';
    expect(defaultDisplayFocus(`  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{6909a9c u0 ${app}} t2590}\n`)).toEqual({ app });
    expect(defaultDisplayFocus(`  mFocusedApp=ActivityRecord{6909a9c u0 ${app} t2590}\n`)).toEqual({ app });
  });
});
