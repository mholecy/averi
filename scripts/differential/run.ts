import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCorpus, runLines, type Recording } from './corpus.js';
import { codeRoot } from './checkout.js';
import { groupDiffs, type RecordingResult, type ToolName } from './differential.js';

/**
 * The differential harness's command line (README.md beside this file).
 *
 *   node --import tsx scripts/differential/run.ts --old <git ref | path> [--new <git ref | path>] --corpus <dir>
 *        [--out <dir>] [--shards N] [--cap N] [--tools tap,scroll_until,…] [--only <regex on tree id>]
 *        [--worktrees <dir>] [--all]
 *
 * OLD and NEW are each a code root or a git ref checked out (detached) in a
 * temporary worktree under `--worktrees` (default the OS temp dir) with
 * this checkout's node_modules linked in, and removed afterwards. NEW
 * defaults to this checkout. One checkout on both sides is refused: its
 * modules would be compared with themselves. The corpus is run by `--shards` processes (default the CPU
 * count), each taking the next unclaimed tree, costliest first; each writes its results, and this process merges them
 * into `<out>/report.md` (counts, the diffs grouped by what changed) and
 * `<out>/diffs.jsonl` (every differing call, both outcomes). `--all` also
 * writes `<out>/calls.jsonl`: every call, both outcomes.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../..');

const { values } = parseArgs({
  options: {
    old: { type: 'string' },
    new: { type: 'string' },
    corpus: { type: 'string' },
    out: { type: 'string' },
    shards: { type: 'string' },
    shard: { type: 'string' },
    cap: { type: 'string' },
    tools: { type: 'string' },
    only: { type: 'string' },
    worktrees: { type: 'string' },
    all: { type: 'boolean' },
  },
});

interface ShardOutput {
  results: RecordingResult[];
  ms: number;
  sleeps: number;
}

/**
 * The order the shards take trees in: the costliest first, so the run does not end on one shard still busy with a big
 * tree. The cost is a guess — the payload's size, an Android tree's times four (three device variants, and its frames
 * are the larger to decode) — and only the order depends on it: which shard runs a tree is decided at run time.
 */
function byCost(corpus: Recording[]): Recording[] {
  const cost = (r: Recording) => r.payload.length * (r.platform === 'android' ? 4 : 1);
  return [...corpus].sort((a, b) => cost(b) - cost(a) || (a.id < b.id ? -1 : 1));
}

/**
 * Claim a tree for this shard: `mkdir` is atomic, so of the shards that try one name exactly one succeeds. The shards
 * share no other state; a shard that finds a tree claimed moves on to the next.
 */
async function claim(out: string, k: number): Promise<boolean> {
  try {
    await mkdir(join(out, 'claims', String(k)), { recursive: false });
    return true;
  } catch {
    return false;
  }
}

// --- a shard: one process, the fake device and the virtual clock installed before either side loads ---

async function shard(): Promise<void> {
  const { installFakeDevice } = await import('./fake-device.js');
  const { installVirtualClock, virtualSleeps, wallNow } = await import('./clock.js');
  installFakeDevice();
  installVirtualClock();
  const { loadSide } = await import('./side.js');
  const { compareRecording } = await import('./differential.js');
  const t0 = wallNow();
  const [i] = values.shard!.split('/').map(Number);
  const oldSide = await loadSide(values.old!);
  const newSide = await loadSide(values.new!);
  const only = values.only === undefined ? undefined : new RegExp(values.only);
  const corpus = byCost((await loadCorpus(values.corpus!)).filter((r) => only === undefined || only.test(r.id)));
  const tools = values.tools === undefined ? undefined : new Set(values.tools.split(',') as ToolName[]);
  const results: RecordingResult[] = [];
  for (const [k, r] of corpus.entries()) {
    if (!(await claim(values.out!, k))) continue;
    results.push(await compareRecording(r, oldSide, newSide, { cap: values.cap === undefined ? undefined : Number(values.cap), tools, keepAll: values.all === true }));
  }
  const out: ShardOutput = { results, ms: wallNow() - t0, sleeps: virtualSleeps() };
  await writeFile(join(values.out!, `shard-${i}.json`), JSON.stringify(out));
}

// --- the parent: resolve OLD, run the shards, merge ---

async function parent(): Promise<void> {
  if (values.old === undefined || values.corpus === undefined) throw new Error('usage: run.ts --old <ref|path> [--new <path>] --corpus <dir> [--out <dir>] [--shards N] …');
  const worktrees = resolve(values.worktrees ?? tmpdir());
  const out = resolve(values.out ?? join(tmpdir(), `averi-differential-${Date.now()}`));
  await mkdir(out, { recursive: true });
  const old = codeRoot(REPO, values.old, 'old', worktrees);
  const neu = codeRoot(REPO, values.new ?? REPO, 'new', worktrees);
  const newRoot = neu.root;
  // One checkout on both sides shares its modules: the run would compare a module with itself, and say nothing.
  if (realpathSync(old.root) === realpathSync(newRoot)) {
    old.cleanup?.();
    neu.cleanup?.();
    throw new Error(`OLD and NEW are the same checkout (${realpathSync(newRoot)}): give one of them as a git ref or another path`);
  }
  const shards = Number(values.shards ?? availableParallelism());
  const corpus: Recording[] = await loadCorpus(resolve(values.corpus));
  await rm(join(out, 'claims'), { recursive: true, force: true });
  await mkdir(join(out, 'claims'));
  const t0 = Date.now();
  try {
    const pass = ['cap', 'tools', 'only'].flatMap((k) => (values[k as 'cap'] === undefined ? [] : [`--${k}`, values[k as 'cap']!]));
    await Promise.all(
      Array.from({ length: shards }, (_, i) =>
        new Promise<void>((done, fail) => {
          const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--shard', `${i}/${shards}`, '--old', old.root, '--new', newRoot, '--corpus', resolve(values.corpus!), '--out', out, ...pass, ...(values.all ? ['--all'] : [])], { stdio: ['ignore', 'inherit', 'inherit'] });
          child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`shard ${i}/${shards} exited ${code}`))));
        }),
      ),
    );
  } finally {
    old.cleanup?.();
    neu.cleanup?.();
  }
  const wall = Date.now() - t0;
  const parts: ShardOutput[] = [];
  for (let i = 0; i < shards; i++) parts.push(JSON.parse(await readFile(join(out, `shard-${i}.json`), 'utf8')) as ShardOutput);
  const results = parts.flatMap((p) => p.results).sort((a, b) => (a.recording < b.recording ? -1 : 1));
  const diffs = results.flatMap((r) => r.diffs);
  await writeFile(join(out, 'diffs.jsonl'), diffs.map((d) => JSON.stringify(d)).join('\n') + (diffs.length ? '\n' : ''));
  if (values.all) await writeFile(join(out, 'calls.jsonl'), results.flatMap((r) => r.all ?? []).map((d) => JSON.stringify(d)).join('\n') + '\n');

  const byTool = new Map<string, { calls: number; diffs: number; ms: number }>();
  for (const r of results) for (const [tool, c] of Object.entries(r.perTool)) {
    const t = byTool.get(tool) ?? { calls: 0, diffs: 0, ms: 0 };
    t.calls += c.calls;
    t.diffs += c.diffs;
    t.ms += c.ms;
    byTool.set(tool, t);
  }
  const calls = results.reduce((a, r) => a + r.calls, 0);
  const sleeps = parts.reduce((a, p) => a + p.sleeps, 0);
  const unmodelled = new Map<string, number>();
  for (const r of results) for (const [k, v] of Object.entries(r.unmodelled)) unmodelled.set(k, (unmodelled.get(k) ?? 0) + v);
  const warnings = [
    ...(sleeps === 0 && calls > 0 ? [`WARNING: ${calls} calls and no virtual sleep — the sleep owner (src/util/sleep.ts, clock.ts) may have moved: waits ran in real time`] : []),
    ...(unmodelled.size > 0 ? [`WARNING: ${[...unmodelled.values()].reduce((a, b) => a + b, 0)} device commands the fake does not model (below)`] : []),
  ];
  const parsed = results.filter((r) => r.parser === 'exercised').length;
  const lines = [
    `# Differential: ${values.old} → ${values.new ?? 'this checkout'}`,
    '',
    `OLD ${old.root}  `,
    `NEW ${newRoot}  `,
    `corpus ${resolve(values.corpus)}: ${corpus.length} trees; this run ${results.length} (${parsed} raw — parser exercised; ${results.length - parsed} normalized — parser not exercised)  `,
    `${calls} calls, ${diffs.length} differing, on ${new Set(diffs.map((d) => d.recording)).size} trees  `,
    `wall ${(wall / 1000).toFixed(1)} s over ${shards} shards (slowest shard ${(Math.max(...parts.map((p) => p.ms)) / 1000).toFixed(1)} s); ${sleeps} virtual sleeps`,
    ...warnings.map((w) => `${w}  `),
    '',
    '| tool | calls (each on both sides) | diffs | ms, both sides |',
    '|---|---|---|---|',
    ...[...byTool].sort().map(([t, c]) => `| ${t} | ${c.calls} | ${c.diffs} | ${Math.round(c.ms)} |`),
    '',
    '## Runs (what each manifest says it is: a rebuilt run is no device capture)',
    '',
    ...(await runLines(resolve(values.corpus), results.map((r) => r.recording))),
    '',
    '## Device commands the fake does not model',
    '',
    ...(unmodelled.size === 0 ? ['none'] : [...unmodelled].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${v} × \`${k.slice('UNMODELLED '.length)}\``)),
    '',
    '## Trees with diffs',
    '',
    ...results.filter((r) => r.diffs.length > 0).map((r) => `- ${r.recording} (${r.parser === 'exercised' ? 'raw' : 'normalized'}): ${r.diffs.length} of ${r.calls}`),
    '',
    '## Diffs grouped (numbers and quoted values blurred)',
    '',
  ];
  for (const [key, g] of groupDiffs(diffs)) {
    lines.push(`### ${g.count} × on ${g.trees.size} trees — ${key.split('\n')[0].slice(0, 200)}`, '', '```', key, '', `e.g. ${g.example.recording} [${g.example.variant}] ${JSON.stringify(g.example.call.args)}`, `   OLD ${g.example.old.reply}`, `       ${g.example.old.device.join(' | ')}`, `   NEW ${g.example.new.reply}`, `       ${g.example.new.device.join(' | ')}`, '```', '');
  }
  await writeFile(join(out, 'report.md'), lines.join('\n'));
  console.log(lines.slice(0, 7 + warnings.length).join('\n'));
  console.log(`report: ${join(out, 'report.md')}`);
}

if (values.shard !== undefined) await shard();
else await parent();
