import { basename, join } from 'node:path';
import { LAB_AVD, pause } from '../lab-device.js';
import type { Run } from './bounded.js';
import type { BatchFs } from './io.js';
import { shellQuote } from './ios-defaults.js';
import { CLEANUP_LABEL, compareReads, comparedLine, sanitizeFixture, type ShellRead } from './lab-chooser.js';
import { CELLS_ENTRY, chooserWindow, cleanUp, handlers, LabEmu, labInstalled, readClipboard, readRoleHolders, UNZIP_SECS, type Cleanup, type ReinstallOptions, type StateRestore } from './lab-emu.js';
import { CATALOG_PATH, cellsWhy, freshIn } from './lab-lines.js';
import { askBuild, metWith, type BuildRef } from './lab-build.js';
import type { BlockCtx, NeedCtx, NeedSpec } from './runner.js';
import type { BatchConfig, NeedResult } from './runner-lines.js';
import { stateOf } from './run-dir.js';
import { exitText, failedCall, nameInLine } from './words.js';

/**
 * The lab emulator's plumbing around a batch's Android blocks (T2 S6b; batch-11.sh:413–450, batch-12.sh:377–400): the
 * `android` need — the lab guard, this run's build installed (`install -r`, batch-11's lab install), the installed APK
 * pulled and its cells.json byte-equal to main's catalog, the handler counts read — and its cheap recheck (`adb
 * get-state`, `pm path`); a need on the handler counts a block expects (batch-11's D55: shared 2, cell 1); the
 * tri-state reads around a block (the role holders, the clipboard: unread is never unchanged); a tree kept with its
 * fitness as a fixture said; the probe's own state restore (S5's StateRestore) as a bounded child; and the chooser's
 * stretch: the window opened, the work, the cleanup's line and hand lines. What is decided and said is
 * lab-chooser.ts's and lab-lines.ts's; the calls go through lab-emu.ts's guarded LabEmu.
 */

/** The need's name in a batch's `needs`. */
export const ANDROID_NEED = 'android';
/** The URLs whose handlers the check counts (batch-11.sh:443: shared 2, cell 1 on main's lab). */
export const HANDLER_URLS: readonly string[] = ['averilab://shared/open', 'averilab://cell/open'];
/** The chooser's dirty window's name. */
export const CHOOSER_WINDOW = 'D55 chooser';
/** The lab emulator as the how names it (lab-device.ts#LAB_AVD). */
const LAB_EMULATOR = `${LAB_AVD} emulator`;

/** A count read or why not, as words. */
const countText = (n: number | { why: string }): string => (typeof n === 'number' ? `${n}` : `not read (${n.why})`);

export interface AndroidLabOptions {
  /** This run's build (lab-build.ts's `kit.android`): asked by the need itself, installed `-r` before the check when met. */
  build?: BuildRef;
  /** A build that failed makes the need not met (default: the APK already installed is used, as batch-11). */
  requireBuild?: boolean;
  /** The URLs whose handlers are counted (HANDLER_URLS unless given). */
  handlers?: readonly string[];
  /** The wait after a key event (tests pass one that does not wait). */
  settle?: (ms: number) => Promise<unknown>;
}

export interface AndroidLab {
  need: NeedSpec;
  /** The APK pulled at the check (batch-11's lab/installed.apk): the one a reinstall puts back. */
  pulled(): string | undefined;
  /** The handler counts read at the check, by URL. */
  counts(): Readonly<Record<string, number | { why: string }>>;
  /** The lab emulator over a block's (or a need's) calls, guarded; why not. */
  open(c: { bounded: Run; config: BatchConfig; fs: BatchFs }): Promise<{ ok: true; emu: LabEmu } | { ok: false; why: string }>;
  /** A need on the handler counts a block expects (`{url: n}`), read again each time it is asked. */
  handlersNeed(expect: Readonly<Record<string, number>>): NeedSpec;
}

/**
 * The lab emulator kit. The need's check (batch-11.sh:427–450): the serial given and guarded; this run's build
 * installed (`adb install -r`, the install bound); the lab installed (`get-state` first, then `pm path`); its APK
 * pulled into the lab folder (a fresh file) and its assets/cells.json main's catalog byte for byte, a copy kept; the
 * handler counts read and kept (android-handlers.txt). Its `alive`: the guard, `get-state` and `pm path`.
 */
export function androidLab(o: AndroidLabOptions = {}): AndroidLab {
  let pulled: string | undefined;
  const counts: Record<string, number | { why: string }> = {};
  const urls = o.handlers ?? HANDLER_URLS;
  const open: AndroidLab['open'] = async (c) => {
    if (c.config.serial === undefined) return { ok: false, why: 'no lab emulator serial given (--serial or AVERI_LAB_SERIAL)' };
    const r = await LabEmu.open(c.config.serial, c.bounded, { fs: c.fs, settle: o.settle ?? pause });
    return r.ok ? { ok: true, emu: r.emu } : r;
  };
  const check = async (c: NeedCtx): Promise<NeedResult> => {
    const opened = await open(c);
    if (!opened.ok) return opened;
    const { emu } = opened;
    const asked = await askBuild(c, o);
    if ('why' in asked) return { ok: false, why: asked.why };
    const { built } = asked;
    if (built !== undefined) {
      const r = await emu.adb(['install', '-r', built]);
      if (failedCall(r)) return { ok: false, why: `this run's build not installed (adb install -r: ${exitText(r)})` };
    }
    const installed = await labInstalled(emu);
    if (installed.state !== 'installed') return { ok: false, why: installed.state === 'missing' ? 'the lab APK is not installed (pm path)' : `whether the lab is installed is unknown (${installed.why})` };
    const local = freshIn(c.fs, c.labDir, 'installed.apk');
    const pull = await emu.adb(['pull', installed.path, local]);
    if (failedCall(pull) || !c.fs.exists(local)) return { ok: false, why: `the installed APK not pulled (${failedCall(pull) ? exitText(pull) : 'exit 0 but no file'})` };
    pulled = local;
    const cells = await emu.run('unzip', ['-p', local, CELLS_ENTRY], { secs: UNZIP_SECS });
    if (!failedCall(cells)) c.fs.createExclusive(freshIn(c.fs, c.labDir, 'android-installed-cells.json'), cells.out);
    const why = cellsWhy(failedCall(cells) ? undefined : cells.out, c.fs.read(join(c.config.repo, CATALOG_PATH)), `the installed APK (${nameInLine(installed.path)})`);
    if (why !== undefined) return { ok: false, why: `${why} (rerun with ONLY=lab,…)` };
    for (const url of urls) counts[url] = await handlers(emu, url);
    const said = urls.map((u) => `${u} ${countText(counts[u])}`).join(', ');
    c.fs.append(join(c.labDir, 'android-handlers.txt'), `handlers: ${said}\n`);
    return metWith(`${LAB_EMULATOR} ${nameInLine(emu.serial)}; ${built === undefined ? 'not rebuilt' : "this run's build installed"}; the APK's ${CELLS_ENTRY} is main's (pulled: ${local}); handlers: ${said}`, asked.warn);
  };
  const alive = async (c: NeedCtx): Promise<NeedResult> => {
    const opened = await open(c);
    if (!opened.ok) return opened;
    const installed = await labInstalled(opened.emu);
    if (installed.state === 'installed') return { ok: true, how: 'adb answers; the lab installed' };
    return { ok: false, why: installed.state === 'missing' ? 'the lab APK is not installed (pm path)' : installed.why };
  };
  return {
    need: { check, alive },
    pulled: () => pulled,
    counts: () => ({ ...counts }),
    open,
    handlersNeed(expect) {
      const asked = async (c: NeedCtx): Promise<NeedResult> => {
        const opened = await open(c);
        if (!opened.ok) return opened;
        const off: string[] = [];
        const read: string[] = [];
        for (const [url, want] of Object.entries(expect)) {
          const n = await handlers(opened.emu, url);
          read.push(`${url} ${countText(n)}`);
          if (n !== want) off.push(`${url} has ${countText(n)} handler(s), ${want} expected`);
        }
        return off.length === 0 ? { ok: true, how: `handlers as expected: ${read.join(', ')}` } : { ok: false, why: off.join('; ') };
      };
      return { check: asked, alive: asked };
    },
  };
}

// ------------------------------------------------------------------------------------------ the tri-state reads

/** The reads a block asks for around it: each by the label its line gets. */
export interface ReadLabels {
  /** The browser role holder (batch-9's read; API 33: `Unknown command`, unread). */
  roles?: string;
  /** The clipboard (batch-9's D43 read; API 33: no shell implementation, unread). */
  clipboard?: string;
}

const READS: Readonly<Record<keyof ReadLabels, (emu: LabEmu) => Promise<ShellRead>>> = { roles: readRoleHolders, clipboard: readClipboard };

/**
 * The tri-state reads around a block's work (batch-9's D43/D55 reads): each asked read before and after, compared —
 * unchanged OK, CHANGED an ERROR, unread a WARN `not compared`, never OK (lab-chooser.ts#comparedLine) — each line one
 * of the block's verdict lines. The work's result is passed back.
 */
export async function withReads<T>(ctx: BlockCtx, emu: LabEmu, labels: ReadLabels, work: () => Promise<T>): Promise<T> {
  const asked = (Object.keys(READS) as (keyof ReadLabels)[]).filter((k) => labels[k] !== undefined);
  const before = new Map<keyof ReadLabels, ShellRead>();
  for (const k of asked) before.set(k, await READS[k](emu));
  const r = await work();
  for (const k of asked) ctx.verdictLines([comparedLine(labels[k]!, compareReads(before.get(k)!, await READS[k](emu)))]);
  return r;
}

// ------------------------------------------------------------------------------------------------- the trees

/**
 * A tree (a uiautomator dump, a resolver) kept in the block's folder, a fresh file, as evidence — and whether it is fit
 * to commit as a fixture as it is (lab-chooser.ts#sanitizeFixture: no device path, not the serial), said in a NOTE.
 */
export function keepTree(ctx: Pick<BlockCtx, 'dir' | 'fs' | 'step'>, name: string, text: string, serial: string): { path: string; fit: boolean } {
  const path = freshIn(ctx.fs, ctx.dir, name);
  ctx.fs.createExclusive(path, text);
  const s = sanitizeFixture(text, serial);
  ctx.step('NOTE', `${basename(path)} kept; ${s.ok ? 'fit as a fixture as it is' : `not fit as a fixture as it is (it holds ${s.hits.map(nameInLine).join(', ')}): sanitise it before committing`}`);
  return { path, fit: s.ok };
}

// ---------------------------------------------------------------------------------------- the probe's restore

export interface ProbeRestoreOptions {
  /** The checkout the probe imports from: its cwd, where `--import tsx` resolves. */
  repo: string;
  /** The probe's file (a scratch probe, outside the repo: d55-b11.ts, e5-b12.ts). */
  probe: string;
  /** Its device flags (`--serial <emu>`, `--apk <file>`): before `--state <file>`. */
  args: readonly string[];
  stateFile: string;
  /** Its bound (batch-12's B_RESTORE). */
  secs: number;
  fs: BatchFs;
  /** The probe's run that writes its state file, for a hand line (lab-emu.ts#StateRestore). */
  stateCommand?: string;
}

/**
 * The probe's own state put back (S5's StateRestore; batch-11's `d55-b11.ts --restore`): `node --import tsx <probe>
 * --restore <args> --state <file>` from the checkout, bounded, through the Run it is given; put back only when it exits
 * 0 and its state file then reads clean. Its command, every word shell-quoted, for a hand line.
 */
export function probeRestore(o: ProbeRestoreOptions): StateRestore {
  const argv = ['--import', 'tsx', o.probe, '--restore', ...o.args, '--state', o.stateFile];
  const name = basename(o.probe);
  return {
    async restore(run) {
      const r = await run(process.execPath, argv, { secs: o.secs, cwd: o.repo });
      if (failedCall(r)) return { ok: false, why: `${name} --restore: ${exitText(r)}` };
      const state = stateOf(o.fs, o.stateFile);
      return state === 'clean' ? { ok: true, how: `${name} --restore: its state file clean` } : { ok: false, why: `${name} --restore exited 0, but its state file is ${state}` };
    },
    command: ['node', ...argv].map(shellQuote).join(' '),
    ...(o.stateCommand !== undefined && { stateCommand: o.stateCommand }),
  };
}

// ---------------------------------------------------------------------------------------- the chooser's stretch

/**
 * The chooser's stretch (batch-11's D55, batch-12's E5): its dirty window opened (lab-emu.ts#chooserWindow, its
 * cleanup label the abort writes), the work, then the cleanup (lab-emu.ts#cleanUp) — its line one of the block's
 * verdict lines and its hand lines to RESTORE at once — and the window closed: what is left is in RESTORE.
 */
export async function chooserStretch(ctx: BlockCtx, emu: LabEmu, o: ReinstallOptions & { cleanup?: string; secs?: number }, work: () => Promise<void>): Promise<Cleanup> {
  ctx.open(CHOOSER_WINDOW, chooserWindow(emu, { ...o, block: ctx.id, cleanup: o.cleanup ?? CLEANUP_LABEL }));
  await work();
  const c = await cleanUp(emu, o);
  ctx.verdictAndHand({ line: c.line, hand: c.hand });
  ctx.close(CHOOSER_WINDOW);
  return c;
}
