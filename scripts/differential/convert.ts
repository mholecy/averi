import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CaptureEntry, RunManifest, Screen } from './corpus.js';
import { syntheticIdb, syntheticUiautomator, withHeaderId, zeroRootWda } from './synthetic.js';

/**
 * Builds a corpus (corpus.ts) from these sources:
 *
 *  - DEVICE RUNS (`--runs`, a directory of `run<N>-ios` / `run<N>-android`
 *    device-check scratch directories, read only, subdirectories included):
 *    every file classified by its content (`classify`) — raw WDA
 *    `/source?format=json`, raw idb `describe-all`, raw `uiautomator dump`,
 *    a saved `ui_snapshot` tree (normalized) — and every unfiltered
 *    `ui_snapshot` the averi server logged in `session.log` (`--- #N …
 *    CALL ui_snapshot {…}`, the tree under its `--- #N RESULT` line) as a
 *    normalized `session-<N>.json`. Everything de-duplicated by content
 *    across the runs (`DeviceRunConverter`). Skipped, and listed in the
 *    run's manifest `note` with the reason: a filtered snapshot, WDA's XML
 *    `/source`, and any file that holds no tree.
 *  - SYNTHETIC FROM DEVICE RUNS (with `--runs`): two raw WDA captures with an
 *    identifier given to their status-band header (synthetic.ts#withHeaderId).
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

export interface Built {
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
/** idb's `describe-all` element: a `type` and a frame (`frame` object or `AXFrame` string). */
const isIdbElement = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as Json).type === 'string' && ((v as Json).frame !== undefined || (v as Json).AXFrame !== undefined);
/** A ui_snapshot node: a `role` and a `rect` — what a filtered snapshot lists. */
const isUiNode = (v: unknown): boolean => typeof v === 'object' && v !== null && typeof (v as Json).role === 'string' && (v as Json).rect !== undefined;

/** The app a normalized iOS tree is of: WDA's root label, or idb's Application element (its first child). */
function appOf(tree: Json): string | undefined {
  if (typeof tree.label === 'string' && tree.label.trim() !== '') return tree.label;
  const first = (tree.children as Json[] | undefined)?.[0];
  return typeof first?.label === 'string' && first.label.trim() !== '' ? first.label : undefined;
}

/** A payload's identity for de-duplication: parsed JSON with the keys sorted, else the text itself. */
export function contentHash(body: string): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : typeof v === 'object' && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Json)[k])])) : v;
  let text = body;
  try {
    text = JSON.stringify(canon(JSON.parse(body)));
  } catch {
    // Not JSON (a uiautomator dump): the bytes are the identity.
  }
  return createHash('sha1').update(text).digest('hex');
}

/** The end of the JSON value that opens `s` (strings and escapes respected), or -1. */
function valueEnd(s: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Every unfiltered `ui_snapshot` tree a device agent's server logged, in call order: [call number, tree]. */
export function sessionTrees(log: string): [string, Json][] {
  const out: [string, Json][] = [];
  for (const m of log.matchAll(/^--- #(\d+) \S+ CALL ui_snapshot (\{.*\})$/gm)) {
    const args = JSON.parse(m[2]) as Json;
    if (typeof args.filter === 'string' && args.filter !== '') continue;
    const rest = log.slice(m.index + m[0].length);
    const result = new RegExp(`^--- #${m[1]} RESULT[^\\n]*\\n`, 'm').exec(rest);
    if (result === null) continue;
    const body = rest.slice(result.index + result[0].length).trimStart();
    if (!body.startsWith('{')) continue;
    const end = valueEnd(body);
    if (end === -1) continue;
    try {
      const tree = JSON.parse(body.slice(0, end)) as unknown;
      if (isTree(tree)) out.push([m[1], tree]);
    } catch {
      // A result that is not one JSON object (an error text that happens to open with a brace) is no tree.
    }
  }
  return out;
}

/** What a device-run file is: a capture (with the body the corpus keeps) or a reason it is not one. */
export type Classified =
  | { kind: 'capture'; source: CaptureEntry['source']; form: CaptureEntry['form']; body: string; app?: string }
  | { kind: 'skip'; reason: string };

/**
 * Classify one file of a device run by its content, not its name:
 *  - uiautomator XML (`<hierarchy`) → raw uiautomator; WDA's XML `/source` → skipped (no parser reads it);
 *  - a JSON object with a `value` element → raw WDA (`/source?format=json`);
 *  - a JSON array of idb elements (`type` + `frame`/`AXFrame`) → raw idb (`ui describe-all --json`);
 *  - a UiNode tree (after a `#<call> (<s>)` header line, if any) → normalized, idb when its root is idb's flat list;
 *  - a JSON array of UiNodes → skipped, a filtered snapshot; anything else → skipped, not a tree (`file`'s extension
 *    tells a .json that holds no tree from a text listing).
 */
export function classify(text: string, platform: 'ios' | 'android', file = ''): Classified {
  if (/^\s*(<\?xml|<hierarchy|\{\s*"value"\s*:\s*"<\?xml)/.test(text)) {
    if (text.includes('<hierarchy')) return { kind: 'capture', source: 'uiautomator', form: 'raw', body: text };
    return { kind: 'skip', reason: 'WDA XML source: no parser reads that format' };
  }
  const start = text.search(/[[{]/);
  let value: unknown;
  try {
    value = start === -1 ? undefined : JSON.parse(text.slice(start));
  } catch {
    value = undefined;
  }
  if (isWdaRaw(value)) {
    const label = ((value as Json).value as Json).label;
    return { kind: 'capture', source: 'wda', form: 'raw', body: text, ...(typeof label === 'string' && { app: label }) };
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isIdbElement)) {
    const app = (value as Json[]).find((e) => e.type === 'Application')?.AXLabel;
    return { kind: 'capture', source: 'idb', form: 'raw', body: JSON.stringify(value), ...(typeof app === 'string' && app.trim() !== '' && { app }) };
  }
  if (isTree(value)) {
    const app = appOf(value);
    return {
      kind: 'capture',
      source: platform === 'android' ? 'uiautomator' : value.flatList === true ? 'idb' : 'wda',
      form: 'normalized',
      body: JSON.stringify(value),
      ...(platform === 'ios' && app !== undefined && { app }),
    };
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isUiNode)) return { kind: 'skip', reason: 'a filtered snapshot: a node list, not a tree' };
  // A .json file that holds no tree (a tool listing behind a header line) is "not a tree"; another file holding no JSON is a listing or a log.
  return { kind: 'skip', reason: value === undefined && !file.endsWith('.json') ? 'not a tree (no JSON in it: a text listing or a log)' : 'not a tree' };
}

/**
 * The name a device-run file takes in the corpus: its path with subdirectories flattened into it (`F1poll/1.json` →
 * `F1poll.1.json`), and an extension that says what it holds.
 *  - A raw payload is `.json` (WDA, idb) or `.xml` (a uiautomator dump): a `.txt` or `.raw` takes the one of its content.
 *  - A normalized tree saved as `.json` keeps its name; saved under any other extension (`.txt`, `.raw`, `.xml`) it is
 *    `<name>.snapshot.json`. A device check saves the raw payload beside the `ui_snapshot` of the same screen under
 *    the same name (`acct2.xml` beside `acct2.txt`, `contacts-list-wda.json` beside `contacts-list-wda.txt`), so the
 *    normalized tree cannot take the raw one's extension — and a normalized Android tree is no dump and is never
 *    named `.xml`. A normalized `.json` keeps its name so the tree ids of earlier runs stay what their reports quote.
 */
export function corpusName(rel: string, c: Extract<Classified, { kind: 'capture' }>): string {
  const flat = rel.replaceAll('/', '.');
  if (c.form === 'normalized') return flat.endsWith('.json') ? flat : flat.replace(/\.(txt|raw|xml)$/, '.snapshot.json');
  return flat.replace(/\.(txt|raw)$/, c.source === 'uiautomator' ? '.xml' : '.json');
}

/** Every file under `dir`, subdirectories included, as paths relative to it, sorted. */
async function filesUnder(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of (await readdir(join(dir, prefix), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await filesUnder(dir, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Device runs into corpus runs, de-duplicated by content across all of them: a screen polled sixty times (run12's
 * F1poll) or logged in a later run's session is taken once. Files first, every run's, then the session logs — so a
 * logged tree that some run saved as a file is the file.
 */
export class DeviceRunConverter {
  private readonly seen = new Set<string>();
  /** Per run: files taken, repeats dropped, files skipped (and why), session trees logged and taken. */
  readonly counts = new Map<string, { files: number; fileRepeats: number; skipped: string[]; logged: number; loggedTaken: number }>();
  /** The distinct trees the session logs hold, saved as a file or not. */
  readonly uniqueLogged = new Set<string>();

  private take(b: Built, file: string, c: Extract<Classified, { kind: 'capture' }>, note?: string): boolean {
    const key = contentHash(c.body);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    add(b, file, c.body, { source: c.source, form: c.form, ...(c.app !== undefined && { app: c.app }), ...(note !== undefined && { note }) });
    return true;
  }

  async files(dir: string): Promise<Built> {
    const name = basename(dir);
    const platform = name.endsWith('-android') ? 'android' : 'ios';
    const b = run(platform, platform === 'ios' ? IPHONE : PIXEL, platform === 'ios' ? 'iPhone 17 simulator, iOS 27.0' : 'Pixel_3a AVD, Android 13 (API 33)');
    const count = { files: 0, fileRepeats: 0, skipped: [] as string[], logged: 0, loggedTaken: 0 };
    this.counts.set(name, count);
    for (const rel of await filesUnder(dir)) {
      if (!/\.(json|txt|xml|raw)$/.test(rel)) continue;
      const c = classify(await readFile(join(dir, rel), 'utf8'), platform, rel);
      if (c.kind === 'skip') {
        count.skipped.push(`${rel} (${c.reason})`);
        continue;
      }
      if (this.take(b, corpusName(rel, c), c, rel.includes('/') ? `from ${rel}` : undefined)) count.files++;
      else count.fileRepeats++;
    }
    if (count.skipped.length > 0) b.manifest.note = `skipped: ${count.skipped.join('; ')}`;
    return b;
  }

  async sessions(dir: string, b: Built): Promise<void> {
    const count = this.counts.get(basename(dir))!;
    let log: string;
    try {
      log = await readFile(join(dir, 'session.log'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    for (const [call, tree] of sessionTrees(log)) {
      count.logged++;
      const c = classify(JSON.stringify(tree), b.manifest.platform);
      if (c.kind !== 'capture') continue;
      this.uniqueLogged.add(contentHash(c.body));
      if (this.take(b, `session-${call}.json`, c, `session.log call #${call}`)) count.loggedTaken++;
    }
  }
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
  // The fixture's root lacks `paddedTouchTargets`, which AndroidAdapter marks on every root it reads — added, as the scratch harness did.
  for (const [k, v] of Object.entries((await j('android-ui-snapshot-compose.json')).screens as Json)) {
    add(android, `android-ui-snapshot-compose.${k}.json`, JSON.stringify({ ...(v as Json), paddedTouchTargets: true }), { source: 'uiautomator', form: 'normalized', note: "paddedTouchTargets added to the root: the fixture's root lacks it" });
  }
  // The dumps exist only as constants in the checkout's tests/helpers (no fixture file holds them), so they are imported
  // from there — the strings the tests read, not a copy that could drift from them.
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
  const devices = new DeviceRunConverter();
  if (values.runs !== undefined) {
    const runs = (await readdir(values.runs)).filter((d) => /^run\d+-(ios|android)$/.test(d)).sort();
    for (const d of runs) built.push([d, await devices.files(join(values.runs, d))]);
    for (const [d, b] of built) await devices.sessions(join(values.runs, d), b);
    const derived = run('ios', IPHONE, 'synthetic, from run14-ios raw captures');
    derived.manifest.note = 'raw WDA captures with an identifier given to the status-band header beneath a presented screen (synthetic.ts#withHeaderId)';
    for (const [f, height] of [['D-swift-fees-sheet.json', 116], ['D-finportal-forgot.json', 102]] as const) {
      const raw = await readFile(join(values.runs, 'run14-ios', f), 'utf8');
      add(derived, `header-id.${f}`, withHeaderId(raw, height, 'synthetic.status_band_header'), { source: 'wda', form: 'raw' });
    }
    built.push(['synthetic-from-runs-ios', derived]);
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
  if (values.runs !== undefined) console.log(`session.log: ${devices.uniqueLogged.size} distinct trees logged`);
  for (const [name, b] of built) {
    const c = devices.counts.get(name);
    console.log(
      `${name}: ${b.manifest.captures.length}` +
        (c === undefined ? '' : ` (files ${c.files} taken, ${c.fileRepeats} repeats; session.log ${c.loggedTaken} taken of ${c.logged} logged)`) +
        (c !== undefined && c.skipped.length > 0 ? ` — skipped: ${c.skipped.join('; ')}` : ''),
    );
  }
  for (const [k, v] of [...counts].sort()) console.log(`${k}: ${v}`);
  console.log(`total: ${[...counts.values()].reduce((a, b) => a + b, 0)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
