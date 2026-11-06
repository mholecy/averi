import { type LabDevice, pause as realPause, withMeasuredPanel } from './lab-device.js';
import { type PreDragged, type PreDragLab, preDragOrSkip, type SwipeEntry, type SwipeHook } from './live-carousel.js';
import { type Call, type Case, type CaseRecord, judged, LATE_READ_MS, wantsLateRead } from './live-cases.js';
import type { Source } from './live-forms.js';
import type { LiveVerdict } from './live-visibility.js';
import { isError } from './replies.js';
import { labSelector, type LabState } from './schema.js';

/**
 * One live case on one tree source: case + lab + tool call → one record and its verdict (backlog A11, docs/adr/0044).
 * The cycle, in the order the device sees it: the warm-up, the launch, the
 * pre-drag, the keyboard's SKIP, the panel's first read, the calls with the reads the case declares between them, the
 * pause, the state, the panel's second read, the late read (live-cases.ts#wantsLateRead), the verdict, a screenshot when
 * it is not ok. What a case reads is its declaration (Case.reads and the fields beside it), never its group; a new read is a
 * field there, a field on the record (CaseRecord, caseRecord), and its read in the cycle below.
 *
 * It knows nothing of argv, of which cases run, or of printing: live.ts is the CLI around it, and tests/truth/run-case.test.ts
 * runs the cycle over tests/helpers/fake-lab.ts. A failure of the harness itself (a call that throws, a guard that
 * refuses) throws out of here and stops the run, as it always did; a pre-drag that fails is the case's SKIP.
 */

/** A lab a case runs on: Android's adds the raw stroke and the IME region; its `platform` tells them apart. */
export type CaseLab = (LabDevice & { readonly platform: 'ios' }) | (LabDevice & PreDragLab & { readonly platform: 'android'; guard(): Promise<unknown>; imeTouchable(): Promise<string> });

export interface CaseRig {
  lab: CaseLab;
  /** One averi tool, through the server under test: its reply's text. */
  callTool(call: Call, config: string): Promise<string>;
  /** The averi.yaml the case runs under (live-cases.ts#caseConfig), as a path. */
  configFor(source: Source, c: Case): Promise<string>;
  /** The hook on the adapter's strokes, armed around the calls of a case that declares `reads.swipes`. */
  swipes: Pick<SwipeHook, 'arm' | 'disarm'>;
  /** Keep a not-ok case's screenshot as `name` (`--shots`); unset, none is taken. */
  keepShot?(name: string, png: Buffer): Promise<void>;
  /** What the run should hear before the case ends: a warm-up or a panel read that failed. */
  note?(line: string): void;
  /** The harness's wait (lab-device.ts#pause) unless given. */
  pause?(ms: number): Promise<unknown>;
  /** The clock of `readAt` and of a screenshot's name, in ms. */
  now?(): number;
}

export interface CaseRun {
  record: CaseRecord;
  verdict: LiveVerdict;
}

/** How long the app is given to write once the calls are done. */
const WRITE_SETTLE_MS = 800;

/** The one place a record is shaped: a skip's and a run's, in the order a recorded file keeps its keys. */
function caseRecord(source: Source, c: Case, reads: Omit<CaseRecord, 'source' | 'id'>): CaseRecord {
  const { skip, replies, launched, after, state, late, warmUpError, preDrag, swipes } = reads;
  return {
    source,
    id: c.id,
    ...(skip !== undefined && { skip }),
    replies,
    launched,
    after,
    state,
    ...(late !== undefined && { late }),
    ...(warmUpError !== undefined && { warmUpError }),
    ...(preDrag !== undefined && { preDrag }),
    ...(swipes !== undefined && { swipes }),
  };
}

export async function runCase(c: Case, source: Source, rig: CaseRig): Promise<CaseRun> {
  const { lab, pause = realPause, now = Date.now, note = () => undefined } = rig;
  // Case.warmUp: the tree source bound first, by one read under the case's own config, its reply discarded, so an entry
  // probe timed from the launch reads the bare screen rather than a Welcome the binding outran. A warm-up that failed is
  // kept in the record.
  const warm = c.warmUp === true ? await rig.callTool({ tool: 'ui_snapshot', args: { filter: labSelector(c.cell, 'home') } }, await rig.configFor(source, c)) : undefined;
  const warmUpError = isError(warm) ? warm : undefined;
  if (warmUpError !== undefined) note(`${source} ${c.id} warm-up failed: ${warmUpError.split('\n')[0]}`);
  let launched = await lab.launch(c.cell);
  /** The case SKIPped before its calls, `why`: no replies, no state, the launch as read. */
  const skip = (why: string): CaseRun => ({ verdict: { outcome: 'SKIP', why }, record: caseRecord(source, c, { skip: why, replies: [], launched, after: [], state: undefined, warmUpError }) });
  // The raw pre-drag (Case.preDrag): the calls start from the state it left. One that failed is the case's SKIP
  // (lv-d62's skipFails then fails the run), never the whole run thrown out.
  let preDragged: PreDragged | undefined;
  if (c.preDrag !== undefined) {
    const dragged = lab.platform === 'android' ? await preDragOrSkip(lab, launched, c.preDrag, pause) : { skip: "a pre-drag is the Android lab's only" };
    if ('skip' in dragged) return skip(dragged.skip);
    ({ preDrag: preDragged, launched } = dragged);
  }
  if (c.keyboard && launched.keyboard?.visible !== true) return skip(lab.platform === 'ios' ? 'no soft keyboard at launch (the simulator saw HID typing; see IosLab.launch)' : 'no IME at launch');
  // The first of the two device reads the kf judges rest on (LabState.imeTouchable, lab-device.ts#withMeasuredPanel),
  // on the Android lab only.
  const panelLab = c.measuresPanel === true && lab.platform === 'android' ? lab : undefined;
  if (panelLab !== undefined) launched = await withMeasuredPanel(launched, panelLab, note);
  const config = await rig.configFor(source, c);
  const replies: string[] = [];
  const after: (LabState | undefined)[] = [];
  let swipes: SwipeEntry[] | undefined;
  const logged = c.reads?.swipes;
  if (logged !== undefined) rig.swipes.arm(logged === true ? undefined : logged.drop);
  try {
    for (const [i, call] of c.calls.entries()) {
      replies.push(await rig.callTool(call, config));
      if (c.reads?.betweenCalls === true && i < c.calls.length - 1) after.push(await lab.state());
    }
  } finally {
    swipes = logged !== undefined ? rig.swipes.disarm() : undefined;
  }
  await pause(WRITE_SETTLE_MS);
  // Stamped with when it was read (LabState.readAt): the ensure judges ask it.
  const stamped = (s: LabState | undefined) => (s === undefined ? s : { ...s, readAt: now() / 1000 });
  const read = stamped(await lab.state())!;
  // The second (D69): the panel again once the calls are done, kept on the final state — the judge holds the two reads
  // to agree (live-forms.ts#panelAfterCalls); `late` gets it from there (live-cases.ts#judged).
  const state = panelLab !== undefined ? await withMeasuredPanel(read, panelLab, note) : read;
  const readings = { source, replies, launched, after, state, swipes };
  let late: LabState | undefined;
  if (wantsLateRead(c, readings)) {
    await pause(LATE_READ_MS);
    late = stamped(await lab.state());
  }
  const verdict = judged(c, { ...readings, late });
  if (rig.keepShot !== undefined && verdict.outcome !== 'ok') await rig.keepShot(`${source}-${c.id}-${now()}.png`, await lab.screenshot());
  return { verdict, record: caseRecord(source, c, { replies, launched, after, state, late, warmUpError, preDrag: preDragged, swipes }) };
}
