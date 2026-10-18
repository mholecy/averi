import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import type { DeviceAdapter } from '../../src/adapters/types.js';
import { listIosDevices } from '../../src/adapters/discovery.js';
import type { Platform, SourceKind } from '../differential/corpus.js';
import { loadSide } from '../differential/side.js';
import { familyOf } from './catalog.js';
import { AndroidLab, IosLab, LAB_APP, LAB_AVD, LAB_WDA_DERIVED_DATA, pause } from './lab-device.js';
import { knownEntry, knownLive } from './live-known.js';
import { holds, judgeNoteFill, judgePhoneScroll, judgeUnderSheet, short, valueOf } from './live-forms.js';
import { judgeDismissal, PRESENTED_WINDOW_CELLS, presentedAssertCase, visibilityCases, type LiveVerdict, type RunsUnder } from './live-visibility.js';
import { allPassed, claimsTap, isError } from './replies.js';
import { appOf, LAB_APPS, type Catalog, type CellTruth, type LabApp, type LabState } from './schema.js';

/**
 * The live golden (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 1b — phase 5's mode brought forward for the
 * forms): averi's verbs that CHANGE state — a fill with and without clear, typing into the focused field, a fill on the
 * secure field and on a prefilled one, a tap under the keyboard with and without a dismissal, a picker row reached by
 * scroll_until — run through averi's MCP tools against the REAL lab simulator, and the app's own model (the state
 * file, Forms.swift) is the oracle. A replayed tree cannot judge these: typing changes nothing in it.
 *
 *   node --import tsx scripts/truth/live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda]
 *     [--cases b1,p4] [--shots <dir>]
 *   node --import tsx scripts/truth/live.ts --serial <lab emulator> [--cases b1,p4] [--shots <dir>]
 *
 * Android (phase 2b, `--serial`): the same cases against the Compose app on the `averi_lab` AVD (Forms.kt; the guard
 * refuses any other device), one tree source (uiautomator), the server's adapter the registry's own (defaultFactory),
 * discovery listing that emulator alone — no adb call reaches another attached device. Its typing is one `input text`
 * per character (src/adapters/android.ts#typeText). A case may judge per platform: Android hides the keyboard with
 * `back` and taps (k1, k3), sets no `error` on a field (e1 asserts the message's text), and has no keyboardDismiss
 * (k2 is iOS only).
 *
 * The server is built as tests/mcp/tools.test.ts builds one (createAveriServer over the SDK's in-memory transport and
 * a real Client), over a REAL AdapterRegistry whose factory constructs the iOS adapter itself: averi gives WDA port
 * 8100 to the first simulator a process asks for, and 8100/8101 may belong to another session's WebDriverAgent — here
 * the WDA source takes `--wda-port` (default 8120, capture.ts's) and builds into the lab's own derived data
 * (lab-device.ts#LAB_WDA_DERIVED_DATA), never device-check's `averi-wda`. Discovery lists the lab simulator only, so no
 * tool call can bind another booted device. Each case launches its cell in a fresh process (simctl, as the capture does
 * — not averi's launch_app, which is not under test here), runs its calls, waits for the app to write, and reads the
 * model.
 *
 * Outcome per case:
 *  - ok: the model holds what the case asked for, and averi's reply does not contradict it;
 *  - LOUD: the model does not hold it, and averi said so (an error, or "NOT verified") — honest, not a pass;
 *  - MISMATCH: averi claimed what did not happen ("Filled", "Tapped" with the model unchanged), or failed what did;
 *  - SKIP: a keyboard case whose launch shows no soft keyboard — the simulator hides it once it has seen HID typing
 *    (idb ui text); IosLab.launch writes the simulator's keyboard preferences back before every launch, and the
 *    keyboard's cases run first besides.
 * Not a vitest test: it needs the simulator.
 *
 * Groups (`--groups`, `forms` by default — the earlier summaries' reproduce lines): `forms` the cases above; `visibility` (phase 5) the coloured-target cells'
 * taps and scroll_until — every case built from the cell's static truth (tests/fixtures/truth) by live-visibility.ts,
 * the app's tap log, scroll offsets and strokes the oracle (`--cells` narrows them); `dismissal` (phase 5, iOS) a tap
 * under the keyboard on the false-covers toolbar cells, under the cell's own `keyboardDismiss` (CellConfig): the
 * control focused, nothing typed. A case not ok prints its whole replies, and every scroll case (and any case not ok)
 * the app's state beneath it. A case not ok that an existing note explains is KNOWN (live-known.ts) and marked so; the
 * exit code is 1 on a MISMATCH not known, and — in a run of this checkout, not a `--side` one — on a known case not
 * `intermittent` that came out ok (fixed: strike it off, as the static ratchet asks). `--record <file>` writes every
 * read (the launch state, the state between the calls, after them) as JSON; `--rejudge <file>` judges such a record
 * again with this checkout's judges, no device (tests/truth/live-rejudge.test.ts).
 *
 * `--app react-native` runs the cases of the React Native lab app's cells (fixtures/apps/rn, its own bundle and package:
 * lab-device.ts#LAB_APP; the visibility cases from its own truth runs, the manifests whose `app` is AveriLabRN) — the
 * native app's (`native`, the default) otherwise: one app per run, its cases only (schema.ts#appOf).
 *
 * `--side <checkout>` runs another averi's src (a calibration checkout, calibrate.ts's `differential-cal-<sha>`): its
 * tools, registry, iOS adapter and tree source, loaded as scripts/differential/side.ts loads a side — the live
 * calibration of a note (calibration.json `live`) runs its cases at the note's before and after commits.
 */

const { values } = parseArgs({
  options: {
    udid: { type: 'string' },
    serial: { type: 'string' },
    'wda-port': { type: 'string' },
    sources: { type: 'string' },
    cases: { type: 'string' },
    shots: { type: 'string' },
    groups: { type: 'string' },
    cells: { type: 'string' },
    side: { type: 'string' },
    record: { type: 'string' },
    rejudge: { type: 'string' },
    app: { type: 'string' },
  },
});
/** What a run read, case by case (`--record`): judged again without a device by `--rejudge`. */
interface RunRecord {
  platform: 'ios' | 'android';
  /** The lab app the run drove; absent on records before round 7: the native one. */
  app?: LabApp;
  side: string;
  results: { source: Source; id: string; skip?: string; replies: string[]; launched: LabState; after: (LabState | undefined)[]; state: LabState | undefined; late?: LabState }[];
}
const rejudging = values.rejudge === undefined ? undefined : (JSON.parse(await readFile(values.rejudge, 'utf8')) as RunRecord);
if (rejudging === undefined && (values.udid === undefined) === (values.serial === undefined)) {
  throw new Error('usage: live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda] [--groups forms,visibility,dismissal] [--cells …] [--cases …] [--side <checkout>] [--record <file>] | --serial <lab emulator> […] | --rejudge <record>');
}
const platform: 'ios' | 'android' = rejudging?.platform ?? (values.serial !== undefined ? 'android' : 'ios');
const app: LabApp = rejudging?.app ?? ((values.app ?? 'native') as LabApp);
if (!LAB_APPS.includes(app)) throw new Error(`no lab app ${values.app} (${LAB_APPS.join(', ')})`);
const device = (values.udid ?? values.serial ?? 'rejudged')!;
const port = Number(values['wda-port'] ?? 8120);
/** The tree sources the cases run under: iOS's (idb, wda), Android's one. */
type Source = IosTreeSourceKind | Extract<SourceKind, 'uiautomator'>;
const sources: Source[] = rejudging !== undefined ? [...new Set(rejudging.results.map((r) => r.source))] : platform === 'android' ? ['uiautomator'] : ((values.sources ?? 'idb,wda').split(',') as IosTreeSourceKind[]);
const only = values.cases?.split(',');
// `forms` by default: the reproduce lines of the earlier summaries (docs/truth/live-android-2026-10-16.md) stay true.
const groups = (values.groups ?? 'forms').split(',');
const onlyCells = values.cells?.split(',');
/** Where a case that is not ok leaves its screenshot (`--shots <dir>`), for the evidence. */
const shots = values.shots;
if (shots !== undefined) await mkdir(shots, { recursive: true });
// The WDA port too: 8100/8101 are refused (lab-device.ts#DEVICE_CHECK_WDA_PORTS). No device at all when rejudging.
const ios = rejudging === undefined && platform === 'ios' ? new IosLab(device, { wdaPort: port, app }) : undefined;
const android = rejudging === undefined && platform === 'android' ? new AndroidLab(device, { app }) : undefined;
// The lab simulator or the lab AVD, or nothing (lab-device.ts#IosLab.guard, #AndroidLab.guard): refused before any
// tool binds it.
if (rejudging === undefined) console.error(`lab: ${ios !== undefined ? await ios.guard() : (await android!.guard(), `${device}, AVD ${LAB_AVD}`)}`);

// --- the cases ---

interface Call {
  tool: 'type_text' | 'tap' | 'scroll_until' | 'assert';
  args: Record<string, unknown>;
}

interface Case extends RunsUnder {
  id: string;
  group: 'forms' | 'visibility' | 'dismissal';
  cell: string;
  says: string;
  /** averi.yaml `app.ios.keyboardDismiss` for this case. */
  dismiss?: unknown[];
  /** The case is about the soft keyboard: judged only when the launch shows it (else SKIP). */
  keyboard?: true;
  /** The platforms it runs on (both when unset). */
  platforms?: readonly Platform[];
  calls: Call[];
  /**
   * `launched`: the model as the launch left it, before any call — what a LOUD case's field held. `after[i]`: the state
   * read right after call i, for a visibility case (its stop judged before the tap after it ran); else empty.
   */
  judge(state: LabState, replies: string[], source: Source, launched: LabState, after: readonly (LabState | undefined)[]): LiveVerdict;
}

const id = (cell: string, tag: string) => `id:"lab.${cell}.${tag}"`;
const fill = (cell: string, tag: string, text: string, clear?: boolean): Call => ({
  tool: 'type_text',
  args: { selector: id(cell, tag), text, ...(clear !== undefined && { clear }) },
});
const P = 'form-prefilled';
const RN = 'rn-field';
const B = 'form-basic';
const K = 'form-keyboard';
const TITLE = { tap: { text: 'Transfer details' } };

const FORMS: Omit<Case, 'group'>[] = [
  // The keyboard's cases first: once the simulator has seen HID typing (idb ui text) it shows no soft keyboard
  // ("typing with a hardware keyboard keeps the software keyboard from showing", src/adapters/ios.ts) until
  // IosLab.launch writes its keyboard preferences back — first, so a failure of that write cannot skip them.
  {
    id: 'k1',
    cell: K,
    keyboard: true,
    says: 'a tap under the keyboard, no dismissal configured: refused, the focus stays (Android: hidden with back, then tapped — the focus on vs)',
    calls: [{ tool: 'tap', args: { selector: id(K, 'vs') } }],
    judge: (s, [reply], source) =>
      source === 'uiautomator'
        ? claimsTap(reply) !== (s.focus === 'vs')
          ? { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${s.focus}` }
          : claimsTap(reply) ? { outcome: 'ok', why: short(reply) } : { outcome: 'LOUD', why: `not tapped, the focus on ${s.focus}: ${short(reply)}` }
      : s.focus !== 'postcode' ? { outcome: 'MISMATCH', why: `the focus moved to ${s.focus}: ${short(reply)}` }
      : claimsTap(reply) ? { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus stayed on postcode` }
      : { outcome: 'ok', why: short(reply) },
  },
  {
    id: 'k2',
    cell: K,
    keyboard: true,
    platforms: ['ios'],
    dismiss: [TITLE],
    says: 'a tap under the keyboard, keyboardDismiss on the title: wda hides it and taps; idb refuses (the list is inert)',
    calls: [{ tool: 'tap', args: { selector: id(K, 'vs') } }],
    judge: (s, [reply], source) => {
      const tapped = claimsTap(reply);
      if (tapped !== (s.focus === 'vs')) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${s.focus}` };
      if (source === 'wda' && !tapped) return { outcome: 'LOUD', why: `not tapped, though a dismissal is configured: ${short(reply)}` };
      return { outcome: 'ok', why: short(reply) };
    },
  },
  {
    id: 'k4',
    cell: K,
    keyboard: true,
    says: 'a tap on the submit pinned above the keyboard fires it',
    calls: [{ tool: 'tap', args: { selector: id(K, 'submit') } }],
    judge: (s, [reply]) => {
      const fired = (s.submits ?? []).length > 0;
      return fired === claimsTap(reply) ? { outcome: fired ? 'ok' : 'LOUD', why: short(reply) } : { outcome: 'MISMATCH', why: `averi says ${short(reply)} — submits: ${(s.submits ?? []).length}` };
    },
  },
  {
    id: 'k3',
    cell: K,
    keyboard: true,
    dismiss: [TITLE],
    says: 'a fill under the keyboard with a dismissal (Android: none configured — back hides it; then note is a strip under the bar, refused by design)',
    calls: [fill(K, 'note', 'Thanks - ok')],
    judge: (s, replies, source, launched) => judgeNoteFill(s, replies, source, launched),
  },
  {
    id: 'k5',
    cell: K,
    keyboard: true,
    platforms: ['android'],
    says: 'a tap on note, under the IME and, once back hid it, under the bar dropped to the bottom: never a submit',
    calls: [{ tool: 'tap', args: { selector: id(K, 'note') } }],
    judge: (s, [reply]) => {
      const submits = (s.submits ?? []).length;
      const tapped = claimsTap(reply);
      if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×, focus ${s.focus}); averi: ${short(reply)}` };
      if (s.focus === 'note') return tapped ? { outcome: 'ok', why: short(reply) } : { outcome: 'MISMATCH', why: `the focus is on note, but averi says ${short(reply)}` };
      return tapped ? { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${s.focus}, no submit` } : { outcome: 'ok', why: `refused, nothing fired (focus ${s.focus}): ${short(reply)}` };
    },
  },
  // F2A1 (docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md): phone lies
  // under the bar riding on the IME, its dump a 42-px strip cut at Continue; a tap at its centre submits the form.
  {
    id: 'k6',
    cell: K,
    keyboard: true,
    platforms: ['android'],
    says: 'a tap on phone, under the bar riding on the IME (its dump a strip cut at Continue): never a submit — refused, or tapped where it focuses phone',
    calls: [{ tool: 'tap', args: { selector: id(K, 'phone') } }],
    judge: (s, [reply]) => {
      const submits = (s.submits ?? []).length;
      if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×, focus ${s.focus}); averi: ${short(reply)}` };
      if (claimsTap(reply)) return s.focus === 'phone' ? { outcome: 'ok', why: short(reply) } : { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${s.focus}, no submit` };
      return { outcome: 'ok', why: `refused, nothing fired (focus ${s.focus}): ${short(reply)}` };
    },
  },
  {
    id: 'k7',
    cell: K,
    keyboard: true,
    platforms: ['android'],
    says: 'scroll_until phone, under the bar riding on the IME: no stop while its centre lies under the bar or the IME, never a submit (the strokes counted)',
    calls: [{ tool: 'scroll_until', args: { selector: id(K, 'phone'), direction: 'down' } }],
    judge: (s, replies, source, launched) => judgePhoneScroll(s, replies, source, launched),
  },
  { id: 'b1', cell: B, says: 'fill, no clear, a name', calls: [fill(B, 'name', 'Jan Novak')], judge: holds('name', 'Jan Novak') },
  { id: 'b1d', cell: B, says: 'fill, no clear, a name with diacritics', calls: [fill(B, 'name', 'Jan Šťastný')], judge: holds('name', 'Jan Šťastný') },
  {
    id: 'b2',
    cell: B,
    says: 'type_text without a selector types into the focused field',
    calls: [fill(B, 'name', 'Jan'), { tool: 'type_text', args: { text: ' & Co.' } }],
    judge: holds('name', 'Jan & Co.'),
  },
  { id: 'b3', cell: B, says: 'fill, clear, an e-mail', calls: [fill(B, 'email', 'jan.stastny@example.com', true)], judge: holds('email', 'jan.stastny@example.com') },
  { id: 'b4', cell: B, says: 'fill, clear, an IBAN with spaces', calls: [fill(B, 'iban', 'SK31 1200 0000 1987 4263 7541', true)], judge: holds('iban', 'SK31 1200 0000 1987 4263 7541') },
  { id: 'b5', cell: B, says: 'fill the amount (decimal pad)', calls: [fill(B, 'amount', '1234.56')], judge: holds('amount', '1234.56') },
  { id: 'b6', cell: B, says: 'fill the secure PIN (number pad)', calls: [fill(B, 'pin', '4821')], judge: holds('pin', '4821') },
  { id: 'b7', cell: B, says: 'fill typographic text (’ “ ” – …)', calls: [fill(B, 'name', 'O’Brien “Jr.” – Co…')], judge: holds('name', 'O’Brien “Jr.” – Co…') },
  { id: 'p1', cell: P, says: 'a no-clear fill keeps the prefill', calls: [fill(P, 'name', ' Jr.')], judge: holds('name', 'Jan Šťastný Jr.') },
  { id: 'p2', cell: P, says: 'a clear fill replaces the prefill', calls: [fill(P, 'iban', 'CZ65 0800 0000 1920 0014 5399', true)], judge: holds('iban', 'CZ65 0800 0000 1920 0014 5399') },
  { id: 'p3', cell: P, says: 'a clear alone empties the field', calls: [fill(P, 'email', '', true)], judge: holds('email', '') },
  { id: 'p4', cell: P, says: 'a clear fill over a prefill with an NBSP', calls: [fill(P, 'amount', '99,90', true)], judge: holds('amount', '99,90') },
  {
    id: 'p5',
    cell: P,
    says: 'a no-clear fill on the prefilled secure PIN keeps it — or averi says it did not',
    calls: [fill(P, 'pin', '1')],
    judge: holds('pin', '25801'),
  },
  { id: 'p6', cell: P, says: 'a clear fill on the prefilled secure PIN', calls: [fill(P, 'pin', '4821', true)], judge: holds('pin', '4821') },
  {
    id: 'e1',
    cell: 'form-errors',
    platforms: ['ios'],
    says: 'fixing a field drops its error, and assert … error reads that from the live tree',
    calls: [
      fill('form-errors', 'name', 'Jan'),
      { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-errors.name' }, error: 'Enter the recipient’s name', timeout: 2_000 }] } },
      { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-errors.email' }, error: 'That’s not an e-mail – check the “@”', timeout: 2_000 }] } },
    ],
    judge: (s, [, gone, still]) => {
      if (s.fields?.name?.error !== null) return { outcome: 'LOUD', why: `the fill did not clear the app's error: ${JSON.stringify(s.fields?.name)}` };
      if (allPassed(gone)) return { outcome: 'MISMATCH', why: `assert read the error the app no longer shows: ${short(gone)}` };
      if (!allPassed(still)) return { outcome: 'MISMATCH', why: `the e-mail's error, still shown, failed: ${short(still)}` };
      return { outcome: 'ok', why: 'name: error gone; email: error still read' };
    },
  },
  {
    id: 'e1a',
    cell: 'form-errors',
    platforms: ['android'],
    says: 'fixing a field drops its error, and its message (Android sets no error: asserted as text) goes from the tree',
    calls: [
      fill('form-errors', 'name', 'Jan'),
      { tool: 'assert', args: { asserts: [{ element: { text: 'Enter the recipient’s name' }, absent: true, timeout: 2_000 }] } },
      { tool: 'assert', args: { asserts: [{ element: { text: 'That’s not an e-mail – check the “@”' }, timeout: 2_000 }] } },
    ],
    judge: (s, [, gone, still]) => {
      if (s.fields?.name?.error !== null) return { outcome: 'LOUD', why: `the fill did not clear the app's error: ${JSON.stringify(s.fields?.name)}` };
      if (!allPassed(gone)) return { outcome: 'MISMATCH', why: `the name's message, gone from the app, is still read: ${short(gone)}` };
      if (!allPassed(still)) return { outcome: 'MISMATCH', why: `the e-mail's message, still shown, failed: ${short(still)}` };
      return { outcome: 'ok', why: 'name: message gone; email: message still read' };
    },
  },
  {
    id: 'c1',
    cell: 'form-picker',
    says: 'scroll_until a row far down the lazy list, tap it: the value is written back',
    calls: [
      { tool: 'scroll_until', args: { selector: id('form-picker', 'country.ST'), direction: 'down' } },
      { tool: 'tap', args: { selector: id('form-picker', 'country.ST') } },
    ],
    judge: (s, [scroll, tap]) => {
      const chosen = valueOf(s, 'country') === 'São Tomé & Príncipe' && s.events.some((e) => e.kind === 'select' && e.tag === 'ST');
      if (chosen) return isError(scroll) || isError(tap) ? { outcome: 'MISMATCH', why: `chosen, but averi failed: ${short(scroll)} / ${short(tap)}` } : { outcome: 'ok', why: short(scroll) };
      return claimsTap(tap) ? { outcome: 'MISMATCH', why: `averi says ${short(tap)} — the app chose ${JSON.stringify(valueOf(s, 'country'))}` } : { outcome: 'LOUD', why: `${short(scroll)} / ${short(tap)}` };
    },
  },
  // The form beneath the picker sheet (round 6's closing review: the active-window hint run live): each field and the
  // submit asked by a tap, the sheet open at launch — live-forms.ts#judgeUnderSheet.
  ...(['name', 'country', 'submit'] as const).map((tag, i) => ({
    id: `c${i + 2}`,
    cell: 'form-picker',
    says: `tap ${tag} beneath the picker sheet, open and fully expanded: nothing fires, the reply says to close the sheet once where the tree source marks it (idb: not in its tree)`,
    calls: [{ tool: 'tap' as const, args: { selector: id('form-picker', tag) } }],
    judge: judgeUnderSheet(tag),
  })),
  // The React Native lab app's fields (`--app react-native`; fixtures/apps/rn, src/ReactNative.tsx): rn-field's three
  // TextInputs, each reporting its value and focus by its target's tag — N a single-line field under its floating label,
  // I the field with a trailing icon button labelled Clear, M a multiline field.
  { id: 'rn1', cell: RN, says: 'fill, no clear, the single-line RN field', calls: [fill(RN, 'N.field', 'Jan Novak')], judge: holds('N', 'Jan Novak') },
  { id: 'rn2', cell: RN, says: 'fill, clear, the multiline RN field', calls: [fill(RN, 'M.field', 'Thanks for the lunch', true)], judge: holds('M', 'Thanks for the lunch') },
  { id: 'rn3', cell: RN, says: 'fill, no clear, the RN field with an icon', calls: [fill(RN, 'I.field', 'SK31 1200')], judge: holds('I', 'SK31 1200') },
  {
    id: 'rn4',
    cell: RN,
    says: 'a tap on the floating label (text:"Payee’s name") focuses its field',
    calls: [{ tool: 'tap', args: { selector: 'text:"Payee’s name"' } }],
    judge: (s, [reply]) =>
      claimsTap(reply) !== (s.focus === 'N') ? { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus is on ${s.focus}` }
      : claimsTap(reply) ? { outcome: 'ok', why: short(reply) }
      : { outcome: 'LOUD', why: `not tapped, the focus on ${s.focus}: ${short(reply)}` },
  },
  {
    id: 'rn5',
    cell: RN,
    says: 'fill the single-line RN field, then assert its text reads what the app holds',
    calls: [fill(RN, 'N.field', 'Jan Novak'), { tool: 'assert', args: { asserts: [{ element: { id: `lab.${RN}.N.field` }, text: 'Jan Novak', timeout: 2_000 }] } }],
    judge: (s, [filled, asserted]) => {
      const held = valueOf(s, 'N') === 'Jan Novak';
      if (held !== allPassed(asserted)) return { outcome: 'MISMATCH', why: `the app holds ${JSON.stringify(valueOf(s, 'N'))}, the assert: ${short(asserted)}` };
      return held ? { outcome: 'ok', why: short(asserted) } : { outcome: 'LOUD', why: `the app holds ${JSON.stringify(valueOf(s, 'N'))}: ${short(filled)} / ${short(asserted)}` };
    },
  },
  {
    id: 'rn6',
    cell: RN,
    says: 'fill the RN field with an icon, then tap its icon (label:"Clear"): the field emptied',
    calls: [fill(RN, 'I.field', 'abc'), { tool: 'tap', args: { selector: 'label:"Clear"' } }],
    judge: (s, replies, source, launched) => {
      const pressed = s.events.some((e) => e.kind === 'tap' && e.tag === 'I');
      if (claimsTap(replies[1]) !== pressed) return { outcome: 'MISMATCH', why: `averi says ${short(replies[1])} — the icon ${pressed ? 'was' : 'was not'} pressed` };
      return holds('I', '')(s, replies, source, launched);
    },
  },
];
const CASES: Case[] = FORMS.map((c) => ({ ...c, group: 'forms' }));

// --- phase 5: the visibility cells, from their static truth ---

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(await readFile(join(ROOT, 'fixtures/apps/cells.json'), 'utf8')) as Catalog;
/** The truth run of this platform and lab app (tests/fixtures/truth/<run>, its manifest's `platform` and `app`). */
async function truthsOf(p: Platform, a: LabApp): Promise<CellTruth[]> {
  const base = join(ROOT, 'tests/fixtures/truth');
  for (const run of await readdir(base)) {
    const manifest = JSON.parse(await readFile(join(base, run, 'manifest.json'), 'utf8')) as { platform: Platform; app?: string; captures: { truth?: string }[] };
    if (manifest.platform !== p || manifest.app !== LAB_APP[a].name) continue;
    const files = [...new Set(manifest.captures.map((c) => c.truth).filter((t): t is string => t !== undefined))];
    return Promise.all(files.map(async (f) => JSON.parse(await readFile(join(base, run, f), 'utf8')) as CellTruth));
  }
  return [];
}

if (groups.includes('visibility')) {
  for (const truth of await truthsOf(platform, app)) {
    if (truth.targets.length === 0 || (onlyCells !== undefined && !onlyCells.includes(truth.cell))) continue;
    const asserts = PRESENTED_WINDOW_CELLS.includes(truth.cell) ? truth.targets.filter((t) => t.declared === 'presented-over').map((t) => presentedAssertCase(truth.cell, t)) : [];
    for (const v of [...visibilityCases(truth, platform), ...asserts]) CASES.push({ ...v, group: 'visibility', judge: (s, replies, source, launched, after) => v.judge(s, replies, launched, source, after) });
  }
}

/**
 * The dismissal's dynamics (#7, #19; iOS): a tap on a field under the keyboard, the cell's own `keyboardDismiss` (the
 * principal title, under SwiftUI's toolbar host or an itemless bar) — the app's focus must move to the field, nothing
 * typed into any field, no submit. WDA taps the dismissal; under idb the list is inert, and a refusal with the focus
 * left where it was is its documented answer.
 */
if (groups.includes('dismissal') && platform === 'ios') {
  for (const cell of catalog.cells) {
    const dismiss = cell.config?.ios?.keyboardDismiss as unknown[] | undefined;
    if (cell.form === undefined || dismiss === undefined || (onlyCells !== undefined && !onlyCells.includes(cell.id))) continue;
    if (cell.platforms !== undefined && !cell.platforms.includes('ios')) continue;
    for (const tag of ['vs', 'ks', 'ss', 'note']) {
      CASES.push({
        id: `dismiss:${cell.id}.${tag}`,
        group: 'dismissal',
        cell: cell.id,
        keyboard: true,
        platforms: ['ios'],
        dismiss,
        says: `a tap on ${tag} under the keyboard, keyboardDismiss on the title: the keyboard dismissed, then ${tag} focused (or refused for where it lies once the keyboard is gone), nothing typed`,
        calls: [{ tool: 'tap', args: { selector: id(cell.id, tag) } }],
        judge: (s, [reply], source, launched) => judgeDismissal(tag, reply, source, s, launched),
      });
    }
  }
}

// --- the server: a real registry, the lab simulator only, WDA on a port of its own ---

/**
 * The averi under test: this checkout's src, or `--side`'s (a checkout of another commit) — its tools, registry, iOS
 * adapter and tree source, loaded by scripts/differential/side.ts#loadSide (the export guard, the old registry's shim).
 */
const averi = rejudging === undefined ? await loadSide(values.side ?? ROOT) : undefined;
if (averi !== undefined) console.error(`averi: ${averi.root}`);
function iosAdapter(udid: string, source: IosTreeSourceKind): DeviceAdapter {
  const create = averi!.createIosTreeSource;
  if (create === undefined) throw new Error(`side ${averi!.root}: no src/adapters/ios-tree-source.ts#createIosTreeSource — the live golden cannot build its tree source`);
  const side = averi!;
  return new side.IosAdapter({ udid, treeSource: create(source, udid, { port, derivedDataPath: LAB_WDA_DERIVED_DATA }) as ConstructorParameters<typeof side.IosAdapter>[0]['treeSource'] });
}

async function connect(): Promise<{ client: Client; close(): Promise<void> }> {
  const registry = averi!.registry({
    factory: (p, deviceId, opts) => (p === 'android' ? averi!.defaultFactory(p, deviceId, opts) : iosAdapter(deviceId, opts?.treeSource ?? 'idb')),
    // The lab device alone. Android: listed without asking adb (its listing runs getprop on every attached device).
    discovery: async (p) =>
      p !== platform ? []
      : p === 'ios' ? (await listIosDevices()).filter((d) => d.id === device)
      : [{ id: device, platform: 'android', name: LAB_AVD, osVersion: 'lab', state: 'booted' }],
  });
  const server = averi!.createAveriServer({ registry, version: 'live-golden' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'live-golden', version: '0' });
  await client.connect(clientSide);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
      await registry.shutdown();
    },
  };
}

const configDir = join(tmpdir(), `averi-live-${process.pid}`);
await mkdir(configDir, { recursive: true });
async function configFor(source: Source, dismiss: unknown[] | undefined): Promise<string> {
  const path = join(configDir, `averi-${source}${dismiss === undefined ? '' : '-dismiss'}.yaml`);
  const ios = source === 'uiautomator' ? {} : { ios: { bundleId: LAB_APP[app].bundle, treeSource: source, ...(dismiss !== undefined && { keyboardDismiss: dismiss }) } };
  // JSON is YAML.
  await writeFile(path, JSON.stringify({ app: { android: { package: LAB_APP[app].package }, ...ios } }));
  return path;
}

async function callTool(client: Client, call: Call, configPath: string): Promise<string> {
  try {
    const r = await client.callTool({ name: call.tool, arguments: { platform, ...call.args, configPath } }, undefined, { timeout: 300_000 });
    const text = (r.content as { type: string; text?: string }[]).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
    return `${r.isError === true ? 'ERROR ' : ''}${text}`;
  } catch (e) {
    return `ERROR (thrown) ${(e as Error).message}`;
  }
}

type Result = { source: Source; c: Case; verdict: LiveVerdict; replies: string[] };
const results: Result[] = [];
const record: RunRecord = { platform, ...(app !== 'native' && { app }), side: values.side ?? 'this checkout', results: [] };
// The run's lab app's cells only (schema.ts#appOf).
const selected = CASES.filter((x) => groups.includes(x.group) && appOf(familyOf(catalog, x.cell)) === app && (only === undefined || only.includes(x.id)) && (x.platforms === undefined || x.platforms.includes(platform)));

/**
 * Judge one case's reads: the state after the calls; a forms case not ok is read again 3 s later (`late`: a model that
 * catches up was the app's lag, not a lost value) — never a visibility case, whose stop is judged on the state read
 * when scroll_until returned, and which a later read would let a fling finish behind the reply's back.
 */
function judged(c: Case, source: Source, replies: string[], launched: LabState, after: (LabState | undefined)[], state: LabState, late: LabState | undefined): LiveVerdict {
  const verdict = c.judge(state, replies, source, launched, after);
  if (verdict.outcome === 'ok' || late === undefined) return verdict;
  const again = c.judge(late, replies, source, launched, after);
  return again.outcome === verdict.outcome ? verdict : { ...again, why: `${again.why} (only 3 s later; first read: ${verdict.why})` };
}

if (rejudging !== undefined) {
  // No device: each recorded case judged again by this checkout's judges.
  for (const r of rejudging.results) {
    const c = selected.find((x) => x.id === r.id);
    if (c === undefined) continue;
    const verdict: LiveVerdict = r.skip !== undefined || r.state === undefined ? { outcome: 'SKIP', why: r.skip ?? 'no state recorded' } : judged(c, r.source, r.replies, r.launched, r.after, r.state, r.late);
    results.push({ source: r.source, c, verdict, replies: r.replies });
  }
} else {
  const lab = (ios ?? android)!;
  if (platform === 'ios') console.error(`WDA: port ${port}, derived data ${LAB_WDA_DERIVED_DATA}`);
  /** The screen now, for the evidence of a case that is not ok. */
  const shoot = async (file: string) => writeFile(file, await lab.screenshot());
  const { client, close } = await connect();
  try {
    // Cases outer, sources inner: the keyboard's cases run on both sources before anything types.
    for (const c of selected) {
      for (const source of sources) {
        if (c.sources !== undefined && !c.sources.includes(source)) continue;
        const launched = await lab.launch(c.cell);
        if (c.keyboard && launched.keyboard?.visible !== true) {
          const verdict: LiveVerdict = { outcome: 'SKIP', why: platform === 'ios' ? 'no soft keyboard at launch (the simulator saw HID typing; see IosLab.launch)' : 'no IME at launch' };
          results.push({ source, c, verdict, replies: [] });
          record.results.push({ source, id: c.id, skip: verdict.why, replies: [], launched, after: [], state: undefined });
          console.error(`${source} ${c.id} SKIP: ${verdict.why}`);
          continue;
        }
        const config = await configFor(source, c.dismiss);
        const replies: string[] = [];
        const after: (LabState | undefined)[] = [];
        for (const [i, call] of c.calls.entries()) {
          replies.push(await callTool(client, call, config));
          // A visibility case reads the app between its calls: its stop is judged as scroll_until left it.
          if (c.group === 'visibility' && i < c.calls.length - 1) after.push(await lab.state());
        }
        await pause(800);
        const state = (await lab.state())!;
        let late: LabState | undefined;
        if (c.group !== 'visibility' && c.judge(state, replies, source, launched, after).outcome !== 'ok') {
          await pause(3_000);
          late = await lab.state();
        }
        const verdict = judged(c, source, replies, launched, after, state, late);
        if (shots !== undefined && verdict.outcome !== 'ok') await shoot(join(shots, `${source}-${c.id}-${Date.now()}.png`));
        results.push({ source, c, verdict, replies });
        record.results.push({ source, id: c.id, replies, launched, after, state, ...(late !== undefined && { late }) });
        console.error(`${source} ${c.id} ${verdict.outcome}: ${verdict.why}`);
      }
    }
  } finally {
    await close();
    await lab.close();
    if (values.record !== undefined) await writeFile(values.record, JSON.stringify(record) + '\n');
  }
}

// --- the summary: every case, a known one marked with its note (live-known.ts); exit 1 on an unknown MISMATCH, and on
// a known case not intermittent that came out ok in a run of this checkout (fixed: strike it off) ---

/**
 * The note a not-ok case is known by — only when it failed by the rule, on the kind of reply, its KNOWN entry pins
 * (live-known.ts).
 */
const known = (r: Result) => knownLive(platform, r.source, r.c.id, r.verdict.cls, r.verdict.kind);
/** A KNOWN entry whose case failed by another rule, or on another kind of reply: unknown, and said so. */
const otherRule = (r: Result) => (r.verdict.outcome !== 'ok' && known(r) === undefined ? knownEntry(platform, r.source, r.c.id) : undefined);
const count = (o: LiveVerdict['outcome']) => results.filter((r) => r.verdict.outcome === o).length;
const unknown = results.filter((r) => r.verdict.outcome === 'MISMATCH' && known(r) === undefined);
const cleared = results.filter((r) => r.verdict.outcome === 'ok' && knownEntry(platform, r.source, r.c.id) !== undefined);
/** live-known.ts is HEAD's: a `--side` run (or a rejudged record of one) is a calibration, never held to it. */
const ofThisCheckout = (rejudging?.side ?? values.side ?? 'this checkout') === 'this checkout';
/** Known, ok this run, and not intermittent: fixed without being struck off (live-known.ts's ratchet). */
const fixed = ofThisCheckout ? cleared.filter((r) => knownEntry(platform, r.source, r.c.id)?.intermittent !== true) : [];
const lines = [
  `<!-- averi: ${rejudging?.side ?? values.side ?? 'this checkout'}${rejudging !== undefined ? ` (rejudged from ${values.rejudge})` : ''} -->`,
  `# Live golden: ${results.length} cases, ${count('ok')} ok, ${count('LOUD')} loud, ${count('MISMATCH')} mismatches (${unknown.length} not known), ${count('SKIP')} skipped`,
  '',
];
for (const source of sources) {
  lines.push(`## ${source}`);
  for (const r of results.filter((x) => x.source === source)) {
    const note = known(r);
    const entry = knownEntry(platform, r.source, r.c.id);
    const other = otherRule(r);
    const mark =
      r.verdict.outcome === 'ok' ? (entry === undefined ? '' : ` [known${entry.intermittent === true ? ' (intermittent)' : ''}, ok this run: ${entry.note}]`)
      : note !== undefined ? ` [known: ${note}]`
      : other !== undefined ? ` [NOT known: ${r.verdict.cls ?? '?'} on ${r.verdict.kind ?? '?'}, where KNOWN pins ${other.cls} on ${other.kind} (${other.note})]`
      : '';
    lines.push(`- ${r.verdict.outcome}${r.verdict.cls === undefined ? '' : ` (${r.verdict.cls})`} ${r.c.id} ${r.c.cell}: ${r.c.says} — ${r.verdict.why}${mark}`);
    if (r.verdict.outcome !== 'ok') for (const [i, reply] of r.replies.entries()) lines.push(`    ${r.c.calls[i].tool} → ${reply.replaceAll('\n', ' ⏎ ')}`);
    if (r.verdict.app !== undefined) lines.push(`    app: ${r.verdict.app}`);
  }
  lines.push('');
}
if (cleared.length > 0) lines.push(`Known but ok this run: ${cleared.map((r) => `${r.source} ${r.c.id}`).join(', ')}`, '');
if (fixed.length > 0) lines.push(`FIXED, not intermittent — strike off live-known.ts: ${fixed.map((r) => `${r.source} ${r.c.id}`).join(', ')}`, '');
console.log(lines.join('\n'));
if (unknown.length > 0 || fixed.length > 0) process.exitCode = 1;
