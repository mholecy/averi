/**
 * The words a device batch speaks, and its SUMMARY. Pure: strings in, strings out.
 *
 * A batch writes two kinds of line. A **step line** says how one step of the run went, its word first, padded:
 * `OK   kf analyze`, `FAIL E5 restore (exit 3) — see restore.log`. A **verdict line** says what a block found, its label
 * first: `kf live verdict: INCONCLUSIVE — the premise does not hold`. The SUMMARY gathers the run's verdict lines in a
 * fixed order between two markers; whoever waits for a batch waits for `======== SUMMARY` (unchanged since batch-1).
 *
 * Not here yet (backlog T2): the ERROR lines batch-12 collected from each block's logs and analyze.txt — the runner
 * (slice S6) knows those files and hands them in with `errors`. The RESTORE block needs no `grep "run $RUN_ID"`
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
 * block the abort SUMMARY could not judge. OK and ERROR: a cleanup line (`E5 cleanup: OK — …`), the lab lines.
 */
export const VERDICTS = ['PASS', 'FAIL', 'INCONCLUSIVE', 'REPRODUCED', 'OBSERVED', 'SKIP', 'INTERRUPTED', 'OK', 'ERROR'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The SUMMARY's opening marker. Its end marker starts with it too: `======== SUMMARY end (run <id>)`. */
export const SUMMARY_MARKER = '======== SUMMARY';

/** A batch's exit codes: 2 refused to start (nothing done, no SUMMARY); 130 interrupted (the abort SUMMARY printed). */
export const EXIT = { ok: 0, failed: 1, refused: 2, interrupted: 130 } as const;

const LINE_BREAK = /[\n\r]/;

/** `line`, or a throw when it holds a line break: the SUMMARY and steps.log are read line by line. */
export function oneLine(line: string, what = 'a line'): string {
  if (LINE_BREAK.test(line)) throw new Error(`${what} holds a line break: ${JSON.stringify(line)}`);
  return line;
}

/** A step line: the word padded to four, then the text (`OK   x`, `DONE x`, `ERROR x`). */
export const stepLine = (word: StepWord, text: string): string => `${word.padEnd(4)} ${text}`;

/** What every refusal line ends with: the batch exits 2 (EXIT.refused) and has done nothing. */
export const NOTHING_DONE = ' — nothing was done';

/** A refusal: `ERROR <text> — nothing was done`. */
export const refusedLine = (text: string): string => `${stepLine('ERROR', text)}${NOTHING_DONE}`;

/** A number as two digits (`09`): the step times and the RUN_ID. */
export const twoDigits = (n: number): string => String(n).padStart(2, '0');

/** A time of day as the batch writes it: `HH:MM:SS`, local (the step lines, the INTERRUPTED line, RESTORE's header). */
export const timeOf = (d: Date): string => `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}`;

/** What a thrown value says: an Error's message, anything else as a string. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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
}

/**
 * A block the abort SUMMARY did not judge: its lines so far, marked, then INTERRUPTED and how to rerun it. Its
 * records not complete, or — `why` — not judged for another reason (the abort's judging budget spent).
 */
export const interruptedBlock = (block: string, linesSoFar: readonly string[], why?: string): string[] => [
  ...linesSoFar.map((l) => `(before the interrupt) ${l}`),
  verdictLine(block, 'INTERRUPTED', why === undefined ? `its records are not complete, not judged (rerun ONLY=${block})` : `not judged (${why}; rerun ONLY=${block})`),
];

/** The SUMMARY's body, before deduplication. */
function bodyOf(s: Summary): string[] {
  return [
    s.checkout,
    ...(s.interrupted === undefined ? [] : [`INTERRUPTED: ${s.name} run ${s.runId} was interrupted at ${s.interrupted.at}`]),
    ...s.labs,
    ...s.blocks.flatMap((b) => (b.interrupted === true ? interruptedBlock(b.block, b.lines, b.why) : b.lines)),
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
 * The run's exit code: 130 when interrupted, whatever else; 1 when any SUMMARY line but an ERROR line says FAIL or
 * this run wrote a RESTORE; else 0. (Refused to start: EXIT.refused, with no SUMMARY.) An ERROR line, an INCONCLUSIVE
 * or a SKIP alone exits 0: the SUMMARY says it, the exit code is for a FAIL or for state left on a device.
 */
export function exitCodeOf(s: Summary): 0 | 1 | 130 {
  if (s.interrupted !== undefined) return EXIT.interrupted;
  if (s.restore.written.length > 0) return EXIT.failed;
  const judged = [s.checkout, ...s.labs, ...s.blocks.flatMap((b) => b.lines), ...s.protectedLines];
  return judged.some(failsIn) ? EXIT.failed : EXIT.ok;
}
