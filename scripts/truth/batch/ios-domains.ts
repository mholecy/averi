import { basename } from 'node:path';
import { IosLab, type Exec } from '../lab-device.js';
import { markDirty, type WindowSpec } from './abort.js';
import type { CallResult, Run } from './bounded.js';
import { nodeFs, type BatchFs } from './io.js';
import {
  absentIn,
  backupPathOf,
  baseOf,
  changeText,
  COMPARE_LABEL,
  decideRestore,
  defaultsArgv,
  diffMaps,
  domainHand,
  domainPart,
  DOMAINS,
  HAND_PREFIX,
  LAB_WDA_PORT,
  LATE_HAND_PREFIX,
  noPerformed,
  notVerifiedLine,
  PROTECTED,
  protectedReadOf,
  restoreDomain,
  restoredLine,
  restoreFileLines,
  shellQuote,
  stateIn,
  TYPED_PY,
  typedMapOf,
  type DomainEntry,
  type DomainMap,
  type DomainRestore,
  type DomainsState,
  type KeyDiff,
  type KeyVal,
  type ProtectedRead,
} from './ios-defaults.js';
import { exitText, firstLineOf, messageOf, nameInLine, stepLine, verdictLine } from './words.js';

/**
 * The lab simulator's settings around the WDA window (batch-10's D43 gate, batch-11's WDA window), over the
 * simulator: the three domains a WebDriverAgent runner's exit changes, backed up before the window's first change
 * and put back KEY BY KEY after, verified; and the schemeapproval domain, which no batch writes, its finportal key
 * only read. What is decided and said is ios-defaults.ts's; here are the calls, through the injected Run, and the
 * files, through io.ts.
 *
 * The state-file protocol (d43-gate.ts's `--state`): `backup` writes `{dirty: true, udid, port, domains}` before the
 * window's first change, the backups beside it; `restore` clears `dirty` only after every domain's read-back equals
 * its backup; `compare`, after the window's end check, marks it dirty again (abort.ts#markDirty) when a domain changed
 * since (a late writer) or could not be read. A plist that cannot be read is never an empty map: it is unread, and
 * unread is never unchanged.
 *
 * Every call goes to the lab simulator only: a `LabSim` is had only through lab-device.ts's guard (its udid listed as
 * `averi-lab …`, never device-check's), and every `defaults` argv is built by ios-defaults.ts's `defaultsArgv`, which
 * lets anything but a read name only the window's three domains, by their exact names: the schemeapproval domain is
 * only ever read. Nothing here names a port. Files are never overwritten: each read of a domain is a fresh file
 * beside the state file, kept as evidence.
 *
 * What S6 adds around it: the WDA kill and the 4 s wait before the restore, the steps, the SUMMARY assembly.
 */

/** The typed read's bound (python3's plistlib on a host file, never a device call): d43-gate.ts's 15 s. */
export const PLIST_SECS = 15;

// ----------------------------------------------------------------------------------------- the lab simulator

/** A Run as lab-device.ts's Exec: its stdout, or a throw naming the exit (as execFile rejects). */
const execOf =
  (run: Run): Exec =>
  async (file, args) => {
    const r = await run(file, args);
    if (r.code !== 0) throw new Error(`${file} ${args.join(' ')}: ${exitText(r)}`);
    return { stdout: r.out };
  };

/**
 * The lab simulator, guarded: had only through `LabSim.open`, which runs lab-device.ts's guard (device-check's udid
 * refused before any call; then the udid listed by `simctl list devices -j` under a name starting `averi-lab `).
 * `using` gives the same guarded simulator over another Run (an abort's detached runner).
 */
export class LabSim {
  private constructor(
    readonly udid: string,
    /** The guard's words: name and runtime (`averi-lab iPhone 17 simulator, iOS 27.0`). */
    readonly description: string,
    private readonly run: Run,
    readonly fs: BatchFs,
  ) {}

  /** The lab simulator `udid`, or why it is refused (nothing was done to it). */
  static async open(udid: string, run: Run, fs: BatchFs = nodeFs): Promise<{ ok: true; sim: LabSim } | { ok: false; why: string }> {
    try {
      const description = await new IosLab(udid, { exec: execOf(run) }).guard();
      return { ok: true, sim: new LabSim(udid, description, run, fs) };
    } catch (e) {
      return { ok: false, why: `the lab guard refused ${nameInLine(udid)} (nothing was done to it): ${firstLineOf(messageOf(e))}` };
    }
  }

  using(run: Run): LabSim {
    return new LabSim(this.udid, this.description, run, this.fs);
  }

  /** `defaults <args>` on the simulator, its argv from `defaultsArgv` (which throws before any call it refuses). */
  defaults(args: readonly string[]): Promise<CallResult> {
    const argv = defaultsArgv(this.udid, args);
    return this.run('xcrun', argv);
  }

  /** python3's plistlib over a host file, bounded by PLIST_SECS. */
  plistlib(path: string): Promise<CallResult> {
    return this.run('python3', ['-I', '-c', TYPED_PY, path], { secs: PLIST_SECS });
  }
}

// ------------------------------------------------------------------------------------------- the reads

/** A host plist read typed, or why not: plistlib must read it as a dictionary. */
async function typedOf(sim: LabSim, path: string): Promise<{ map: Record<string, KeyVal> } | { why: string }> {
  const r = await sim.plistlib(path);
  if (r.code !== 0) return { why: `plistlib could not read ${nameInLine(basename(path))}: ${exitText(r)}` };
  const map = typedMapOf(r.out);
  return typeof map === 'string' ? { why: `${nameInLine(basename(path))}: ${map}` } : { map };
}

/** A domain's backup read typed: null when absent before the window (no backup), else plistlib's map or why not. */
async function backupOf(sim: LabSim, entry: DomainEntry): Promise<{ map: DomainMap } | { why: string }> {
  if (entry.backup === null) return { map: null };
  const read = await typedOf(sim, entry.backup);
  return 'why' in read ? { why: `its backup: ${read.why}` } : read;
}

/**
 * Export a domain to `path` and read it typed, or why not. A domain that is not there exports an empty dictionary,
 * exit 0 (the host's defaults), so the map never says absent: diffMaps reads an empty domain as an absent one, and
 * only the backup's `defaults read` probe (ios-defaults.ts's absentIn) tells the two apart, where it matters.
 */
async function readDomain(sim: LabSim, domain: string, path: string): Promise<{ map: Record<string, KeyVal> } | { why: string }> {
  const r = await sim.defaults(['export', domain, path]);
  if (r.code === 0 && sim.fs.exists(path)) return typedOf(sim, path);
  return { why: `defaults export ${domain}: ${r.code === 0 ? 'exit 0 but no file written' : exitText(r)}` };
}

/**
 * A fresh path for one read of a domain: `<base>.<kind>.plist`, or `<base>.<kind>-2.plist`, … — the first not there.
 * An earlier read stays as it was (a restore may run twice: the abort's after the block's own).
 */
export function freshPathOf(fs: BatchFs, stateFile: string, domain: string, kind: 'after' | 'readback' | 'compare'): string {
  const base = `${baseOf(stateFile, domain)}.${kind}`;
  if (!fs.exists(`${base}.plist`)) return `${base}.plist`;
  let n = 2;
  while (fs.exists(`${base}-${n}.plist`)) n++;
  return `${base}-${n}.plist`;
}

// -------------------------------------------------------------------------------------------------- backup

export type Backup = { ok: true; state: DomainsState; line: string } | { ok: false; why: string };

/**
 * Before the window's first change: each domain exported beside `stateFile` and read typed (a plist plistlib cannot
 * read as a dictionary fails the backup), or proven absent; then the state file created, dirty, in one exclusive
 * write. A failure writes no state, so nothing may be changed: the window does not run (batch-11's "no wda run
 * (nothing changed)"). An earlier state file or backup there is never overwritten: refused.
 */
export async function backup(sim: LabSim, stateFile: string): Promise<Backup> {
  if (sim.fs.exists(stateFile)) return { ok: false, why: `${nameInLine(stateFile)} is there already: a state file is never overwritten — no state written` };
  const domains: DomainEntry[] = [];
  for (const name of DOMAINS) {
    const path = backupPathOf(stateFile, name);
    if (sim.fs.exists(path)) return { ok: false, why: `${nameInLine(path)} is there already: a backup is never overwritten — no state written` };
    const read = await readDomain(sim, name, path);
    if ('why' in read) return { ok: false, why: `${read.why} — no state written` };
    // An empty export proves nothing (an absent domain exports one too): the read says absent or there.
    const absent = Object.keys(read.map).length === 0 ? absentIn(name, await sim.defaults(['read', name])) : false;
    if (typeof absent === 'object') return { ok: false, why: `${absent.why} — no state written` };
    domains.push({ name, backup: absent ? null : path });
  }
  const state: DomainsState = { dirty: true, udid: sim.udid, port: LAB_WDA_PORT, domains };
  sim.fs.createExclusive(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const said = domains.map((d) => `${d.name} ${d.backup === null ? 'absent' : 'exported'}`).join(', ');
  return { ok: true, state, line: stepLine('OK', `D43 backup: ${said}; state ${nameInLine(stateFile)} (dirty until the restore verifies)`) };
}

// ------------------------------------------------------------------------------------------------- restore

export type Restored =
  | { ok: true; line: string; domains: DomainRestore[] }
  | { ok: false; line: string; domains: DomainRestore[]; why: string; hand: string[] };

/** A restore that did nothing, and needed nothing: `<label>: OK — nothing to do (<why>)`. */
const nothingToDo = (why: string): Restored => ({ ok: true, line: restoredLine(`nothing to do (${why})`), domains: [] });

/** A restore not verified before any domain was tried: its line, and the RESTORE lines for the state file. */
const notVerified = (why: string, hand: string[]): Restored => ({ ok: false, line: notVerifiedLine(why), domains: [], why, hand });

/**
 * Put each domain the state file names back by decideRestore's rule, verified by a fresh read-back each time; then
 * clear the state file's `dirty` — only when every domain's read-back equals its backup. No state file: nothing was
 * backed up, so nothing was changed. A clean one: nothing to do. One for another simulator, or unreadable: NOT
 * VERIFIED, nothing done. Safe to run twice (the abort runs it after the block's own): each read is a new file.
 */
export async function restore(sim: LabSim, stateFile: string): Promise<Restored> {
  const { fs } = sim;
  if (!fs.exists(stateFile)) return nothingToDo('no state file: the window backed nothing up, so changed nothing');
  const st = stateIn(fs.read(stateFile));
  const byHand = [`${HAND_PREFIX}compare the simulator's ${DOMAINS.join(', ')} with the .backup.plist files beside ${nameInLine(stateFile)}`];
  if (typeof st === 'string') return notVerified(`the state file ${nameInLine(stateFile)}: ${st}`, byHand);
  if (!st.dirty) return nothingToDo('the state file is clean');
  if (st.udid !== sim.udid) return notVerified(`the state file is for ${nameInLine(st.udid)}, not ${nameInLine(sim.udid)}`, byHand);
  const domains: DomainRestore[] = [];
  for (const entry of st.domains) domains.push(await restoreOne(sim, stateFile, entry));
  const parts = domains.map(domainPart);
  const restoreLines = domains.flatMap((d) => (d.readBackEqual ? [] : restoreFileLines(HAND_PREFIX, sim.udid, domainHand(d.name, d.backup, d.hand))));
  if (restoreLines.length === 0) {
    try {
      fs.replace(stateFile, JSON.stringify({ ...st, dirty: false }));
    } catch (e) {
      const why = `every domain equals its backup, but ${nameInLine(stateFile)} could not be cleared (${firstLineOf(messageOf(e))})`;
      return { ok: false, line: notVerifiedLine(why), domains, why, hand: byHand };
    }
    const allEqual = domains.every((d) => d.readBackEqual && d.equalAfterRun);
    return { ok: true, line: restoredLine(allEqual ? 'every domain equals its backup (nothing put back)' : parts.join(', ')), domains };
  }
  const why = parts.join(', ');
  return { ok: false, line: notVerifiedLine(why), domains, why, hand: restoreLines };
}

/** One domain: its backup and its state now read typed, then restoreDomain; any read or call that fails stops it. */
async function restoreOne(sim: LabSim, stateFile: string, entry: DomainEntry): Promise<DomainRestore> {
  const { name, backup: backupPath } = entry;
  const performed = noPerformed();
  const failed = (why: string): DomainRestore => ({ name, backup: backupPath, performed, readBackEqual: false, differ: [], why, hand: [] });
  const before = await backupOf(sim, entry);
  if ('why' in before) return failed(before.why);
  const after = await readDomain(sim, name, freshPathOf(sim.fs, stateFile, name, 'after'));
  if ('why' in after) return failed(after.why);
  const equalAfterRun = diffMaps(before.map, after.map).length === 0;
  try {
    const r = await restoreDomain(
      { domain: name, backupPath, backup: before.map, now: after.map },
      {
        run: async (args) => (await sim.defaults(args)).code,
        read: async () => {
          const again = await readDomain(sim, name, freshPathOf(sim.fs, stateFile, name, 'readback'));
          if ('why' in again) throw new Error(`its read-back: ${again.why}`);
          return again.map;
        },
      },
      performed,
    );
    if (r.plan.verdict !== 'NOT VERIFIED') return { name, backup: backupPath, equalAfterRun, performed, readBackEqual: true };
    return { name, backup: backupPath, performed, readBackEqual: false, differ: r.plan.differ, why: r.plan.why, hand: r.plan.hand };
  } catch (e) {
    return failed(firstLineOf(messageOf(e)));
  }
}

// ------------------------------------------------------------------------------------------------- compare

/**
 * A domain after the window's end against its backup: unchanged; changed (its keys, each `<key> <before> → <after>`,
 * and the hand commands); or unread, with why — never unchanged.
 */
export type Compared =
  | { name: string; outcome: 'unchanged' }
  | { name: string; outcome: 'changed'; differ: KeyDiff[]; changes: string[]; hand: string[] }
  | { name: string; outcome: 'unread'; why: string };

export interface Comparison {
  domains: Compared[];
  /** `D43 WDA-window compare: OK — …` when every domain is unchanged; else WARN naming each changed or unread one. */
  line: string;
  /** The late writer's RESTORE lines (LATE_HAND): none when every domain is unchanged, or nothing was compared. */
  hand: string[];
}

/** Nothing compared, and why: every domain unread, the line a WARN, no hand line, the state file left as it is. */
function notCompared(why: string): Comparison {
  const said = `not compared: ${why}`;
  return { domains: DOMAINS.map((name) => ({ name, outcome: 'unread', why: said })), line: verdictLine(COMPARE_LABEL, 'WARN', said), hand: [] };
}

/**
 * After the window's end check (the runner's exit can write after the restore verified): each domain read again,
 * typed, against its backup — only once the restore has verified (the state clean) and for this simulator; else
 * nothing is compared and nothing is called a late writer. Changed or unread, the state file is marked dirty again
 * (the device is not proven put back; confirmed in review: the next run must refuse until a restore verifies) and the
 * hand lines name what to do; unread is never unchanged.
 */
export async function compare(sim: LabSim, stateFile: string): Promise<Comparison> {
  const st = stateIn(sim.fs.read(stateFile));
  if (typeof st === 'string') return notCompared(`the state file ${nameInLine(stateFile)}: ${st}`);
  if (st.dirty) return notCompared('the restore has not verified (the state file is dirty)');
  if (st.udid !== sim.udid) return notCompared(`the state file is for ${nameInLine(st.udid)}, not ${nameInLine(sim.udid)}`);
  const domains: Compared[] = [];
  for (const entry of st.domains) domains.push(await compareOne(sim, stateFile, entry));
  return comparison(sim, stateFile, domains);
}

async function compareOne(sim: LabSim, stateFile: string, entry: DomainEntry): Promise<Compared> {
  const { name } = entry;
  const before = await backupOf(sim, entry);
  if ('why' in before) return { name, outcome: 'unread', why: before.why };
  const now = await readDomain(sim, name, freshPathOf(sim.fs, stateFile, name, 'compare'));
  if ('why' in now) return { name, outcome: 'unread', why: now.why };
  const plan = decideRestore({ domain: name, backupPath: entry.backup, backup: before.map, now: now.map });
  if (plan.verdict === 'equal') return { name, outcome: 'unchanged' };
  const changes = plan.differ.map((x) => changeText(x.key, before.map, now.map));
  return { name, outcome: 'changed', differ: plan.differ, changes, hand: domainHand(name, entry.backup, plan.hand) };
}

/** The comparison's line and RESTORE lines; the state file marked dirty when any domain is not unchanged. */
function comparison(sim: LabSim, stateFile: string, domains: Compared[]): Comparison {
  const notUnchanged = domains.filter((d) => d.outcome !== 'unchanged');
  if (notUnchanged.length === 0) return { domains, line: verdictLine(COMPARE_LABEL, 'OK', 'every domain still equals its backup after the end check'), hand: [] };
  let state: string;
  try {
    const marked = markDirty(sim.fs, stateFile);
    state = marked === 'marked' ? 'the state file marked dirty again' : `the state file could not be marked dirty (${marked})`;
  } catch (e) {
    // As restore says a state file it cannot clear: the line says it, the hand lines still go to RESTORE.
    state = `the state file could not be marked dirty (${firstLineOf(messageOf(e))})`;
  }
  const said = notUnchanged.map((d) => (d.outcome === 'changed' ? `${d.name}: ${d.changes.join(', ')}` : `${d.name} unread (${d.why})`)).join('; ');
  const restoreLines = notUnchanged.flatMap((d) =>
    d.outcome === 'changed'
      ? restoreFileLines(LATE_HAND_PREFIX, sim.udid, d.hand)
      : [`${LATE_HAND_PREFIX}${d.name} could not be compared: read it and compare it with its backup beside ${nameInLine(stateFile)} by hand`],
  );
  return { domains, line: verdictLine(COMPARE_LABEL, 'WARN', `${said} — ${state}; the hand lines are in RESTORE`), hand: restoreLines };
}

// ---------------------------------------------------------------------------------------- the read-only key

/** `defaults read <schemeapproval> <finportal key>` (batch-11.sh:337–340), read by protectedReadOf. */
export async function readProtected(sim: LabSim): Promise<ProtectedRead> {
  return protectedReadOf(await sim.defaults(['read', PROTECTED.domain, PROTECTED.key]));
}

// ---------------------------------------------------------------------------------------------- the window

/**
 * The WDA window's dirty window (abort.ts): its restore this module's, over the abort's detached runner; its state
 * file, so the abort puts it back only when it reads clean after; its hand lines for when it is not put back.
 */
export function domainsWindow(sim: LabSim, stateFile: string, opts: { block?: string; secs?: number } = {}): WindowSpec {
  return {
    async restore(run) {
      const r = await restore(sim.using(run), stateFile);
      return r.ok ? { ok: true, how: r.line } : { ok: false, why: r.line, hand: r.hand };
    },
    // Read when asked (the abort writes it): per domain from the state file — an import of its backup, or for one
    // absent before key deletes, never an import (d43-gate.ts's rule); no state yet, one line saying both.
    get hand() {
      const st = stateIn(sim.fs.read(stateFile));
      if (typeof st !== 'string') return st.domains.flatMap((d) => restoreFileLines(HAND_PREFIX, sim.udid, domainHand(d.name, d.backup, [])));
      // A state file there that cannot be read is said first: the person must look at it before trusting any backup.
      return [
        ...(sim.fs.exists(stateFile) ? [`${HAND_PREFIX}the state file ${nameInLine(stateFile)} is unreadable: ${st}`] : []),
        `${HAND_PREFIX}the simulator settings not provably put back: compare ${DOMAINS.join(', ')} with the state file ${nameInLine(stateFile)} and the .backup.plist files beside it — a domain with a backup: xcrun simctl spawn ${shellQuote(sim.udid)} defaults import <domain> <its backup>; one absent before (backup null): defaults delete <domain> <key> for each key it holds, never the whole domain`,
      ];
    },
    stateFile,
    ...(opts.block !== undefined && { block: opts.block }),
    ...(opts.secs !== undefined && { secs: opts.secs }),
  };
}
