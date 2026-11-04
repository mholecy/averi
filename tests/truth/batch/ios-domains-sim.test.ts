import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEVICE_CHECK_SIMULATOR, DEVICE_CHECK_WDA_PORTS } from '../../../scripts/truth/lab-device.js';
import { TIMED_OUT, type Call, type CallResult, type Run } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import {
  backup,
  backupPathOf,
  compare,
  DOMAINS,
  domainsWindow,
  freshPathOf,
  LabSim,
  PLIST_SECS,
  PROTECTED,
  readProtected,
  restore,
  TYPED_PY,
  type KeyVal,
} from '../../../scripts/truth/batch/ios-domains.js';
import { stateOf } from '../../../scripts/truth/batch/run-dir.js';

// scripts/truth/batch/ios-domains.ts over a simulator: a recording fake Run stands in for xcrun simctl (its domains in
// memory, `defaults export` writing the typed map to the host file) and for python3's plistlib (the file's map, or a
// failure for one it cannot read). Real files in a temp dir, through io.ts. Every call of every test is checked for
// what b11-dry's shims flagged as a VIOLATION: device-check's simulator or WDA ports named, or `defaults write|delete|
// import|rename` on the schemeapproval domain (afterEach). No device is touched.

const LAB = 'LAB-SIMULATOR-UDID';
const A11Y = 'com.apple.Accessibility';
const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'batch');
const exported = (domain: string, phase: string): Record<string, KeyVal> => JSON.parse(readFileSync(join(FIXTURES, 'd43-b10', `${domain}.${phase}.json`), 'utf8')) as Record<string, KeyVal>;
/** batch-10's backups: the simulator's three domains before the window. */
const before = (): Record<string, Record<string, KeyVal>> => Object.fromEntries(DOMAINS.map((d) => [d, exported(d, 'backup')]));

const ok = (out = ''): CallResult => ({ code: 0, timedOut: false, signal: null, out, err: '' });
const exit = (code: number, err = ''): CallResult => ({ code, timedOut: false, signal: null, out: '', err });
const timedOut: CallResult = { code: TIMED_OUT, timedOut: true, signal: 'SIGKILL', out: '', err: '' };

/** What `defaults write -<type> <v>` stores: the typed value the export reads back. */
const typedOf = (flag: string, v: string): KeyVal => {
  if (flag === '-bool') return { t: 'bool', c: v, v };
  if (flag === '-int') return { t: 'int', c: String(Number(v)), v };
  if (flag === '-float') return { t: 'float', c: v, v };
  return { t: 'string', c: JSON.stringify(v), v };
};

let dir: string;
const violations: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-ios-domains-'));
  violations.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  expect(violations).toEqual([]);
});

type Rule = (cmd: string, args: readonly string[]) => CallResult | undefined;

/**
 * A fake lab simulator. `domains`: its settings (absent: not there); `name`: what simctl lists it as; `rules`: answers
 * tried first, in order (a refused write, a hung export); `unreadable`: host files plistlib cannot read.
 */
function fakeSim(opts: { domains?: Record<string, Record<string, KeyVal>>; name?: string; rules?: Rule[]; unreadable?: Set<string> } = {}) {
  const domains = new Map(Object.entries(structuredClone(opts.domains ?? before())));
  const calls: { cmd: string; args: readonly string[]; call: Call | undefined }[] = [];
  const unreadable = opts.unreadable ?? new Set<string>();
  const run: Run = async (cmd, args, call) => {
    calls.push({ cmd, args, call });
    const said = args.join(' ');
    if (said.toUpperCase().includes(DEVICE_CHECK_SIMULATOR)) violations.push(`device-check's simulator named: ${cmd} ${said}`);
    for (const p of DEVICE_CHECK_WDA_PORTS) if (args.some((a) => a.includes(String(p)))) violations.push(`port ${p} named: ${cmd} ${said}`);
    const verb = args[4];
    if (args[3] === 'defaults' && verb !== 'read' && said.toLowerCase().includes(PROTECTED.domain.toLowerCase())) violations.push(`schemeapproval written: ${said}`);
    for (const rule of opts.rules ?? []) {
      const r = rule(cmd, args);
      if (r !== undefined) return r;
    }
    if (cmd === 'python3') {
      const path = args[3];
      if (unreadable.has(path) || !existsSync(path)) return exit(1, 'plistlib.InvalidFileException: Invalid file');
      return ok(readFileSync(path, 'utf8'));
    }
    if (cmd !== 'xcrun' || args[0] !== 'simctl') throw new Error(`no answer for ${cmd} ${said}`);
    if (args[1] === 'list') return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: LAB, name: opts.name ?? 'averi-lab iPhone 17' }] } }));
    if (args[1] !== 'spawn' || args[2] !== LAB || args[3] !== 'defaults') throw new Error(`no answer for ${cmd} ${said}`);
    const [domain, key] = [args[5], args[6]];
    const map = domains.get(domain);
    if (verb === 'export') {
      if (map === undefined) return exit(1, `Domain ${domain} does not exist`);
      writeFileSync(args[6], JSON.stringify(map));
      return ok();
    }
    if (verb === 'write') {
      domains.set(domain, { ...map, [key]: typedOf(args[7], args[8]) });
      return ok();
    }
    if (verb === 'delete') {
      if (key === undefined) return domains.delete(domain) ? ok() : exit(1, `Domain ${domain} does not exist`);
      if (map === undefined || !Object.hasOwn(map, key)) return exit(1, readFileSync(join(FIXTURES, 'schemeapproval-absent-b9-delete.txt'), 'utf8'));
      const rest = { ...map };
      delete rest[key];
      domains.set(domain, rest);
      return ok();
    }
    if (verb === 'read') {
      const kv = map?.[key];
      return kv === undefined ? exit(1, readFileSync(join(FIXTURES, 'schemeapproval-absent-b8-read.txt'), 'utf8')) : ok(`${kv.v ?? kv.c}\n`);
    }
    if (verb === 'import') {
      // `defaults import` merges: the backup's keys set, any other key kept (hence the proven-merge fallback).
      domains.set(domain, { ...map, ...(JSON.parse(readFileSync(args[6], 'utf8')) as Record<string, KeyVal>) });
      return ok();
    }
    throw new Error(`no answer for ${cmd} ${said}`);
  };
  /** Each defaults call's words after `defaults`. */
  const defaults = () => calls.filter((c) => c.args[3] === 'defaults').map((c) => c.args.slice(4).join(' '));
  return { run, calls, domains, defaults };
}

/** The guarded lab simulator over a fake. */
async function labOf(fake: { run: Run }): Promise<LabSim> {
  const opened = await LabSim.open(LAB, fake.run);
  if (!opened.ok) throw new Error(opened.why);
  return opened.sim;
}

const stateFile = () => join(dir, 'state.json');
const readState = () => JSON.parse(readFileSync(stateFile(), 'utf8')) as { dirty: boolean; udid: string; port: number; domains: { name: string; backup: string | null }[] };

/** The window as batch-10 ran it: the backup, then the runner's exit flipping Accessibility (its `after` export). */
async function windowRun(fake: ReturnType<typeof fakeSim>): Promise<LabSim> {
  const sim = await labOf(fake);
  expect((await backup(sim, stateFile())).ok).toBe(true);
  fake.domains.set(A11Y, exported(A11Y, 'after'));
  return sim;
}

describe("LabSim.open — lab-device.ts's guard, before any defaults call (batch-11 lab_guard, b11-dry check.sh:9–10)", () => {
  it("device-check's simulator is refused before any call at all, in any case", async () => {
    for (const udid of [DEVICE_CHECK_SIMULATOR, DEVICE_CHECK_SIMULATOR.toLowerCase()]) {
      const calls: string[] = [];
      const r = await LabSim.open(udid, async (cmd, args) => (calls.push(`${cmd} ${args.join(' ')}`), ok()));
      expect(r).toEqual({ ok: false, why: `the lab guard refused ${udid} (nothing was done to it): ${udid} is the device-check simulator — the lab runs on its own (averi-lab …) only` });
      expect(calls).toEqual([]);
    }
  });

  it('a simulator not named `averi-lab …`, or one simctl does not list, is refused after `simctl list devices -j` alone', async () => {
    const fake = fakeSim({ name: 'iPhone 17 Pro' });
    expect(await LabSim.open(LAB, fake.run)).toEqual({ ok: false, why: `the lab guard refused ${LAB} (nothing was done to it): simulator ${LAB} is "iPhone 17 Pro", not the lab's (averi-lab …): refused` });
    const other = await LabSim.open('OTHER', fake.run);
    expect(other.ok === false && other.why).toBe("the lab guard refused OTHER (nothing was done to it): no simulator OTHER in simctl's list: refused");
    expect(fake.calls.map((c) => c.args.join(' '))).toEqual(['simctl list devices -j', 'simctl list devices -j']);
  });

  it("simctl list failing or past its bound refuses too, naming its exit (a Run's result read as lab-device.ts's Exec)", async () => {
    const r = await LabSim.open(LAB, async () => ({ ...timedOut, err: 'wedged\nmore' }));
    expect(r).toEqual({ ok: false, why: `the lab guard refused ${LAB} (nothing was done to it): xcrun simctl list devices -j: past its bound (exit 142) wedged` });
    const r2 = await LabSim.open(LAB, async () => exit(3));
    expect(r2.ok === false && r2.why).toBe(`the lab guard refused ${LAB} (nothing was done to it): xcrun simctl list devices -j: exit 3`);
  });

  it("the lab simulator: guarded, its description the guard's; `using` keeps it over another Run, which then gets every call", async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    expect([sim.udid, sim.description]).toEqual([LAB, 'averi-lab iPhone 17 simulator, iOS 27.0']);
    const other = fakeSim();
    const moved = sim.using(other.run);
    expect([moved.udid, moved.description]).toEqual([LAB, sim.description]);
    await readProtected(moved);
    expect(other.calls.map((c) => c.args[4])).toEqual(['read']);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("backup — the state file written dirty before the window's first change (sim-domains.ts, batch-11.sh:567–570)", () => {
  it('each domain exported beside the state file and read typed; the state {dirty: true, udid, port 8120, domains}', async () => {
    const fake = fakeSim();
    const r = await backup(await labOf(fake), stateFile());
    expect(r.ok).toBe(true);
    expect(readState()).toEqual({ dirty: true, udid: LAB, port: 8120, domains: DOMAINS.map((name) => ({ name, backup: backupPathOf(stateFile(), name) })) });
    expect(r.ok && r.state).toEqual(readState());
    expect(r.ok && r.line).toBe(`OK   D43 backup: com.apple.keyboard.preferences exported, com.apple.Preferences exported, com.apple.Accessibility exported; state ${stateFile()} (dirty until the restore verifies)`);
    expect(fake.defaults()).toEqual(DOMAINS.map((d) => `export ${d} ${backupPathOf(stateFile(), d)}`));
    expect(stateOf(nodeFs, stateFile())).toBe('dirty');
  });

  it("every call bounded: xcrun by its own bound (no secs: boundFor's 120 s), plistlib by PLIST_SECS", async () => {
    const fake = fakeSim();
    await backup(await labOf(fake), stateFile());
    expect(fake.calls.filter((c) => c.cmd === 'xcrun').every((c) => c.call === undefined)).toBe(true);
    const py = fake.calls.filter((c) => c.cmd === 'python3');
    expect(py).toHaveLength(3);
    expect(py.every((c) => c.call?.secs === PLIST_SECS && c.args[0] === '-I' && c.args[1] === '-c' && c.args[2] === TYPED_PY)).toBe(true);
  });

  it('a domain that does not exist is recorded absent (backup null), not a failure', async () => {
    const domains = before();
    delete domains['com.apple.Preferences'];
    const r = await backup(await labOf(fakeSim({ domains })), stateFile());
    expect(r.ok && r.line).toContain('com.apple.Preferences absent');
    expect(readState().domains[1]).toEqual({ name: 'com.apple.Preferences', backup: null });
  });

  it('an export that fails, passes its bound, or writes no file: no state written — so the window changes nothing', async () => {
    const cases: [Rule, string][] = [
      [(_, a) => (a[4] === 'export' && a[5] === A11Y ? exit(5, 'boom') : undefined), `defaults export ${A11Y}: exit 5 boom — no state written`],
      [(_, a) => (a[4] === 'export' ? timedOut : undefined), 'defaults export com.apple.keyboard.preferences: past its bound (exit 142) — no state written'],
      [(_, a) => (a[4] === 'export' ? { ...timedOut, err: 'Domain x does not exist' } : undefined), 'defaults export com.apple.keyboard.preferences: past its bound (exit 142) Domain x does not exist — no state written'],
      [(_, a) => (a[4] === 'export' ? ok('Domain x does not exist') : undefined), 'defaults export com.apple.keyboard.preferences: exit 0 but no file written — no state written'],
    ];
    for (const [rule, why] of cases) {
      const file = join(mkdtempSync(join(dir, 'c-')), 'state.json');
      expect(await backup(await labOf(fakeSim({ rules: [rule] })), file)).toEqual({ ok: false, why });
      expect(existsSync(file)).toBe(false);
    }
  });

  it('a backup plistlib cannot read as a dictionary fails it, never read as an empty domain (sim-domains.ts:49–53)', async () => {
    const r = await backup(await labOf(fakeSim({ unreadable: new Set([backupPathOf(stateFile(), 'com.apple.Preferences')]) })), stateFile());
    expect(r).toEqual({ ok: false, why: 'plistlib could not read state.com.apple.Preferences.backup.plist: exit 1 plistlib.InvalidFileException: Invalid file — no state written' });
    expect(existsSync(stateFile())).toBe(false);
  });

  it('a typed read that is no map fails it too (plistlib exited 0 with something else)', async () => {
    const r = await backup(await labOf(fakeSim({ rules: [(cmd) => (cmd === 'python3' ? ok('[]') : undefined)] })), stateFile());
    expect(r).toEqual({ ok: false, why: 'state.com.apple.keyboard.preferences.backup.plist: its typed read is no map — no state written' });
  });

  it('an earlier state file or backup there is never overwritten: refused before its export', async () => {
    writeFileSync(stateFile(), '{"dirty": false}');
    const fake = fakeSim();
    const sim = await labOf(fake);
    expect(await backup(sim, stateFile())).toEqual({ ok: false, why: `${stateFile()} is there already: a state file is never overwritten — no state written` });
    expect(fake.defaults()).toEqual([]);
    const other = join(dir, 'b.json');
    writeFileSync(backupPathOf(other, A11Y), 'old');
    expect(await backup(sim, other)).toEqual({ ok: false, why: `${backupPathOf(other, A11Y)} is there already: a backup is never overwritten — no state written` });
    expect(readFileSync(backupPathOf(other, A11Y), 'utf8')).toBe('old');
    expect(fake.defaults()).toEqual(['com.apple.keyboard.preferences', 'com.apple.Preferences'].map((d) => `export ${d} ${backupPathOf(other, d)}`));
    expect(existsSync(other)).toBe(false);
  });
});

describe("restore — key by key, verified, the state cleared only then (d43-gate.ts --restore; batch-10's D43 run)", () => {
  it("batch-10's run: Accessibility's three flipped keys written back typed, the others equal; the state clean", async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    const r = await restore(sim, stateFile());
    expect(r).toMatchObject({ ok: true, line: 'D43 WDA-window restore: OK — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility)' });
    expect(fake.domains.get(A11Y)).toEqual(exported(A11Y, 'readback'));
    expect(fake.defaults().filter((d) => !d.startsWith('export'))).toEqual(['AccessibilityEnabled', 'ApplicationAccessibilityEnabled', 'AutomationEnabled'].map((k) => `write ${A11Y} ${k} -bool true`));
    expect(readState()).toEqual({ dirty: false, udid: LAB, port: 8120, domains: DOMAINS.map((name) => ({ name, backup: backupPathOf(stateFile(), name) })) });
  });

  it('nothing changed by the window: every domain equal, nothing put back, the state clean', async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    await backup(sim, stateFile());
    expect((await restore(sim, stateFile())).line).toBe('D43 WDA-window restore: OK — every domain equals its backup (nothing put back)');
    expect(fake.defaults().every((d) => d.startsWith('export'))).toBe(true);
    expect(readState().dirty).toBe(false);
  });

  it('every read a fresh file beside the state, kept: a second restore after a late change reads after-2, readback-2', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    await restore(sim, stateFile());
    writeFileSync(stateFile(), JSON.stringify({ ...readState(), dirty: true }));
    fake.domains.set(A11Y, exported(A11Y, 'after'));
    expect((await restore(sim, stateFile())).ok).toBe(true);
    expect(readdirSync(dir).filter((f) => f.startsWith(`state.${A11Y}.`)).sort()).toEqual(['after-2', 'after', 'backup', 'readback-2', 'readback'].map((k) => `state.${A11Y}.${k}.plist`));
    expect(freshPathOf(nodeFs, stateFile(), A11Y, 'after')).toBe(join(dir, `state.${A11Y}.after-3.plist`));
    expect(freshPathOf(nodeFs, stateFile(), A11Y, 'compare')).toBe(join(dir, `state.${A11Y}.compare.plist`));
  });

  it('nothing to do — no call — when there is no state file (nothing backed up) or it is clean (put back already)', async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    expect(await restore(sim, stateFile())).toEqual({ ok: true, line: 'D43 WDA-window restore: OK — nothing to do (no state file: the window backed nothing up, so changed nothing)', domains: [] });
    writeFileSync(stateFile(), JSON.stringify({ dirty: false, udid: LAB, port: 8120, domains: [] }));
    expect((await restore(sim, stateFile())).line).toBe('D43 WDA-window restore: OK — nothing to do (the state file is clean)');
    expect(fake.calls).toHaveLength(1);
  });

  it('NOT VERIFIED, nothing done, for a state of another simulator or one that cannot be read; its hand line says what to compare', async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    writeFileSync(stateFile(), JSON.stringify({ dirty: true, udid: 'OTHER', port: 8120, domains: [] }));
    const other = await restore(sim, stateFile());
    expect(other).toMatchObject({ ok: false, line: `D43 WDA-window restore: ERROR — NOT VERIFIED — the state file is for OTHER, not ${LAB}` });
    expect(!other.ok && other.hand).toEqual([`D43 (iOS): compare the simulator's ${DOMAINS.join(', ')} with the .backup.plist files beside ${stateFile()}`]);
    writeFileSync(stateFile(), '{"dirty": tru');
    expect((await restore(sim, stateFile())).line).toBe(`D43 WDA-window restore: ERROR — NOT VERIFIED — the state file ${stateFile()}: it is no JSON`);
    expect(fake.calls).toHaveLength(1);
  });

  it('NOT VERIFIED when the read-back still differs (the writes refused, the import too): the state stays dirty, the hand lines typed', async () => {
    const fake = fakeSim({ rules: [(_, a) => (a[4] === 'write' || a[4] === 'import' ? exit(1, 'refused') : undefined)] });
    const sim = await windowRun(fake);
    const r = await restore(sim, stateFile());
    expect(r.ok).toBe(false);
    expect(r.line).toBe(
      'D43 WDA-window restore: ERROR — NOT VERIFIED — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility NOT equal to its backup after refused in com.apple.Accessibility: write AccessibilityEnabled (exit 1), write ApplicationAccessibilityEnabled (exit 1), write AutomationEnabled (exit 1); imported the whole backup into com.apple.Accessibility (exit 1) — keys differ: AccessibilityEnabled changed, ApplicationAccessibilityEnabled changed, AutomationEnabled changed (defaults import exited 1: the domain not cleared)',
    );
    expect(!r.ok && r.hand).toEqual(['AccessibilityEnabled', 'ApplicationAccessibilityEnabled', 'AutomationEnabled'].map((k) => `D43 (iOS): xcrun simctl spawn ${LAB} defaults write ${A11Y} ${k} -bool true`));
    expect(readState().dirty).toBe(true);
  });

  it('a read-back plistlib cannot read is NOT VERIFIED, never an empty (so "equal") domain (sim-domains.ts review round 2)', async () => {
    const fake = fakeSim({ unreadable: new Set([join(dir, `state.${A11Y}.readback.plist`)]) });
    const sim = await windowRun(fake);
    const r = await restore(sim, stateFile());
    expect(r.line).toContain(
      `com.apple.Accessibility NOT equal to its backup after wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility (its read-back: plistlib could not read state.${A11Y}.readback.plist: exit 1 plistlib.InvalidFileException: Invalid file)`,
    );
    expect(!r.ok && r.hand).toEqual([`D43 (iOS): xcrun simctl spawn ${LAB} defaults import ${A11Y} ${backupPathOf(stateFile(), A11Y)}`]);
    expect(readState().dirty).toBe(true);
  });

  it('a backup or an export that cannot be read stops that domain only; the others are still put back', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    const unread = backupPathOf(stateFile(), 'com.apple.keyboard.preferences');
    const r = await restore(
      sim.using(async (cmd, args, call) => {
        if (cmd === 'python3' && args[3] === unread) return exit(1, 'InvalidFileException');
        return args[4] === 'export' && args[5] === 'com.apple.Preferences' ? exit(5, 'Domain com.apple.Preferences is busy') : fake.run(cmd, args, call);
      }),
      stateFile(),
    );
    expect(r.line).toBe(
      'D43 WDA-window restore: ERROR — NOT VERIFIED — com.apple.keyboard.preferences NOT equal to its backup (its backup: plistlib could not read state.com.apple.keyboard.preferences.backup.plist: exit 1 InvalidFileException), com.apple.Preferences NOT equal to its backup (defaults export com.apple.Preferences: exit 5 Domain com.apple.Preferences is busy), com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility)',
    );
    expect(!r.ok && r.hand).toEqual([
      `D43 (iOS): xcrun simctl spawn ${LAB} defaults import com.apple.keyboard.preferences ${backupPathOf(stateFile(), 'com.apple.keyboard.preferences')}`,
      `D43 (iOS): xcrun simctl spawn ${LAB} defaults import com.apple.Preferences ${backupPathOf(stateFile(), 'com.apple.Preferences')}`,
    ]);
    expect(fake.domains.get(A11Y)).toEqual(exported(A11Y, 'readback'));
  });

  it("a domain absent before: the keys it gained deleted one by one, never the domain; a key already gone (batch-9's stderr) is no failure", async () => {
    const domains = before();
    delete domains['com.apple.Preferences'];
    const fake = fakeSim({ domains });
    const sim = await labOf(fake);
    await backup(sim, stateFile());
    fake.domains.set('com.apple.Preferences', { gone: { t: 'int', c: '2', v: '2' }, late: { t: 'int', c: '1', v: '1' } });
    // `gone` goes on its own just before its delete, which then says batch-9's "Could not find key … not been changed."
    const r = await restore(
      sim.using(async (cmd, args, call) => {
        if (args[4] === 'delete' && args[6] === 'gone') fake.domains.set('com.apple.Preferences', { late: { t: 'int', c: '1', v: '1' } });
        return fake.run(cmd, args, call);
      }),
      stateFile(),
    );
    expect(r.line).toBe('D43 WDA-window restore: OK — com.apple.keyboard.preferences equal, com.apple.Preferences put back (deleted late in com.apple.Preferences; refused in com.apple.Preferences: delete gone (exit 1)), com.apple.Accessibility equal');
    expect(fake.defaults().filter((d) => !d.startsWith('export'))).toEqual(['delete com.apple.Preferences gone', 'delete com.apple.Preferences late']);
    expect(fake.domains.get('com.apple.Preferences')).toEqual({});
    expect(readState().dirty).toBe(false);
  });

  it('a domain absent before that still holds a key it cannot delete: NOT VERIFIED, its hand line a key delete, never the domain', async () => {
    const domains = before();
    delete domains['com.apple.Preferences'];
    const fake = fakeSim({ domains, rules: [(_, a) => (a[4] === 'delete' ? exit(1, 'no') : undefined)] });
    const sim = await labOf(fake);
    await backup(sim, stateFile());
    fake.domains.set('com.apple.Preferences', { late: { t: 'int', c: '1', v: '1' } });
    const r = await restore(sim, stateFile());
    expect(r.line).toContain('com.apple.Preferences NOT equal to its backup after refused in com.apple.Preferences: delete late (exit 1) — keys differ: late extra (absent before the run: its keys deleted one by one, the domain itself never deleted, and it still holds keys)');
    expect(!r.ok && r.hand).toEqual([`D43 (iOS): xcrun simctl spawn ${LAB} defaults delete com.apple.Preferences late`]);
    expect(fake.defaults().filter((d) => !d.startsWith('export'))).toEqual(['delete com.apple.Preferences late']);
  });

  it('a state file naming the schemeapproval domain cannot sneak a call in: refused whole, nothing run, the state kept dirty', async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    writeFileSync(stateFile(), JSON.stringify({ dirty: true, udid: LAB, port: 8120, domains: [{ name: PROTECTED.domain, backup: join(dir, 'forged.plist') }] }));
    expect((await restore(sim, stateFile())).line).toBe(`D43 WDA-window restore: ERROR — NOT VERIFIED — the state file ${stateFile()}: it names ${PROTECTED.domain}, not one of ${DOMAINS.join(', ')}`);
    expect((await compare(sim, stateFile())).domains.every((d) => d.outcome === 'unread')).toBe(true);
    expect(fake.calls).toHaveLength(1);
  });

  it('a state file that cannot be cleared after a verified read-back (a folder there): NOT VERIFIED, the hand line kept', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    expect(sim.fs).toBe(nodeFs);
    const opened = await LabSim.open(LAB, fake.run, { ...nodeFs, replace: () => { throw new Error('EISDIR: no\nmore'); } });
    const r = await restore(opened.ok ? opened.sim : sim, stateFile());
    expect(r.line).toBe(`D43 WDA-window restore: ERROR — NOT VERIFIED — every domain equals its backup, but ${stateFile()} could not be cleared (EISDIR: no)`);
    expect(readState().dirty).toBe(true);
  });
});

describe("compare — a late writer after the restore (batch-11 review round 1: sim-domains --compare; b11-dry d43-latediff, full-pass)", () => {
  it('every domain equal after the window: OK, no hand line, the state left clean', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    await restore(sim, stateFile());
    const c = await compare(sim, stateFile());
    expect(c).toEqual({ domains: DOMAINS.map((name) => ({ name, outcome: 'unchanged' })), line: 'OK   D43 compare: every domain equals its backup after the window (no late writer)', hand: [] });
    expect(readState().dirty).toBe(false);
  });

  it('the runner flips Accessibility again after the restore: WARN, LATE_HAND lines for RESTORE, the state marked dirty again', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    await restore(sim, stateFile());
    fake.domains.set(A11Y, { ...exported(A11Y, 'backup'), AutomationEnabled: { t: 'int', c: '0', v: '0' } });
    const c = await compare(sim, stateFile());
    expect(c.line).toBe(`WARN D43 compare: ${A11Y} changed after the restore (AutomationEnabled changed) — the state file marked dirty again; the hand lines are in RESTORE`);
    expect(c.hand).toEqual([`D43 (iOS, changed after the restore — a late writer): xcrun simctl spawn ${LAB} defaults write ${A11Y} AutomationEnabled -bool true`]);
    expect(c.domains[2]).toEqual({ name: A11Y, outcome: 'changed', differ: [{ key: 'AutomationEnabled', kind: 'changed' }], hand: [`defaults write ${A11Y} AutomationEnabled -bool true`] });
    expect(readState().dirty).toBe(true);
    expect(fake.defaults().filter((d) => !d.startsWith('export'))).toEqual(['AccessibilityEnabled', 'ApplicationAccessibilityEnabled', 'AutomationEnabled'].map((k) => `write ${A11Y} ${k} -bool true`));
  });

  it('a domain whose plist plistlib cannot read is unread — never unchanged — and its hand line says to compare it by hand', async () => {
    const fake = fakeSim({ unreadable: new Set([join(dir, 'state.com.apple.Preferences.compare.plist')]) });
    const sim = await labOf(fake);
    await backup(sim, stateFile());
    await restore(sim, stateFile());
    const c = await compare(sim, stateFile());
    expect(c.domains[1]).toEqual({ name: 'com.apple.Preferences', outcome: 'unread', why: 'plistlib could not read state.com.apple.Preferences.compare.plist: exit 1 plistlib.InvalidFileException: Invalid file' });
    expect(c.line).toBe('WARN D43 compare: com.apple.Preferences unread (plistlib could not read state.com.apple.Preferences.compare.plist: exit 1 plistlib.InvalidFileException: Invalid file) — the state file marked dirty again; the hand lines are in RESTORE');
    expect(c.hand).toEqual([`D43 (iOS, changed after the restore — a late writer): com.apple.Preferences could not be compared: read it and compare it with its backup beside ${stateFile()} by hand`]);
    expect(readState().dirty).toBe(true);
  });

  it('a backup gone, an export past its bound: unread each; a domain absent before that is still absent is unchanged', async () => {
    const domains = before();
    delete domains['com.apple.Preferences'];
    const fake = fakeSim({ domains });
    const sim = await labOf(fake);
    await backup(sim, stateFile());
    rmSync(backupPathOf(stateFile(), 'com.apple.keyboard.preferences'));
    const c = await compare(sim.using(async (cmd, args, call) => (args[4] === 'export' && args[5] === A11Y ? timedOut : fake.run(cmd, args, call))), stateFile());
    expect(c.domains.map((d) => d.outcome)).toEqual(['unread', 'unchanged', 'unread']);
    expect(c.domains[2]).toEqual({ name: A11Y, outcome: 'unread', why: `defaults export ${A11Y}: past its bound (exit 142)` });
  });

  it('no state file, or one that is no state: every domain unread, the line a WARN, nothing marked (there is nothing to mark)', async () => {
    const fake = fakeSim();
    const sim = await labOf(fake);
    const c = await compare(sim, stateFile());
    expect(c.domains).toEqual(DOMAINS.map((name) => ({ name, outcome: 'unread', why: `the state file ${stateFile()}: it cannot be read` })));
    expect(c.line).toContain('— the state file missing; the hand lines are in RESTORE');
    expect(c.hand).toHaveLength(3);
    writeFileSync(stateFile(), '[]');
    expect((await compare(sim, stateFile())).line).toContain('— the state file unreadable; the hand lines are in RESTORE');
    expect(readFileSync(stateFile(), 'utf8')).toBe('[]');
    expect(fake.calls).toHaveLength(1);
  });
});

describe("readProtected — the finportal key, read only: a value, absent or unreadable (batch-11.sh:337–340; batch-8 run 1 VOID)", () => {
  const reading = (r: CallResult) => fakeSim({ rules: [(_, a) => (a[4] === 'read' ? r : undefined)] });

  it('read with `defaults read <schemeapproval> <finportal key>` and nothing else; its value, the trailing line break dropped', async () => {
    const fake = reading(ok('dev.finportal.app\n'));
    expect(await readProtected(await labOf(fake))).toEqual({ state: 'value', value: 'dev.finportal.app' });
    expect(fake.defaults()).toEqual([`read ${PROTECTED.domain} ${PROTECTED.key}`]);
    expect(PROTECTED).toEqual({ domain: 'com.apple.launchservices.schemeapproval', key: 'com.apple.CoreSimulator.CoreSimulatorBridge-->sk.finportal.myport' });
  });

  it("batch-8's stderr for a key not there — exit 1, Could not find key — is absent, never unreadable", async () => {
    const said = readFileSync(join(FIXTURES, 'schemeapproval-absent-b8-read.txt'), 'utf8');
    expect(await readProtected(await labOf(reading(exit(1, said))))).toEqual({ state: 'absent' });
  });

  it("batch-9's delete variant (the same error, then \"Defaults have not been changed.\") reads absent too; so does a domain not there", async () => {
    const said = readFileSync(join(FIXTURES, 'schemeapproval-absent-b9-delete.txt'), 'utf8');
    expect(await readProtected(await labOf(reading(exit(1, said))))).toEqual({ state: 'absent' });
    expect(await readProtected(await labOf(reading({ ...exit(1), out: `Domain ${PROTECTED.domain} does not exist` })))).toEqual({ state: 'absent' });
  });

  it('any other failure is unreadable, with why: another exit, exit 1 saying something else, or the absent words with another exit', async () => {
    expect(await readProtected(await labOf(reading(exit(1, 'Permission denied\nmore'))))).toEqual({ state: 'unreadable', why: 'exit 1 Permission denied' });
    expect(await readProtected(await labOf(reading(exit(2, 'Could not find key'))))).toEqual({ state: 'unreadable', why: 'exit 2 Could not find key' });
    expect(await readProtected(await labOf(reading(exit(127))))).toEqual({ state: 'unreadable', why: 'exit 127' });
  });

  it('past its bound (142) is unreadable, even with the absent words on stderr: a read cut short proved nothing', async () => {
    expect(await readProtected(await labOf(reading(timedOut)))).toEqual({ state: 'unreadable', why: 'past its bound (exit 142)' });
    expect(await readProtected(await labOf(reading({ ...timedOut, code: 1, err: 'Could not find key' })))).toEqual({ state: 'unreadable', why: 'past its bound (exit 1) Could not find key' });
  });
});

describe("domainsWindow — the WDA window as abort.ts's dirty window (batch-11.sh:158–164, the abort path)", () => {
  it('its restore runs over the Run the abort hands it (detached), and says how; its state file and its hand line given', async () => {
    const fake = fakeSim();
    const sim = await windowRun(fake);
    const detached = fakeSim();
    detached.domains.set(A11Y, exported(A11Y, 'after'));
    const w = domainsWindow(sim, stateFile(), { block: 'D43', secs: 300 });
    expect([w.stateFile, w.block, w.secs]).toEqual([stateFile(), 'D43', 300]);
    expect(w.hand).toEqual([`D43 (iOS): the simulator settings not provably put back: compare ${DOMAINS.join(', ')} with the .backup.plist files beside ${stateFile()} (xcrun simctl spawn ${LAB} defaults import <domain> <its backup>)`]);
    const p = await w.restore(detached.run);
    expect(p).toEqual({ ok: true, how: 'D43 WDA-window restore: OK — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility)' });
    expect(detached.defaults().length).toBeGreaterThan(0);
    expect(fake.defaults().every((d) => d.startsWith('export'))).toBe(true);
    expect(readState().dirty).toBe(false);
  });

  it('not put back: why is its line, its hand lines the typed commands; no block or secs named, none set', async () => {
    const fake = fakeSim({ rules: [(_, a) => (a[4] === 'write' || a[4] === 'import' ? exit(1) : undefined)] });
    const sim = await windowRun(fake);
    const w = domainsWindow(sim, stateFile());
    expect('block' in w || 'secs' in w).toBe(false);
    const p = await w.restore(fake.run);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.why).toMatch(/^D43 WDA-window restore: ERROR — NOT VERIFIED — /);
    expect(!p.ok && p.hand).toHaveLength(3);
  });
});
