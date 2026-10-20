import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import type { Recording } from './corpus.js';
import { configFor, connect, type Outcome } from './differential.js';
import { expectations, formExpectations, sent, type Verb } from './golden-spec.js';
import { replyKind, type ReplyKind } from '../truth/replies.js';
import type { Side } from './side.js';
import { pct, type CellTruth, type ImeCapture } from '../truth/schema.js';
import { consistency, controlConsistency, outOfProcessKeyboard } from '../truth/truth.js';
import { hostExec, useRecognizer } from './fake-device.js';
import { ocrDecision, ocrSkip, probeHarness } from './ocr-probe.js';

/**
 * The golden mode (docs/plans/2026-10-15-ground-truth-lab-app.md): ground-truth captures (scripts/truth/capture.ts)
 * replayed through ONE side, the fake device serving the screenshot the device showed, and each verb's answer judged
 * against what the truth implies (golden-spec.ts) — not against another checkout. A mismatch is a bug found without a
 * device round; a target whose truth's sources disagree is a broken cell, reported and not judged.
 *
 *   node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth [--side <git ref | path>]
 *     [--worktrees <dir>] [--only <cell>[,<cell>…]] [--json | --against <base.json>]
 *
 * The side defaults to this checkout; an older commit's src is loaded by this checkout's harness (side.ts). `--only`
 * keeps the captures a token names (selectRecordings); `--json` prints the results as data (GoldenJson) in place of the
 * report — scripts/truth/calibrate.ts reads it; `--against` a `--json` file of an earlier run prints, in place of the
 * report, what changed since (golden-diff.ts: changed checks, the KNOWN rows to strike, the COUNTS to write). A check
 * whose reply is a harness or JavaScript error, or whose call sent a command the fake device does not model, carries it
 * as `faults` (faultsOf), in the JSON and the report. Exit code 1 on a mismatch, a broken target or a fault.
 */

export interface GoldenCheck {
  recording: string;
  target: string;
  verb: Verb;
  says: string;
  /** undefined: as the truth implies. */
  mismatch?: string;
  reply: string;
  /** What kind of reply it is (scripts/truth/replies.ts#replyKind): the ratchet pins it for a known mismatch. */
  kind: ReplyKind;
  /**
   * The taps and swipes the device was sent (golden-spec/judges.ts#sent): the ratchet pins them for a known mismatch.
   */
  calls: string[];
  /** What the row read of the reply where its first line says nothing of it (Expectation.read): absent elsewhere. */
  read?: string;
  /** What says the HARNESS failed, not the tool (`faultsOf`): absent when none. */
  faults?: string[];
  /**
   * Why the row was not asked: an `ocr` row on a host whose recognizer cannot read (ocrAvailability) — no verdict either
   * way, never a mismatch; its reply says so. Absent on every row asked.
   */
  skipped?: string;
}

/**
 * A reply that is a JavaScript error or the harness's own, not a tool's answer — the harness's errors, so read here, not
 * by scripts/truth/replies.ts (which reads averi's replies): thrown through the MCP client
 * (`THROW`), a TypeError/ReferenceError of a side loaded wrong ("this.factory is not a function"), or the fake device's
 * refusal (`differential: …`).
 */
export const HARNESS_ERROR = /^THROW |\bis not a (?:function|constructor)\b|\bCannot read properties of\b|\bis not defined\b|\bdifferential: /;

/**
 * Why a call's outcome is no evidence about the side's tool: its reply a harness error (HARNESS_ERROR), and each
 * device command the fake does not model (`UNMODELLED …`) — the tool asked something no recording answers.
 */
export function faultsOf(o: { reply: string; device: readonly string[] }): string[] {
  const line = o.reply.split('\n').find((l) => HARNESS_ERROR.test(l));
  return [...(line === undefined ? [] : [line.slice(0, 200)]), ...o.device.filter((d) => d.startsWith('UNMODELLED '))];
}

/** One golden row: the call's verdict, its reply, kind and device calls, and its faults (faultsOf) when it has any. */
export const checkOf = (recording: string, target: string, verb: Verb, says: string, mismatch: string | undefined, outcome: Outcome, read?: string): GoldenCheck => {
  const faults = faultsOf(outcome);
  return { recording, target, verb, says, ...(mismatch !== undefined && { mismatch }), reply: outcome.reply, kind: replyKind(outcome.reply), calls: sent(outcome), ...(read !== undefined && { read }), ...(faults.length > 0 && { faults }) };
};

/**
 * Whether the `ocr` rows can be judged here, once per process: undefined to ask them — the fake device then runs the
 * host's recognizer for every side (useRecognizer('vision')) — else why not. Decided by the harness's own probe
 * (ocr-probe.ts#ocrSkip, never the src under test): skipped only when the host is not macOS, has no `swiftc`, or Vision
 * answers `nilError` (a sandbox); any other failure asks the rows, so a side whose recognizer does not compile or reads
 * wrong is red, not skipped. `GOLDEN_OCR=require` makes a skip an error: the ratchet then cannot pass without them.
 */
let ocrProbe: Promise<string | undefined> | undefined;
export function ocrAvailability(): Promise<string | undefined> {
  ocrProbe ??= probeHarness(hostExec).then((o) => {
    const d = ocrDecision(ocrSkip(o), process.env);
    if (d.ask) useRecognizer('vision');
    return d.ask ? undefined : d.skip;
  });
  return ocrProbe;
}

/** An `ocr` row not asked (ocrAvailability): no call made, no mismatch, the reason in its reply. */
export const skippedCheck = (recording: string, target: string, verb: Verb, says: string, why: string): GoldenCheck => ({
  recording,
  target,
  verb,
  says,
  reply: `SKIPPED — no OCR on this host: ${why}`,
  kind: 'other',
  calls: [],
  skipped: why,
});

export interface GoldenResult {
  recording: string;
  checks: GoldenCheck[];
  /** Targets and controls whose truth's sources disagree (scripts/truth/truth.ts#consistency, #controlConsistency). */
  broken: string[];
}

export async function goldenRecording(recording: Recording, side: Side): Promise<GoldenResult> {
  if (recording.truth === undefined || recording.screenshot === undefined) throw new Error(`golden: ${recording.id} names no truth or screenshot`);
  const truth = JSON.parse(await readFile(recording.truth, 'utf8')) as CellTruth;
  const screenshot = await readFile(recording.screenshot);
  const png = PNG.sync.read(screenshot);
  const result: GoldenResult = { recording: recording.id, checks: [], broken: [] };
  // Android (uiautomator) only — what the device itself answered beside its tree, each file beside the truth: the IME's
  // answers when captured with it up (the fake then starts each call with the keyboard shown), the dump of the screen
  // after one back hid it (CellTruth.afterBack), and its system bands with the IME down (CellTruth.displays: the
  // navigation mode's own bar).
  const beside = (file: string | undefined) => (file === undefined || recording.source !== 'uiautomator' ? undefined : readFile(join(dirname(recording.truth!), file), 'utf8'));
  const imeJson = await beside(truth.ime);
  const ime = imeJson === undefined ? undefined : (JSON.parse(imeJson) as ImeCapture);
  const afterBackXml = await beside(truth.afterBack?.trees.uiautomator);
  const windowDisplays = await beside(truth.displays);
  const profile = {
    platform: recording.platform,
    screen: recording.screen ?? truth.screen,
    frame: { width: png.width, height: png.height },
    screenshot,
    ...(recording.app !== undefined && { app: recording.app }),
    ...(ime !== undefined && { ime }),
    ...(afterBackXml !== undefined && { afterBackXml }),
    ...(windowDisplays !== undefined && { windowDisplays }),
  };
  const config = await configFor(recording, undefined, truth.config);
  const c = await connect(side, recording, profile);
  try {
    for (const t of truth.targets) {
      const why = consistency(t, recording.platform, truth.screen, truth.navigation);
      if (why !== undefined) {
        result.broken.push(`${t.tag}: ${why}`);
        continue;
      }
      // A live-only row (its truth a dynamic: golden-spec/judges.ts#Expectation.live) is the live golden's, never asked
      // here.
      for (const e of expectations(recording.platform, t, truth, recording.source, recording.payload).filter((x) => x.live === undefined)) {
        const why = e.verb === 'ocr' ? await ocrAvailability() : undefined;
        if (why !== undefined) {
          result.checks.push(skippedCheck(recording.id, e.target ?? t.tag, e.verb, e.says, why));
          continue;
        }
        const outcome = await c.call(e.call, config);
        result.checks.push(checkOf(recording.id, e.target ?? t.tag, e.verb, e.says, e.judge(outcome), outcome, e.read?.(outcome)));
      }
    }
    // A form cell: its rows are judged unless a control's probe disagrees with its frame — then the cell is broken.
    const brokenControls = (truth.form?.controls ?? []).flatMap((c) => {
      const why = controlConsistency(c, outOfProcessKeyboard(recording.platform, truth.form?.keyboard?.frame, truth.form?.keyboard?.panels));
      return why === undefined ? [] : [`${c.tag}: ${why}`];
    });
    result.broken.push(...brokenControls);
    if (brokenControls.length === 0) {
      // A live-only form row (Expectation.live) is the live golden's, never asked here — as a target's.
      for (const e of formExpectations(recording.platform, truth, recording.source).filter((x) => x.live === undefined)) {
        const why = e.verb === 'ocr' ? await ocrAvailability() : undefined;
        if (why !== undefined) {
          result.checks.push(skippedCheck(recording.id, e.target, e.verb, e.says, why));
          continue;
        }
        const outcome = await c.call(e.call, config);
        result.checks.push(checkOf(recording.id, e.target, e.verb, e.says, e.judge(outcome), outcome, e.read?.(outcome)));
      }
    }
  } finally {
    await c.close();
  }
  return result;
}

/** The report: per capture, each target's verbs `ok` or `MISMATCH`, and the broken targets. */
export function goldenReport(results: readonly GoldenResult[]): string {
  const checks = results.flatMap((r) => r.checks);
  const bad = checks.filter((c) => c.mismatch !== undefined);
  const faulted = checks.filter((c) => c.faults !== undefined);
  const skipped = checks.filter((c) => c.skipped !== undefined);
  const lines = [
    `# Golden: ${checks.length} checks, ${bad.length} mismatches, ${results.reduce((a, r) => a + r.broken.length, 0)} broken targets${faulted.length > 0 ? `, ${faulted.length} with a harness fault` : ''}${skipped.length > 0 ? `, ${skipped.length} skipped (no OCR on this host: ${skipped[0].skipped})` : ''}`,
    '',
  ];
  for (const r of results) {
    lines.push(`## ${r.recording}`);
    for (const b of r.broken) lines.push(`- BROKEN ${b}`);
    for (const c of r.checks) {
      lines.push(c.skipped !== undefined ? `- skipped ${c.target} ${c.verb}: ${c.says}` : c.mismatch === undefined ? `- ok ${c.target} ${c.verb}: ${c.says}` : `- MISMATCH ${c.target} ${c.verb}: expected ${c.says} — ${c.mismatch}`);
      for (const f of c.faults ?? []) lines.push(`  - FAULT ${f}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export { pct };

/** A capture's cell: its file name up to the first dot (`form-keyboard.wda.json` → `form-keyboard`). */
export const cellOf = (r: Pick<Recording, 'file'>) => r.file.slice(0, r.file.indexOf('.') < 0 ? undefined : r.file.indexOf('.'));
/**
 * A capture's file name without its extension (`form-keyboard.wda.json` → `form-keyboard.wda`, `alert-dim.xml` →
 * `alert-dim`).
 */
const stemOf = (r: Pick<Recording, 'file'>) => r.file.replace(/\.(json|xml)$/, '');

/** `--only`'s value: comma-separated tokens, blanks dropped. */
export const parseOnly = (value: string | undefined): string[] | undefined =>
  value === undefined ? undefined : value.split(',').map((t) => t.trim()).filter((t) => t !== '');

/**
 * The captures `only` names, in corpus order (all of them when `only` is undefined). A token is a cell
 * (`form-keyboard`: every source of it), a capture without its extension (`form-keyboard.wda`) or its file name
 * (`form-keyboard.wda.json`), each optionally behind its run (`ios-iphone17-ios27/alert-dim`). Strict: a token that
 * names no capture is an error naming it — a filter that silently matches nothing would read as all green.
 */
export function selectRecordings<R extends Pick<Recording, 'run' | 'file'>>(recordings: readonly R[], only: readonly string[] | undefined): R[] {
  if (only === undefined) return [...recordings];
  const matches = (r: R, token: string) => {
    const slash = token.lastIndexOf('/');
    if (slash >= 0 && token.slice(0, slash) !== r.run) return false;
    const name = token.slice(slash + 1);
    return name === cellOf(r) || name === stemOf(r) || name === r.file;
  };
  const none = only.filter((t) => !recordings.some((r) => matches(r, t)));
  if (none.length > 0) throw new Error(`golden --only: ${none.join(', ')} names no capture of the corpus`);
  return recordings.filter((r) => only.some((t) => matches(r, t)));
}

/** `--json`'s output: the side's code root and each capture's checks and broken targets. */
export interface GoldenJson {
  side: string;
  results: GoldenResult[];
}

/** golden's exit code: 1 on a mismatch, a broken target or a fault. */
export const exitCode = (results: readonly GoldenResult[]): 0 | 1 =>
  results.some((r) => r.broken.length > 0 || r.checks.some((c) => c.mismatch !== undefined || c.faults !== undefined)) ? 1 : 0;

// --- the command line ---

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { corpus: { type: 'string' }, side: { type: 'string' }, worktrees: { type: 'string' }, only: { type: 'string' }, json: { type: 'boolean' }, against: { type: 'string' } },
  });
  if (values.corpus === undefined || (values.json === true && values.against !== undefined)) {
    throw new Error('usage: golden.ts --corpus <dir> [--side <ref|path>] [--worktrees <dir>] [--only <cell>[,<cell>…]] [--json | --against <base.json>]');
  }
  // The base is read first: a missing file, or one no `--json` run wrote, fails before any replay.
  const against = values.against;
  const base = against === undefined ? undefined : (await import('./golden-diff.js')).baseOf(await readFile(resolve(against), 'utf8'), against);
  // The checkout first: git runs before the fake device refuses every process.
  const { codeRoot } = await import('./checkout.js');
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const code = codeRoot(repo, values.side ?? repo, 'golden', resolve(values.worktrees ?? tmpdir()));
  const cleanup = code.cleanup === undefined ? undefined : (await import('node:child_process')).execFileSync.bind(null, 'git', ['-C', repo, 'worktree', 'remove', '--force', code.root], { stdio: 'ignore' });
  const { installFakeDevice } = await import('./fake-device.js');
  const { installVirtualClock } = await import('./clock.js');
  installFakeDevice();
  installVirtualClock();
  const { loadSide } = await import('./side.js');
  const { loadCorpus } = await import('./corpus.js');
  try {
    const side = await loadSide(code.root);
    const corpus = selectRecordings((await loadCorpus(resolve(values.corpus))).filter((r) => r.truth !== undefined), parseOnly(values.only));
    const results: GoldenResult[] = [];
    for (const r of corpus) results.push(await goldenRecording(r, side));
    if (against !== undefined && base !== undefined) {
      // The ratchet's files are this checkout's: the rows to strike and the counts to write are in them.
      const { KNOWN_FILES } = await import('../../tests/differential/golden/files.js');
      const { diffReport, goldenDiff } = await import('./golden-diff.js');
      console.log(diffReport(against, goldenDiff(base, results, KNOWN_FILES)));
    } else console.log(values.json === true ? JSON.stringify({ side: side.root, results } satisfies GoldenJson) : goldenReport(results));
    process.exitCode = exitCode(results);
  } finally {
    cleanup?.();
  }
}
