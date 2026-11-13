import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { shellQuote } from '../../src/adapters/adb-shell.js';
import { CHOOSER_FOCUS_COMMAND, FOCUSED_WINDOW_COMMAND, TOUCHABLE_COMMAND } from '../../src/adapters/android-wm.js';
import { isMain } from '../is-main.js';
import { HOME_COMMAND, pause } from './lab-device.js';

/**
 * A35's two-display capture (docs/plans/2026-10-30-performance-backlog.md, row A35; owner's grant 2026-11-13): the
 * window manager's dumps the Android adapter reads, on a device with a second display, so the three multi-display rules
 * of src/adapters/android-wm.ts can be made one on real text. The second display is an overlay display
 * (`settings put global overlay_display_devices …`), set for the capture only and put back in a `finally`:
 *
 *   node --import tsx scripts/truth/capture-two-display.ts --serial emulator-5554 --out <dir>
 *
 * Before: the setting's value, display 0's focus, HOME, the root tasks. Then three states, each the same reads (READS):
 * `a`, display 0 as found (nothing started) with the overlay present; `b`, Settings started on display 0; `c`, the clock
 * started on the overlay display beside it (`am start --display <id>`; Settings itself would move its one task there).
 * The clock's process is killed (`am kill`) after when it was not running before. After: every root task the
 * capture started removed, then the setting put back (deleted when it was `null`) and read back — each step its own
 * try, so a failed one cannot skip the setting's —, the overlay gone from the dump, display 0's focus as before (HOME
 * refocused when the overlay's removal left mFocusedApp null) — each checked, exit 1 when one is not. A Settings task
 * already there before is reused by `b` and `c` and kept (tasks are restored by id, not by state). Never wipes, clears,
 * reboots or force-stops anything.
 */

const run = promisify(execFile);

/** The overlay display: 720x1280 at 320 dpi, a phone-shaped second screen. */
const OVERLAY = '720x1280/320';
const SETTING = 'overlay_display_devices';
/** The harmless activities started: Settings on display 0 (`b`, `c`), the clock on the overlay display (`c`). */
const SETTINGS = 'com.android.settings/.Settings';
const CLOCK = 'com.google.android.deskclock/com.android.deskclock.DeskClock';
const CLOCK_PACKAGE = CLOCK.split('/')[0];
const WAIT_MS = 15_000;

/** Each read, its file stem and the shell line, word for word the adapter's (android-wm.ts). */
const READS: readonly { stem: string; line: string }[] = [
  { stem: 'dumpsys-window-displays', line: 'dumpsys window displays' }, // parseImeInsets, parseStatusBand, parseNavigationBand
  { stem: 'focused-window', line: FOCUSED_WINDOW_COMMAND }, // parseFocusedWindow
  { stem: 'chooser-focus', line: CHOOSER_FOCUS_COMMAND }, // defaultDisplayFocus
  { stem: 'touchable', line: TOUCHABLE_COMMAND }, // the IME witness and touchable region
  { stem: 'dumpsys-display', line: 'dumpsys display' }, // context: the displays the system holds
];

const shellOf = (serial: string) => async (line: string): Promise<string> => {
  const { stdout } = await run('adb', ['-s', serial, 'shell', line], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

const DISPLAY_HEADER = 'Display: mDisplayId=';
/** Each display's block of `dumpsys window displays` (whole or grepped), by its header's id, in the dump's order. */
const displayBlocks = (dump: string): { id: number; block: string }[] =>
  dump.split(DISPLAY_HEADER).slice(1).map((block) => ({ id: Number.parseInt(block, 10), block }));
/** Display `id`'s block, '' when the dump has none. */
const displayBlock = (dump: string, id: number): string => displayBlocks(dump).find((d) => d.id === id)?.block ?? '';
/** The display ids `dumpsys window displays` heads its blocks with. */
const displayIds = (dump: string): number[] => displayBlocks(dump).map((d) => d.id);

/** Display 0's focus lines (CHOOSER_FOCUS_COMMAND's block of display 0), for the before/after check. */
const display0Focus = (dump: string): string =>
  displayBlock(dump, 0).split('\n').filter((l) => /mCurrentFocus=|mFocusedApp=/.test(l)).map((l) => l.trim()).join(' | ');

async function waitFor<T>(what: string, read: () => Promise<T | undefined>): Promise<T> {
  const until = Date.now() + WAIT_MS;
  for (;;) {
    const v = await read();
    if (v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out (${WAIT_MS} ms) waiting for ${what}`);
    await pause(500);
  }
}

async function capture(shell: (line: string) => Promise<string>, out: string, state: string, log: (s: string) => void): Promise<void> {
  for (const { stem, line } of READS) {
    const text = await shell(line);
    await writeFile(join(out, `${stem}-${state}.txt`), text);
    log(`  ${state} ${stem}: ${text.length} bytes`);
  }
}

/** The root task ids of `am stack list`, with their display. */
const rootTasks = (list: string): { id: number; display: number }[] =>
  [...list.matchAll(/^RootTask id=(\d+) .*?displayId=(\d+) /gm)].map((m) => ({ id: Number(m[1]), display: Number(m[2]) }));

/** Display `id`'s block of CHOOSER_FOCUS_COMMAND's answer: its focused window's component, if any. */
const focusedOn = (dump: string, id: number): string | undefined =>
  /mCurrentFocus=Window\{[0-9a-f]+ u\d+ ([^\s}]+)\}/.exec(displayBlock(dump, id))?.[1];

export async function main(argv: readonly string[]): Promise<number> {
  const arg = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const serial = arg('--serial');
  const out = arg('--out');
  if (serial === undefined || out === undefined) {
    console.error('usage: capture-two-display.ts --serial <serial> --out <dir>');
    return 2;
  }
  await mkdir(out, { recursive: true });
  const lines: string[] = [];
  const log = (s: string) => {
    lines.push(s);
    console.log(s);
  };
  const shell = shellOf(serial);
  const stacks = async () => (await shell("am stack list | grep -E '^RootTask|taskId='")).trimEnd();
  const sdk = (await shell('getprop ro.build.version.sdk')).trim();
  const before = (await shell(`settings get global ${SETTING}`)).trim();
  const focusBefore = display0Focus(await shell(CHOOSER_FOCUS_COMMAND));
  const tasksBefore = new Set(rootTasks(await shell('am stack list')).map((t) => t.id));
  const clockRan = (await shell(`pidof ${CLOCK_PACKAGE}; true`)).trim() !== '';
  const home = (await shell(HOME_COMMAND)).trim().split('\n').at(-1) ?? '';
  log(`${new Date().toISOString()} serial ${serial} sdk ${sdk}`);
  log(`before: ${SETTING}=${before}`);
  log(`before: display 0 focus: ${focusBefore}`);
  log(`before: HOME ${home}; root tasks:\n${await stacks()}`);
  if (displayIds(await shell('dumpsys window displays')).length !== 1) {
    log('refused: the device already has more than one display');
    await writeFile(join(out, 'capture.log.txt'), `${lines.join('\n')}\n`);
    return 1;
  }
  /** Remove every root task the capture started (none of `tasksBefore`). */
  const removeNewTasks = async () => {
    for (const t of rootTasks(await shell('am stack list')).filter((x) => !tasksBefore.has(x.id))) {
      log(`restore: am stack remove ${t.id} (display ${t.display})`);
      await shell(`am stack remove ${t.id}`);
    }
  };
  let ok = true;
  try {
    await shell(`settings put global ${SETTING} ${shellQuote(OVERLAY)}`);
    const second = await waitFor('the overlay display in dumpsys window displays', async () =>
      displayIds(await shell('dumpsys window displays')).find((id) => id !== 0),
    );
    log(`overlay ${OVERLAY} up as display ${second}`);
    await pause(2000); // let the overlay's window and insets settle
    log('a: display 0 as found, nothing started');
    await capture(shell, out, 'a', log);

    /** Start `component` on `display` and wait for its window's focus there. */
    const startOn = async (component: string, display: number) => {
      log(`am start -W --display ${display} -n ${component}`);
      log((await shell(`am start -W --display ${display} -n ${component}`)).trimEnd());
      const pkg = component.split('/')[0];
      await waitFor(`${pkg} focused on display ${display}`, async () =>
        focusedOn(await shell(CHOOSER_FOCUS_COMMAND), display)?.startsWith(`${pkg}/`) === true ? true : undefined,
      );
      await pause(1500);
    };
    log('b: Settings on display 0');
    await startOn(SETTINGS, 0);
    await capture(shell, out, 'b', log);
    log(`c: Settings on display 0, the clock on display ${second}`);
    await startOn(CLOCK, second);
    log(`c: root tasks:\n${await stacks()}`);
    await capture(shell, out, 'c', log);
  } catch (e) {
    ok = false;
    log(`capture failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    /** One restore step in its own try, so a failed one cannot skip the next (the setting's above all). */
    const step = async (what: string, act: () => Promise<void>) => {
      try {
        await act();
      } catch (e) {
        ok = false;
        log(`RESTORE FAILED (${what}): ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    await step('the tasks the capture started', removeNewTasks);
    await step(`${SETTING} back to ${before}`, async () => {
      await shell(before === 'null' ? `settings delete global ${SETTING}` : `settings put global ${SETTING} ${shellQuote(before)}`);
      const after = (await shell(`settings get global ${SETTING}`)).trim();
      log(`after: ${SETTING}=${after} ${after === before ? '(as before)' : `(WAS ${before})`}`);
      if (after !== before) throw new Error(`reads ${after} — put ${SETTING} back to ${before} by hand`);
    });
    await step('display 0 as before', async () => {
      await waitFor('one display again', async () => ((displayIds(await shell('dumpsys window displays')).length === 1) ? true : undefined));
      await pause(1000);
      let focusAfter = display0Focus(await shell(CHOOSER_FOCUS_COMMAND));
      if (
        focusAfter !== focusBefore &&
        focusAfter.includes('mFocusedApp=null') &&
        focusBefore.includes(`mFocusedApp=ActivityRecord{`) &&
        focusBefore.includes(home.split('/')[0])
      ) {
        // Measured by hand (2026-11-13, API 33, an earlier run): after the overlay display is removed, display 0's
        // mFocusedApp reads null until an activity next starts there; HOME alone does not reset it. Settings started and
        // HOME pressed puts it back.
        log(`restore: display 0 focus is ${focusAfter}; refocus HOME through Settings`);
        await shell(`am start -W --display 0 -n ${SETTINGS}`);
        await pause(1000);
        await shell('input keyevent KEYCODE_HOME');
        await pause(1000);
        await removeNewTasks();
        await pause(1000);
        focusAfter = display0Focus(await shell(CHOOSER_FOCUS_COMMAND));
      }
      if (!clockRan) {
        log(`restore: am kill ${CLOCK_PACKAGE} (not running before)`);
        await shell(`am kill ${CLOCK_PACKAGE}`);
      }
      const tasksAfter = new Set(rootTasks(await shell('am stack list')).map((t) => t.id));
      const sameTasks = tasksAfter.size === tasksBefore.size && [...tasksAfter].every((id) => tasksBefore.has(id));
      log(`after: display 0 focus: ${focusAfter} ${focusAfter === focusBefore ? '(as before)' : '(CHANGED)'}`);
      log(`after: root tasks ${sameTasks ? '(as before)' : '(CHANGED)'}:\n${await stacks()}`);
      if (focusAfter !== focusBefore || !sameTasks) ok = false;
    });
    log(ok ? 'done' : 'FAILED');
    await writeFile(join(out, 'capture.log.txt'), `${lines.join('\n')}\n`);
  }
  return ok ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
