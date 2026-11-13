import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { INPUT_SHOWN_COMMAND, TOUCHABLE_COMMAND, defaultDisplayFocus, parseFocusedWindow, parseImeInsets, parseInputShown, parseNavigationBand, parseStatusBand, parseTouchableRegion } from '../../src/adapters/android-wm.js';
import { chooserInFocus } from '../../src/adapters/android-chooser.js';
import { GBOARD, GBOARD_PANEL, GBOARD_STRIP, INPUT_SHOWN_LINE } from '../helpers/android-dumps.js';

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

  it('two focus lines in one block, the first a title (never captured): the component is the first one named; the focused window the one of display 0\'s', () => {
    const lines = '  mCurrentFocus=Window{1111111 u0 Dialog Title}\n  mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}\n';
    expect(defaultDisplayFocus(lines)).toStrictEqual({ window: 'android/com.android.internal.app.ResolverActivity' });
    const dump = focusRecordAs('u0 Dialog Title');
    // A35: the first line names a window the dump does not list, so it is no display's that can be told; the second's
    // window is display 0's (before A35 the first line decided: unknown)
    expect(parseFocusedWindow(dump.replace('mCurrentFocus=', 'mCurrentFocus=Window{2222222 u0 dev.averi.lab/dev.averi.lab.Other}\n  mCurrentFocus='))).toEqual(STACKED);
  });

  it('the focused activity beside the window: `mFocusedApp`\'s component, in either API\'s shape', () => {
    const app = 'dev.averi.lab/.MainActivity';
    expect(defaultDisplayFocus(`  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{6909a9c u0 ${app}} t2590}\n`)).toStrictEqual({ app });
    expect(defaultDisplayFocus(`  mFocusedApp=ActivityRecord{6909a9c u0 ${app} t2590}\n`)).toStrictEqual({ app });
  });
});

// A35 — ONE DISPLAY RULE. Every read of the window manager answers for the DEFAULT display (id 0): the display `am start`
// with no `--display` starts the app on, `input tap` and `screencap` with no `-d` act on. Another display's lines are
// not read. Where the dump says which display a line is, that decides: a `Display: mDisplayId=<n>` header (`dumpsys
// window displays`, CHOOSER_FOCUS_COMMAND), or, in FOCUSED_WINDOW_COMMAND's answer (no headers), each window block's
// `mDisplayId=<n>` — the focus line whose window is display 0's, the size line after it, display 0's windows. A dump
// that names no display is one display's, whole. Before A35 the reads answered a second display three ways (every
// display must agree; the first found; display 0's block, the chooser's) — pinned by A27 on synthetic dumps, decided
// here on A35's capture (docs/truth/live-records/a35-two-display/).

const fixtures = new URL('../fixtures/', import.meta.url);
const truth = new URL('../fixtures/truth/', import.meta.url);
/** A35's captures of two displays (docs/truth/live-records/a35-two-display/), out of the one-display census: pinned below. */
const TWO_DISPLAY = '-api33-two-display-';
/** Every captured `dumpsys window displays` of one display: the keyboard fixtures and each lab cell's (`<cell>.displays.txt`). */
const DISPLAYS: readonly [string, string][] = [
  ...readdirSync(fixtures).filter((f) => f.startsWith('dumpsys-window-displays-') && !f.includes(TWO_DISPLAY)).map((f) => [f, readFileSync(new URL(f, fixtures), 'utf8')] as [string, string]),
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

describe('the census: every captured one-display dump is display 0\'s, whole — the rule reads it as before A35', () => {
  it('the fixtures are there', () => {
    expect(DISPLAYS.length).toBeGreaterThanOrEqual(30);
    expect(WINDOWS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(DISPLAYS)('%s: one display header, display 0\'s, one DisplayFrames line; display 0\'s block alone reads as the whole dump', (_name, dump) => {
    expect(count(dump, /Display: mDisplayId=/g)).toBe(1);
    expect(count(dump, /Display: mDisplayId=0 /g)).toBe(1);
    expect(count(dump, /^[ \t]*DisplayFrames w=/gm)).toBe(1);
    const block = displayZero(dump);
    expect(parseImeInsets(block)).toEqual(parseImeInsets(dump));
    expect(parseStatusBand(block)).toEqual(parseStatusBand(dump));
    expect(parseNavigationBand(block)).toEqual(parseNavigationBand(dump));
    expect(defaultDisplayFocus(block)).toEqual(defaultDisplayFocus(dump));
  });

  it.each(WINDOWS)('%s: one focus line, one DisplayFrames line, every window block display 0\'s', (_name, dump) => {
    expect(count(dump, /mCurrentFocus=/g)).toBe(1);
    expect(count(dump, /DisplayFrames w=/g)).toBe(1);
    expect(count(dump, /^ {4}mDisplayId=0 /gm)).toBe(count(dump, /^ {2}Window #\d+ /gm));
  });
});

describe('A35: the captured two-display dumps (emulator-5554 + a 720x1280 overlay display 4) — every read answers for display 0', () => {
  const read = (kind: string, state: string): string => readFileSync(new URL(`dumpsys-window-${kind}${TWO_DISPLAY}${state}.txt`, fixtures), 'utf8');
  const STATES = ['a-launcher-d0', 'b-settings-d0', 'c-settings-d0-clock-d4'] as const;

  it.each(STATES)('%s: two displays, each with its own IME entry and DisplayFrames line; display 0\'s are read: IME hidden, status 66, navigation 2154', (state) => {
    const dump = read('displays', state);
    expect(count(dump, /Display: mDisplayId=/g)).toBe(2);
    expect(count(dump, /^[ \t]*DisplayFrames w=/gm)).toBe(2);
    expect(count(dump, /^[ \t]*InsetsSource type=ITYPE_IME /gm)).toBe(2);
    expect(count(dump, /^[ \t]*InsetsSource type=ITYPE_STATUS_BAR /gm)).toBe(1);
    expect(count(dump, /^[ \t]*InsetsSource type=ITYPE_NAVIGATION_BAR /gm)).toBe(1);
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
    expect(parseStatusBand(dump)).toBe(66);
    // before A35 none: every display had to agree, and the two DisplayFrames sizes differ
    expect(parseNavigationBand(dump)).toBe(2154);
    expect(parseNavigationBand(dump)).toBe(parseNavigationBand(displayZero(dump)));
  });

  it("each state's reads as display 0's block alone would read them, whichever display the dump lists first", () => {
    for (const state of STATES) {
      const dump = read('displays', state);
      const zero = displayZero(dump);
      expect([parseImeInsets(dump), parseStatusBand(dump), parseNavigationBand(dump)]).toEqual([parseImeInsets(zero), parseStatusBand(zero), parseNavigationBand(zero)]);
      expect(defaultDisplayFocus(read('focus', state))).toEqual(defaultDisplayFocus(displayZero(read('focus', state))));
    }
  });

  it('the focus read prints no display headers: each display\'s focus line before its size line, the top-focused display last', () => {
    const lines = (state: string) => read('focused-window', state).split('\n').filter((l) => /mCurrentFocus=|DisplayFrames w=/.test(l)).map((l) => l.trim().replace(/\{[0-9a-f]+ /, '{… '));
    expect(lines('b-settings-d0')).toEqual(['mCurrentFocus=null', 'DisplayFrames w=720 h=1280 r=0', 'mCurrentFocus=Window{… u0 com.android.settings/com.android.settings.Settings}', 'DisplayFrames w=1080 h=2220 r=0']);
    expect(lines('c-settings-d0-clock-d4')).toEqual(['mCurrentFocus=null', 'DisplayFrames w=1080 h=2220 r=0', 'mCurrentFocus=Window{… u0 com.google.android.deskclock/com.android.deskclock.DeskClock}', 'DisplayFrames w=720 h=1280 r=0']);
    expect(read('focused-window', 'b-settings-d0')).not.toMatch(/Display: mDisplayId=/);
  });

  it("the focused window: display 0's focus (the one whose window block says mDisplayId=0), display 0's size, display 0's windows beside it", () => {
    // b: Settings' frame is [0,0][1080,2220] on display 0 — before A35 read as 720x1280, display 4's size (the first found)
    expect(parseFocusedWindow(read('focused-window', 'b-settings-d0'))).toEqual({ of: 'screenAlone', frame: { x: 0, y: 0, width: 1080, height: 2220 } });
    // a: the launcher's GoogleDiscoverWindow is a visible app window beside it on display 0, as on one display
    expect(parseFocusedWindow(read('focused-window', 'a-launcher-d0'))).toEqual({ of: 'unknown' });
    // c: display 0 has no window focus (the clock on display 4 holds it): no focus of display 0's to read
    expect(parseFocusedWindow(read('focused-window', 'c-settings-d0-clock-d4'))).toEqual({ of: 'unknown' });
  });

  it("c: the clock's own window, read as display 0's, would be screenAlone — it is not, because its block says display 4", () => {
    const c = read('focused-window', 'c-settings-d0-clock-d4');
    // the clock's popup gone and its block moved to display 0: the clock alone on the 720x1280 frame, its size line's
    const moved = c.replace(/  Window #0 Window\{5d3da71 [\s\S]*?(?=  Window #1 )/, '').replace(/(Window #1 Window\{1a1f85 [^\n]*\n {4}mDisplayId=)4/, '$10');
    expect(parseFocusedWindow(moved)).toEqual({ of: 'unknown' }); // Settings, visible on display 0, beside it
    expect(parseFocusedWindow(moved.replace(/(Window\{f324dc [^\n]*\n {4}mDisplayId=)0/g, '$14'))).toEqual({ of: 'screenAlone', frame: { x: 0, y: 0, width: 720, height: 1280 } });
  });

  it("the chooser's read: display 0's focused app and window; c keeps display 0's focused app but no window (only the top-focused display has one)", () => {
    expect(defaultDisplayFocus(read('focus', 'a-launcher-d0'))).toEqual({ app: 'com.google.android.apps.nexuslauncher/.NexusLauncherActivity', window: 'com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity' });
    expect(defaultDisplayFocus(read('focus', 'b-settings-d0'))).toEqual({ app: 'com.android.settings/.Settings', window: 'com.android.settings/com.android.settings.Settings' });
    expect(defaultDisplayFocus(read('focus', 'c-settings-d0-clock-d4'))).toEqual({ app: 'com.android.settings/.Settings' });
  });
});

describe('the one rule on synthetic two-display dumps (what the capture did not show)', () => {
  const header = (id: number): string => `  Display: mDisplayId=${id} (organized)\n`;
  const frames = '  DisplayFrames w=1080 h=2220 r=0\n';
  const status = (frame: string): string => `        InsetsSource type=ITYPE_STATUS_BAR frame=${frame} visible=true insetsRoundedCornerFrame=false\n`;
  const ime = (frame: string, visible: boolean): string => `        InsetsSource type=ITYPE_IME frame=${frame} visible=${visible} insetsRoundedCornerFrame=false\n`;
  const zero = header(0) + frames + status('[0,0][1080,66]') + ime('[0,1398][1080,2220]', true);
  const one = header(1) + frames + status('[0,0][1080,80]') + ime('[0,0][0,0]', false);
  const SHOWN = { state: 'shown', frame: { x: 0, y: 1398, width: 1080, height: 822 } };

  it("a keyboard and a 66 band on display 0, neither on display 1: display 0's answer, whichever display is listed first (before A35: no answer)", () => {
    expect(parseImeInsets(zero + one)).toEqual(SHOWN);
    expect(parseStatusBand(zero + one)).toBe(66);
    expect(parseImeInsets(one + zero)).toEqual(SHOWN);
    expect(parseStatusBand(one + zero)).toBe(66);
    // a keyboard on display 1 alone is not display 0's
    expect(parseImeInsets(header(0) + frames + status('[0,0][1080,66]') + ime('[0,0][0,0]', false) + header(1) + ime('[0,1398][1080,2220]', true))).toEqual({ state: 'hidden' });
  });

  it('a dump of displays none of which is display 0 reads nothing (before A35 the chooser read the first display\'s)', () => {
    const focus = (window: string): string => `  mCurrentFocus=Window{56b9ca0 u0 ${window}}\n`;
    const chooser = 'android/com.android.internal.app.ResolverActivity';
    expect(defaultDisplayFocus(header(1) + focus(chooser) + header(2))).toEqual({});
    expect(chooserInFocus(header(1) + focus(chooser))).toBeUndefined();
    expect(parseImeInsets(one)).toEqual({ state: 'unknown' });
    expect(parseStatusBand(one)).toBeUndefined();
  });

  it('display 0\'s block: the chooser on display 1 is not display 0\'s focus, whichever display the dump lists first', () => {
    const focus = (window: string): string => `  mCurrentFocus=Window{56b9ca0 u0 ${window}}\n`;
    const chooser = 'android/com.android.internal.app.ResolverActivity';
    const lab = 'dev.averi.lab/dev.averi.lab.MainActivity';
    expect(defaultDisplayFocus(header(1) + focus(chooser) + header(0) + focus(lab))).toEqual({ window: lab });
    expect(defaultDisplayFocus(header(0) + focus(lab) + header(1) + focus(chooser))).toEqual({ window: lab });
  });

  it("the focus read: another display's focus line, listed before display 0's or after it, is not read (before A35 the first decided)", () => {
    const dump = dumpOf('dialog-fullscreen');
    const other = '  mCurrentFocus=Window{2222222 u0 other.app/.Main}\n  DisplayFrames w=720 h=1280 r=0\n';
    expect(parseFocusedWindow(dump.replace('  mCurrentFocus=', `${other}  mCurrentFocus=`))).toEqual(STACKED);
    expect(parseFocusedWindow(dump.replace(/(DisplayFrames w=[^\n]*\n)/, `$1${other}`))).toEqual(STACKED);
  });

  it("the focus read: display 0's size is the line after display 0's focus line, not the dump's first", () => {
    const dump = dumpOf('dialog-fullscreen');
    const other = '  mCurrentFocus=null\n  DisplayFrames w=720 h=1280 r=0\n';
    // display 0's focus listed second, after display 4's null focus and 720x1280 size: still 1080x2220
    expect(parseFocusedWindow(dump.replace('  mCurrentFocus=', `${other}  mCurrentFocus=`))).toEqual(STACKED);
    // display 0's focus with no size line of its own (only another display's, before it): unknown
    expect(parseFocusedWindow(dump.replace(/DisplayFrames w=\d+ h=\d+ r=\d+/, 'x').replace('  mCurrentFocus=', `${other}  mCurrentFocus=`))).toEqual({ of: 'unknown' });
  });

  it("the focus read: two focus lines that both name a window of display 0's are no one display's focus — unknown", () => {
    const dump = dumpOf('dialog-fullscreen');
    const focused = FOCUS_LINE.exec(dump)?.[1];
    // a second focus line, with its own size line, after display 0's: it names the dialog's window too
    expect(parseFocusedWindow(dump.replace(/(DisplayFrames w=[^\n]*\n)/, `$1  mCurrentFocus=Window{${focused} u0 x}\n  DisplayFrames w=720 h=1280 r=0\n`))).toEqual({ of: 'unknown' });
  });

  it("the focus read: an app window of another display's, visible, is not beside display 0's focus", () => {
    const open = dumpOf('open');
    expect(parseFocusedWindow(open)).toEqual({ of: 'screenAlone', frame: { x: 0, y: 0, width: 1080, height: 2220 } });
    const other = '  Window #99 Window{3333333 u0 other.app/other.app.Main}:\n    mDisplayId=4 rootTaskId=9 mSession=x\n    mAttrs={(0,0)(fillxfill) ty=BASE_APPLICATION\n    Frames: parent=[0,0][720,1280] display=[0,0][720,1280] frame=[0,0][720,1280] last=x\n    isVisible=true\n';
    const at = open.indexOf('  Window #');
    expect(parseFocusedWindow(open.slice(0, at) + other + open.slice(at))).toEqual({ of: 'screenAlone', frame: { x: 0, y: 0, width: 1080, height: 2220 } });
    // the same window on display 0 is beside it
    expect(parseFocusedWindow(open.slice(0, at) + other.replace('mDisplayId=4', 'mDisplayId=0') + open.slice(at))).toEqual({ of: 'unknown' });
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

  /** The dump with `line` inserted just before the focused window's header (inside the block before it). */
  const beforeFocused = (line: string): string => {
    const header = dump.lastIndexOf('\n  Window #', dump.indexOf(`Window{${hash} `, dump.indexOf('WINDOW MANAGER WINDOWS')));
    expect(header).toBeGreaterThan(0);
    return `${dump.slice(0, header)}\n${line}${dump.slice(header)}`;
  };

  it('a window block opens on its own header line alone: two spaces, `Window #`, and the line ending at its `:`', () => {
    // a deeper line naming the focused window's hash, and a header-like line with more after its `:`, open no block
    expect(parseFocusedWindow(beforeFocused(`    Window #99 Window{${hash} u0 Nested}:`))).toEqual(STACKED);
    expect(parseFocusedWindow(beforeFocused(`  Window #99 Window{${hash} u0 Other}: and more`))).toEqual(STACKED);
    expect(parseFocusedWindow(beforeFocused(`  Window #99 Window{${hash} u0 Other}:`))).toEqual({ of: 'unknown' }); // a real header: a block with no type
  });

  it('a window\'s frame is its own `Frames:` line, which starts the line after the indent', () => {
    expect(parseFocusedWindow(inFocused((block) => block.replace(/^( +Frames: )/m, '    mLast Frames: parent=[0,0][1,1] frame=[0,0][10,10]\n$1')))).toEqual(STACKED);
    expect(parseFocusedWindow(inFocused((block) => block.replace(/^( +Frames: )/m, '    Frames: parent=[0,0][1,1] frame=[0,0][10,10]\n$1')))).toEqual({ of: 'stacked', frame: { x: 0, y: 0, width: 10, height: 10 }, screen: SCREEN });
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

  it('parseNavigationBand: a DisplayFrames line\'s rotation is all its digits, and blanks may end the line', () => {
    expect(parseNavigationBand('  DisplayFrames w=1080 h=2220 r=0 \t\n' + NAV('[0,2154][1080,2220]'))).toBe(2154);
    // a second DisplayFrames line at r=10 (no Android rotation; synthetic, no display header): a second size, so no band
    expect(parseNavigationBand(FRAMES + '  DisplayFrames w=1080 h=2220 r=10\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
  });

  it('parseNavigationBand: DisplayFrames lines alike but for their indent are one size; a line with more after r= is none', () => {
    expect(parseNavigationBand(FRAMES + '    DisplayFrames w=1080 h=2220 r=0\n' + NAV('[0,2154][1080,2220]'))).toBe(2154);
    expect(parseNavigationBand('  DisplayFrames w=1080 h=2220 r=0 x\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
    expect(parseNavigationBand('  mLast DisplayFrames w=1080 h=2220 r=0\n' + NAV('[0,2154][1080,2220]'))).toBeUndefined();
  });
});

// The parsers' own cases, moved from tests/adapters/android.test.ts (A27): there each sat beside the adapter call that
// reads with it; the adapter's cases stay there.
/** A real `dumpsys window displays` (tests/fixtures/dumpsys-window-displays-<name>.txt). */
const dumpsys = (name: string) => readFile(new URL(`../fixtures/dumpsys-window-displays-${name}.txt`, import.meta.url), 'utf8');

describe('parseImeInsets — is a soft keyboard shown, and which rect does it cover (the parser AndroidAdapter.keyboard.state reads with)', () => {
  const STATUS_BAR_33 = '        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false';
  const STATUS_BAR_36 = '        InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null';
  const IME_SHOWN_33 = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false';
  const IME_HIDDEN_33 = '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false';
  /** DisplayPolicy's lines, as the real dumps print them. */
  const SHOWING = '    mIsImeShowing=true\n    mImeHeight=756\n';
  const HIDING = '    mIsImeShowing=false\n    mImeHeight=0\n';
  const lines = (...l: string[]) => `    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;

  it('API 33, keyboard shown (real dump): the IME frame, as a rect in screen pixels', async () => {
    expect(parseImeInsets(await dumpsys('api33-keyboard-shown'))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1398, width: 1080, height: 822 }, // frame=[0,1398][1080,2220]
    });
  });

  it('API 33, keyboard hidden (real dump): hidden — visible=false decides, though visibleFrame still holds the nav-bar strip', async () => {
    const dump = await dumpsys('api33-keyboard-hidden');
    expect(dump).toContain('InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false');
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 33, ~0.4 s after back (real line): visible=false with the full frame still set is HIDDEN, not shown', () => {
    const animatingOut = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, animatingOut))).toEqual({ state: 'hidden' });
  });

  it('the measured finportal login line (API 33): frame [0,1285][1080,2220]', () => {
    const line = '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, line))).toEqual({ state: 'shown', frame: { x: 0, y: 1285, width: 1080, height: 935 } });
  });

  it('API 36, no keyboard since boot (real dump): the list reads and has no ime entry — hidden', async () => {
    const dump = await dumpsys('api36-no-ime-source');
    expect(dump).toContain('InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true');
    expect(dump).not.toMatch(/type=ime\b/);
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 34+ format, shown and hidden (FROM DOCUMENTATION, unverified on a device): `id=… type=ime`, no visibleFrame', () => {
    const ime = (frame: string, visible: boolean) =>
      `        InsetsSource id=3 type=ime frame=${frame} visible=${visible} flags= sideHint=BOTTOM boundingRects=null`;
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,1344][1080,2280]', true)))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1344, width: 1080, height: 936 },
    });
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,0][0,0]', false)))).toEqual({ state: 'hidden' });
  });

  // FAIL OPEN: everything below is `unknown` — the callers then behave as
  // they did before the question existed. None of it may read as shown (a
  // guessed frame) or as hidden (dismissKeyboard would stop pressing back).
  it.each([
    ['an empty dump', ''],
    ['a dump with no InsetsSource list at all', 'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\n  Display: mDisplayId=0\n'],
    ['only the provider/control lines, not the state list', '        mSource=InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true\n        mControl=InsetsSourceControl type=ITYPE_IME mLeash=x\n'],
    ['a list in a format that does not read (no frame=, no visible=)', '        InsetsSource type=ITYPE_STATUS_BAR bounds=Rect(0, 0 - 1080, 66) shown\n        InsetsSource type=ITYPE_IME bounds=Rect(0, 1285 - 1080, 2220) shown\n'],
    ['an IME entry whose frame does not read', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['an IME entry with no visible=', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220]')],
    ['an IME entry whose visible is neither true nor false', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=maybe')],
    ['an IME entry with only visibleFrame= (it is not the frame)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME visibleFrame=[0,1285][1080,2220] visible=true')],
    ['a visible IME with an EMPTY frame (it says shown but not where)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visible=true')],
    ['two visible IME entries with different frames (no display header: one display\'s dump, not of the known shape)', lines(
      '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=true',
      '        InsetsSource type=ITYPE_IME frame=[0,600][1920,1080] visible=true',
    )],
  ])('unrecognised → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a type that merely CONTAINS "ime" is not the IME: with mIsImeShowing=false the list simply has no ime entry (hidden)', () => {
    const lookalike = '        InsetsSource id=7 type=imeCaptionBar frame=[0,1285][1080,2220] visible=true flags=';
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_36, lookalike))).toEqual({ state: 'hidden' });
  });

  // The second witness (review 2026-10-03): DisplayPolicy's mIsImeShowing
  // line, present in all three real dumps. A false `shown` presses back on a
  // screen with no keyboard; a silent `hidden` switches the guard off. Both
  // become `unknown` wherever the two witnesses disagree or one is missing
  // where it is needed.
  it('the real dumps carry the witness that agrees with them: true beside shown, false beside hidden and beside no-entry', async () => {
    expect(await dumpsys('api33-keyboard-shown')).toMatch(/^ {4}mIsImeShowing=true$/m);
    expect(await dumpsys('api33-keyboard-hidden')).toMatch(/^ {4}mIsImeShowing=false$/m);
    expect(await dumpsys('api36-no-ime-source')).toMatch(/^ {4}mIsImeShowing=false$/m);
  });

  it.each([
    ['no display header, a hidden and a shown entry (never the shown one\'s frame)', lines(STATUS_BAR_33, IME_HIDDEN_33) + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['no display header, two witnesses that disagree', HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['no IME entry and no mIsImeShowing line (a renamed type, an older dump)', lines(STATUS_BAR_36)],
    ['no IME entry with mIsImeShowing=true (a renamed type while a keyboard is up)', SHOWING + lines(STATUS_BAR_36)],
    ['visible=true contradicted by mIsImeShowing=false', HIDING + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['visible=false contradicted by mIsImeShowing=true', SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['mIsImeShowing=false but NO InsetsSource list reads (the witness alone is not a recognised format)', HIDING + '  Display: mDisplayId=0\n'],
    ['mIsImeShowing=false beside an IME entry that does not read (it is not "no entry")', HIDING + lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['a `visible=` that belongs to a later, longer token (requestedvisible=true)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] requestedvisible=true')],
    ['a `visible=` value that only starts with true (visible=trueish)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=trueish')],
    ['a `type=` that belongs to a longer token (subtype=ITYPE_IME on another source is not an IME entry; no witness)', lines('        InsetsSource subtype=ITYPE_IME type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true')],
  ])('the witnesses disagree or are missing → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a REAL dump truncated before the IME line (the witness is cut off with it, or says true) is unknown, never hidden', async () => {
    const shown = await dumpsys('api33-keyboard-shown');
    const cut = shown.slice(0, shown.indexOf('        InsetsSource type=ITYPE_IME'));
    expect(cut).toContain('InsetsSource type=ITYPE_STATUS_BAR'); // the list was being printed
    expect(parseImeInsets(cut)).toEqual({ state: 'unknown' }); // mIsImeShowing=true, no entry
    expect(parseImeInsets(cut.replace(/^ *mIsImeShowing=.*\n/m, ''))).toEqual({ state: 'unknown' }); // no witness at all
  });

  it('when both witnesses are there and agree, or the entry speaks alone (mIsImeShowing absent — API 30–32, unverified), the entry decides', () => {
    const frame = { x: 0, y: 1398, width: 1080, height: 822 };
    expect(parseImeInsets(SHOWING + lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // `mIsImeShowing=true` MID-LINE, after other text, is not the DisplayPolicy field: it must be ignored,
    // so it neither contradicts a hidden entry nor disagrees with the real witness line.
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Each anchor on its own: text BEFORE the token (nothing after), and text AFTER the value (nothing before).
    expect(parseImeInsets('    mLastState: foo=1 mIsImeShowing=true\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mIsImeShowing=true mImeHeight=756\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Two entries and witnesses that agree (no display header) are not a contradiction.
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
  });
});

describe('parseStatusBand — the status band, out of `dumpsys window displays` (the parser AndroidAdapter.viewport reads with)', () => {
  const STATUS_33 = (frame: string, visible = 'true') => `        InsetsSource type=ITYPE_STATUS_BAR frame=${frame} visible=${visible} insetsRoundedCornerFrame=false`;
  const STATUS_36 = (frame: string, visible = 'true') =>
    `        InsetsSource id=ab460000 type=statusBars frame=${frame} visible=${visible} flags= sideHint=TOP boundingRects=null`;
  const NAV_33 = '        InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true insetsRoundedCornerFrame=false';
  const lines = (...l: string[]) => `    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;

  it('the real dumps: API 33 `type=ITYPE_STATUS_BAR frame=[0,0][1080,66]` and API 36 `type=statusBars frame=[0,0][1080,66]` both read 66', async () => {
    expect(parseStatusBand(await dumpsys('api33-keyboard-hidden'))).toBe(66);
    expect(parseStatusBand(await dumpsys('api33-keyboard-shown'))).toBe(66);
    expect(parseStatusBand(await dumpsys('api36-no-ime-source'))).toBe(66);
  });

  it('the band is the frame\'s bottom — a taller bar (a display cutout) is read as it is; the provider\'s `mSource=InsetsSource …` copy is not a second entry', () => {
    expect(parseStatusBand(lines(STATUS_36('[0,0][1080,145]'), NAV_33))).toBe(145);
    expect(parseStatusBand(`${lines(STATUS_33('[0,0][1080,66]'))}        mSource=InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,99] visible=true\n`)).toBe(66);
  });

  it.each([
    ['the bar hidden (an immersive or full-screen app): visible=false', lines(STATUS_33('[0,0][1080,66]', 'false'), NAV_33)],
    ['no status-bar entry at all', lines(NAV_33)],
    ['an empty dump', ''],
    ['an entry that does not read fully (no visible=)', '        InsetsSource type=statusBars frame=[0,0][1080,66] flags=\n'],
    ['an empty frame', lines(STATUS_36('[0,0][0,0]'))],
    ['a frame that does not start at the screen\'s top', lines(STATUS_36('[0,2154][1080,2220]'))],
    ['no display header, two bars that disagree (66 and hidden)', lines(STATUS_33('[0,0][1080,66]')) + lines(STATUS_33('[0,0][1080,66]', 'false'))],
    ['no display header, two bars that disagree (66 and 80)', lines(STATUS_36('[0,0][1080,66]')) + lines(STATUS_36('[0,0][1920,80]'))],
  ])('no band — fail open, as before the band existed — on %s', (_name, dump) => {
    expect(parseStatusBand(dump)).toBeUndefined();
  });

  it('two bars that agree (no display header) read as the one band', () => {
    expect(parseStatusBand(lines(STATUS_33('[0,0][1080,66]')) + lines(STATUS_33('[0,0][1080,66]')))).toBe(66);
  });
});

describe('parseNavigationBand — the visible navigation bar\'s top, out of `dumpsys window displays`', () => {
  const NAV_33 = (frame: string, visible = 'true') => `        InsetsSource type=ITYPE_NAVIGATION_BAR frame=${frame} visible=${visible} insetsRoundedCornerFrame=false`;
  const NAV_36 = (frame: string, visible = 'true') =>
    `        InsetsSource id=ab460001 type=navigationBars frame=${frame} visible=${visible} flags= sideHint=BOTTOM boundingRects=null`;
  const STATUS_33 = '        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false';
  const FRAMES = (w = 1080, h = 2220, r = 0) => `  DisplayFrames w=${w} h=${h} r=${r}`;
  /** One display: its DisplayFrames line (default the measured 1080x2220, unrotated), then its InsetsState entries. */
  const display = (frames: string, ...l: string[]) => `${frames}\n    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;
  const lines = (...l: string[]) => display(FRAMES(), ...l);

  it('the real API 33 dumps, keyboard hidden and shown: `DisplayFrames w=1080 h=2220 r=0` and `type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true` read 2154', async () => {
    expect(parseNavigationBand(await dumpsys('api33-keyboard-hidden'))).toBe(2154);
    expect(parseNavigationBand(await dumpsys('api33-keyboard-shown'))).toBe(2154);
  });

  it('API 14+\'s `type=navigationBars` reads alike; a taller 3-button bar reads its own top; the provider\'s `mSource=` copy is no second entry', () => {
    expect(parseNavigationBand(lines(STATUS_33, NAV_36('[0,2154][1080,2220]')))).toBe(2154);
    expect(parseNavigationBand(lines(NAV_36('[0,2094][1080,2220]')))).toBe(2094);
    expect(parseNavigationBand(`${lines(NAV_33('[0,2154][1080,2220]'))}        mSource=InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2000][1080,2220] visible=true\n`)).toBe(2154);
    expect(parseNavigationBand(display(FRAMES(1080, 2280), NAV_36('[0,2214][1080,2280]')))).toBe(2214); // the display's own height, whatever it is
  });

  it.each([
    ['the bar hidden (an immersive app): visible=false', lines(STATUS_33, NAV_33('[0,2154][1080,2220]', 'false'))],
    ['no navigation-bar entry at all', lines(STATUS_33)],
    ['an empty dump', ''],
    ['a frame that does not end at the display\'s bottom', lines(NAV_33('[0,2088][1080,2154]'))],
    ['a frame that ends at 2220 on a display 2280 tall', display(FRAMES(1080, 2280), NAV_33('[0,2154][1080,2220]'))],
    ['a bar at the LEFT side, running to the bottom', lines(NAV_33('[0,0][126,2220]'))],
    ['a bar at the RIGHT side, running to the bottom', lines(NAV_33('[954,0][1080,2220]'))],
    ['a frame from above the screen\'s top', lines(NAV_33('[0,-10][1080,2220]'))],
    ['a frame half the display wide', lines(NAV_33('[0,2154][540,2220]'))],
    ['a frame the display\'s width shifted off its left edge', lines(NAV_33('[10,2154][1090,2220]'))],
    ['a frame taller than it is wide (all but the top 10 px)', lines(NAV_33('[0,10][1080,2220]'))],
    ['a frame the whole display (a natural-landscape tablet, r=0)', display(FRAMES(2220, 1080), NAV_33('[0,0][2220,1080]'))],
    ['a turned display (r=1), its bar at the bottom of the turned frame — portrait only', display(FRAMES(2220, 1080, 1), NAV_33('[0,1014][2220,1080]'))],
    // A display whose natural rotation is landscape: its band, kept by the adapter, would be applied to the turned (portrait) box after a rotation.
    ['a natural-landscape tablet (w > h at r=0), its bar across the bottom — portrait displays only', display(FRAMES(2560, 1600), NAV_33('[0,1504][2560,1600]'))],
    ['no DisplayFrames line (the display\'s size unsaid)', `    mInsetsState:\n${NAV_33('[0,2154][1080,2220]')}\n`],
    ['no display header, two DisplayFrames sizes, their bars alike', lines(NAV_33('[0,2154][1080,2220]')) + display(FRAMES(1080, 2280), NAV_33('[0,2154][1080,2220]'))],
    ['an entry that does not read fully (no visible=)', display(FRAMES(), '        InsetsSource type=navigationBars frame=[0,2154][1080,2220] flags=')],
    ['a malformed frame', lines('        InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080] visible=true')],
    ['an empty frame', lines(NAV_36('[0,2220][1080,2220]'))],
    ['no display header, two bars that disagree (2154 and hidden)', lines(NAV_33('[0,2154][1080,2220]')) + lines(NAV_33('[0,2154][1080,2220]', 'false'))],
  ])('no band on %s', (_name, dump) => {
    expect(parseNavigationBand(dump)).toBeUndefined();
  });

  it('the API 36 fixture (a Pixel_4 AVD, 1080x2280) lists no navigation bar: no band', async () => {
    expect(parseNavigationBand(await dumpsys('api36-no-ime-source'))).toBeUndefined();
  });
});

describe('parseInputShown — the input method\'s own word (the parser AndroidAdapter.keyboard.witness reads with)', () => {
  it('reads mInputShown=true as shown and mInputShown=false as hidden (the real line)', () => {
    expect(parseInputShown(INPUT_SHOWN_LINE(true))).toBe('shown');
    expect(parseInputShown(INPUT_SHOWN_LINE(false))).toBe('hidden');
    expect(parseInputShown('mInputShown=true')).toBe('shown'); // the word alone, no newline
    expect(parseInputShown('  mInputShown=false mOther=1\n')).toBe('hidden'); // not necessarily last on the line
  });

  it.each([
    ['empty output', ''],
    ['no such word', '  mShowRequested=false mShowForced=false\n'],
    ['a value that only STARTS with true (mInputShown=trueish; "truthy" too)', '  mShowForced=false mInputShown=trueish\n  mInputShown=truthy\n'],
    ['a value that only starts with false (mInputShown=falsey)', '  mShowForced=false mInputShown=falsey\n'],
    ['a value that is neither (mInputShown=1)', '  mInputShown=1\n'],
    ['a value in another case (mInputShown=TRUE)', '  mInputShown=TRUE\n'],
    ['a value in another case (mInputShown=False)', '  mInputShown=False\n'],
    ['the name in another case (minputshown=true)', '  minputshown=true\n'],
    ['the name as the TAIL of a longer one (mPrevmInputShown=true)', '  mShowForced=false mPrevmInputShown=true\n'],
    ['the name glued to other text mid-word (xmInputShown=false)', '  foo=xmInputShown=false\n'],
    ['two words that disagree', '  mInputShown=true\n  mInputShown=false\n'],
  ])('cannot tell → unknown: %s', (_name, out) => {
    expect(parseInputShown(out)).toBe('unknown');
  });

  it('two words that agree are one answer', () => {
    expect(parseInputShown('  mInputShown=false\n  mInputShown=false\n')).toBe('hidden');
  });
});

describe('parseTouchableRegion — the IME window\'s touchable region (the parser AndroidAdapter.keyboard.touchable reads with)', () => {
  it('reads the four measured regions as rects: floating (panel + strip), docked (the band), hidden (the strip), stale landscape', () => {
    expect(parseTouchableRegion(GBOARD.floating.touchable)).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
    expect(parseTouchableRegion(GBOARD.docked.touchable)).toEqual([{ x: 0, y: 1398, width: 1080, height: 822 }]);
    expect(parseTouchableRegion(GBOARD.hidden.touchable)).toEqual([GBOARD_STRIP]);
    expect(parseTouchableRegion(GBOARD.staleLandscape.touchable)).toEqual([{ x: 0, y: 948, width: 2220, height: 132 }]);
  });

  it('any count, any whitespace between the numbers and the groups; an empty region is no rect', () => {
    expect(parseTouchableRegion('    touchable region=SkRegion( ( 359, 1269 ,1040,1912 )  (0,2088,1080,2220) )\n')).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
    expect(parseTouchableRegion('touchable region=SkRegion((0,0,10,10)(0,10,20,20)(5,20,6,30))')).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 10, width: 20, height: 10 },
      { x: 5, y: 20, width: 1, height: 10 },
    ]);
    expect(parseTouchableRegion('  touchable region=SkRegion()\n')).toEqual([]);
    // Two lines that say the same thing are one region.
    expect(parseTouchableRegion(GBOARD.floating.touchable + GBOARD.floating.touchable)).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
  });

  it.each([
    ['no such line (grep matched nothing)', '  mInputShown=true\n'],
    ['empty output', ''],
    ['a region that is not wholly (l,t,r,b) groups', '  touchable region=SkRegion((359,1269,1040,1912)junk(0,2088,1080,2220))\n'],
    ['a truncated region', '  touchable region=SkRegion((359,1269,1040\n'],
    ['three numbers to a group', '  touchable region=SkRegion((359,1269,1040))\n'],
    ['another notation', '  touchable region=Region[0,2088][1080,2220]\n'],
    ['a rect with right < left', '  touchable region=SkRegion((1040,1269,359,1912))\n'],
    ['two lines that disagree', GBOARD.floating.touchable + '  touchable region=SkRegion((0,1398,1080,2220))\n'],
    ['a readable line beside one that is not (no line is dropped to make the rest agree)', GBOARD.floating.touchable + '  touchable region=SkRegion((359,1269\n'],
  ])('cannot read → undefined (no panel, the band alone): %s', (_name, out) => {
    expect(parseTouchableRegion(out)).toBeUndefined();
  });
});

describe('the keyboard reads\' shell lines, as sent (until A27 pinned only through the adapter\'s calls, android.test.ts)', () => {
  it('the witness: the input method\'s first `mInputShown` word, filtered on the device', () => {
    expect(INPUT_SHOWN_COMMAND).toBe('dumpsys input_method | grep -m1 -w mInputShown');
  });

  it('the touchable region: the witness\'s line, every `touchable region=` line of the IME window, then `true`', () => {
    expect(TOUCHABLE_COMMAND).toBe("dumpsys input_method | grep -m1 -w mInputShown; dumpsys window InputMethod | grep -F 'touchable region='; true");
  });
});
