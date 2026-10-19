import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The differential harness's corpus (README.md beside this file, "Corpus
 * format"): what a device check read, kept as data the code under test reads
 * again. One directory per capture run, one file per tree, and a
 * `manifest.json` that says what each file is:
 *
 *   { "platform": "ios" | "android", "app"?: string, "screen"?: { width, height },
 *     "device"?: string, "note"?: string,
 *     "captures": [{ "file": string, "source": "wda" | "idb" | "uiautomator",
 *                    "form": "raw" | "normalized", "app"?, "screen"?, "note"?,
 *                    "screenshot"?: string, "truth"?: string }] }
 *
 * A RAW capture is the payload the tree source read off the device — WDA's
 * `/source?format=json` body, idb's `ui describe-all --json` array,
 * uiautomator's dump XML — and is replayed through the parser of the code
 * under test. A NORMALIZED capture is a UiNode tree as `ui_snapshot` printed
 * it (a device check that kept no raw payload): it is served as it is, and a
 * run says the parser was not exercised on it.
 *
 * The screen is the device's, in the tree's units (points on iOS, pixels on
 * Android) — what the fake device answers for `idb describe` and `wm size`;
 * a capture's own overrides its run's. A ground-truth capture (scripts/truth/capture.ts) also names the screenshot the
 * device showed and its truth file (scripts/truth/schema.ts#CellTruth), both beside it: the golden mode
 * (golden.ts) serves the one and judges by the other. The corpus itself lives outside the
 * repository (device trees of real apps); the repository's committed sample
 * is a handful of tests/fixtures trees.
 */

export type Platform = 'ios' | 'android';
export type SourceKind = 'wda' | 'idb' | 'uiautomator';
export type Form = 'raw' | 'normalized';
export interface Screen {
  width: number;
  height: number;
}

export interface CaptureEntry {
  file: string;
  source: SourceKind;
  form: Form;
  app?: string;
  screen?: Screen;
  note?: string;
  /** A PNG beside the capture: the screen the device showed when the tree was read. */
  screenshot?: string;
  /** A JSON beside the capture: what the screen is known to show (scripts/truth/schema.ts#CellTruth). */
  truth?: string;
}

export interface RunManifest {
  platform: Platform;
  app?: string;
  screen?: Screen;
  device?: string;
  note?: string;
  captures: CaptureEntry[];
}

/** One tree of the corpus, ready to replay: `id` is `<run>/<file>`, the payload the file's text. */
export interface Recording {
  id: string;
  run: string;
  file: string;
  platform: Platform;
  source: SourceKind;
  form: Form;
  app?: string;
  screen?: Screen;
  note?: string;
  payload: string;
  /** The screenshot's path, when the capture names one. */
  screenshot?: string;
  /** The truth file's path, when the capture names one. */
  truth?: string;
}

/** Which source kinds each platform's adapter reads — a capture of another kind has no reader to replay it through. */
const KINDS: Record<Platform, readonly SourceKind[]> = { ios: ['wda', 'idb'], android: ['uiautomator'] };

/**
 * Every capture of every run under `dir`, sorted by id (the report's order
 * depends on it). Strict: a directory without a manifest, an unknown
 * platform, a form other than raw or normalized, a capture file that is
 * missing, or a source kind its platform has no reader for is an error
 * naming it — a corpus that silently loses trees
 * would report fewer diffs, which reads as "no change".
 */
export async function loadCorpus(dir: string): Promise<Recording[]> {
  const out: Recording[] = [];
  for (const run of (await readdir(dir)).sort()) {
    const runDir = join(dir, run);
    if (!(await stat(runDir)).isDirectory()) continue;
    let manifest: RunManifest;
    try {
      manifest = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as RunManifest;
    } catch (e) {
      throw new Error(`corpus run ${run}: no readable manifest.json (${(e as Error).message})`, { cause: e });
    }
    if (!Object.hasOwn(KINDS, manifest.platform)) {
      throw new Error(`corpus run ${run}: platform ${JSON.stringify(manifest.platform)} is not one of ${Object.keys(KINDS).join(', ')}`);
    }
    for (const c of manifest.captures) {
      const id = `${run}/${c.file}`;
      if (c.form !== 'raw' && c.form !== 'normalized') {
        throw new Error(`corpus capture ${id}: form ${JSON.stringify(c.form)} is not raw or normalized`);
      }
      if (!KINDS[manifest.platform]?.includes(c.source)) {
        throw new Error(`corpus capture ${id}: source ${c.source} is not one the ${manifest.platform} adapter reads (${KINDS[manifest.platform]?.join(', ')})`);
      }
      let payload: string;
      try {
        payload = await readFile(join(runDir, c.file), 'utf8');
      } catch (e) {
        throw new Error(`corpus capture ${id}: ${(e as Error).message}`, { cause: e });
      }
      for (const extra of [c.screenshot, c.truth]) {
        if (extra !== undefined && !(await stat(join(runDir, extra)).catch(() => undefined))?.isFile()) {
          throw new Error(`corpus capture ${id}: ${extra} is missing`);
        }
      }
      const app = c.app ?? manifest.app;
      const screen = c.screen ?? manifest.screen;
      out.push({
        id,
        run,
        file: c.file,
        platform: manifest.platform,
        source: c.source,
        form: c.form,
        ...(app !== undefined && { app }),
        ...(screen !== undefined && { screen }),
        ...(c.note !== undefined && { note: c.note }),
        payload,
        ...(c.screenshot !== undefined && { screenshot: join(runDir, c.screenshot) }),
        ...(c.truth !== undefined && { truth: join(runDir, c.truth) }),
      });
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The report's "Runs" lines: each run this run replayed, its tree count, and what its manifest says it is (`device`,
 * `note`) — so a run whose payloads are not device captures (README.md, "Rebuilt runs are not device captures") never
 * reads as one in the header's raw count. `ids` are the replayed recordings' ids (`<run>/<file>`).
 */
export async function runLines(dir: string, ids: readonly string[]): Promise<string[]> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const run = id.slice(0, id.indexOf('/'));
    counts.set(run, (counts.get(run) ?? 0) + 1);
  }
  const lines: string[] = [];
  for (const [run, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const { device, note } = JSON.parse(await readFile(join(dir, run, 'manifest.json'), 'utf8')) as RunManifest;
    const says = [device, note].filter((s) => s !== undefined && s !== '').join(' — ');
    lines.push(`- ${run}: ${n} trees${says === '' ? '' : ` — ${says}`}`);
  }
  return lines;
}
