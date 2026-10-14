import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CaptureEntry, RunManifest, Screen } from './corpus.js';
import { syntheticIdb, syntheticUiautomator, zeroRootWda } from './synthetic.js';

/**
 * Builds a corpus (corpus.ts) from what exists today:
 *
 *  - DEVICE RUNS (`--runs`, a directory of `run<N>-ios` / `run<N>-android`
 *    device-check scratch directories, read only): every `ui_snapshot` tree a
 *    device agent saved — a `#<call> (<s>)` header line, then the JSON — as a
 *    NORMALIZED capture (idb when its root is idb's flat list, else WDA);
 *    every raw WDA `/source?format=json` body (a JSON object with a `value`
 *    element) and every raw `uiautomator dump` XML as a RAW capture. Skipped,
 *    and listed in the run's manifest `note`: a filtered snapshot (a JSON
 *    array, not a tree), WDA's XML `/source` (no parser reads that format),
 *    and anything that is not a tree.
 *  - FIXTURES (`--repo`, a checkout: its tests/fixtures and tests/helpers):
 *    the raw WDA sources and captures, the raw idb element lists (whole files
 *    and the per-screen lists inside the documented ones), the normalized
 *    ui_snapshot fixtures, the uiautomator dumps of tests/helpers.
 *  - SYNTHETIC (synthetic.ts): the hand-made raw trees the scratch harness
 *    covered.
 *
 * Usage: node --import tsx scripts/differential/convert.ts --runs <dir> --repo <checkout> --out <corpus dir>
 */

const IPHONE: Screen = { width: 402, height: 874 };
const PIXEL: Screen = { width: 1080, height: 2220 };

interface Built {
  manifest: RunManifest;
  files: Record<string, string>;
}

function run(platform: 'ios' | 'android', screen: Screen, device: string): Built {
  return { manifest: { platform, screen, device, captures: [] }, files: {} };
}

function add(b: Built, file: string, body: string, entry: Omit<CaptureEntry, 'file'>): void {
  if (b.files[file] !== undefined) throw new Error(`duplicate corpus file ${file}`);
  b.files[file] = body;
  b.manifest.captures.push({ file, ...entry });
}

type Json = Record<string, unknown>;
const isTree = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Json).role === 'string';
const isWdaRaw = (v: unknown): boolean => typeof v === 'object' && v !== null && typeof ((v as Json).value as Json | undefined)?.type === 'string';

/** The app a normalized iOS tree is of: WDA's root label, or idb's Application element (its first child). */
function appOf(tree: Json): string | undefined {
  if (typeof tree.label === 'string' && tree.label.trim() !== '') return tree.label;
  const first = (tree.children as Json[] | undefined)?.[0];
  return typeof first?.label === 'string' && first.label.trim() !== '' ? first.label : undefined;
}

async function deviceRun(dir: string): Promise<Built> {
  const name = basename(dir);
  const platform = name.endsWith('-android') ? 'android' : 'ios';
  const b = run(platform, platform === 'ios' ? IPHONE : PIXEL, platform === 'ios' ? 'iPhone 17 simulator, iOS 27.0' : 'Pixel_3a AVD, Android 13 (API 33)');
  const skipped: string[] = [];
  for (const f of (await readdir(dir)).sort()) {
    if (!/\.(json|txt|xml|raw)$/.test(f)) continue;
    const text = await readFile(join(dir, f), 'utf8');
    if (/^\s*<\?xml/.test(text) || f.endsWith('.raw')) {
      if (text.includes('<hierarchy')) add(b, f, text, { source: 'uiautomator', form: 'raw' });
      else skipped.push(`${f} (WDA XML source: no parser reads that format)`);
      continue;
    }
    const start = text.search(/[[{]/);
    let value: unknown;
    try {
      value = start === -1 ? undefined : JSON.parse(text.slice(start));
    } catch {
      value = undefined;
    }
    if (isWdaRaw(value)) {
      add(b, f, text, { source: 'wda', form: 'raw', ...(typeof ((value as Json).value as Json).label === 'string' && { app: ((value as Json).value as Json).label as string }) });
    } else if (isTree(value)) {
      const app = appOf(value);
      add(b, f.replace(/\.txt$/, '.json'), JSON.stringify(value), {
        source: platform === 'android' ? 'uiautomator' : value.flatList === true ? 'idb' : 'wda',
        form: 'normalized',
        ...(platform === 'ios' && app !== undefined && { app }),
      });
    } else if (Array.isArray(value)) {
      skipped.push(`${f} (a filtered snapshot: a node list, not a tree)`);
    } else if (value !== undefined || /^#\d+/.test(text)) {
      skipped.push(`${f} (not a tree)`);
    }
  }
  if (skipped.length > 0) b.manifest.note = `skipped: ${skipped.join('; ')}`;
  return b;
}

async function fixtureRuns(repo: string): Promise<{ ios: Built; android: Built }> {
  const fx = join(repo, 'tests/fixtures');
  const j = async (f: string) => JSON.parse(await readFile(join(fx, f), 'utf8')) as Json;
  const ios = run('ios', IPHONE, 'iPhone 17 simulator, iOS 27.0 (as the fixtures say)');
  const android = run('android', PIXEL, 'Pixel_3a AVD, Android 13 (API 33)');
  for (const f of (await readdir(fx)).sort()) {
    if (/^wda-(source|capture)-.*\.json$/.test(f)) add(ios, f, await readFile(join(fx, f), 'utf8'), { source: 'wda', form: 'raw' });
  }
  add(ios, 'idb-swift-form-continue.json', await readFile(join(fx, 'idb-swift-form-continue.json'), 'utf8'), { source: 'idb', form: 'raw' });
  add(ios, 'idb-swift-form-number-pad.json', JSON.stringify((await j('idb-swift-form-number-pad.json')).elements), { source: 'idb', form: 'raw' });
  for (const [k, v] of Object.entries((await j('idb-modal-listed-before-content.json')).screens as Json)) add(ios, `idb-modal-listed-before-content.${k}.json`, JSON.stringify(v), { source: 'idb', form: 'raw' });
  for (const [k, v] of Object.entries((await j('idb-swift-form-scrolled-under-top-bar.json')).positions as Json)) add(ios, `idb-swift-form-scrolled-under-top-bar.${k}.json`, JSON.stringify(v), { source: 'idb', form: 'raw' });
  add(ios, 'idb-ui-snapshot-account-detail-error.json', JSON.stringify((await j('idb-ui-snapshot-account-detail-error.json')).screen), { source: 'idb', form: 'normalized' });
  for (const [k, v] of Object.entries((await j('ios-ui-snapshot-swift-iban-error.json')).screens as Json)) add(ios, `ios-ui-snapshot-swift-iban-error.${k}.json`, JSON.stringify(v), { source: k === 'idb' ? 'idb' : 'wda', form: 'normalized' });
  for (const [k, v] of Object.entries((await j('wda-ui-snapshot-stacked-layers.json')).screens as Json)) add(ios, `wda-ui-snapshot-stacked-layers.${k}.json`, JSON.stringify(v), { source: 'wda', form: 'normalized' });
  // Captured before AndroidAdapter marked its root `paddedTouchTargets` (it always does now) — added, as the scratch harness did.
  for (const [k, v] of Object.entries((await j('android-ui-snapshot-compose.json')).screens as Json)) {
    add(android, `android-ui-snapshot-compose.${k}.json`, JSON.stringify({ ...(v as Json), paddedTouchTargets: true }), { source: 'uiautomator', form: 'normalized', note: 'paddedTouchTargets added to the root (captured before the parser marked it)' });
  }
  const dumps = (await import(join(repo, 'tests/helpers/android-dumps.ts'))) as { COMPOSE: Record<string, string> };
  const classic = (await import(join(repo, 'tests/helpers/synthetic-android-trees.ts'))) as { CLASSIC_VIEWS: Record<string, string>; SETTINGS_ROW_SLIVER: string };
  for (const [k, xml] of Object.entries({ ...dumps.COMPOSE, ...classic.CLASSIC_VIEWS, settingsRowSliver: classic.SETTINGS_ROW_SLIVER })) add(android, `helpers.${k}.xml`, xml, { source: 'uiautomator', form: 'raw' });
  return { ios, android };
}

async function syntheticRuns(repo: string): Promise<{ ios: Built; android: Built }> {
  const fx = join(repo, 'tests/fixtures');
  const ios = run('ios', IPHONE, 'synthetic (iPhone 17 layout)');
  const android = run('android', PIXEL, 'synthetic (Pixel_3a layout)');
  ios.manifest.note = android.manifest.note = 'hand-made raw trees (synthetic.ts), the shapes the scratch harness built inline';
  const pad = (JSON.parse(await readFile(join(fx, 'idb-swift-form-number-pad.json'), 'utf8')) as { elements: Parameters<typeof syntheticIdb>[0] }).elements;
  for (const [f, body] of Object.entries(syntheticIdb(pad))) add(ios, f, body, { source: 'idb', form: 'raw' });
  add(ios, 'zero-root.wda-source-myport-login-keyboard.json', zeroRootWda(await readFile(join(fx, 'wda-source-myport-login-keyboard.json'), 'utf8')), { source: 'wda', form: 'raw' });
  for (const [f, body] of Object.entries(syntheticUiautomator())) add(android, f, body, { source: 'uiautomator', form: 'raw' });
  return { ios, android };
}

async function write(out: string, name: string, b: Built): Promise<void> {
  const dir = join(out, name);
  await mkdir(dir, { recursive: true });
  for (const [f, body] of Object.entries(b.files)) await writeFile(join(dir, f), body);
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(b.manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { runs: { type: 'string' }, repo: { type: 'string' }, out: { type: 'string' } } });
  if (values.out === undefined || (values.runs === undefined && values.repo === undefined)) {
    throw new Error('usage: convert.ts --out <corpus dir> [--runs <device runs dir>] [--repo <averi checkout>]');
  }
  const out = resolve(values.out);
  const built: [string, Built][] = [];
  if (values.runs !== undefined) {
    for (const d of (await readdir(values.runs)).filter((d) => /^run\d+-(ios|android)$/.test(d)).sort()) built.push([d, await deviceRun(join(values.runs, d))]);
  }
  if (values.repo !== undefined) {
    const repo = resolve(values.repo);
    const fx = await fixtureRuns(repo);
    const syn = await syntheticRuns(repo);
    built.push(['fixtures-ios', fx.ios], ['fixtures-android', fx.android], ['synthetic-ios', syn.ios], ['synthetic-android', syn.android]);
  }
  for (const [name, b] of built) await write(out, name, b);
  // The counts per platform, source kind and form — what the report quotes.
  const counts = new Map<string, number>();
  for (const [, b] of built) for (const c of b.manifest.captures) {
    const k = `${b.manifest.platform} ${c.source} ${c.form}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [name, b] of built) console.log(`${name}: ${b.manifest.captures.length}${b.manifest.note?.startsWith('skipped') ? ` — ${b.manifest.note}` : ''}`);
  for (const [k, v] of [...counts].sort()) console.log(`${k}: ${v}`);
  console.log(`total: ${[...counts.values()].reduce((a, b) => a + b, 0)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
