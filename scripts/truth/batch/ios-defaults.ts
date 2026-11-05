import { basename, dirname, join } from 'node:path';
import type { CallResult } from './bounded.js';
import { exitText, nameInLine, stepLine, verdictLine } from './words.js';

/**
 * The lab simulator's settings as values and words, pure (no Run, no file): what ios-domains.ts reads, decides and
 * says around the WDA window. The three domains a WebDriverAgent runner's exit changes, read typed (plistlib, per
 * top-level key its type and canonical value), so bool false is never int 0 (batch-10 measured the runner's exit flip
 * com.apple.Accessibility's keys from bool to int); d43-gate.ts's restore rule (`decideRestore`) and the one table of
 * what each restore action runs and records; the one `defaults` argv builder, an allowlist; the read-only
 * schemeapproval key and what its read means; the state file's shape; and every line a batch prints of them.
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

/** A RESTORE line's start (batch-11's `D43 (iOS): …`). */
export const HAND_PREFIX = 'D43 (iOS): ';
/** A late writer's RESTORE line's start: a domain changed after the restore had verified it. */
export const LATE_HAND_PREFIX = 'D43 (iOS, changed after the restore — a late writer): ';

/** The restore's verdict label (batch-11 copied `D43 restore:` into verdict.txt as `D43 WDA-window restore:`). */
export const RESTORE_LABEL = 'D43 WDA-window restore';
/** The compare's verdict label (batch-11's `D43 WDA-window compare:` line). */
export const COMPARE_LABEL = 'D43 WDA-window compare';
/** How much of a value a compare line shows, in code points, before `…`: the line stays short whatever a key holds. */
export const COMPARE_VALUE_CHARS = 60;

// ------------------------------------------------------------------------- a domain as its typed top-level keys

/**
 * One top-level key: its plist type `t`, its canonical JSON `c` (sorted, nested types kept), and for a scalar `v`, the
 * text a typed `defaults write` takes. The short names mirror TYPED_PY's JSON keys, which the fixtures hold too.
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

const holds = (m: DomainMap, k: string) => m !== null && Object.hasOwn(m, k);

/**
 * `want` against `got`, by key (sorted): changed (both hold it, type or value differs), missing (only want), extra
 * (only got).
 */
export function diffMaps(want: DomainMap, got: DomainMap): KeyDiff[] {
  const out: KeyDiff[] = [];
  for (const k of [...new Set([...Object.keys(want ?? {}), ...Object.keys(got ?? {})])].sort()) {
    if (!holds(got, k)) out.push({ key: k, kind: 'missing' });
    else if (!holds(want, k)) out.push({ key: k, kind: 'extra' });
    else if (want![k].t !== got![k].t || want![k].c !== got![k].c) out.push({ key: k, kind: 'changed' });
  }
  return out;
}

/** `<key> <kind>` each, as the lines name them. */
export const differText = (d: readonly KeyDiff[]): string => d.map((x) => `${x.key} ${x.kind}`).join(', ');

/**
 * plistlib → per top-level key {t: plist type, c: canonical JSON (sorted; data, dates and bool/int/float kept apart),
 * v: a scalar's write text}. A Python bool is an int: bool is asked first.
 */
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
    // Anything but an object holds no `t` from KEY_TYPES: refused by the same check.
    if (v === null || !KEY_TYPES.has(v.t as string) || typeof v.c !== 'string' || (v.v !== undefined && typeof v.v !== 'string')) return `its typed read holds no typed value for ${nameInLine(k)}`;
  }
  return parsed as Record<string, KeyVal>;
}

// ------------------------------------------------------------------------------------------- the one argv builder

/** The verbs ios-domains.ts runs `defaults` with. */
const VERBS: ReadonlySet<string> = new Set(['read', 'export', 'write', 'delete', 'import']);
/** The only domains anything but a read may name: the window's three, each by its exact name. */
const WRITTEN: ReadonlySet<string> = new Set(DOMAINS);

/**
 * The argv of `xcrun simctl spawn <udid> defaults <args>` — the only place one is built. It throws for a verb it does
 * not run (rename, an option first), and for any verb but a read whose domain is not exactly one of the window's three
 * (an allowlist: another case, a long s, a plist path, a prefix — refused alike). A read may name any domain: it is how
 * the schemeapproval key is watched. The batches no longer write that domain at all; a future need for it is a new
 * decision, not a new call.
 */
export function defaultsArgv(udid: string, args: readonly string[]): string[] {
  const verb = args[0] ?? '';
  if (!VERBS.has(verb)) throw new Error(`defaults ${JSON.stringify(verb)}: not a verb this module runs (${[...VERBS].join(', ')})`);
  const domain = args[1] ?? '';
  if (verb !== 'read' && !WRITTEN.has(domain)) {
    throw new Error(`defaults ${verb} ${JSON.stringify(domain)}: refused — only ${DOMAINS.join(', ')} are exported or written, each by its exact name; ${PROTECTED.domain} is read only`);
  }
  return ['simctl', 'spawn', udid, 'defaults', ...args];
}

/** A word as a shell reads it back: as given when plain, else single-quoted (a `'` in it as `'\''`). */
export const shellQuote = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

// ------------------------------------------------------------------------------------------------ the restore rule

const WRITE_FLAG = { bool: '-bool', int: '-int', float: '-float', string: '-string' } as const;
type WriteFlag = (typeof WRITE_FLAG)[keyof typeof WRITE_FLAG];
const flagOf = (kv: KeyVal): WriteFlag | undefined => (kv.v !== undefined && Object.hasOwn(WRITE_FLAG, kv.t) ? WRITE_FLAG[kv.t as keyof typeof WRITE_FLAG] : undefined);

export type RestoreAction = { op: 'write'; key: string; flag: WriteFlag; value: string } | { op: 'delete-key'; key: string } | { op: 'import' } | { op: 'delete-domain-then-import' };

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

/** What an action runs (its `defaults` arguments, one list per command) and how its exits are recorded. */
interface Op<A extends RestoreAction> {
  args(a: A, domain: string, backupPath: string | null): string[][];
  record(a: A, codes: readonly number[], p: Performed): void;
}
type OpOf<K extends RestoreAction['op']> = Op<Extract<RestoreAction, { op: K }>>;

/** The one table of the restore's actions: actionArgs and restoreDomain both read it. */
const OPS: { [K in RestoreAction['op']]: OpOf<K> } = {
  write: {
    args: (a, domain) => [['write', domain, a.key, a.flag, a.value]],
    record: (a, codes, p) => void (codes[0] === 0 ? p.wroteBack.push(a.key) : p.refused.push(`write ${a.key} (exit ${codes[0]})`)),
  },
  'delete-key': {
    args: (a, domain) => [['delete', domain, a.key]],
    record: (a, codes, p) => void (codes[0] === 0 ? p.deleted.push(a.key) : p.refused.push(`delete ${a.key} (exit ${codes[0]})`)),
  },
  import: {
    args: (_, domain, backupPath) => [['import', domain, backupPath!]],
    record: (_, codes, p) => void (p.import = codes[0]),
  },
  'delete-domain-then-import': {
    args: (_, domain, backupPath) => [['delete', domain], ['import', domain, backupPath!]],
    record: (_, codes, p) => void (p.fallback = { delete: codes[0], import: codes[1] }),
  },
};
const opOf = (a: RestoreAction): Op<RestoreAction> => OPS[a.op] as Op<RestoreAction>;

/** The `defaults` arguments of an action (the delete-then-import is two commands). */
export const actionArgs = (a: RestoreAction, domain: string, backupPath: string | null): string[][] => opOf(a).args(a, domain, backupPath);

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
interface PlanParts {
  actions: RestoreAction[];
  differ: KeyDiff[];
  /** The `defaults …` commands that would put it back by hand (no `xcrun simctl spawn <udid>` yet). */
  hand: string[];
}
/** Equal; or a stage to act on; or NOT VERIFIED, and why. */
export type RestorePlan = (PlanParts & { verdict: 'equal' }) | (PlanParts & { verdict: 'act'; stage: 'per-key' | 'import' | 'fallback' }) | (PlanParts & { verdict: 'NOT VERIFIED'; why: string });

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
  // One pass: each key's per-key action, if any, and its hand command. A changed or missing key is one the backup
  // holds, so the domain had a backup: `backup` and `backupPath` are set for it.
  const perKey: RestoreAction[] = [];
  const handCommands: string[] = [];
  let importNamed = false;
  for (const d of differ) {
    if (d.kind === 'extra') {
      perKey.push({ op: 'delete-key', key: d.key });
      handCommands.push(`defaults delete ${i.domain} ${shellQuote(d.key)}`);
      continue;
    }
    const kv = i.backup![d.key];
    const flag = flagOf(kv);
    if (flag !== undefined) {
      perKey.push({ op: 'write', key: d.key, flag, value: kv.v! });
      handCommands.push(`defaults write ${i.domain} ${shellQuote(d.key)} ${flag} ${shellQuote(kv.v!)}`);
    } else if (!importNamed) {
      importNamed = true;
      handCommands.push(`defaults import ${i.domain} ${shellQuote(i.backupPath!)}`);
    }
  }
  const parts = { differ, hand: handCommands };
  const stop = (why: string): RestorePlan => ({ verdict: 'NOT VERIFIED', actions: [], ...parts, why });
  if (i.done === undefined && perKey.length > 0) return { verdict: 'act', stage: 'per-key', actions: perKey, ...parts };
  if (i.done === undefined || i.done === 'per-key') {
    if (i.backupPath === null) return stop('absent before the run: its keys deleted one by one, the domain itself never deleted, and it still holds keys');
    return { verdict: 'act', stage: 'import', actions: [{ op: 'import' }], ...parts };
  }
  if (i.done === 'import') {
    if (i.importExit === 0 && differ.every((d) => d.kind === 'extra')) return { verdict: 'act', stage: 'fallback', actions: [{ op: 'delete-domain-then-import' }], ...parts };
    if (i.importExit !== 0) return stop(`defaults import exited ${i.importExit ?? '?'}: the domain not cleared`);
    return stop(`the import did not bring back ${differ.filter((d) => d.kind !== 'extra').map((d) => d.key).join(', ')}: it did not merge, so the domain not cleared`);
  }
  return stop('it still differs after defaults delete + defaults import');
}

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
    for (const a of plan.actions) {
      const codes: number[] = [];
      for (const args of actionArgs(a, input.domain, input.backupPath)) codes.push(await io.run(args));
      opOf(a).record(a, codes, performed);
    }
    // decideRestore reads the import's exit only after the import stage: the whole import's, recorded as performed.
    input = { ...input, now: await io.read(), done: plan.stage, importExit: performed.import };
  }
}

// ---------------------------------------------------------------------------------------- the state file

/** One domain the state file names: its name, and its backup's path (null: absent before the window). */
export interface DomainEntry {
  name: string;
  backup: string | null;
}

/** The state file (d43-gate.ts's StateFile): which domains were backed up, each backup's path (null: absent). */
export interface DomainsState {
  dirty: boolean;
  udid: string;
  port: number;
  domains: DomainEntry[];
}

/** `<state dir>/<state stem>.<domain>` — the base of d43-gate.ts's pathsOf, so its --restore reads the same files. */
export const baseOf = (stateFile: string, domain: string): string => join(dirname(stateFile), `${basename(stateFile).replace(/\.json$/, '')}.${domain}`);

/** The backup's path beside the state file (d43-gate.ts's, sim-domains.ts's). */
export const backupPathOf = (stateFile: string, domain: string): string => `${baseOf(stateFile, domain)}.backup.plist`;

/** The state file's text as a DomainsState, or why not. */
export function stateIn(text: string | undefined): DomainsState | string {
  if (text === undefined) return 'it cannot be read';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'it is no JSON';
  }
  const st = parsed as Partial<DomainsState> | null;
  // A primitive or an array has no boolean `dirty`: refused by the same check.
  if (st === null || typeof st.dirty !== 'boolean' || typeof st.udid !== 'string' || !Array.isArray(st.domains)) return 'it is no state of the simulator domains';
  for (const d of st.domains as unknown[]) {
    const x = d as { name?: unknown; backup?: unknown } | null;
    if (x === null || typeof x.name !== 'string' || (x.backup !== null && typeof x.backup !== 'string')) return 'a domain in it has no name or backup';
  }
  // The window's three domains, each once, or the state is refused whole: none (a restore would prove nothing), one
  // missing (it would go unchecked), twice, or another domain (the schemeapproval one, which is never written).
  const names = (st.domains as DomainEntry[]).map((d) => d.name);
  if (names.length !== DOMAINS.length || DOMAINS.some((d) => !names.includes(d))) {
    return `it names ${names.length === 0 ? 'no domain' : names.map(nameInLine).join(', ')}, not the window's ${DOMAINS.join(', ')}, each once`;
  }
  return st as DomainsState;
}

// --------------------------------------------------------------------------------------- what defaults said

/** A regex's text for `s` taken literally. */
const literal = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * defaults' words for a read of a domain that is not there, naming this domain only: `Domain '<domain>' not found.` —
 * the host's defaults (Darwin 27, seen by the T2 S4 review; no simulator stderr of it was captured: batch-13 records
 * the simulator's own).
 */
const notFoundSaid = (domain: string): RegExp => new RegExp(`\\bDomain '${literal(domain)}' not found\\.`);

/**
 * Whether a `defaults read <domain>` of a domain that exported empty says it is absent: exit 1 with that domain's
 * `not found` words, not past its bound, is absent (true); exit 0 is there and empty (false); anything else cannot
 * tell, and is why not.
 */
export function absentIn(domain: string, r: CallResult): boolean | { why: string } {
  if (r.code === 0) return false;
  if (r.code === 1 && !r.timedOut && notFoundSaid(domain).test(r.err + r.out)) return true;
  return { why: `${domain} exported empty, and defaults read ${domain} cannot tell absent from empty: ${exitText(r)}` };
}

// ---------------------------------------------------------------------------------------- the read-only key

/** The finportal key read: its value, absent (the key or its domain not there), or unreadable — never written. */
export type ProtectedRead = { state: 'value'; value: string } | { state: 'absent' } | { state: 'unreadable'; why: string };

/**
 * The stderr of a read of the protected key that is not there: batch-8's and batch-9's words (`Could not find key '…'
 * in domain '…'.`), naming this key in this domain — a not-found naming another key is unexpected, so unreadable.
 */
const ABSENT_KEY = new RegExp(`Could not find key '${literal(PROTECTED.key)}' in domain '${literal(PROTECTED.domain)}'`);

/**
 * What `defaults read <schemeapproval> <finportal key>` (batch-11.sh:337–340) gave: exit 0, its value (the output's
 * trailing line breaks dropped, as `$(…)` did); exit 1, not past its bound, with "Could not find key '<this key>' in
 * domain '<it>'" or "Domain '<it>' not found.", absent — never unreadable (batch-8's first run read an absent key as
 * unreadable and was VOID); anything else — a timeout, those words about another key or domain — unreadable, why.
 */
export function protectedReadOf(r: CallResult): ProtectedRead {
  if (r.code === 0) return { state: 'value', value: r.out.replace(/\n+$/, '') };
  const said = r.err + r.out;
  if (r.code === 1 && !r.timedOut && (ABSENT_KEY.test(said) || notFoundSaid(PROTECTED.domain).test(said))) return { state: 'absent' };
  return { state: 'unreadable', why: exitText(r) };
}

/** A read's value; none when absent (so a value that reads "absent" is still no absent key). */
const valueOf = (p: ProtectedRead): string | undefined => (p.state === 'value' ? p.value : undefined);

const shown = (p: ProtectedRead): string => (p.state === 'value' ? nameInLine(p.value) : p.state === 'absent' ? 'absent' : `unreadable (${p.why})`);

/**
 * The SUMMARY's protected-key line (batch-11.sh:584–585), from the reads at the iOS stretch's start and end:
 * `OK … unchanged` only when both were read (a value, or absent) and are the same; else an ERROR saying CHANGED or
 * unread — unread is never unchanged.
 */
export function protectedLine(start: ProtectedRead, end: ProtectedRead): string {
  const what = `${PROTECTED.domain}'s ${PROTECTED_SHORT}`;
  const bothRead = start.state !== 'unreadable' && end.state !== 'unreadable';
  if (bothRead && valueOf(start) === valueOf(end)) return stepLine('OK', `${what} unchanged (${shown(start)}; read only)`);
  const how = bothRead ? 'CHANGED' : 'unread';
  return stepLine('ERROR', `${what} ${how}: ${shown(start)} at the start, ${shown(end)} at the end — no batch writes it: read it by hand (batch-5's backup stays read only)`);
}

// ------------------------------------------------------------------------------------------------- the lines

/** The commands as RESTORE lines: `<prefix>xcrun simctl spawn <udid> <cmd>`. */
export const restoreFileLines = (prefix: string, udid: string, cmds: readonly string[]): string[] => cmds.map((c) => `${prefix}xcrun simctl spawn ${shellQuote(udid)} ${c}`);

/** The hand commands for a domain not put back: its plan's, or by its backup (d43-gate.ts's restoreLine's rule). */
export function domainHand(name: string, backupPath: string | null, planned: readonly string[]): string[] {
  if (planned.length > 0) return [...planned];
  if (backupPath === null) return [`defaults read ${name} (then defaults delete ${name} <key> for each key it holds; never the whole domain)`];
  return [`defaults import ${name} ${shellQuote(backupPath)}`];
}

/**
 * One domain's restore, as the lines say it: its read-back equal to its backup — and whether it was equal right after
 * the run already — or not, with the keys still differing (none known when a read failed), why it stopped and the
 * `defaults …` commands to finish it by hand (none planned when a read failed).
 */
export type DomainRestore = { name: string; backup: string | null; performed: Performed } & (
  | { readBackEqual: true; equalAfterRun: boolean }
  | { readBackEqual: false; differ: KeyDiff[]; why: string; hand: string[] }
);

/** One domain in the restore line (a part of d43-gate.ts's restoreLine, without the port: S6 owns the WDA). */
export function domainPart(d: DomainRestore): string {
  const did = performedText(d.name, d.performed);
  // Put back means something was done: a domain that differed after the run got at least one action.
  if (d.readBackEqual) return d.equalAfterRun ? `${d.name} equal` : `${d.name} put back (${did})`;
  const keys = d.differ.length > 0 ? ` — keys differ: ${differText(d.differ)}` : '';
  return `${d.name} NOT equal to its backup${did === '' ? '' : ` after ${did}`}${keys} (${d.why})`;
}

/** The restore's `OK — …` line. */
export const restoredLine = (why: string): string => verdictLine(RESTORE_LABEL, 'OK', why);
/** The restore's `ERROR — NOT VERIFIED — …` line. */
export const notVerifiedLine = (why: string): string => verdictLine(RESTORE_LABEL, 'ERROR', `NOT VERIFIED — ${why}`);

/**
 * A typed value as a compare line shows it: `<type> <canonical value>`, one line, cut at COMPARE_VALUE_CHARS code
 * points (never half a surrogate pair) with `…`; or `absent`.
 */
export function shownValue(kv: KeyVal | undefined): string {
  if (kv === undefined) return 'absent';
  const c = [...nameInLine(kv.c)];
  return `${kv.t} ${c.length > COMPARE_VALUE_CHARS ? `${c.slice(0, COMPARE_VALUE_CHARS).join('')}…` : c.join('')}`;
}

/** A key that differs after the window, as a compare line names it: `<key> <before> → <after>`. */
export const changeText = (key: string, before: DomainMap, now: Readonly<Record<string, KeyVal>>): string => `${nameInLine(key)} ${shownValue(before?.[key])} → ${shownValue(now[key])}`;
