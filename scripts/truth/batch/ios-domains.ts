import { basename, dirname, join } from 'node:path';
import { IosLab, type Exec } from '../lab-device.js';
import { markDirty, type WindowSpec } from './abort.js';
import type { CallResult, Run } from './bounded.js';
import { nodeFs, type BatchFs } from './io.js';
import { firstLineOf, messageOf, nameInLine, stepLine, verdictLine } from './words.js';

/**
 * The lab simulator's settings around the WDA window (batch-10's D43 gate, batch-11's WDA window): the three domains
 * a WebDriverAgent runner's exit changes, backed up before the window's first change and put back KEY BY KEY after,
 * verified; and the schemeapproval domain, which no batch writes, its finportal key only read.
 *
 * batch-10 measured that the runner's exit flips com.apple.Accessibility's keys from bool to int (`AutomationEnabled`
 * true → 0): a domain is read typed (plistlib, per top-level key its type and canonical value), so bool false is never
 * int 0, and a key is written back with its own type. The rule (`decideRestore`, d43-gate.ts's): each changed or
 * missing scalar written back typed, each extra key deleted — a key, never the domain; still differing, the whole
 * backup imported; after the import, `defaults delete <domain>` + import only once the import is proven to have
 * merged; anything else NOT VERIFIED, with the hand commands. A domain absent before the run is never deleted and
 * never imported into: there is no backup to bring back, so a domain delete would only take keys nobody wrote.
 *
 * The state-file protocol (d43-gate.ts's `--state`): `backup` writes `{dirty: true, udid, port, domains}` before the
 * window's first change, the backups beside it; `restore` clears `dirty` only after every domain's read-back equals
 * its backup; `compare`, after the window's end, marks it dirty again (abort.ts#markDirty) when a domain changed
 * since (a late writer) or could not be read. A plist that cannot be read is never an empty map: it is unread, and
 * unread is never unchanged.
 *
 * Every call goes to the lab simulator only: a `LabSim` is had only through lab-device.ts's guard (its udid listed as
 * `averi-lab …`, never device-check's), and every `defaults` argv is built by `defaultsArgv`, which refuses any verb
 * but a read on the schemeapproval domain. Nothing here names a port. Files go through io.ts and are never
 * overwritten: each read of a domain is a fresh file beside the state file, kept as evidence.
 *
 * What S6 adds around it: the WDA kill and the 4 s wait before the restore, the steps, the SUMMARY assembly.
 */

/** The three domains the WDA window backs up and puts back (d43-gate.ts's DOMAINS, its order). */
export const DOMAINS = ['com.apple.keyboard.preferences', 'com.apple.Preferences', 'com.apple.Accessibility'] as const;

/** The lab's WebDriverAgent port, as the state file records it (d43-gate.ts's PORT): read by d43-gate.ts --restore. */
export const LAB_WDA_PORT = 8120;

/**
 * The read-only key (batch-11.sh:54–55): the remembered "Open in" answer for finportal's scheme. No batch writes its
 * domain at all since batch-11; batch-5's one backup of it stays unopened.
 */
export const PROTECTED = { domain: 'com.apple.launchservices.schemeapproval', key: 'com.apple.CoreSimulator.CoreSimulatorBridge-->sk.finportal.myport' } as const;

/** The key as the lines name it: `-->sk.finportal.myport`. */
const PROTECTED_SHORT = PROTECTED.key.slice(PROTECTED.key.indexOf('-->'));

/** The typed read's bound (python3's plistlib on a host file, never a device call): d43-gate.ts's 15 s. */
export const PLIST_SECS = 15;

/** A RESTORE line's start (batch-11's `D43 (iOS): …`). */
export const HAND_PREFIX = 'D43 (iOS): ';
/** A late writer's RESTORE line's start: a domain changed after the restore had verified it. */
export const LATE_HAND_PREFIX = 'D43 (iOS, changed after the restore — a late writer): ';

/** The verdict labels (batch-11 copied `D43 restore:` into verdict.txt as `D43 WDA-window restore:`). */
export const RESTORE_LABEL = 'D43 WDA-window restore';

// ------------------------------------------------------------------------- a domain as its typed top-level keys

/**
 * One top-level key: its plist type, its canonical JSON (sorted, nested types kept), and for a scalar the text a typed
 * `defaults write` takes.
 */
export interface KeyVal {
  t: 'bool' | 'int' | 'float' | 'string' | 'data' | 'date' | 'dict' | 'array';
  c: string;
  v?: string;
}
/** A domain's top-level keys; null: the domain is absent (equal to an empty one). */
export type DomainMap = Readonly<Record<string, KeyVal>> | null;
export interface KeyDiff {
  key: string;
  kind: 'changed' | 'missing' | 'extra';
}

const has = (m: DomainMap, k: string) => m !== null && Object.hasOwn(m, k);

/** `want` against `got`, by key (sorted): changed (both hold it, type or value differs), missing (only want), extra (only got). */
export function diffMaps(want: DomainMap, got: DomainMap): KeyDiff[] {
  const out: KeyDiff[] = [];
  for (const k of [...new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})])].sort()) {
    if (!has(got, k)) out.push({ key: k, kind: 'missing' });
    else if (!has(want, k)) out.push({ key: k, kind: 'extra' });
    else if (want![k].t !== got![k].t || want![k].c !== got![k].c) out.push({ key: k, kind: 'changed' });
  }
  return out;
}

/** `<key> <kind>` each, as the lines name them. */
export const differText = (d: readonly KeyDiff[]): string => d.map((x) => `${x.key} ${x.kind}`).join(', ');

// ------------------------------------------------------------------------------------------- the one argv builder

/** The verbs this module runs `defaults` with. */
const VERBS: ReadonlySet<string> = new Set(['read', 'export', 'write', 'delete', 'import']);
/** What may touch the schemeapproval domain: a read, nothing else. */
const PROTECTED_VERBS: ReadonlySet<string> = new Set(['read']);
const PROTECTED_LOWER = PROTECTED.domain.toLowerCase();

/**
 * The argv of `xcrun simctl spawn <udid> defaults <args>` — the only place this module builds one. It throws for a
 * verb it does not run (rename, an option first), and for any verb but a read that names the schemeapproval domain
 * anywhere in its arguments, in any case, as a domain or inside a path: the batches no longer write that domain at
 * all; a future need for it is a new decision, not a new call.
 */
export function defaultsArgv(udid: string, args: readonly string[]): string[] {
  const verb = args[0];
  if (verb === undefined || !VERBS.has(verb)) throw new Error(`defaults ${JSON.stringify(verb ?? '')}: not a verb this module runs (${[...VERBS].join(', ')})`);
  if (!PROTECTED_VERBS.has(verb) && args.some((a) => a.toLowerCase().includes(PROTECTED_LOWER))) {
    throw new Error(`defaults ${verb} on ${PROTECTED.domain}: refused — no batch writes that domain (read only)`);
  }
  return ['simctl', 'spawn', udid, 'defaults', ...args];
}

// ------------------------------------------------------------------------------------------------ the restore rule

const WRITE_FLAG = { bool: '-bool', int: '-int', float: '-float', string: '-string' } as const;
type WriteFlag = (typeof WRITE_FLAG)[keyof typeof WRITE_FLAG];
const flagOf = (kv: KeyVal): WriteFlag | undefined => (kv.v !== undefined && Object.hasOwn(WRITE_FLAG, kv.t) ? WRITE_FLAG[kv.t as keyof typeof WRITE_FLAG] : undefined);
/** A word as a shell reads it back: as given when plain, else single-quoted. */
const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export type RestoreAction = { op: 'write'; key: string; flag: WriteFlag; value: string } | { op: 'delete-key'; key: string } | { op: 'import' } | { op: 'delete-domain-then-import' };

/** The `defaults` arguments of an action (the delete-then-import is two commands). */
export function actionArgs(a: RestoreAction, domain: string, backupPath: string | null): string[][] {
  if (a.op === 'write') return [['write', domain, a.key, a.flag, a.value]];
  if (a.op === 'delete-key') return [['delete', domain, a.key]];
  if (a.op === 'import') return [['import', domain, backupPath!]];
  return [['delete', domain], ['import', domain, backupPath!]];
}

/**
 * One step of a domain's restore. `now` is the domain as read last; `done` the stage that read followed (none: the
 * read right after the run); `importExit` the exit of the stage's `defaults import`.
 */
export interface RestoreInput {
  domain: string;
  backupPath: string | null;
  backup: DomainMap;
  now: DomainMap;
  done?: 'per-key' | 'import' | 'fallback';
  importExit?: number;
}
export interface RestorePlan {
  verdict: 'equal' | 'act' | 'NOT VERIFIED';
  stage?: 'per-key' | 'import' | 'fallback';
  actions: RestoreAction[];
  differ: KeyDiff[];
  why?: string;
  /** The `defaults …` commands that would put it back by hand (no `xcrun simctl spawn <udid>` yet). */
  hand: string[];
}

/**
 * The restore rule (pure; d43-gate.ts's, unchanged). Equal → done. Else, in order:
 *  per-key: each changed/missing scalar written back typed, each extra key deleted (a key, never the domain);
 *  import: still differing and a backup exists → `defaults import` of the whole backup;
 *  fallback: after the import, only when it exited 0 and the read-back holds every backup key with its value plus
 *    extra keys (the import merged) → `defaults delete <domain>` + `defaults import`;
 *  anything else → NOT VERIFIED, nothing more done. An absent-before domain (backupPath null) gets the per-key deletes
 *  only: never a domain delete, never an import.
 */
export function decideRestore(i: RestoreInput): RestorePlan {
  const differ = diffMaps(i.backup, i.now);
  if (differ.length === 0) return { verdict: 'equal', actions: [], differ, hand: [] };
  const hand: string[] = [];
  for (const d of differ) {
    const kv = i.backup !== null && has(i.backup, d.key) ? i.backup[d.key] : undefined;
    if (d.kind === 'extra') hand.push(`defaults delete ${i.domain} ${shq(d.key)}`);
    else if (kv !== undefined && flagOf(kv) !== undefined) hand.push(`defaults write ${i.domain} ${shq(d.key)} ${flagOf(kv)} ${shq(kv.v!)}`);
    else if (i.backupPath !== null && !hand.some((h) => h.startsWith('defaults import '))) hand.push(`defaults import ${i.domain} ${shq(i.backupPath)}`);
  }
  const stop = (why: string): RestorePlan => ({ verdict: 'NOT VERIFIED', actions: [], differ, why, hand });
  const absentBefore = i.backupPath === null;
  if (i.done === undefined) {
    const actions: RestoreAction[] = [];
    for (const d of differ) {
      if (d.kind === 'extra') actions.push({ op: 'delete-key', key: d.key });
      else {
        const kv = has(i.backup, d.key) ? i.backup![d.key] : undefined;
        const flag = kv !== undefined ? flagOf(kv) : undefined;
        if (flag !== undefined) actions.push({ op: 'write', key: d.key, flag, value: kv!.v! });
      }
    }
    if (actions.length) return { verdict: 'act', stage: 'per-key', actions, differ, hand };
  }
  if (i.done === undefined || i.done === 'per-key') {
    if (absentBefore) return stop('absent before the run: its keys deleted one by one, the domain itself never deleted, and it still holds keys');
    return { verdict: 'act', stage: 'import', actions: [{ op: 'import' }], differ, hand };
  }
  if (i.done === 'import') {
    if (i.importExit === 0 && differ.every((d) => d.kind === 'extra')) return { verdict: 'act', stage: 'fallback', actions: [{ op: 'delete-domain-then-import' }], differ, hand };
    if (i.importExit !== 0) return stop(`defaults import exited ${i.importExit ?? '?'}: the domain not cleared`);
    return stop(`the import did not bring back ${differ.filter((d) => d.kind !== 'extra').map((d) => d.key).join(', ')}: it did not merge, so the domain not cleared`);
  }
  return stop('it still differs after defaults delete + defaults import');
}

/**
 * A domain's performed restore actions: `deleted`/`wroteBack` the keys whose `defaults delete|write` exited 0,
 * `refused` those that did not (`delete <key> (exit n)` / `write <key> (exit n)`), `import` the exit of the whole
 * `defaults import`, `fallback` the exits of the `defaults delete <domain>` + `defaults import`.
 */
export interface Performed {
  deleted: string[];
  wroteBack: string[];
  refused: string[];
  import?: number;
  fallback?: { delete: number; import: number };
}
export const noPerformed = (): Performed => ({ deleted: [], wroteBack: [], refused: [] });

/** The performed actions in words, each naming the domain (empty when nothing was done). */
export function performedText(domain: string, p: Performed): string {
  const out: string[] = [];
  if (p.wroteBack.length) out.push(`wrote back ${p.wroteBack.join(', ')} in ${domain}`);
  if (p.deleted.length) out.push(`deleted ${p.deleted.join(', ')} in ${domain}`);
  if (p.refused.length) out.push(`refused in ${domain}: ${p.refused.join(', ')}`);
  if (p.import !== undefined) out.push(`imported the whole backup into ${domain} (exit ${p.import})`);
  if (p.fallback !== undefined) out.push(`fell back to defaults delete ${domain} (exit ${p.fallback.delete}) + defaults import (exit ${p.fallback.import})`);
  return out.join('; ');
}

/**
 * One domain's restore, driven by decideRestore until it says equal or NOT VERIFIED (each stage at most once).
 * `io.run` runs `defaults <args>` and gives its exit; `io.read` reads the domain again, typed, and throws when it
 * cannot (a plist that cannot be read is never an empty map).
 */
export async function restoreDomain(
  start: RestoreInput,
  io: { run(args: string[]): Promise<number>; read(): Promise<DomainMap> },
  performed: Performed = noPerformed(),
): Promise<{ equal: boolean; plan: RestorePlan; performed: Performed }> {
  let input = start;
  for (;;) {
    const plan = decideRestore(input);
    if (plan.verdict !== 'act') return { equal: plan.verdict === 'equal', plan, performed };
    let importExit: number | undefined;
    for (const a of plan.actions) {
      const codes: number[] = [];
      for (const args of actionArgs(a, input.domain, input.backupPath)) {
        const code = await io.run(args);
        codes.push(code);
        if (args[0] === 'import') importExit = code;
      }
      if (a.op === 'write' || a.op === 'delete-key') {
        if (codes[0] === 0) (a.op === 'write' ? performed.wroteBack : performed.deleted).push(a.key);
        else performed.refused.push(`${a.op === 'write' ? 'write' : 'delete'} ${a.key} (exit ${codes[0]})`);
      } else if (a.op === 'import') performed.import = codes[0];
      else performed.fallback = { delete: codes[0], import: codes[1] };
    }
    input = { ...input, now: await io.read(), done: plan.stage, ...(importExit !== undefined && { importExit }) };
  }
}

// ----------------------------------------------------------------------------------------- the lab simulator

/** A Run as lab-device.ts's Exec: its stdout, or a throw naming the exit (as execFile rejects). */
const execOf =
  (run: Run): Exec =>
  async (file, args) => {
    const r = await run(file, args);
    if (r.code !== 0) throw new Error(`${file} ${args.join(' ')}: ${exitText(r)}`);
    return { stdout: r.out };
  };

/** A failed call in words: `exit n <its first line>`, or that it passed its bound. */
const exitText = (r: CallResult): string => {
  const said = firstLineOf(r.err + r.out);
  return `${r.timedOut ? `past its bound (exit ${r.code})` : `exit ${r.code}`}${said === '' ? '' : ` ${said}`}`;
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

/** plistlib → per top-level key {t: plist type, c: canonical JSON (sorted; data, dates and bool/int/float kept apart), v: a scalar's write text}. */
export const TYPED_PY = `import plistlib,json,sys,base64,datetime
def enc(v):
    if isinstance(v,bool) or v is None: return v
    if isinstance(v,(int,float,str)): return v
    if isinstance(v,(bytes,bytearray)): return {"$data":base64.b64encode(v).decode()}
    if isinstance(v,datetime.datetime): return {"$date":v.isoformat()}
    if isinstance(v,dict): return {str(k):enc(x) for k,x in v.items()}
    if isinstance(v,(list,tuple)): return [enc(x) for x in v]
    return {"$other":repr(v)}
def typ(v):
    if isinstance(v,bool): return "bool"
    if isinstance(v,int): return "int"
    if isinstance(v,float): return "float"
    if isinstance(v,str): return "string"
    if isinstance(v,(bytes,bytearray)): return "data"
    if isinstance(v,datetime.datetime): return "date"
    if isinstance(v,dict): return "dict"
    return "array"
with open(sys.argv[1],"rb") as f: d=plistlib.load(f)
if not isinstance(d,dict): sys.exit("the top level is not a dictionary")
out={}
for k,v in d.items():
    e={"t":typ(v),"c":json.dumps(enc(v),sort_keys=True)}
    if e["t"]=="bool": e["v"]="true" if v else "false"
    elif e["t"] in ("int","string"): e["v"]=str(v)
    elif e["t"]=="float": e["v"]=repr(v)
    out[str(k)]=e
print(json.dumps(out,sort_keys=True))`;

const KEY_TYPES: ReadonlySet<string> = new Set(['bool', 'int', 'float', 'string', 'data', 'date', 'dict', 'array']);

/** plistlib's answer as a typed map, or why it is none: every key a KeyVal, or the whole answer refused. */
export function typedMapOf(out: string): Record<string, KeyVal> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return 'its typed read is no JSON';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'its typed read is no map';
  for (const [k, kv] of Object.entries(parsed)) {
    const v = kv as Partial<KeyVal> | null;
    if (typeof v !== 'object' || v === null || !KEY_TYPES.has(v.t as string) || typeof v.c !== 'string' || (v.v !== undefined && typeof v.v !== 'string')) return `its typed read holds no typed value for ${nameInLine(k)}`;
  }
  return parsed as Record<string, KeyVal>;
}

/** A host plist read typed, or why not: plistlib must read it as a dictionary. */
async function typedOf(sim: LabSim, path: string): Promise<{ map: Record<string, KeyVal> } | { why: string }> {
  const r = await sim.plistlib(path);
  if (r.code !== 0) return { why: `plistlib could not read ${nameInLine(basename(path))}: ${exitText(r)}` };
  const map = typedMapOf(r.out);
  return typeof map === 'string' ? { why: `${nameInLine(basename(path))}: ${map}` } : { map };
}

/** Export a domain to `path` and read it typed: its map (null: the domain does not exist), or why not. */
async function readDomain(sim: LabSim, domain: string, path: string): Promise<{ map: DomainMap } | { why: string }> {
  const r = await sim.defaults(['export', domain, path]);
  if (r.code === 0 && sim.fs.exists(path)) return typedOf(sim, path);
  if (r.code !== 0 && !r.timedOut && /does not exist/i.test(r.err + r.out)) return { map: null };
  return { why: `defaults export ${domain}: ${r.code === 0 ? 'exit 0 but no file written' : exitText(r)}` };
}

// ---------------------------------------------------------------------------------------- the state file

/** The state file (d43-gate.ts's StateFile): which domains were backed up, each backup's path (null: absent). */
export interface DomainsState {
  dirty: boolean;
  udid: string;
  port: number;
  domains: { name: string; backup: string | null }[];
}

/** `<state dir>/<state stem>.<domain>` — d43-gate.ts#pathsOf's base, so its --restore reads the same files. */
const baseOf = (stateFile: string, domain: string) => join(dirname(stateFile), `${basename(stateFile).replace(/\.json$/, '')}.${domain}`);

/** The backup's path beside the state file (d43-gate.ts's, sim-domains.ts's). */
export const backupPathOf = (stateFile: string, domain: string): string => `${baseOf(stateFile, domain)}.backup.plist`;

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

/** The state file's text as a DomainsState, or why not. */
export function stateIn(text: string | undefined): DomainsState | string {
  if (text === undefined) return 'it cannot be read';
  let s: unknown;
  try {
    s = JSON.parse(text);
  } catch {
    return 'it is no JSON';
  }
  const st = s as Partial<DomainsState> | null;
  if (typeof st !== 'object' || st === null || typeof st.dirty !== 'boolean' || typeof st.udid !== 'string' || !Array.isArray(st.domains)) return 'it is no state of the simulator domains';
  for (const d of st.domains as unknown[]) {
    const x = d as { name?: unknown; backup?: unknown } | null;
    if (typeof x !== 'object' || x === null || typeof x.name !== 'string' || (x.backup !== null && typeof x.backup !== 'string')) return 'a domain in it has no name or backup';
    // Only the window's own domains are ever put back: a state naming another (the schemeapproval one) is refused whole.
    if (!(DOMAINS as readonly string[]).includes(x.name)) return `it names ${nameInLine(x.name)}, not one of ${DOMAINS.join(', ')}`;
  }
  return st as DomainsState;
}

// -------------------------------------------------------------------------------------------------- backup

export type Backup = { ok: true; state: DomainsState; line: string } | { ok: false; why: string };

/**
 * Before the window's first change: each domain exported beside `stateFile` and read typed (a plist plistlib cannot
 * read as a dictionary fails the backup), or recorded absent; then the state file written, dirty. A failure writes no
 * state, so nothing may be changed: the window does not run (batch-11's "no wda run (nothing changed)"). An earlier
 * state file or backup there is never overwritten: refused.
 */
export async function backup(sim: LabSim, stateFile: string): Promise<Backup> {
  if (sim.fs.exists(stateFile)) return { ok: false, why: `${nameInLine(stateFile)} is there already: a state file is never overwritten — no state written` };
  const domains: DomainsState['domains'] = [];
  for (const name of DOMAINS) {
    const path = backupPathOf(stateFile, name);
    if (sim.fs.exists(path)) return { ok: false, why: `${nameInLine(path)} is there already: a backup is never overwritten — no state written` };
    const read = await readDomain(sim, name, path);
    if ('why' in read) return { ok: false, why: `${read.why} — no state written` };
    domains.push({ name, backup: read.map === null ? null : path });
  }
  const state: DomainsState = { dirty: true, udid: sim.udid, port: LAB_WDA_PORT, domains };
  sim.fs.createExclusive(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const said = domains.map((d) => `${d.name} ${d.backup === null ? 'absent' : 'exported'}`).join(', ');
  return { ok: true, state, line: stepLine('OK', `D43 backup: ${said}; state ${nameInLine(stateFile)} (dirty until the restore verifies)`) };
}

// ------------------------------------------------------------------------------------------------- restore

/** One domain's restore, as the lines say it. */
export interface DomainRestore {
  name: string;
  backup: string | null;
  /** Equal right after the run, before anything was put back. */
  equalAfterRun?: boolean;
  performed: Performed;
  /** Its final read-back equals its backup. */
  readBackEqual: boolean;
  /** NOT VERIFIED: the keys still differing, why the restore stopped, the `defaults …` hand commands. */
  differ?: KeyDiff[];
  why?: string;
  hand?: string[];
}

export type Restored =
  | { ok: true; line: string; domains: DomainRestore[] }
  | { ok: false; line: string; domains: DomainRestore[]; why: string; hand: string[] };

/** The commands as RESTORE lines: `D43 (iOS): xcrun simctl spawn <udid> <cmd>`. */
const handLines = (prefix: string, udid: string, cmds: readonly string[]): string[] => cmds.map((c) => `${prefix}xcrun simctl spawn ${shq(udid)} ${c}`);

/** The hand commands for a domain not put back: its plan's, or by its backup (d43-gate.ts#restoreLine's rule). */
function domainHand(name: string, backupPath: string | null, planned: readonly string[] | undefined): string[] {
  if (planned !== undefined && planned.length > 0) return [...planned];
  if (backupPath === null) return [`defaults read ${name} (then defaults delete ${name} <key> for each key it holds; never the whole domain)`];
  return [`defaults import ${name} ${shq(backupPath)}`];
}

/** One domain in the restore line (d43-gate.ts#restoreLine's part, without the port: S6 owns the WDA). */
function domainPart(d: DomainRestore): string {
  const did = performedText(d.name, d.performed);
  if (d.readBackEqual) return d.equalAfterRun === true ? `${d.name} equal` : `${d.name} put back${did === '' ? '' : ` (${did})`}`;
  const keys = d.differ !== undefined && d.differ.length > 0 ? ` — keys differ: ${differText(d.differ)}` : '';
  return `${d.name} NOT equal to its backup${did === '' ? '' : ` after ${did}`}${keys}${d.why === undefined ? '' : ` (${d.why})`}`;
}

/** A restore that did nothing, and needed nothing: `<label>: OK — <why>`. */
const nothingToDo = (why: string): Restored => ({ ok: true, line: verdictLine(RESTORE_LABEL, 'OK', `nothing to do (${why})`), domains: [] });

/** A restore not verified before any domain was tried: its line, and the hand line for the state file. */
function notVerified(why: string, hand: string[]): Restored {
  return { ok: false, line: verdictLine(RESTORE_LABEL, 'ERROR', `NOT VERIFIED — ${why}`), domains: [], why, hand };
}

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
  for (const d of st.domains) domains.push(await restoreOne(sim, stateFile, d));
  const parts = domains.map(domainPart);
  const hand = domains.flatMap((d) => (d.readBackEqual ? [] : handLines(HAND_PREFIX, sim.udid, domainHand(d.name, d.backup, d.hand))));
  if (hand.length === 0) {
    try {
      fs.replace(stateFile, JSON.stringify({ ...st, dirty: false }));
    } catch (e) {
      const why = `every domain equals its backup, but ${nameInLine(stateFile)} could not be cleared (${firstLineOf(messageOf(e))})`;
      return { ok: false, line: verdictLine(RESTORE_LABEL, 'ERROR', `NOT VERIFIED — ${why}`), domains, why, hand: byHand };
    }
    const allEqual = domains.every((d) => d.equalAfterRun === true);
    return { ok: true, line: verdictLine(RESTORE_LABEL, 'OK', allEqual ? 'every domain equals its backup (nothing put back)' : parts.join(', ')), domains };
  }
  const why = parts.join(', ');
  return { ok: false, line: verdictLine(RESTORE_LABEL, 'ERROR', `NOT VERIFIED — ${why}`), domains, why, hand };
}

/** One domain: its backup and its state now read typed, then restoreDomain; any read or call that fails stops it. */
async function restoreOne(sim: LabSim, stateFile: string, d: DomainsState['domains'][number]): Promise<DomainRestore> {
  const performed = noPerformed();
  const failed = (why: string): DomainRestore => ({ name: d.name, backup: d.backup, performed, readBackEqual: false, why });
  const before = d.backup === null ? { map: null } : await typedOf(sim, d.backup);
  if ('why' in before) return failed(`its backup: ${before.why}`);
  const after = await readDomain(sim, d.name, freshPathOf(sim.fs, stateFile, d.name, 'after'));
  if ('why' in after) return failed(after.why);
  const equalAfterRun = diffMaps(before.map, after.map).length === 0;
  try {
    const r = await restoreDomain(
      { domain: d.name, backupPath: d.backup, backup: before.map, now: after.map },
      {
        run: async (args) => (await sim.defaults(args)).code,
        read: async () => {
          const again = await readDomain(sim, d.name, freshPathOf(sim.fs, stateFile, d.name, 'readback'));
          if ('why' in again) throw new Error(`its read-back: ${again.why}`);
          return again.map;
        },
      },
      performed,
    );
    if (r.equal) return { name: d.name, backup: d.backup, equalAfterRun, performed, readBackEqual: true };
    return { name: d.name, backup: d.backup, equalAfterRun, performed, readBackEqual: false, differ: r.plan.differ, ...(r.plan.why !== undefined && { why: r.plan.why }), hand: r.plan.hand };
  } catch (e) {
    return { ...failed(firstLineOf(messageOf(e))), equalAfterRun };
  }
}

// ------------------------------------------------------------------------------------------------- compare

/** A domain after the window's end against its backup: unchanged, changed (its keys), or unread (why) — never OK. */
export type Compared = { name: string; outcome: 'unchanged' } | { name: string; outcome: 'changed'; differ: KeyDiff[]; hand: string[] } | { name: string; outcome: 'unread'; why: string };

export interface Comparison {
  domains: Compared[];
  /** `OK   D43 compare: …` when every domain is unchanged; else a WARN naming each changed or unread one. */
  line: string;
  /** The late writer's RESTORE lines (LATE_HAND): none when every domain is unchanged. */
  hand: string[];
}

/**
 * After the window's end (the runner's exit can write after the restore verified): each domain the state file names
 * read again, typed, against its backup. Changed or unread, the state file is marked dirty again (the device is not
 * proven put back) and the hand lines name what to do; unread is never unchanged.
 */
export async function compare(sim: LabSim, stateFile: string): Promise<Comparison> {
  const st = stateIn(sim.fs.read(stateFile));
  if (typeof st === 'string') {
    const why = `the state file ${nameInLine(stateFile)}: ${st}`;
    return comparison(sim, stateFile, DOMAINS.map((name) => ({ name, outcome: 'unread', why })));
  }
  const domains: Compared[] = [];
  for (const d of st.domains) domains.push(await compareOne(sim, stateFile, d));
  return comparison(sim, stateFile, domains);
}

async function compareOne(sim: LabSim, stateFile: string, d: DomainsState['domains'][number]): Promise<Compared> {
  const before = d.backup === null ? { map: null } : await typedOf(sim, d.backup);
  if ('why' in before) return { name: d.name, outcome: 'unread', why: `its backup: ${before.why}` };
  const now = await readDomain(sim, d.name, freshPathOf(sim.fs, stateFile, d.name, 'compare'));
  if ('why' in now) return { name: d.name, outcome: 'unread', why: now.why };
  const plan = decideRestore({ domain: d.name, backupPath: d.backup, backup: before.map, now: now.map });
  if (plan.verdict === 'equal') return { name: d.name, outcome: 'unchanged' };
  return { name: d.name, outcome: 'changed', differ: plan.differ, hand: domainHand(d.name, d.backup, plan.hand) };
}

/** The comparison's line and hand lines; the state file marked dirty when anything is not unchanged. */
function comparison(sim: LabSim, stateFile: string, domains: Compared[]): Comparison {
  const off = domains.filter((d) => d.outcome !== 'unchanged');
  if (off.length === 0) return { domains, line: stepLine('OK', 'D43 compare: every domain equals its backup after the window (no late writer)'), hand: [] };
  const marked = markDirty(sim.fs, stateFile);
  const said = off.map((d) => (d.outcome === 'changed' ? `${d.name} changed after the restore (${differText(d.differ)})` : `${d.name} unread (${d.why})`)).join('; ');
  const hand = off.flatMap((d) =>
    d.outcome === 'changed'
      ? handLines(LATE_HAND_PREFIX, sim.udid, d.hand)
      : [`${LATE_HAND_PREFIX}${d.name} could not be compared: read it and compare it with its backup beside ${nameInLine(stateFile)} by hand`],
  );
  const state = marked === 'marked' ? 'the state file marked dirty again' : `the state file ${marked}`;
  return { domains, line: stepLine('WARN', `D43 compare: ${said} — ${state}; the hand lines are in RESTORE`), hand };
}

// ---------------------------------------------------------------------------------------- the read-only key

/** The finportal key read: its value, absent (the key or its domain not there), or unreadable — never written. */
export type ProtectedRead = { state: 'value'; value: string } | { state: 'absent' } | { state: 'unreadable'; why: string };

/** The stderr of a read of a key that is not there (batch-8, batch-9), or of a domain that is not (batch-11.sh:339). */
const ABSENT_SAID = /Could not find key|does not exist/;

/**
 * `defaults read <schemeapproval> <finportal key>` (batch-11.sh:337–340): exit 0, its value (the output's trailing
 * line breaks dropped, as `$(…)` did); exit 1 with defaults' "Could not find key" or "does not exist", absent — never
 * unreadable (batch-8's first run read an absent key as unreadable and was VOID); anything else, a timeout too,
 * unreadable, with why.
 */
export async function readProtected(sim: LabSim): Promise<ProtectedRead> {
  const r = await sim.defaults(['read', PROTECTED.domain, PROTECTED.key]);
  if (r.code === 0) return { state: 'value', value: r.out.replace(/\n+$/, '') };
  if (r.code === 1 && !r.timedOut && ABSENT_SAID.test(r.err + r.out)) return { state: 'absent' };
  return { state: 'unreadable', why: exitText(r) };
}

/** Two reads the same: both absent, or both the same value (a value that reads "absent" is no absent key). */
const sameRead = (a: ProtectedRead, b: ProtectedRead): boolean => (a.state === 'value' && b.state === 'value' ? a.value === b.value : a.state === b.state);

const shown = (p: ProtectedRead): string => (p.state === 'value' ? nameInLine(p.value) : p.state === 'absent' ? 'absent' : `unreadable (${p.why})`);

/**
 * The SUMMARY's protected-key line (batch-11.sh:584–585), from the reads at the iOS stretch's start and end:
 * `OK … unchanged` only when both were read (a value, or absent) and are the same; else an ERROR saying CHANGED or
 * unread — unread is never unchanged.
 */
export function protectedLine(start: ProtectedRead, end: ProtectedRead): string {
  const what = `${PROTECTED.domain}'s ${PROTECTED_SHORT}`;
  const bothRead = start.state !== 'unreadable' && end.state !== 'unreadable';
  if (bothRead && sameRead(start, end)) return stepLine('OK', `${what} unchanged (${shown(start)}; read only)`);
  const how = bothRead ? 'CHANGED' : 'unread';
  return stepLine('ERROR', `${what} ${how}: ${shown(start)} at the start, ${shown(end)} at the end — no batch writes it: read it by hand (batch-5's backup stays read only)`);
}

// ---------------------------------------------------------------------------------------------- the window

/**
 * The WDA window's dirty window (abort.ts): its restore this module's, over the abort's detached runner; its state
 * file, so the abort puts it back only when it reads clean after; its hand line for when it is not put back.
 */
export function domainsWindow(sim: LabSim, stateFile: string, opts: { block?: string; secs?: number } = {}): WindowSpec {
  return {
    async restore(run) {
      const r = await restore(sim.using(run), stateFile);
      return r.ok ? { ok: true, how: r.line } : { ok: false, why: r.line, hand: r.hand };
    },
    hand: [`${HAND_PREFIX}the simulator settings not provably put back: compare ${DOMAINS.join(', ')} with the .backup.plist files beside ${nameInLine(stateFile)} (xcrun simctl spawn ${shq(sim.udid)} defaults import <domain> <its backup>)`],
    stateFile,
    ...(opts.block !== undefined && { block: opts.block }),
    ...(opts.secs !== undefined && { secs: opts.secs }),
  };
}
