import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultDisplayFocus, parseFocusedWindow, parseImeInsets, parseNavigationBand, parseStatusBand, parseTouchableRegion } from '../../src/adapters/android-wm.js';
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
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}\n')).toStrictEqual({
      window: 'android/com.android.internal.app.ResolverActivity',
    });
  });

  it('a window named by a title, not a component (`Window{<hash> u0 Some Title}`): its hash is read, no component', () => {
    expect(parseFocusedWindow(focusRecordAs('u0 Dialog Title'))).toEqual(STACKED);
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 u0 Dialog Title}\n')).toStrictEqual({});
  });

  it('a record with no user token (`Window{<hash> <pkg>/<class>}`, never captured): its hash is read, no component — the two old regexes\' difference, kept', () => {
    expect(parseFocusedWindow(focusRecordAs('dev.averi.lab/dev.averi.lab.MainActivity'))).toEqual(STACKED);
    expect(defaultDisplayFocus('  mCurrentFocus=Window{56b9ca0 android/com.android.internal.app.ResolverActivity}\n')).toStrictEqual({});
    expect(chooserInFocus('  mCurrentFocus=Window{56b9ca0 android/com.android.internal.app.ResolverActivity}\n')).toBeUndefined();
  });

  it('two focus lines in one block, the first a title (never captured): the hash is the first line\'s, the component the first one named', () => {
    const lines = '  mCurrentFocus=Window{1111111 u0 Dialog Title}\n  mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}\n';
    expect(defaultDisplayFocus(lines)).toStrictEqual({ window: 'android/com.android.internal.app.ResolverActivity' });
    const dump = focusRecordAs('u0 Dialog Title');
    expect(parseFocusedWindow(dump.replace('mCurrentFocus=', 'mCurrentFocus=Window{2222222 u0 dev.averi.lab/dev.averi.lab.Other}\n  mCurrentFocus='))).toEqual({ of: 'unknown' });
  });

  it('the focused activity beside the window: `mFocusedApp`\'s component, in either API\'s shape', () => {
    const app = 'dev.averi.lab/.MainActivity';
    expect(defaultDisplayFocus(`  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{6909a9c u0 ${app}} t2590}\n`)).toStrictEqual({ app });
    expect(defaultDisplayFocus(`  mFocusedApp=ActivityRecord{6909a9c u0 ${app} t2590}\n`)).toStrictEqual({ app });
  });
});

// A27, step 3 — ONE MULTI-DISPLAY RULE, NOT TAKEN. The window manager's reads answer a second display three ways:
// - every display must agree (parseImeInsets, parseStatusBand, parseNavigationBand: each display's InsetsState
//   entries, and its DisplayFrames line, read over the whole `dumpsys window displays`; any disagreement is no answer);
// - the first found (parseFocusedWindow: FOCUSED_WINDOW_COMMAND greps the focus and size lines without their display
//   headers, so it reads the first `mCurrentFocus` and the first `DisplayFrames` of the answer);
// - display 0's block (defaultDisplayFocus, the chooser's: from its `Display: mDisplayId=0` header to the next).
// Merging them needs a dump that tells them apart, and every captured one holds ONE display (the census below): on
// each, display 0's block is the whole dump, so the three read the same lines. Which rule is right for a second display
// is a device question (a multi-display AVD's dump), left to a follow-up; the synthetic dumps after the census pin
// where the three differ today.

const fixtures = new URL('../fixtures/', import.meta.url);
const truth = new URL('../fixtures/truth/', import.meta.url);
/** Every captured `dumpsys window displays`: the keyboard fixtures and each lab cell's (`<cell>.displays.txt`). */
const DISPLAYS: readonly [string, string][] = [
  ...readdirSync(fixtures).filter((f) => f.startsWith('dumpsys-window-displays-')).map((f) => [f, readFileSync(new URL(f, fixtures), 'utf8')] as [string, string]),
  ...readdirSync(truth).filter((d) => d.startsWith('android-')).flatMap((d) =>
    readdirSync(new URL(`${d}/`, truth))
      .filter((f) => f.endsWith('.displays.txt'))
      .map((f) => [`${d}/${f}`, readFileSync(new URL(`${d}/${f}`, truth), 'utf8')] as [string, string]),
  ),
];
/** Every captured FOCUSED_WINDOW_COMMAND answer (`<cell>.windows.txt`). */
const WINDOWS: readonly [string, string][] = readdirSync(truth)
  .filter((d) => d.startsWith('android-'))
  .flatMap((d) =>
    readdirSync(new URL(`${d}/`, truth))
      .filter((f) => f.endsWith('.windows.txt'))
      .map((f) => [`${d}/${f}`, readFileSync(new URL(`${d}/${f}`, truth), 'utf8')] as [string, string]),
  );
const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0;
/** This test's own cut of display 0's block (header to next header) — not the module's, which it checks against. */
const displayZero = (dump: string): string => {
  const at = dump.indexOf('Display: mDisplayId=0 ');
  const next = dump.indexOf('Display: mDisplayId=', at + 1);
  return dump.slice(at, next === -1 ? undefined : next);
};

describe('the census: every captured dump holds one display, so no fixture tells the three rules apart', () => {
  it('the fixtures are there', () => {
    expect(DISPLAYS.length).toBeGreaterThanOrEqual(30);
    expect(WINDOWS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(DISPLAYS)('%s: one display header, one DisplayFrames line; display 0\'s block alone reads as the whole dump', (_name, dump) => {
    expect(count(dump, /Display: mDisplayId=/g)).toBe(1);
    expect(count(dump, /^[ \t]*DisplayFrames w=/gm)).toBe(1);
    const block = displayZero(dump);
    expect(parseImeInsets(block)).toEqual(parseImeInsets(dump));
    expect(parseStatusBand(block)).toEqual(parseStatusBand(dump));
    expect(parseNavigationBand(block)).toEqual(parseNavigationBand(dump));
    expect(defaultDisplayFocus(block)).toEqual(defaultDisplayFocus(dump));
  });

  it.each(WINDOWS)('%s: one focus line, one DisplayFrames line — the first found is the only one', (_name, dump) => {
    expect(count(dump, /mCurrentFocus=/g)).toBe(1);
    expect(count(dump, /DisplayFrames w=/g)).toBe(1);
  });
});

describe('where the three rules differ today: two displays (synthetic — no device dump of two)', () => {
  const header = (id: number): string => `  Display: mDisplayId=${id} (organized)\n`;
  const frames = '  DisplayFrames w=1080 h=2220 r=0\n';
  const status = (frame: string): string => `        InsetsSource type=ITYPE_STATUS_BAR frame=${frame} visible=true insetsRoundedCornerFrame=false\n`;
  const ime = (frame: string, visible: boolean): string => `        InsetsSource type=ITYPE_IME frame=${frame} visible=${visible} insetsRoundedCornerFrame=false\n`;
  const zero = header(0) + frames + status('[0,0][1080,66]') + ime('[0,1398][1080,2220]', true);
  const one = header(1) + frames + status('[0,0][1080,80]') + ime('[0,0][0,0]', false);

  it('every display must agree: display 0 shows a keyboard and a 66 band, display 1 neither — no answer, as with one display unread', () => {
    expect(parseImeInsets(zero + one)).toEqual({ state: 'unknown' });
    expect(parseStatusBand(zero + one)).toBeUndefined();
    // display 0's block alone answers: the rule a merge to the chooser's would give
    expect(parseImeInsets(displayZero(zero + one))).toEqual({ state: 'shown', frame: { x: 0, y: 1398, width: 1080, height: 822 } });
    expect(parseStatusBand(displayZero(zero + one))).toBe(66);
  });

  it('display 0\'s block: the chooser on display 1 is not display 0\'s focus, whichever display the dump lists first', () => {
    const focus = (window: string): string => `  mCurrentFocus=Window{56b9ca0 u0 ${window}}\n`;
    const chooser = 'android/com.android.internal.app.ResolverActivity';
    const lab = 'dev.averi.lab/dev.averi.lab.MainActivity';
    expect(defaultDisplayFocus(header(1) + focus(chooser) + header(0) + focus(lab))).toEqual({ window: lab });
  });

  it('the first found: the focus read has no display headers, so the first focus line decides whichever display it is', () => {
    const dump = dumpOf('dialog-fullscreen');
    const other = '  mCurrentFocus=Window{2222222 u0 other.app/.Main}\n';
    // another display's focus listed first: its window is none of the windows dump's → unknown; listed after: unread
    expect(parseFocusedWindow(dump.replace('  mCurrentFocus=', `${other}  mCurrentFocus=`))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(dump.replace(/(mCurrentFocus=[^\n]*\n)/, `$1${other}`))).toEqual(STACKED);
  });
});

// A27's mutation run (ADR 0038's A27 amendment): what the moved parsers' own tests left unpinned, through the module's
// exports. Each case is one rule of the parser's doc comment.
describe('parseFocusedWindow: the window types of an app, by number, and a window the dump gives no frame', () => {
  const dump = dumpOf('dialog-fullscreen');
  const hash = FOCUS_LINE.exec(dump)?.[1] ?? '';
  /** The dump with `edit` applied to the focused window's block alone. */
  const inFocused = (edit: (block: string) => string): string => {
    const at = dump.indexOf(`Window{${hash} `, dump.indexOf('WINDOW MANAGER WINDOWS'));
    const end = dump.indexOf('\n  Window #', at);
    expect(at).toBeGreaterThan(0);
    return dump.slice(0, at) + edit(dump.slice(at, end === -1 ? undefined : end)) + (end === -1 ? '' : dump.slice(end));
  };
  const typed = (ty: string): string => inFocused((block) => block.replace(/ty=APPLICATION /, `ty=${ty} `));

  it('a type printed as a number: 2–99 and 1000–1999 are an app\'s (stacked), 100–999 and 2000 on are not', () => {
    expect(typed('APPLICATION')).toBe(dump);
    for (const ty of ['2', '99', '1000', '1999']) expect(parseFocusedWindow(typed(ty)), ty).toEqual(STACKED);
    for (const ty of ['100', '999', '2000', '2040']) expect(parseFocusedWindow(typed(ty)), ty).toEqual({ of: 'unknown' });
  });

  it('another app window visible beside the activity\'s is read by its own `isVisible=true` line alone', () => {
    const open = dumpOf('open');
    const launcher = open.indexOf('com.google.android.apps.nexuslauncher/');
    const shownAs = (line: string): string => open.slice(0, launcher) + open.slice(launcher).replace('    isVisible=false', line);
    expect(parseFocusedWindow(shownAs('    isVisible=true'))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(shownAs('      isVisible=true'))).toMatchObject({ of: 'screenAlone' });
    expect(parseFocusedWindow(shownAs('    isVisible=trueish'))).toMatchObject({ of: 'screenAlone' });
  });

  it('a type name the table does not hold is no app\'s: unknown', () => {
    expect(parseFocusedWindow(typed('STATUS_BAR'))).toEqual({ of: 'unknown' });
  });

  it('the focused window\'s block with no `Frames:` line, or a frame wholly off the display: unknown', () => {
    expect(parseFocusedWindow(inFocused((block) => block.replace(/^ +Frames: [^\n]*\n/m, '')))).toEqual({ of: 'unknown' });
    expect(parseFocusedWindow(inFocused((block) => block.replace(/ frame=\[[^\]]*\]\[[^\]]*\]/, ' frame=[2000,66][2100,2153]')))).toEqual({ of: 'unknown' });
  });
});

describe('parseTouchableRegion: a rect of no width or height is kept, an inverted one is none', () => {
  it('a line rect (right = left, or bottom = top) is a rect of no area', () => {
    expect(parseTouchableRegion('touchable region=SkRegion((5,5,5,10))')).toEqual([{ x: 5, y: 5, width: 0, height: 5 }]);
    expect(parseTouchableRegion('touchable region=SkRegion((5,5,10,5))')).toEqual([{ x: 5, y: 5, width: 5, height: 0 }]);
  });

  it('right left of left, or bottom above top: undefined', () => {
    expect(parseTouchableRegion('touchable region=SkRegion((10,5,5,10))')).toBeUndefined();
    expect(parseTouchableRegion('touchable region=SkRegion((5,10,10,5))')).toBeUndefined();
  });
});

describe('the InsetsState readers: an entry with a token missing, a frame of no area, the line\'s own edges', () => {
  const entry = (body: string): string => `        InsetsSource ${body}\n`;
  const STATUS = entry('type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false');
  const FRAMES = '  DisplayFrames w=1080 h=2220 r=0\n';
  const NAV = (frame: string): string => entry(`type=ITYPE_NAVIGATION_BAR frame=${frame} visible=true`);

  it('an entry with no `type=` is read past by all three, never thrown on', () => {
    const untyped = entry('frame=[0,0][1080,66] visible=true');
    expect(parseImeInsets(untyped + STATUS + '    mIsImeShowing=false\n')).toEqual({ state: 'hidden' });
    expect(parseStatusBand(untyped + STATUS)).toBe(66);
    expect(parseNavigationBand(FRAMES + untyped + NAV('[0,2154][1080,2220]'))).toBe(2154);
  });

  it('parseImeInsets: no entry that reads fully (type, frame, visible) is a format it does not know — unknown, even beside mIsImeShowing=false', () => {
    expect(parseImeInsets(entry('type=ITYPE_STATUS_BAR visible=true') + '    mIsImeShowing=false\n')).toEqual({ state: 'unknown' });
    expect(parseImeInsets(STATUS + '    mIsImeShowing=false\n')).toEqual({ state: 'hidden' });
    expect(parseImeInsets(entry('frame=[0,0][1080,66] visible=true') + '    mIsImeShowing=false\n')).toEqual({ state: 'unknown' });
  });

  it('parseImeInsets: a visible IME frame of no width, or of no height, is unknown', () => {
    expect(parseImeInsets(STATUS + entry('type=ITYPE_IME frame=[0,1398][0,2220] visible=true'))).toEqual({ state: 'unknown' });
    expect(parseImeInsets(STATUS + entry('type=ITYPE_IME frame=[0,1398][1080,1398] visible=true'))).toEqual({ state: 'unknown' });
    expect(parseImeInsets(STATUS + entry('type=ITYPE_IME frame=[0,1398][1080,2220] visible=true'))).toEqual({ state: 'shown', frame: { x: 0, y: 1398, width: 1080, height: 822 } });
    expect(parseImeInsets(STATUS + entry('type=ITYPE_IME frame=[359,1269][1040,1912] visible=true'))).toEqual({ state: 'shown', frame: { x: 359, y: 1269, width: 681, height: 643 } });
  });

  it('parseImeInsets: `mIsImeShowing` with blanks after it on its line is still its line', () => {
    expect(parseImeInsets(STATUS + entry('type=ITYPE_IME frame=[0,0][0,0] visible=false') + '    mIsImeShowing=true \n')).toEqual({ state: 'unknown' });
  });

  it('parseStatusBand: an entry with no frame, a frame of no width or no height — no band', () => {
    expect(parseStatusBand(entry('type=ITYPE_STATUS_BAR visible=true'))).toBeUndefined();
    expect(parseStatusBand(entry('type=ITYPE_STATUS_BAR frame=[0,0][0,66] visible=true'))).toBeUndefined();
    expect(parseStatusBand(entry('type=ITYPE_STATUS_BAR frame=[0,0][1080,0] visible=true'))).toBeUndefined();
  });

  it('parseStatusBand: `visible=true` ending the entry, or starting it, reads', () => {
    expect(parseStatusBand(entry('type=statusBars frame=[0,0][1080,66] visible=true'))).toBe(66);
    expect(parseStatusBand(entry('visible=true type=statusBars frame=[0,0][1080,66]'))).toBe(66);
  });

  it('parseNavigationBand: a square display is upright; a landscape one at r=0, or a turned one, has no band', () => {
    expect(parseNavigationBand('  DisplayFrames w=1080 h=1080 r=0\n' + NAV('[0,1014][1080,1080]'))).toBe(1014);
    expect(parseNavigationBand('  DisplayFrames w=2560 h=1600 r=0\n' + NAV('[0,1534][2560,1600]'))).toBeUndefined();
    expect(parseNavigationBand('  DisplayFrames w=1080 h=2220 r=1\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
  });

  it('parseNavigationBand: a bar as tall as it is wide is no band', () => {
    expect(parseNavigationBand(FRAMES + NAV('[0,1140][1080,2220]'))).toBeUndefined();
  });

  it('parseNavigationBand: DisplayFrames lines alike but for their indent are one size; a line with more after r= is none', () => {
    expect(parseNavigationBand(FRAMES + '    DisplayFrames w=1080 h=2220 r=0\n' + NAV('[0,2154][1080,2220]'))).toBe(2154);
    expect(parseNavigationBand('  DisplayFrames w=1080 h=2220 r=0 x\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
    expect(parseNavigationBand('  mLast DisplayFrames w=1080 h=2220 r=0\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
  });
});
