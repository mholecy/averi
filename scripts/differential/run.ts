import { execFileSync, spawn } from 'node:child_process';
import { existsSync, realpathSync, symlinkSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadCorpus, type Recording } from './corpus.js';
import type { CallResult, RecordingResult, ToolName } from './differential.js';

/**
 * The differential harness's command line (README.md beside this file).
 *
 *   node --import tsx scripts/differential/run.ts --old <git ref | path> [--new <path>] --corpus <dir>
 *        [--out <dir>] [--shards N] [--cap N] [--tools tap,scroll_until,…] [--only <regex on tree id>]
 *        [--worktrees <dir>] [--all]
 *
 * OLD is a code root, or a git ref checked out (detached) in a temporary
 * worktree under `--worktrees` (default the OS temp dir) with this
 * checkout's node_modules linked in, and removed afterwards. NEW defaults to
 * this checkout. The corpus is split into `--shards` processes (default the
 * CPU count) by tree; each writes its results, and this process merges them
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
 * The trees shard `i` of `n` runs: the largest first, each to the shard with the least payload so far — a tree's cost
 * grows with its size (every call reads and parses it), and a round-robin split left one shard with the big WDA trees.
 * Deterministic: the corpus is sorted by id and ties go to the lower shard.
 */
function shardOf(corpus: Recording[], i: number, n: number): Recording[] {
  const load = new Array<number>(n).fill(0);
  const mine: Recording[] = [];
  for (const r of [...corpus].sort((a, b) => b.payload.length - a.payload.length || (a.id < b.id ? -1 : 1))) {
    const k = load.indexOf(Math.min(...load));
    load[k] += r.payload.length;
    if (k === i) mine.push(r);
  }
  return mine;
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
  const [i, n] = values.shard!.split('/').map(Number);
  const oldSide = await loadSide(values.old!);
  const newSide = await loadSide(values.new!);
  const only = values.only === undefined ? undefined : new RegExp(values.only);
  const corpus = shardOf((await loadCorpus(values.corpus!)).filter((r) => only === undefined || only.test(r.id)), i, n);
  const tools = values.tools === undefined ? undefined : new Set(values.tools.split(',') as ToolName[]);
  const results: RecordingResult[] = [];
  for (const r of corpus) {
    results.push(await compareRecording(r, oldSide, newSide, { cap: values.cap === undefined ? undefined : Number(values.cap), tools, keepAll: values.all === true }));
  }
  const out: ShardOutput = { results, ms: wallNow() - t0, sleeps: virtualSleeps() };
  await writeFile(join(values.out!, `shard-${i}.json`), JSON.stringify(out));
}

// --- the parent: resolve OLD, run the shards, merge ---

function codeRoot(spec: string, worktrees: string): { root: string; cleanup?: () => void } {
  if (existsSync(join(spec, 'src/mcp/tools.ts'))) return { root: resolve(spec) };
  const sha = execFileSync('git', ['-C', REPO, 'rev-parse', '--short', `${spec}^{commit}`], { encoding: 'utf8' }).trim();
  const root = join(worktrees, `differential-old-${sha}`);
  if (!existsSync(root)) {
    execFileSync('git', ['-C', REPO, 'worktree', 'add', '--detach', root, sha], { stdio: 'ignore' });
    symlinkSync(realpathSync(join(REPO, 'node_modules')), join(root, 'node_modules'));
  }
  return { root, cleanup: () => execFileSync('git', ['-C', REPO, 'worktree', 'remove', '--force', root], { stdio: 'ignore' }) };
}

/** A reply with its numbers and quoted selector values blurred — so one change seen on many trees groups as one. */
const blur = (s: string) => s.replace(/"[^"]*"/g, '"…"').replace(/-?\d+(\.\d+)?/g, '#');

function group(diffs: CallResult[]): [string, { count: number; trees: Set<string>; example: CallResult }][] {
  const groups = new Map<string, { count: number; trees: Set<string>; example: CallResult }>();
  for (const d of diffs) {
    const what = d.old.reply === d.new.reply ? 'device calls only' : `OLD ${blur(d.old.reply).slice(0, 400)}\n   NEW ${blur(d.new.reply).slice(0, 400)}`;
    const key = `${d.call.tool} — ${what}`;
    const g = groups.get(key) ?? { count: 0, trees: new Set(), example: d };
    g.count++;
    g.trees.add(d.recording);
    groups.set(key, g);
  }
  return [...groups].sort((a, b) => b[1].count - a[1].count);
}

async function parent(): Promise<void> {
  if (values.old === undefined || values.corpus === undefined) throw new Error('usage: run.ts --old <ref|path> [--new <path>] --corpus <dir> [--out <dir>] [--shards N] …');
  const worktrees = resolve(values.worktrees ?? tmpdir());
  const out = resolve(values.out ?? join(tmpdir(), `averi-differential-${Date.now()}`));
  await mkdir(out, { recursive: true });
  const newRoot = resolve(values.new ?? REPO);
  const old = codeRoot(values.old, worktrees);
  const shards = Number(values.shards ?? availableParallelism());
  const corpus: Recording[] = await loadCorpus(resolve(values.corpus));
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
  const parsed = results.filter((r) => r.parser === 'exercised').length;
  const lines = [
    `# Differential: ${values.old} → ${values.new ?? 'this checkout'}`,
    '',
    `OLD ${old.root}  `,
    `NEW ${newRoot}  `,
    `corpus ${resolve(values.corpus)}: ${corpus.length} trees; this run ${results.length} (${parsed} raw — parser exercised; ${results.length - parsed} normalized — parser not exercised)  `,
    `${calls} calls, ${diffs.length} differing, on ${new Set(diffs.map((d) => d.recording)).size} trees  `,
    `wall ${(wall / 1000).toFixed(1)} s over ${shards} shards (slowest shard ${(Math.max(...parts.map((p) => p.ms)) / 1000).toFixed(1)} s); ${parts.reduce((a, p) => a + p.sleeps, 0)} virtual sleeps`,
    '',
    '| tool | calls (each on both sides) | diffs | ms, both sides |',
    '|---|---|---|---|',
    ...[...byTool].sort().map(([t, c]) => `| ${t} | ${c.calls} | ${c.diffs} | ${Math.round(c.ms)} |`),
    '',
    '## Trees with diffs',
    '',
    ...results.filter((r) => r.diffs.length > 0).map((r) => `- ${r.recording} (${r.parser === 'exercised' ? 'raw' : 'normalized'}): ${r.diffs.length} of ${r.calls}`),
    '',
    '## Diffs grouped (numbers and quoted values blurred)',
    '',
  ];
  for (const [key, g] of group(diffs)) {
    lines.push(`### ${g.count} × on ${g.trees.size} trees — ${key.split('\n')[0].slice(0, 200)}`, '', '```', key, '', `e.g. ${g.example.recording} [${g.example.variant}] ${JSON.stringify(g.example.call.args)}`, `   OLD ${g.example.old.reply}`, `       ${g.example.old.device.join(' | ')}`, `   NEW ${g.example.new.reply}`, `       ${g.example.new.device.join(' | ')}`, '```', '');
  }
  await writeFile(join(out, 'report.md'), lines.join('\n'));
  console.log(lines.slice(0, 7).join('\n'));
  console.log(`report: ${join(out, 'report.md')}`);
}

if (values.shard !== undefined) await shard();
else await parent();
