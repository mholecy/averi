import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CHOOSER_ADVICE, CHOOSER_FOCUS_COMMAND, CHOOSER_SHEET_ADVICE, chooserAdvice, chooserAlsoInFront, chooserInFocus, chooserSheet, chooserSheetSays, launchChooserNote, monkeyChooserRefusal } from '../../src/adapters/android-chooser.js';
import { everyNode, type ChooserSheet, type UiNode } from '../../src/adapters/types.js';
import type { StartRefused } from '../../src/adapters/android-start.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';
import { parseDump } from '../helpers/android-dumps.js';

// D55 (ADR 0041): Android's "Open with" chooser in front after a deep link, judged by the focused component alone.
// dumpsys-window-focus-api33-resolver.txt is the two focus lines batch-9's D55 probe recorded (averi_lab, API 33,
// main e734fedf) right after averi's open_deep_link of averilab://shared/open, a link two lab activities handle: the
// values as recorded, the two-space indent of `dumpsys window displays` restored. The probe kept no more of the dump.
// The keyboard fixtures are whole `dumpsys window displays` dumps with an app in front.
// D55r: the dumpsys-window-focus-api33-b10-*.txt fixtures are batch-10's E1 reads (averi_lab, API 33, main 139256a2):
// CHOOSER_FOCUS_COMMAND as the probe read it right after averi's open_deep_link replied ("Opened" each time; averi's
// own read was not recorded): -chooser after averilab://shared/open from the launcher with both lines naming the
// chooser (run 2), -chooser-window-null the one run whose window was still `null` (run 1), -lab-window-null after
// averilab://cell/open, one handler (control 1).

const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const RESOLVER = 'android/com.android.internal.app.ResolverActivity';
const LAB = 'dev.averi.lab/.MainActivity';
/** The chooser as the focused window, batch-9's record. */
const CHOOSER_WINDOW = `Window{56b9ca0 u0 ${RESOLVER}}`;
/** The launcher's focus as batch-9 recorded it before the link (its `homeFocus`). */
const LAUNCHER_FOCUS = '  mCurrentFocus=Window{9d5e433 u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}\n';

/**
 * `mFocusedApp`'s ActivityRecord in each API's shape: API 33 closes the component with a brace
 * (`… <component>} t2590}`: batch-9's and batch-10's every read), API 36 with a space (`… <component> t2}`: the
 * API 36 fixture). Every synthetic case below that writes an `mFocusedApp` line runs against both.
 */
/** A read's focus lines alone (`mCurrentFocus`, `mFocusedApp`), in order: its header and blank tail dropped. */
const focusLines = (read: string) => read.split('\n').filter((line) => /mCurrentFocus=|mFocusedApp=/.test(line));

const SHAPES = [
  ['API 33', (app: string, user = 'u0') => `ActivityRecord{6909a9c ${user} ${app}} t2590}`],
  ['API 36', (app: string, user = 'u0') => `ActivityRecord{6909a9c ${user} ${app} t2590}`],
] as const;

describe('chooserInFocus — the chooser named by the focused component (batch-9, API 33)', () => {
  it('the recorded chooser in front: its component, as the dump names it', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-resolver.txt'))).toBe(RESOLVER);
  });
});

describe('chooserInFocus — batch-10\'s reads at averi\'s reply (D55r, API 33, the brace shape)', () => {
  it('both lines the chooser: the chooser', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b10-chooser.txt'))).toBe(RESOLVER);
  });

  it('the window still `null`, the chooser already the focused activity: the chooser — the activity alone names it', async () => {
    const read = await fixture('dumpsys-window-focus-api33-b10-chooser-window-null.txt');
    expect(read).toContain('mCurrentFocus=null\n');
    expect(chooserInFocus(read)).toBe(RESOLVER);
  });

  it('the window still `null`, the lab the focused activity (a one-handler link): undefined', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b10-lab-window-null.txt'))).toBeUndefined();
  });

  it('batch-10\'s brace-shape activity line decides over the chooser\'s window: the lab under it is undefined', async () => {
    const [, lab = ''] = focusLines(await fixture('dumpsys-window-focus-api33-b10-lab-window-null.txt'));
    const [chooserWindow = ''] = focusLines(await fixture('dumpsys-window-focus-api33-b10-chooser.txt'));
    expect(lab).toBe('  mFocusedApp=ActivityRecord{10e4bcf u0 dev.averi.lab/.MainActivity} t2681}');
    expect(chooserWindow).toContain(`mCurrentFocus=Window{db0395f u0 ${RESOLVER}}`);
    expect(chooserInFocus(`${chooserWindow}\n${lab}\n`)).toBeUndefined();
  });
});

// T4: more of the batches' real reads, as the device printed them (`dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'`,
// no display header), each fed to chooserInFocus:
// - dumpsys-window-focus-api33-b10-launcher.txt: batch-10's D55 E2 read before the link (averi_lab, API 33, main
//   139256a2), the launcher in front, `mFocusedApp` in API 33's brace shape (`…NexusLauncherActivity} t1620}`);
// - dumpsys-window-focus-api33-b4-chrome-firstrun.txt: batch-4's D55 read after `am start -a VIEW -d
//   https://example.com` (averi_lab, API 33), one handler, Chrome's FirstRunActivity in front;
// - dumpsys-window-focus-api33-b10-after-launch-{intent,monkey}.txt: batch-10's D55 E4 reads 1.5 s after a launch_app
//   (D55b's cases, android.test.ts): the chooser still in front;
// - dumpsys-window-focus-api33-b11-after-launch-{intent-start,intent-start-chooser-window,monkey}.txt: batch-11's
//   D55b reads, averi's own CHOOSER_FOCUS_COMMAND (display header and all) right where D55b reads it — at the `-p`
//   start's return (run 1, the window `null`, as in 7 of 10; run 2, the chooser's own window, as in the other 3) and
//   after monkey's exit 251 (run 1 of 3);
// - cmd-package-resolve-activity-api33-b10-{two,one}-handler(s).txt: batch-10's D55 E3 reads of `cmd package
//   resolve-activity --brief -a android.intent.action.VIEW -d <url>` (the same bytes 3 of 3 times each, 21–28 ms).
//   These are SHAPE RECORDS for a parser that does not exist yet (ADR 0041's documented fallback, not built): averi
//   never asks resolve-activity, so their pins guard no averi code and kill no mutant.
describe('chooserInFocus — T4: the batches\' other real focus reads (API 33, brace shape, no display header)', () => {
  it('the launcher in front, both lines its own (batch-10, before the link): undefined', async () => {
    const read = await fixture('dumpsys-window-focus-api33-b10-launcher.txt');
    expect(read).toContain('mFocusedApp=ActivityRecord{c72a554 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity} t1620}\n');
    expect(chooserInFocus(read)).toBeUndefined();
  });

  it('the launcher\'s brace-shape activity line decides over the chooser\'s window: undefined (a chooser on its way out)', async () => {
    const [, launcher = ''] = focusLines(await fixture('dumpsys-window-focus-api33-b10-launcher.txt'));
    expect(chooserInFocus(`  mCurrentFocus=${CHOOSER_WINDOW}\n${launcher}\n`)).toBeUndefined();
  });

  it('a third-party activity in front that is not the chooser (Chrome\'s FirstRunActivity, batch-4): undefined', async () => {
    const read = await fixture('dumpsys-window-focus-api33-b4-chrome-firstrun.txt');
    expect(read).toContain('com.android.chrome/org.chromium.chrome.browser.firstrun.FirstRunActivity} t2549}\n');
    expect(chooserInFocus(read)).toBeUndefined();
  });

  it('the chooser still in front 1.5 s after each launch_app of batch-10\'s E4: the chooser', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b10-after-launch-intent.txt'))).toBe(RESOLVER);
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b10-after-launch-monkey.txt'))).toBe(RESOLVER);
  });

  it('averi\'s own read at the `-p` start\'s return and after monkey\'s refusal (batch-11, D55b): the chooser, either window', async () => {
    const atStart = await fixture('dumpsys-window-focus-api33-b11-after-launch-intent-start.txt');
    expect(atStart).toBe(
      '  Display: mDisplayId=0 (organized)\n  mCurrentFocus=null\n' +
        `  mFocusedApp=ActivityRecord{4d8b71b u0 ${RESOLVER}} t2841}\n`,
    );
    expect(chooserInFocus(atStart)).toBe(RESOLVER);
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b11-after-launch-intent-start-chooser-window.txt'))).toBe(RESOLVER);
    expect(chooserInFocus(await fixture('dumpsys-window-focus-api33-b11-after-launch-monkey.txt'))).toBe(RESOLVER);
  });

  it('an app activity under the chooser\'s brace-shape window: the activity line read, so undefined', async () => {
    const [window = ''] = focusLines(await fixture('dumpsys-window-focus-api33-b10-after-launch-intent.txt'));
    const [, chrome = ''] = focusLines(await fixture('dumpsys-window-focus-api33-b4-chrome-firstrun.txt'));
    expect(chooserInFocus(`${window}\n${chrome}\n`)).toBeUndefined();
  });
});

describe('`cmd package resolve-activity --brief` — batch-10\'s two shapes, records for a parser not built yet (ADR 0041\'s fallback)', () => {
  it('two handlers, none preferred: the resolver, `match=0x0 … isDefault=false`', async () => {
    expect(await fixture('cmd-package-resolve-activity-api33-b10-two-handlers.txt')).toBe(
      'priority=0 preferredOrder=0 match=0x0 specificIndex=-1 isDefault=false\n' + `${RESOLVER}\n`,
    );
  });

  it('one handler: the lab\'s activity, `match=0x308000 … isDefault=true`', async () => {
    expect(await fixture('cmd-package-resolve-activity-api33-b10-one-handler.txt')).toBe(
      'priority=0 preferredOrder=0 match=0x308000 specificIndex=-1 isDefault=true\n' + `${LAB}\n`,
    );
  });

  it('is no focus read: chooserInFocus names nothing in either, though the two-handler answer names the resolver', async () => {
    expect(chooserInFocus(await fixture('cmd-package-resolve-activity-api33-b10-two-handlers.txt'))).toBeUndefined();
    expect(chooserInFocus(await fixture('cmd-package-resolve-activity-api33-b10-one-handler.txt'))).toBeUndefined();
  });
});

describe('chooserInFocus — a whole API 33 dump, with its `Display: mDisplayId=0` header', () => {
  /** The keyboard-hidden dump with each focus line the given read holds put in place of the dump's own. */
  const withFocus = async (read: string) =>
    focusLines(read).reduce(
      (dump, line) => dump.replace(line.includes('mCurrentFocus=') ? /^ {2}mCurrentFocus=.*$/m : /^ {2}mFocusedApp=.*$/m, line),
      await fixture('dumpsys-window-displays-api33-keyboard-hidden.txt'),
    );

  it('the keyboard-hidden dump with batch-9\'s chooser pair on its focus lines: the chooser', async () => {
    const dump = await withFocus(await fixture('dumpsys-window-focus-api33-resolver.txt'));
    expect(dump).toMatch(/^ {2}Display: mDisplayId=0 /m);
    expect(dump).toContain('mFocusedApp=ActivityRecord{6909a9c u0 android/com.android.internal.app.ResolverActivity} t2590}');
    expect(chooserInFocus(dump)).toBe(RESOLVER);
  });

  it('batch-10\'s window-`null` pair on its focus lines: the chooser, from `mFocusedApp` alone', async () => {
    const dump = await withFocus(await fixture('dumpsys-window-focus-api33-b10-chooser-window-null.txt'));
    expect(dump).toContain('\n  mCurrentFocus=null\n');
    expect(chooserInFocus(dump)).toBe(RESOLVER);
  });

  it('the dump\'s own pair, the chooser\'s window over its app activity: undefined — `mFocusedApp` read in the dump', async () => {
    const dump = await withFocus(`  mCurrentFocus=${CHOOSER_WINDOW}\n`);
    expect(dump).toContain('mFocusedApp=ActivityRecord{59ce9b8 u0 com.example.app/.MainActivity} t8}');
    expect(chooserInFocus(dump)).toBeUndefined();
  });
});

describe('chooserInFocus — an app, the launcher or no focus in front is no chooser (recorded dumps)', () => {
  it('an app in front (whole `dumpsys window displays` dumps, API 33): undefined', async () => {
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api33-keyboard-hidden.txt'))).toBeUndefined();
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api33-keyboard-shown.txt'))).toBeUndefined();
  });

  it('nothing to read — an empty answer, another dump: undefined', async () => {
    expect(chooserInFocus('')).toBeUndefined();
    expect(chooserInFocus(await fixture('dumpsys-window-displays-api36-no-ime-source.txt'))).toBeUndefined();
  });

  it('the launcher\'s window alone, the race the link may lose (the chooser not in front yet): undefined — today\'s reply', () => {
    expect(chooserInFocus(LAUNCHER_FOCUS)).toBeUndefined();
  });

  it('a window named by its title, not a component (`Window{… u0 NotificationShade}`): undefined', () => {
    expect(chooserInFocus('  mCurrentFocus=Window{f61dea2 u0 NotificationShade}\n')).toBeUndefined();
  });

  it('a record cut right after the component (no `}` or space after it, at the end or before a newline): that line names nothing', () => {
    expect(chooserInFocus(`  mCurrentFocus=Window{56b9ca0 u0 ${RESOLVER}`)).toBeUndefined();
    const cut = `  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{6dd03d6 u0 ${RESOLVER}`;
    expect(chooserInFocus(cut)).toBeUndefined();
    expect(chooserInFocus(`${cut}\n`)).toBeUndefined();
    expect(chooserInFocus(`  mCurrentFocus=${CHOOSER_WINDOW}\n  mFocusedApp=ActivityRecord{10e4bcf u0 ${LAB}`)).toBe(RESOLVER);
  });
});

describe('chooserInFocus — no `mFocusedApp` line: the focused window decides', () => {
  it('the chooser the focus window and no focused activity line: the chooser', () => {
    expect(chooserInFocus(`  mCurrentFocus=${CHOOSER_WINDOW}\n`)).toBe(RESOLVER);
  });
});

describe.each(SHAPES)('chooserInFocus — synthetic `mFocusedApp` lines, the %s shape', (_api, record) => {
  /** Synthetic focus lines, in the dump's shape: `mCurrentFocus` naming a window, `mFocusedApp` an activity. */
  const focus = (window: string, app: string) => `  mCurrentFocus=${window}\n  mFocusedApp=${record(app)}\n`;

  describe('an app or the launcher the focused activity is no chooser', () => {
    it('the launcher the focus window and the focused activity: undefined', () => {
      expect(chooserInFocus(focus(LAUNCHER_FOCUS.trim().slice('mCurrentFocus='.length), 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity'))).toBeUndefined();
    });

    it('no focus (`mCurrentFocus=null`, a transition) with an app the focused activity: undefined', () => {
      expect(chooserInFocus(focus('null', LAB))).toBeUndefined();
    });
  });

  describe('the focused activity decides; the focused window only when no activity is named', () => {
    it('no focus window yet, the chooser already the focused activity (the start resumed it, its window not drawn): the chooser', () => {
      expect(chooserInFocus(focus('null', RESOLVER))).toBe(RESOLVER);
    });

    it('the launcher still the focus window, the chooser the focused activity: the chooser', () => {
      expect(chooserInFocus(focus('Window{9d5e433 u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}', RESOLVER))).toBe(RESOLVER);
    });

    it('the chooser the focus window, an app the focused activity (a chooser on its way out, the link\'s app resumed): undefined', () => {
      expect(chooserInFocus(focus(CHOOSER_WINDOW, LAB))).toBeUndefined();
    });

    it('the focused activity\'s component, when the two lines name two choosers', () => {
      const chooser = 'android/com.android.internal.app.ChooserActivity';
      expect(chooserInFocus(focus(`Window{56b9ca0 u0 ${chooser}}`, RESOLVER))).toBe(RESOLVER);
    });
  });

  describe('the components that are the chooser, and no others', () => {
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
      const app = `  mFocusedApp=${record(RESOLVER, 'u10')}\n`;
      expect(chooserInFocus(window)).toBe(RESOLVER);
      expect(chooserInFocus(app)).toBe(RESOLVER);
    });
  });

  describe('API 29\'s `mFocusedApp`, an ActivityRecord inside an AppWindowToken (AOSP 10\'s shape, the record as above)', () => {
    /** API 29 prints the focused app as its window token: `AppWindowToken{… token=Token{… ActivityRecord{…}}}`. */
    const api29 = (window: string, app: string) =>
      `  mCurrentFocus=${window}\n  mFocusedApp=AppWindowToken{8a2c1f0 token=Token{4b3e2d1 ${record(app)}}}\n`;

    it('no focus window yet, the chooser the focused activity (the race): the chooser', () => {
      expect(chooserInFocus(api29('null', RESOLVER))).toBe(RESOLVER);
    });

    it('`mFocusedApp=null`: an ActivityRecord on a later line is not the focused activity — the window decides', () => {
      const dump = `  mCurrentFocus=null\n  mFocusedApp=null\n  mResumedActivity: ${record(RESOLVER)}\n`;
      expect(chooserInFocus(dump)).toBeUndefined();
    });

    it('the chooser the focus window, an app the focused activity (a chooser on its way out): undefined — "Opened"', () => {
      expect(chooserInFocus(api29(CHOOSER_WINDOW, LAB))).toBeUndefined();
    });
  });

  describe('one focus pair per display: the default display\'s alone', () => {
    const display = (id: number, window: string, app: string) =>
      `  Display: mDisplayId=${id} (organized)\n  mCurrentFocus=${window}\n  mFocusedApp=${app}\n`;
    const CHOOSER_APP = record(RESOLVER);
    const LAB_WINDOW = 'Window{c6f91da u0 dev.averi.lab/dev.averi.lab.MainActivity}';
    const LAB_APP = record(LAB);

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

// D55b (ADR 0041's D55b amendment): the launch's replies with the chooser in front, worded here beside the link's — the
// note after `launch_app`'s `-p` start, and monkey's refusal — each pinned whole (D55's first mutation run lost two
// mutants to unpinned advice strings).
describe('D55b — the launch\'s chooser wording: chooserAdvice, launchChooserNote, monkeyChooserRefusal', () => {
  /** The advice both launch paths share: neutral on whose intent the chooser answers (it may be another link's). */
  const LAUNCH_ADVICE =
    'Take a ui_snapshot, tap the app you mean, then its "Just once" button if it shows one (never "Always": it ' +
    "changes the device's default for the intent it answers); press_key back drops the chooser. averi taps nothing itself.";
  const SYS_KEYS = '** SYS_KEYS has no physical keys but with factor 2.0%.';
  const MONKEY_HEAD = "monkey started nothing in dev.averi.lab: Android's chooser (android/com.android.internal.app.ResolverActivity) is in front, and monkey starts nothing over it";

  it('chooserAdvice is CHOOSER_ADVICE for a link, and the launch wording for a launch', () => {
    expect(chooserAdvice('such links', 'the link')).toBe(CHOOSER_ADVICE);
    expect(chooserAdvice('the intent it answers', 'the chooser')).toBe(LAUNCH_ADVICE);
  });

  it("launchChooserNote: the chooser in front and the package not — no claim whose intent it answers — the advice, naming the activity", () => {
    expect(launchChooserNote('dev.averi.lab', RESOLVER, '`activity:` on the launch step / launch_app')).toBe(
      'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        `is in front, and dev.averi.lab is not. ${LAUNCH_ADVICE} Naming the activity (\`activity:\` on the launch step / ` +
        'launch_app) starts it without the chooser.',
    );
  });

  /** monkey's refusal as runStart reports it: its `** ` lines, and the ExecError of its exit when it had one. */
  const refusedBy = (lines: string[], exitCode?: number | null): StartRefused => ({
    kind: 'refused',
    command: 'monkey',
    lines,
    ...(exitCode !== undefined && { cause: execErrorLikeExec('adb -s e shell monkey', exitCode, '') }),
  });

  it("monkeyChooserRefusal: the chooser as THE cause, monkey's actual exit code, the shared advice — no line quoted", () => {
    expect(monkeyChooserRefusal('dev.averi.lab', RESOLVER, refusedBy([SYS_KEYS], 251))).toBe(
      `${MONKEY_HEAD} (it exited 251). ${LAUNCH_ADVICE} Then launch again.`,
    );
    expect(monkeyChooserRefusal('dev.averi.lab', RESOLVER, refusedBy([SYS_KEYS], 252))).toBe(
      `${MONKEY_HEAD} (it exited 252). ${LAUNCH_ADVICE} Then launch again.`,
    );
  });

  it('monkeyChooserRefusal with no exit code (exit 0, so no cause; or a signal, `null`): no exit clause', () => {
    for (const refused of [refusedBy([SYS_KEYS]), refusedBy([SYS_KEYS], null)]) {
      expect(monkeyChooserRefusal('dev.averi.lab', RESOLVER, refused)).toBe(`${MONKEY_HEAD}. ${LAUNCH_ADVICE} Then launch again.`);
    }
  });

  it('chooserAlsoInFront: the chooser named beside a reason of its own, with the shared advice', () => {
    expect(chooserAlsoInFront(RESOLVER)).toBe(`Android's chooser (android/com.android.internal.app.ResolverActivity) is also in front. ${LAUNCH_ADVICE}`);
  });
});

// D55c (ADR 0041's D55c amendment): the chooser's own tree, judged by resource id alone (chooserSheet), and the replies'
// words for it — the sheet quoted, and the advice to tap a row's centre and then id:button_once. Read only after the
// focus read named the chooser (android.test.ts pins the calls). uiautomator-lab-resolver.xml is batch-10's E2 capture
// of the fresh layout (android-resolver-tree.test.ts pins its parse); uiautomator-lab-resolver-selected.xml is batch-11's
// E2 dump of the same chooser after one tap at row 2's centre: the buttons enabled, nothing else changed.
describe('D55c — chooserSheet: the chooser\'s fresh layout, by resource id', () => {
  const dumped = async (name: string): Promise<UiNode> => {
    const raw = await fixture(name);
    return parseDump(raw.slice(0, raw.lastIndexOf('>') + 1));
  };
  /** The fixture's tree, parsed fresh for each case (a case may change it). */
  const fresh = () => dumped('uiautomator-lab-resolver.xml');
  const byId = (root: UiNode, id: string) => [...everyNode(root)].filter((n) => n.identifier === id);
  const one = (root: UiNode, id: string): UiNode => {
    const [node] = byId(root, id);
    if (node === undefined) throw new Error(`no ${id}`);
    return node;
  };
  const leaf = (id: string, label: string): UiNode => ({ role: 'text', label, identifier: id, value: null, rect: { x: 22, y: 1500, width: 88, height: 88 }, children: [] });
  const SHEET: ChooserSheet = {
    title: 'Open with',
    apps: [
      { label: 'AveriLab', centre: { x: 540, y: 1727 } },
      { label: 'AveriLab', detail: 'AveriLab twin', centre: { x: 540, y: 1881 } },
    ],
    once: { label: 'Just once', centre: { x: 723, y: 2058 }, disabled: true },
    always: { label: 'Always', centre: { x: 936, y: 2058 }, disabled: true },
  };

  it('batch-10\'s fresh chooser: the title, both rows at their ROW\'s centre (not the label\'s), both buttons disabled; 2057.5 rounds to 2058', async () => {
    const tree = await fresh();
    expect(one(tree, 'button_once').rect).toEqual({ x: 604, y: 1983, width: 238, height: 149 });
    const sheet = chooserSheet(tree);
    expect(sheet).toEqual(SHEET);
    // A row with no `text2` has no `detail` key at all (toEqual alone would take `detail: undefined` for it).
    expect(Object.keys(sheet?.apps[0] ?? {})).toEqual(['label', 'centre']);
  });

  it('batch-11\'s selected chooser (one row tapped): the same sheet, neither button disabled', async () => {
    expect(chooserSheet(await dumped('uiautomator-lab-resolver-selected.xml'))).toEqual({
      ...SHEET,
      once: { ...SHEET.once, disabled: false },
      always: { ...SHEET.always, disabled: false },
    });
  });

  it('no `title` node, or an empty one: the sheet without a title (no key)', async () => {
    for (const unset of [(t: UiNode) => { t.identifier = null; }, (t: UiNode) => { t.label = ''; }, (t: UiNode) => { t.label = null; }]) {
      const tree = await fresh();
      unset(one(tree, 'title'));
      const sheet = chooserSheet(tree);
      expect(sheet).toEqual({ apps: SHEET.apps, once: SHEET.once, always: SHEET.always });
      expect(sheet !== undefined && 'title' in sheet).toBe(false);
    }
  });

  it('two `title` nodes: no title — which one heads the sheet is not known', async () => {
    const tree = await fresh();
    one(tree, 'title_container').children.push(leaf('title', 'Another'));
    expect(chooserSheet(tree)).toEqual({ apps: SHEET.apps, once: SHEET.once, always: SHEET.always });
  });

  it('one row alone: one app', async () => {
    const tree = await fresh();
    one(tree, 'resolver_list').children.splice(1);
    expect(chooserSheet(tree)?.apps).toEqual([SHEET.apps[0]]);
  });

  it('an empty `text2`: the app with no detail', async () => {
    const tree = await fresh();
    one(tree, 'text2').label = '';
    expect(chooserSheet(tree)?.apps[1]).toEqual({ label: 'AveriLab', centre: { x: 540, y: 1881 } });
    expect(Object.keys(chooserSheet(tree)?.apps[1] ?? {})).toEqual(['label', 'centre']);
  });

  /** Each shape the guard refuses: anything but the measured layout fails open (undefined, today's reply). */
  const UNRECOGNISED: [string, (tree: UiNode) => void][] = [
    ['no `resolver_list`', (t) => { one(t, 'resolver_list').identifier = null; }],
    ['two `resolver_list`s', (t) => { one(t, 'profile_pager').children.push({ ...one(t, 'resolver_list'), children: [] }); }],
    ['a list with no rows', (t) => { one(t, 'resolver_list').children = []; }],
    ['a row with no `text1`', (t) => { one(t, 'text1').identifier = null; }],
    ['a row whose `text1` is empty', (t) => { one(t, 'text1').label = ''; }],
    ['a row whose `text1` has no label', (t) => { one(t, 'text1').label = null; }],
    ['a row with two `text1`s', (t) => { one(t, 'text2').identifier = 'text1'; }],
    ['a row with two `text2`s', (t) => { one(t, 'resolver_list').children[1].children[1].children.push(leaf('text2', 'Another')); }],
    ['no `button_once`', (t) => { one(t, 'button_once').identifier = null; }],
    ['two `button_once`s', (t) => { one(t, 'button_bar').children.push(leaf('button_once', 'Just once')); }],
    ['no `button_always`', (t) => { one(t, 'button_always').identifier = null; }],
    ['two `button_always`s', (t) => { one(t, 'button_bar').children.push(leaf('button_always', 'Always')); }],
    ['a `button_once` with no label', (t) => { one(t, 'button_once').label = ''; }],
    ['a `button_always` with no label', (t) => { one(t, 'button_always').label = null; }],
    // resolver_list_with_default (AOSP android13 core/res/res/layout/resolver_list_with_default.xml): the last-chosen
    // app's `icon` and `title` in a header above the list — never captured. Quoting the list's rows alone there would
    // hide the preselected app, so an `icon` or a `text1` outside the list is not the fresh layout.
    ['an `icon` outside the list (the with_default header)', (t) => { one(t, 'title_container').children.unshift(leaf('icon', '')); }],
    ['a `text1` outside the list', (t) => { one(t, 'button_bar').children.push(leaf('text1', 'AveriLab')); }],
  ];

  it.each(UNRECOGNISED)('%s: undefined', async (_shape, change) => {
    const tree = await fresh();
    change(tree);
    expect(chooserSheet(tree)).toBeUndefined();
  });

  it('a tree that is not a chooser (a dump of the lab\'s own screen): undefined', async () => {
    expect(chooserSheet(await dumped('uiautomator-lab-open.xml'))).toBeUndefined();
  });
});

describe('D55c — the sheet\'s words: chooserSheetSays and the sheet advice, pinned whole', () => {
  const SHEET: ChooserSheet = {
    title: 'Open with',
    apps: [
      { label: 'AveriLab', centre: { x: 540, y: 1727 } },
      { label: 'AveriLab', detail: 'AveriLab twin', centre: { x: 540, y: 1881 } },
    ],
    once: { label: 'Just once', centre: { x: 723, y: 2058 }, disabled: true },
    always: { label: 'Always', centre: { x: 936, y: 2058 }, disabled: true },
  };
  const LIST =
    'apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881); buttons "Just once" at (723, 2058) ' +
    '(disabled), "Always" at (936, 2058) (disabled)';

  it('the title, what the chooser asks, the apps with their rows\' centres, the buttons with theirs and "(disabled)" where marked', () => {
    expect(chooserSheetSays(SHEET, 'asking which app opens it')).toBe(`"Open with", asking which app opens it: ${LIST}`);
  });

  it('no title: no quoted head; one app: "app"; enabled buttons: no "(disabled)"', () => {
    const sheet: ChooserSheet = {
      apps: [SHEET.apps[1]],
      once: { ...SHEET.once, disabled: false },
      always: { ...SHEET.always, disabled: false },
    };
    expect(chooserSheetSays(sheet, 'and dev.averi.lab is not')).toBe(
      'and dev.averi.lab is not: app "AveriLab" ("AveriLab twin") at (540, 1881); buttons "Just once" at (723, 2058), "Always" at (936, 2058)',
    );
  });

  it('one button disabled, the other not: the mark on that one alone', () => {
    expect(chooserSheetSays({ ...SHEET, title: undefined, always: { ...SHEET.always, disabled: false } }, 'x')).toBe(
      'x: apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881); buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058)',
    );
  });

  it('CHOOSER_SHEET_ADVICE: tap the row by its x and y, then id:button_once, never id:button_always; BACK drops the link', () => {
    expect(CHOOSER_SHEET_ADVICE).toBe(
      "Tap the app's row at its x and y (one tap only selects it and enables the buttons), then tap id:button_once " +
        "(never id:button_always: it changes the device's default for such links); press_key back drops the link. averi " +
        'taps nothing itself.',
    );
  });

  it('launchChooserNote with a sheet: the sheet quoted, the launch\'s advice, naming the activity', () => {
    expect(launchChooserNote('dev.averi.lab', RESOLVER, '`activity:` on the launch step / launch_app', SHEET)).toBe(
      'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        `is in front, "Open with", and dev.averi.lab is not: ${LIST}. Tap the app's row at its x and y (one tap only ` +
        "selects it and enables the buttons), then tap id:button_once (never id:button_always: it changes the device's " +
        'default for the intent it answers); press_key back drops the chooser. averi taps nothing itself. Naming the ' +
        'activity (`activity:` on the launch step / launch_app) starts it without the chooser.',
    );
  });

  it('launchChooserNote with no sheet (undefined): D55b\'s note byte for byte', () => {
    const note = launchChooserNote('dev.averi.lab', RESOLVER, '`activity:` on the launch step / launch_app');
    expect(launchChooserNote('dev.averi.lab', RESOLVER, '`activity:` on the launch step / launch_app', undefined)).toBe(note);
    expect(note).toContain('Take a ui_snapshot, tap the app you mean');
  });
});
