import type { CallResult } from './bounded.js';

/**
 * The words a device batch speaks, and its SUMMARY. Pure: strings in, strings out.
 *
 * A batch writes two kinds of line. A **step line** says how one step of the run went, its word first, padded:
 * `OK   kf analyze`, `FAIL E5 restore (exit 3) — see restore.log`. A **verdict line** says what a block found, its label
 * first: `kf live verdict: INCONCLUSIVE — the premise does not hold`. The SUMMARY gathers the run's verdict lines in a
 * fixed order between two markers; whoever waits for a batch waits for `======== SUMMARY` (unchanged since batch-1).
 *
 * The ERROR lines batch-12 collected from each block's logs and analyze.txt are the runner's to read (runner.ts, T2
 * S6a): it knows those files and hands them in with `errors`. The RESTORE block needs no `grep "run $RUN_ID"`
 * filter any more: a run refuses to start while a RESTORE file exists (run-dir.ts#refusals) and only appends to it,
 * so what it prints is what this run wrote (`restore.written`, header line included, as batch-12's `cat`).
 */

/** Step words: OK done; DONE ended with a judged exit 1 (steps.ts#stepWordOf); FAIL; WARN; NOTE; SKIP; ERROR. */
export const STEP_WORDS = ['OK', 'DONE', 'FAIL', 'WARN', 'NOTE', 'SKIP', 'ERROR'] as const;
export type StepWord = (typeof STEP_WORDS)[number];

/**
 * Verdict words. A block or one of its parts: PASS, FAIL, INCONCLUSIVE (its precondition not shown, or too few runs
 * judged — never a number from a run that could not set its state up), REPRODUCED (a control side shows the bug the
 * fix removes), OBSERVED (a fact recorded, nothing judged), SKIP (not run, by a knob or a premise). INTERRUPTED: a
 * block the abort SUMMARY could not judge. OK, WARN and ERROR: a cleanup or check line (`E5 cleanup: OK — …`,
 * batch-11's `D43 WDA-window compare: WARN — …`), the lab lines. WARN alone never fails the run (exitCodeOf).
 */
export const VERDICTS = ['PASS', 'FAIL', 'INCONCLUSIVE', 'REPRODUCED', 'OBSERVED', 'SKIP', 'INTERRUPTED', 'OK', 'WARN', 'ERROR'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The SUMMARY's opening marker. Its end marker starts with it too: `======== SUMMARY end (run <id>)`. */
export const SUMMARY_MARKER = '======== SUMMARY';

/**
 * A batch's exit codes: 1 a FAIL or a RESTORE; 2 nothing done — either refused to start (no SUMMARY), or no wanted
 * block ran (a failed checkout, every need or precondition failed: the SUMMARY, with NONE_RAN_LINE after each block's
 * why); 130 interrupted (the abort SUMMARY printed).
 */
export const EXIT = { ok: 0, failed: 1, nothingDone: 2, interrupted: 130 } as const;

const LINE_BREAK = /[\n\r]/;

/** `line`, or a throw when it holds a line break: the SUMMARY and steps.log are read line by line. */
export function oneLine(line: string, what = 'a line'): string {
  if (LINE_BREAK.test(line)) throw new Error(`${what} holds a line break: ${JSON.stringify(line)}`);
  return line;
}

/** A step line: the word padded to four, then the text (`OK   x`, `DONE x`, `ERROR x`). */
export const stepLine = (word: StepWord, text: string): string => `${word.padEnd(4)} ${text}`;

/** What every refusal line ends with: the batch exits 2 (EXIT.nothingDone) and has done nothing. */
export const NOTHING_DONE = ' — nothing was done';

/** A refusal: `ERROR <text> — nothing was done`. */
export const refusedLine = (text: string): string => `${stepLine('ERROR', text)}${NOTHING_DONE}`;

/** A number as two digits (`09`): the step times and the RUN_ID. */
export const twoDigits = (n: number): string => String(n).padStart(2, '0');

/** A time of day as the batch writes it: `HH:MM:SS`, local (the step lines, the INTERRUPTED line, RESTORE's header). */
export const timeOf = (d: Date): string => `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`;

/**
 * A name (a path, a case id, a source) as a line may hold it: as given, or JSON-quoted (`"a\nb"`, `""`) when it holds a
 * line break or is empty — as this module's own errors quote a value — so a why naming it never breaks its line, never
 * throws, and never names nothing unseen.
 */
export const nameInLine = (name: string): string => (name === '' || LINE_BREAK.test(name) ? JSON.stringify(name) : name);

/** A tool's or an error's first line, trimmed: up to the first \n or \r, so what a why quotes of it is one line. */
export const firstLineOf = (text: string): string => text.split(LINE_BREAK, 1)[0].trim();

/** What a thrown value says: an Error's message, anything else as a string. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether a call failed: any exit but 0, or past its bound (one predicate for every reader of a CallResult). */
export const failedCall = (r: CallResult): boolean => r.code !== 0 || r.timedOut;

/**
 * A failed call in words: `exit n <its first line>`, or that it passed its bound — stderr's first line before stdout's
 * (ios-defaults.ts's, shared from here since T2 S5).
 */
export const exitText = (r: CallResult): string => {
  const said = firstLineOf(r.err + r.out);
  return `${r.timedOut ? `past its bound (exit ${r.code})` : `exit ${r.code}`}${said === '' ? '' : ` ${said}`}`;
};

/**
 * A verdict line, `<label>: <VERDICT>` and ` — <why>` when a reason is given. The label must not hold a colon: the
 * exit rule and parseVerdictLine read the label up to the first one.
 */
export function verdictLine(label: string, verdict: Verdict, why?: string): string {
  if (label === '') throw new Error('a verdict label "" is empty');
  if (/[:\n\r]/.test(label)) throw new Error(`a verdict label ${JSON.stringify(label)} holds a colon or a line break`);
  if (!(VERDICTS as readonly string[]).includes(verdict)) throw new Error(`${JSON.stringify(verdict)} is not a verdict word (${VERDICTS.join(', ')})`);
  const tail = why === undefined ? '' : ` — ${oneLine(why, `the reason of ${JSON.stringify(label)}`)}`;
  return `${label}: ${verdict}${tail}`;
}

const VERDICT_LINE = new RegExp(`^([^:\\n]+): (${VERDICTS.join('|')})(?: — (.*))?$`);

/** A verdict line's parts, or undefined when the line is none (another word, no label, a word run on). */
export function parseVerdictLine(line: string): { label: string; verdict: Verdict; why: string | undefined } | undefined {
  const m = VERDICT_LINE.exec(line);
  return m === null ? undefined : { label: m[1], verdict: m[2] as Verdict, why: m[3] };
}

/**
 * Whether a SUMMARY line says FAIL: batch-12's exit rule, `^[^:]+: FAIL( |$)` — FAIL right after the first colon,
 * whatever follows it (`lv-d62 verdict: FAIL 2/3 dropped` too, which parseVerdictLine, strict for the lines this module
 * writes, reads as none) — or a step line whose word is FAIL.
 */
export const failsIn = (line: string): boolean => /^(?:[^:]+: )?FAIL(?: |$)/.test(line);

/** One block's lines for the SUMMARY: its verdict lines, or — `interrupted` — the lines it wrote before the interrupt. */
export interface BlockReport {
  block: string;
  lines: readonly string[];
  interrupted?: boolean;
  /** Why an interrupted block was not judged, when not for its records (abort.ts: the judging budget spent). */
  why?: string;
}

/** Everything the SUMMARY says, in the order it says it. */
export interface Summary {
  name: string;
  runId: string;
  /** The checkout line (`OK checkout: main's HEAD …`). */
  checkout: string;
  /** The lab lines (`LAB android: OK — …`). */
  labs: readonly string[];
  /** Each wanted block, in the batch's order. */
  blocks: readonly BlockReport[];
  /** The read-only keys' lines (the schemeapproval key: unchanged or not). */
  protectedLines: readonly string[];
  /** The RESTORE file and the lines this run wrote into it (run-dir.ts#writeRestore; none: everything put back). */
  restore: { file: string; written: readonly string[] };
  /** This run's ERROR lines (steps.ts#StepLog.errors). */
  errors: readonly string[];
  /** Set when the run was interrupted: the time of the interrupt (HH:MM:SS). */
  interrupted?: { at: string };
  /** No wanted block ran (runner.ts, T2 S6a review round 1): the exit is 2, never success. */
  noneRan?: boolean;
}

/**
 * A block the abort SUMMARY did not judge: its lines so far, marked, then INTERRUPTED and how to rerun it. Its
 * records not complete, or — `why` — not judged for another reason (the abort's judging budget spent).
 */
export const interruptedBlock = (block: string, linesSoFar: readonly string[], why?: string): string[] => [
  ...linesSoFar.map((l) => `(before the interrupt) ${l}`),
  verdictLine(block, 'INTERRUPTED', why === undefined ? `its records are not complete, not judged (rerun ONLY=${block})` : `not judged (${why}; rerun ONLY=${block})`),
];

/**
 * The SUMMARY's line, after the blocks', whenever no wanted block ran (T2 S6a review rounds 2, 3): it names no exit
 * code, which is exitCodeOf's — 2, or 1 when a RESTORE was written.
 */
export const NONE_RAN_LINE = "NOTE no wanted block ran (each one's why above)";

/** The SUMMARY's body, before deduplication. */
function bodyOf(s: Summary): string[] {
  return [
    s.checkout,
    ...(s.interrupted === undefined ? [] : [`INTERRUPTED: ${s.name} run ${s.runId} was interrupted at ${s.interrupted.at}`]),
    ...s.labs,
    ...s.blocks.flatMap((b) => (b.interrupted === true ? interruptedBlock(b.block, b.lines, b.why) : b.lines)),
    ...(s.noneRan === true ? [NONE_RAN_LINE] : []),
    ...s.protectedLines,
    ...(s.restore.written.length === 0 ? ['RESTORE: none — everything dirty was put back and verified'] : [`RESTORE: state not provably put back — ${s.restore.file}:`, ...s.restore.written]),
    ...s.errors,
  ].map((l) => oneLine(l, 'a SUMMARY line'));
}

/**
 * The SUMMARY: the marker; the checkout line; INTERRUPTED when it was; the lab lines; each block's verdict lines; the
 * protected-key lines; RESTORE (none, or its file and what this run wrote into it); this run's ERRORs; the end marker. Each body line
 * once (batch-6's deduplication: an ERROR noted twice prints once).
 */
export function summaryLines(s: Summary): string[] {
  const end = `${SUMMARY_MARKER} end (run ${s.runId}${s.interrupted === undefined ? '' : ', INTERRUPTED'})`;
  return [SUMMARY_MARKER, ...new Set(bodyOf(s)), end];
}

/**
 * The run's exit code: 130 when interrupted, whatever else; 1 when any SUMMARY line but an ERROR line says FAIL or this
 * run wrote a RESTORE; 2 when no wanted block ran ("nothing was done": an agent reading only the exit code must not see
 * success); else 0. (Refused to start: EXIT.nothingDone too, with no SUMMARY.) An ERROR line, an INCONCLUSIVE or a SKIP
 * alone exits 0 when a block ran: the SUMMARY says it, the exit code is for a FAIL or for state left on a device.
 */
export function exitCodeOf(s: Summary): 0 | 1 | 2 | 130 {
  if (s.interrupted !== undefined) return EXIT.interrupted;
  if (s.restore.written.length > 0) return EXIT.failed;
  const judged = [s.checkout, ...s.labs, ...s.blocks.flatMap((b) => b.lines), ...s.protectedLines];
  if (judged.some(failsIn)) return EXIT.failed;
  return s.noneRan === true ? EXIT.nothingDone : EXIT.ok;
}

/** A standing batch's exit codes (standing.ts: lab-run's, lab-run-ios's): a batch's, and `unproven` for a run that proved nothing. */
export const STANDING_EXIT = { ...EXIT, unproven: 3 } as const;

/**
 * A standing batch's exit code, read from the same SUMMARY as exitCodeOf and stricter: exitCodeOf's 1, 2 and 130
 * stand; its 0 is 0 only when no judged line (the checkout's, the labs', the blocks', the protected keys') says
 * INCONCLUSIVE or ERROR, the ERROR section is empty (an unread log's NOTE in it too: what it held is not known) and
 * every label in `wanted` has a PASS line — else unproven (3).
 */
export function standingExitOf(s: Summary, wanted: readonly string[]): number {
  const code = exitCodeOf(s);
  if (code !== EXIT.ok) return code;
  const judged = [s.checkout, ...s.labs, ...s.blocks.flatMap((b) => b.lines), ...s.protectedLines].map(parseVerdictLine).filter((v) => v !== undefined);
  const proven =
    s.errors.length === 0 &&
    !judged.some((v) => v.verdict === 'INCONCLUSIVE' || v.verdict === 'ERROR') &&
    wanted.every((l) => judged.some((v) => v.label === l && v.verdict === 'PASS'));
  return proven ? STANDING_EXIT.ok : STANDING_EXIT.unproven;
}

/**
 * A JSON value as one key (T2 S6b review round 1, NIT 8: a run's identity, asked and done; here since T2b-1's code
 * review, so the pure halves need no io): every object's fields sorted, at every depth, so two equal values built in
 * another field order give the same text; arrays keep their order.
 */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (typeof v !== 'object' || v === null) return JSON.stringify(v);
  const o = v as Record<string, unknown>;
  // A field set to undefined is no field (JSON.stringify drops it too).
  const keys = Object.keys(o).sort().filter((k) => o[k] !== undefined);
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}
