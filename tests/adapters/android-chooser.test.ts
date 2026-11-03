import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CHOOSER_ADVICE, CHOOSER_FOCUS_COMMAND, chooserInFocus } from '../../src/adapters/android-chooser.js';

// D55 (ADR 0041): Android's "Open with" chooser in front after a deep link, judged by the focused component alone.
// dumpsys-window-focus-api33-resolver.txt is the two focus lines batch-9's D55 probe recorded (averi_lab, API 33,
// main e734fedf) right after averi's open_deep_link of averilab://shared/open, a link two lab activities handle: the
// values as recorded, the two-space indent of `dumpsys window displays` restored. The probe kept no more of the dump.
// The keyboard fixtures are whole `dumpsys window displays` dumps with an app in front.

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const RESOLVER = 'android/com.android.internal.app.ResolverActivity';
/** The launcher's focus as batch-9 recorded it before the link (its `homeFocus`). */
const LAUNCHER_FOCUS = '  mCurrentFocus=Window{9d5e433 u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}\n';
/** Synthetic focus lines, in the dump's shape: `mCurrentFocus` naming a window, `mFocusedApp` an activity. */
const focus = (window: string, app: string) => `  mCurrentFocus=${window}\n  mFocusedApp=ActivityRecord{6909a9c u0 ${app} t2590}\n`;

describe('chooserInFocus — the chooser named by the focused component (batch-9, API 33)', () => {
  it('the recorded chooser in front: its component, as the dump names it', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-resolver.txt'))).toBe(RESOLVER);
  });
});

describe('chooserInFocus — an app, the launcher or no focus in front is no chooser', () => {
  it('an app in front (whole `dumpsys window displays` dumps, API 33): undefined', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api33-keyboard-hidden.txt'))).toBeUndefined();
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api33-keyboard-shown.txt'))).toBeUndefined();
  });

  it('the launcher, the race the link may lose (the chooser not in front yet): undefined — today\'s reply', () => {
    expect(chooserInFocus(LAUNCHER_FOCUS)).toBeUndefined();
    expect(chooserInFocus(focus(LAUNCHER_FOCUS.trim().slice('mCurrentFocus='.length), 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity'))).toBeUndefined();
  });

  it('no focus (`mCurrentFocus=null`, a transition) with an app the focused activity: undefined', () => {
    expect(chooserInFocus(focus('null', 'dev.averi.lab/.MainActivity'))).toBeUndefined();
  });

  it('nothing to read — an empty answer, another dump: undefined', async () => {
    expect(chooserInFocus('')).toBeUndefined();
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api36-no-ime-source.txt'))).toBeUndefined();
  });
});

describe('chooserInFocus — the focused activity decides; the focused window only when no activity is named (synthetic lines)', () => {
  it('no focus window yet, the chooser already the focused activity (the start resumed it, its window not drawn): the chooser', () => {
    expect(chooserInFocus(focus('null', RESOLVER))).toBe(RESOLVER);
  });

  it('the launcher still the focus window, the chooser the focused activity: the chooser', () => {
    expect(chooserInFocus(focus('Window{9d5e433 u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}', RESOLVER))).toBe(RESOLVER);
  });

  it('the chooser the focus window, an app the focused activity (a chooser on its way out, the link\'s app resumed): undefined', () => {
    expect(chooserInFocus(focus(`Window{56b9ca0 u0 ${RESOLVER}}`, 'dev.averi.lab/.MainActivity'))).toBeUndefined();
  });

  it('the chooser the focus window and no focused activity line: the chooser', () => {
    expect(chooserInFocus(`  mCurrentFocus=Window{56b9ca0 u0 ${RESOLVER}}\n`)).toBe(RESOLVER);
  });

  it('the focused activity\'s component, when the two lines name two choosers', () => {
    const chooser = 'android/com.android.internal.app.ChooserActivity';
    expect(chooserInFocus(focus(`Window{56b9ca0 u0 ${chooser}}`, RESOLVER))).toBe(RESOLVER);
  });
});

describe('chooserInFocus — the components that are the chooser, and no others (synthetic lines)', () => {
  it.each([
    ['android/com.android.internal.app.ChooserActivity'],
    ['com.android.intentresolver/.ResolverActivity'],
    ['com.android.intentresolver/.ChooserActivity'],
    ['com.android.intentresolver/com.android.intentresolver.ResolverActivity'],
  ])('%s: the chooser', (component) => {
    expect(chooserInFocus(focus(`Window{56b9ca0 u0 ${component}}`, component))).toBe(component);
  });

  it.each([
    ['com.example.app/.ResolverActivity', 'an app\'s own activity of that name'],
    ['com.example.android/.ResolverActivity', 'a package that ends in android'],
    ['android.example/.ResolverActivity', 'a package that starts with android'],
    ['com.android.intentresolver.x/.ChooserActivity', 'a package the resolver\'s prefixes'],
    ['android/com.android.internal.app.ResolverActivityHelper', 'a class the name prefixes'],
    ['android/com.android.internal.app.MyResolverActivity', 'a class the name ends'],
    ['android/com.android.internal.app.HeavyWeightSwitcherActivity', 'another of the platform\'s activities'],
    ['com.android.intentresolver/.IntentForwarderActivity', 'another of the resolver package\'s activities'],
  ])('%s (%s): undefined', (component) => {
    expect(chooserInFocus(focus(`Window{56b9ca0 u0 ${component}}`, component))).toBeUndefined();
  });

  it('a user other than the first (`u10`, a work profile): the same chooser', () => {
    const window = `  mCurrentFocus=Window{56b9ca0 u10 ${RESOLVER}}\n`;
    const app = `  mFocusedApp=ActivityRecord{6909a9c u10 ${RESOLVER} t2590}\n`;
    expect(chooserInFocus(window)).toBe(RESOLVER);
    expect(chooserInFocus(app)).toBe(RESOLVER);
  });

  it('a window named by its title, not a component (`Window{… u0 NotificationShade}`): undefined', () => {
    expect(chooserInFocus('  mCurrentFocus=Window{f61dea2 u0 NotificationShade}\n')).toBeUndefined();
  });
});

describe('CHOOSER_FOCUS_COMMAND — the two focus lines of `dumpsys window displays`, every word a constant', () => {
  it('is the one line averi asks', () => {
    expect(CHOOSER_FOCUS_COMMAND).toBe("dumpsys window displays | grep -E 'mCurrentFocus=|mFocusedApp='");
  });
});

describe('CHOOSER_ADVICE — what the reply advises, and that averi taps nothing', () => {
  it('is the one wording: pick the app, "Just once", never "Always"; BACK drops the link; averi taps nothing', () => {
    expect(CHOOSER_ADVICE).toBe(
      'Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one (never "Always": it ' +
        "changes the device's default for such links); press_key back drops the link. averi taps nothing itself.",
    );
  });
});
