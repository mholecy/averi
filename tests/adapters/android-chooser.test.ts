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

describe('chooserInFocus — a whole API 33 dump, with its `Display: mDisplayId=0` header', () => {
  it('the keyboard-hidden dump with batch-9\'s chooser pair on its focus lines: the chooser', async () => {
    const recorded = (await fixture('dumpsys-window-focus-api33-resolver.txt')).split('\n');
    const dump = (await fixture('dumpsys-window-displays-api33-keyboard-hidden.txt'))
      .replace(/^ {2}mCurrentFocus=.*$/m, recorded[0] ?? '')
      .replace(/^ {2}mFocusedApp=.*$/m, recorded[1] ?? '');
    expect(dump).toMatch(/^ {2}Display: mDisplayId=0 /m);
    expect(dump).toContain('mFocusedApp=ActivityRecord{6909a9c u0 android/com.android.internal.app.ResolverActivity} t2590}');
    expect(chooserInFocus(dump)).toBe(RESOLVER);
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

describe('chooserInFocus — API 29\'s `mFocusedApp`, an ActivityRecord inside an AppWindowToken (synthetic lines, AOSP 10\'s shape)', () => {
  /** API 29 prints the focused app as its window token: `AppWindowToken{… token=Token{… ActivityRecord{… u0 <component> t5}}}`. */
  const api29 = (window: string, app: string) =>
    `  mCurrentFocus=${window}\n  mFocusedApp=AppWindowToken{8a2c1f0 token=Token{4b3e2d1 ActivityRecord{6909a9c u0 ${app} t5}}}\n`;

  it('no focus window yet, the chooser the focused activity (the race): the chooser', () => {
    expect(chooserInFocus(api29('null', RESOLVER))).toBe(RESOLVER);
  });

  it('`mFocusedApp=null`: an ActivityRecord on a later line is not the focused activity — the window decides', () => {
    const dump = `  mCurrentFocus=null\n  mFocusedApp=null\n  mResumedActivity: ActivityRecord{6909a9c u0 ${RESOLVER} t2590}\n`;
    expect(chooserInFocus(dump)).toBeUndefined();
  });

  it('the chooser the focus window, an app the focused activity (a chooser on its way out): undefined — "Opened"', () => {
    expect(chooserInFocus(api29(`Window{56b9ca0 u0 ${RESOLVER}}`, 'dev.averi.lab/.MainActivity'))).toBeUndefined();
  });
});

describe('chooserInFocus — one focus pair per display: the default display\'s alone (synthetic dumps)', () => {
  const display = (id: number, window: string, app: string) =>
    `  Display: mDisplayId=${id} (organized)\n  mCurrentFocus=${window}\n  mFocusedApp=${app}\n`;
  const CHOOSER_WINDOW = `Window{56b9ca0 u0 ${RESOLVER}}`;
  const CHOOSER_APP = `ActivityRecord{6909a9c u0 ${RESOLVER} t2590}`;
  const LAB_WINDOW = 'Window{c6f91da u0 dev.averi.lab/dev.averi.lab.MainActivity}';
  const LAB_APP = 'ActivityRecord{59ce9b8 u0 dev.averi.lab/.MainActivity t8}';

  it('display 0 with no focused activity, display 1 showing a chooser: undefined', () => {
    expect(chooserInFocus(display(0, LAB_WINDOW, 'null') + display(1, CHOOSER_WINDOW, CHOOSER_APP))).toBeUndefined();
    expect(chooserInFocus(display(0, 'null', 'null') + display(1, CHOOSER_WINDOW, CHOOSER_APP))).toBeUndefined();
  });

  it('the chooser on display 0, an app on display 1: the chooser', () => {
    expect(chooserInFocus(display(0, CHOOSER_WINDOW, CHOOSER_APP) + display(1, LAB_WINDOW, LAB_APP))).toBe(RESOLVER);
  });

  it('display 0 listed after another: still display 0\'s pair', () => {
    expect(chooserInFocus(display(1, LAB_WINDOW, LAB_APP) + display(0, 'null', CHOOSER_APP))).toBe(RESOLVER);
    expect(chooserInFocus(display(1, CHOOSER_WINDOW, CHOOSER_APP) + display(0, LAB_WINDOW, LAB_APP))).toBeUndefined();
  });

  it('no display 0 among the headers: the first display\'s pair', () => {
    expect(chooserInFocus(display(1, CHOOSER_WINDOW, CHOOSER_APP) + display(2, LAB_WINDOW, LAB_APP))).toBe(RESOLVER);
    expect(chooserInFocus(display(10, LAB_WINDOW, LAB_APP) + display(1, CHOOSER_WINDOW, CHOOSER_APP))).toBeUndefined();
  });
});

describe('CHOOSER_FOCUS_COMMAND — each display\'s header and focus lines of `dumpsys window displays`, every word a constant', () => {
  it('is the one line averi asks', () => {
    expect(CHOOSER_FOCUS_COMMAND).toBe("dumpsys window displays | grep -E 'Display: mDisplayId=|mCurrentFocus=|mFocusedApp='");
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
