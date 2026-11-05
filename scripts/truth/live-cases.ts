import { readdir, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from '../differential/corpus.js';
import { familyOf } from './catalog.js';
import { LAB_APP } from './lab-device.js';
import { CAROUSEL_CASES, hedgedCeiling, type DeviceLog, type PreDragged, type SwipeEntry } from './live-carousel.js';
import { knownEntry, knownLive } from './live-known.js';
import { judgeFullWindow, judgeHeldNo } from './live-ensure.js';
import { FLOATING_PANEL_EVIDENCE, holds, holdsShown, judgeFloatingGap, judgeMissUnderSheet, judgeNoteFill, judgePhoneAfterBack, judgePhoneScroll, judgeUnderSheet, refusedCapped, refusedKept, refusedUnchanged, short, type Source, valueOf } from './live-forms.js';
import { judgeDismissal, PRESENTED_WINDOW_CELLS, presentedAssertCase, visibilityCases, type LiveVerdict, type RunsUnder } from './live-visibility.js';
import { allPassed, claimsTap, isError } from './replies.js';
import { appOf, labId, labSelector, parseLabApp, type Catalog, type CellTruth, type HeldSpec, type LabApp, type LabState } from './schema.js';

/**
 * The live golden's cases and their judging, no device (scripts/truth/live.ts is the CLI that runs them): the forms
 * cases, the visibility cases built from the cells' static truth, the dismissal cases, the carousel group's
 * (live-carousel.ts); `judged` (a case's reads, the
 * late one included); `summarize` (the report and the exit code, against live-known.ts); and `rejudge` — a recorded
 * run judged again by this checkout's judges, in process: what `live.ts --rejudge <record>` prints, and what
 * tests/truth/live-rejudge.test.ts reads without a node process a record.
 */

/** The side of a run of this checkout's own src (`--side` unset): the one live-known.ts holds to its entries. */
export const THIS_CHECKOUT = 'this checkout';

/** The averi checkout (its root): the catalog, the truth runs, and live.ts's own src when no `--side` is given. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The prefixes of a `--side` checkout's label outside the repo (sideLabel): a calibration checkout's, any other's. */
export const SIDE_LABEL = { cal: '<cal>', scratch: '<scratch>' } as const;

/**
 * The `side` a record names (T8): THIS_CHECKOUT with no `--side`; otherwise a portable label — never the host's
 * absolute path (a record is committed) and never THIS_CHECKOUT (a `--side` run is a calibration, not held to
 * live-known.ts: summarize). A checkout inside the repo by its repo-relative path ("." the repo itself); one outside
 * by its folder, under SIDE_LABEL.cal when it is calibrate.ts's `differential-cal-<sha>`, else under SIDE_LABEL.scratch.
 * A relative `--side` resolves from `cwd`, as live.ts loads it.
 */
export function sideLabel(side: string | undefined, { root = ROOT, cwd = process.cwd() }: { root?: string; cwd?: string } = {}): string {
  if (side === undefined) return THIS_CHECKOUT;
  const path = resolve(cwd, side);
  const inRepo = relative(root, path);
  const outside = inRepo === '..' || inRepo.startsWith(`..${sep}`) || isAbsolute(inRepo);
  if (!outside) return inRepo === '' ? '.' : inRepo;
  const dir = basename(path);
  return `${dir.startsWith('differential-cal-') ? SIDE_LABEL.cal : SIDE_LABEL.scratch}/${dir}`;
}

/**
 * A record's `side` that names no host: THIS_CHECKOUT, a label sideLabel writes, or an older relative one (`../r8`) —
 * never absolute, never under a home (`~`), never empty.
 */
export function isPortableSide(side: unknown): boolean {
  return side === THIS_CHECKOUT || (typeof side === 'string' && side !== '' && !isAbsolute(side) && !side.startsWith('~'));
}

/** What a run read, case by case (`--record`): judged again without a device by `--rejudge`. */
export interface RunRecord {
  platform: Platform;
  /** The lab app the run drove; absent on records before round 7: the native one. */
  app?: LabApp;
  side: string;
  results: {
    source: Source;
    id: string;
    skip?: string;
    replies: string[];
    /** The state the calls started from: the launch's, or — a case with a pre-drag — the one read after it. */
    launched: LabState;
    after: (LabState | undefined)[];
    state: LabState | undefined;
    late?: LabState;
    warmUpError?: string;
    /** A carousel case's raw pre-drag (Case.preDrag) and the launch's state before it. */
    preDrag?: PreDragged;
    /** A carousel case's strokes as averi drew them during its calls, a dropped one marked (Case.dropSwipe). */
    swipes?: SwipeEntry[];
  }[];
}

// --- the cases ---

export interface Call {
  tool: 'type_text' | 'tap' | 'scroll_until' | 'assert' | 'run_flow' | 'press_key' | 'ensure_state' | 'ui_snapshot' | 'swipe';
  args: Record<string, unknown>;
}

export interface Case extends RunsUnder {
  id: string;
  group: 'forms' | 'visibility' | 'dismissal' | 'ensure' | 'carousel';
  cell: string;
  says: string;
  /** averi.yaml `app.ios.keyboardDismiss` for this case. */
  dismiss?: unknown[];
  /** averi.yaml `flows` for this case: what its `run_flow` calls name, and its `states`' reach rungs. */
  flows?: Record<string, unknown>;
  /** averi.yaml `states` for this case: what its `ensure_state` calls name. */
  states?: Record<string, unknown>;
  /** The case is about the soft keyboard: judged only when the launch shows it (else SKIP). */
  keyboard?: true;
  /**
   * Android: right after the launch, the IME window's touchable region is read (LabDevice.imeTouchable) into
   * `launched.imeTouchable` — the floating panel the kf cases are judged against (live-forms.ts#measuredPanel) — and
   * again after the calls into `state.imeTouchable` (D69: the two must agree, live-forms.ts#panelAfterCalls).
   */
  measuresPanel?: true;
  /**
   * Bind the case's tree source before its launch — one `ui_snapshot` under its config, the reply kept only when it
   * failed (RunRecord `warmUpError`): a case timed from the launch (live-ensure.ts) must not lose its first seconds to
   * WDA starting or idb's companion coming up.
   */
  warmUp?: true;
  /** A SKIP of the case proves nothing and fails the run (summarize): the ensure cases'. */
  skipFails?: true;
  /** The platforms it runs on (both when unset). */
  platforms?: readonly Platform[];
  /**
   * Android, the carousel group: a raw drag of this many px left on the carousel after the launch, before the calls
   * (live-carousel.ts#preDrag) — `launched` is then the state read after it.
   */
  preDrag?: number;
  /** Android, the carousel group: the Nth stroke averi draws during the calls is not sent (live-carousel.ts#SwipeHook). */
  dropSwipe?: number;
  calls: Call[];
  /**
   * `launched`: the model as the launch left it, before any call — what a LOUD case's field held. `after[i]`: the state
   * read right after call i, for a visibility case (its stop judged before the tap after it ran); else empty. `log`: the
   * strokes averi drew during the calls (a carousel case's; RunRecord `swipes`).
   */
  judge(state: LabState, replies: string[], source: Source, launched: LabState, after: readonly (LabState | undefined)[], log?: DeviceLog): LiveVerdict;
}

const id = labSelector;
const fill = (cell: string, tag: string, text: string, clear?: boolean): Call => ({
  tool: 'type_text',
  args: { selector: id(cell, tag), text, ...(clear !== undefined && { clear }) },
});
const P = 'form-prefilled';
const RN = 'rn-field';
const B = 'form-basic';
const K = 'form-keyboard';
const KF = 'form-keyboard-floating';
const TITLE = { tap: { text: 'Transfer details' } };
const F = 'form-format';
const RF = 'rn-format';
const G = 'form-grouped';
const RFE = 'rn-format-eager';
const NBSP = '\u00A0';
/** A flow that taps a field and types into it with a `type:` step (blind: no read-back), or fills it with a `fill:` one. */
const typeFlow = (cell: string, tag: string, value: string) => ({ type_it: { steps: [{ tap: { id: labId(cell, tag) } }, { type: { value } }] } });
const fillFlow = (cell: string, tag: string, value: string) => ({ fill_it: { steps: [{ fill: { id: labId(cell, tag), value, clear: true } }] } });
/** A flow that taps a field and types digits into it with a `type_pin:` step (blind, one keystroke a digit). */
const pinFlow = (cell: string, tag: string, value: string) => ({ pin_it: { steps: [{ tap: { id: labId(cell, tag) } }, { type_pin: { value } }] } });
/** An assert that the field's text in the tree reads `text` — what the screen shows, beside the model the judge reads. */
const shows = (cell: string, tag: string, text: string): Call => ({ tool: 'assert', args: { asserts: [{ element: { id: labId(cell, tag) }, text, timeout: 2_000 }] } });

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
  // L2 (docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md) is the same screen
  // on iOS — Continue in the bottom safe-area inset, lifted onto the keyboard over phone's centre — and the judges read
  // only what both apps log (submits, focus, the frames of phone and `submit.bar`, the keyboard), so both platforms.
  {
    id: 'k6',
    cell: K,
    keyboard: true,
    says: 'a tap on phone, under the bar riding on the keyboard: never a submit — refused, or tapped where it focuses phone',
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
    says: 'scroll_until phone, under the bar riding on the keyboard: no stop while its centre lies under the bar or the keyboard, never a submit (the strokes counted)',
    calls: [{ tool: 'scroll_until', args: { selector: id(K, 'phone'), direction: 'down' } }],
    judge: (s, replies, source, launched) => judgePhoneScroll(s, replies, source, launched),
  },
  // Phone after back (docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md):
  // k7's launch, `back` hides the IME, then `fully: true` on phone — the next field's title over its touch target's margin.
  {
    id: 'k7f',
    cell: K,
    keyboard: true,
    platforms: ['android'],
    says: 'after back hid the IME, scroll_until phone fully: true: "fully visible" where phone is drawn whole, its touch target under the next title judged on one screenshot',
    calls: [
      { tool: 'press_key', args: { key: 'back' } },
      { tool: 'scroll_until', args: { selector: id(K, 'phone'), direction: 'down', fully: true } },
    ],
    judge: (s, replies, source, launched) => judgePhoneAfterBack(s, replies, source, launched),
  },
  // FU1 (docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md):
  // Gboard floated by hand (no adb setting does it), its panel over the form and the pinned submit in the strip below it
  // — live-forms.ts#judgeFloatingGap, against the panel the IME's region names at launch and again after the calls
  // (measuresPanel, D69); a run whose Gboard came up docked is SKIP, and so is one where the panel does not lie as the
  // case's premise needs.
  {
    id: 'kf1',
    cell: KF,
    keyboard: true,
    measuresPanel: true,
    platforms: ['android'],
    says: 'scroll_until the submit between a floating keyboard\'s panel and its strip: visible with no stroke (the panel evidenced over ks first)',
    calls: [FLOATING_PANEL_EVIDENCE, { tool: 'scroll_until', args: { selector: id(KF, 'submit'), direction: 'down' } }],
    judge: judgeFloatingGap('kf1'),
  },
  {
    id: 'kf2',
    cell: KF,
    keyboard: true,
    measuresPanel: true,
    platforms: ['android'],
    says: 'scroll_until the submit there, then tap it: one submit, the IME still up',
    calls: [
      FLOATING_PANEL_EVIDENCE,
      { tool: 'scroll_until', args: { selector: id(KF, 'submit'), direction: 'down' } },
      { tool: 'tap', args: { selector: id(KF, 'submit') } },
    ],
    judge: judgeFloatingGap('kf2'),
  },
  {
    id: 'kf3',
    cell: KF,
    keyboard: true,
    measuresPanel: true,
    platforms: ['android'],
    says: 'scroll_until ks, under the floating panel: never visible while its centre lies in the panel, no key typed',
    calls: [{ tool: 'scroll_until', args: { selector: id(KF, 'ks'), direction: 'down' } }],
    judge: judgeFloatingGap('kf3'),
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
  // D43a (ADR 0037): a character averi cannot type, into the prefill — refused before the tap, the prefill kept. Under
  // idb and uiautomator only since D43 (ADR 0037's D43 amendment): WDA types `Š` through `/wda/keys` — p7w.
  { id: 'p7', cell: P, sources: ['idb', 'uiautomator'], says: 'a no-clear fill of a character averi cannot type (Š) is refused, the prefill kept', calls: [fill(P, 'name', 'Š')], judge: refusedKept('name') },
  { id: 'p7w', cell: P, platforms: ['ios'], sources: ['wda'], says: 'a no-clear fill of Š under WDA (/wda/keys) keeps the prefill and appends it', calls: [fill(P, 'name', 'Š')], judge: holds('name', 'Jan ŠťastnýŠ') },
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
  // …and name beneath it asked by an assert and a flow's wait: (round 7's code review, A3's harness cases): each fails,
  // its not-found saying the sheet's remedy once — live-forms.ts#judgeMissUnderSheet. Android: the hint is
  // uiautomator's; an iOS run of them is unmeasured.
  ...[
    { asks: 'an assert on', call: { tool: 'assert' as const, args: { asserts: [{ element: { id: 'lab.form-picker.name' }, timeout: 3_000 }] } } },
    { asks: 'a colour assert on', call: { tool: 'assert' as const, args: { asserts: [{ element: { id: 'lab.form-picker.name' }, color: { expected: '#FFFFFF' }, timeout: 5_000 }] } } },
    { asks: "a flow's wait: on", call: { tool: 'run_flow' as const, args: { flow: 'wait_name' } } },
  ].map(({ asks, call }, i) => ({
    id: `c${i + 5}`,
    cell: 'form-picker',
    platforms: ['android'] as const,
    says: `${asks} name beneath the picker sheet, open and fully expanded: it fails, nothing fires, the not-found says to close the sheet once`,
    ...(call.tool === 'run_flow' && { flows: { wait_name: { steps: [{ wait: { element: { id: 'lab.form-picker.name' }, timeout: '3s' } }] } } }),
    calls: [call],
    judge: judgeMissUnderSheet('name'),
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
  // D18: fields that reformat as they are typed (form-format; schema.ts#FieldFormat) — the model holds the formatted
  // text (iban grouped in fours, the amount's thousands by a no-break space), or, ibanShown on Compose, the text as
  // typed with only the screen grouped (a VisualTransformation; elsewhere ibanShown formats its model as iban does).
  { id: 'f1', cell: F, says: 'fill, no clear, an IBAN the field groups in fours', calls: [fill(F, 'iban', 'SK3112000000'), shows(F, 'iban', 'SK31 1200 0000')], judge: holdsShown('iban', 'SK31 1200 0000') },
  { id: 'f2', cell: F, says: 'fill, clear, an IBAN the field groups in fours', calls: [fill(F, 'iban', 'SK3112000000', true), shows(F, 'iban', 'SK31 1200 0000')], judge: holdsShown('iban', 'SK31 1200 0000') },
  { id: 'f3', cell: F, says: 'fill, clear, an amount the field groups by thousands', calls: [fill(F, 'amount', '1234567,89', true), shows(F, 'amount', `1${NBSP}234${NBSP}567,89`)], judge: holdsShown('amount', `1${NBSP}234${NBSP}567,89`) },
  { id: 'f4', cell: F, platforms: ['android'], says: 'fill, clear, an IBAN grouped on the screen only (the model as typed)', calls: [fill(F, 'ibanShown', 'SK3112000000', true)], judge: holds('ibanShown', 'SK3112000000') },
  { id: 'f5', cell: F, says: 'fill, no clear, an IBAN typed with its own spaces', calls: [fill(F, 'iban', 'SK31 1200 0000')], judge: holds('iban', 'SK31 1200 0000') },
  {
    id: 'f6',
    cell: F,
    says: 'fill an IBAN, then type_text without a selector types on into the grouping field',
    calls: [fill(F, 'iban', 'SK31'), { tool: 'type_text', args: { text: '12000000' } }],
    judge: holds('iban', 'SK31 1200 0000'),
  },
  {
    id: 'f7',
    cell: F,
    says: 'a clear alone empties the grouping field, then a fill',
    calls: [fill(F, 'iban', 'SK3112'), fill(F, 'iban', '', true), fill(F, 'iban', 'CZ6508000000')],
    judge: holds('iban', 'CZ65 0800 0000'),
  },
  { id: 'f8', cell: F, says: "a flow's tap + `type:` into the grouping field", flows: typeFlow(F, 'iban', 'SK3112000000'), calls: [{ tool: 'run_flow', args: { flow: 'type_it' } }], judge: holds('iban', 'SK31 1200 0000') },
  { id: 'f9', cell: F, says: "a flow's `fill:` (clear) into the grouping field", flows: fillFlow(F, 'iban', 'SK3112000000'), calls: [{ tool: 'run_flow', args: { flow: 'fill_it' } }], judge: holds('iban', 'SK31 1200 0000') },
  { id: 'f10', cell: F, says: "a flow's tap + `type_pin:` into the amount field that groups by thousands", flows: pinFlow(F, 'amount', '1234567'), calls: [{ tool: 'run_flow', args: { flow: 'pin_it' } }], judge: holds('amount', `1${NBSP}234${NBSP}567`) },
  // D37: a dotted date (schema.ts#FieldFormat's `date`; ADR 0034 failed it by rule until D51) under a placeholder with no letter or
  // digit (`__.__.____`), and a phone that does not reformat under a `+421` placeholder — ADR 0034's D29 gaps. Batch-3
  // ran them (main 6b4a44df): f11 failed-holds under every source, f12–f14 ok; D51 (ADR 0034's amendment) fixed f11.
  { id: 'f11', cell: F, says: 'fill, no clear, a date the field dots as typed', calls: [fill(F, 'date', '31122026'), shows(F, 'date', '31.12.2026')], judge: holdsShown('date', '31.12.2026') },
  { id: 'f12', cell: F, says: 'fill, clear, a date typed with its own dots into the field that dots it', calls: [fill(F, 'date', '31.12.2026', true)], judge: holds('date', '31.12.2026') },
  { id: 'f13', cell: F, says: 'fill, no clear, a phone number under a `+421` placeholder', calls: [fill(F, 'phone', '421903123456')], judge: holds('phone', '421903123456') },
  { id: 'f14', cell: F, says: 'fill, clear, a phone number with its `+421` under a `+421` placeholder', calls: [fill(F, 'phone', '+421903123456', true)], judge: holds('phone', '+421903123456') },
  // D63: the date field keeps 8 digits, so a no-clear `2026` after a full date changes nothing, though the field's text
  // holds it; averi must say the field did not change, not Filled (live-forms.ts#refusedUnchanged). Not yet run on a device.
  // A `loud-changed` here points to the caret landing inside the text (the cap then keeps other digits), not to D63.
  { id: 'f15', cell: F, says: 'fill, clear, a full date; then, no clear, digits the full field refuses though its text holds them: did not change', calls: [fill(F, 'date', '31122026', true), fill(F, 'date', '2026')], judge: refusedUnchanged('date', '31.12.2026') },
  // D64: the date field keeps 8 digits, so a no-clear `12` after `31.12.202` keeps the `1` alone — `31.12.2021`, a reading
  // that holds `12` only inside the earlier text; averi must fail it, not say Filled (live-forms.ts#refusedCapped). Not
  // yet run on a device. A `loud-changed` here points to the caret landing inside the text (the cap then keeps other
  // digits), not to D64.
  { id: 'f16', cell: F, says: 'fill, clear, a date one digit short; then, no clear, two digits the field keeps only the first of, though its text holds them: refused', calls: [fill(F, 'date', '3112202', true), fill(F, 'date', '12')], judge: refusedCapped('date', '31.12.2021') },
  // L7: form-grouped (D60, D37's `+421`) — ibanEager adds a space as soon as a group of four is complete (group4eager:
  // `SK31` shows `SK31 `), phoneGrouped groups a phone number in threes under a `+421` placeholder (phone3). Read on
  // the device by batch-9 and batch-10 (docs/truth/live-records/*-forms-l7-1.json, *-forms-d61-*.json). g2 ends on a
  // complete group: the field shows the eager space after it, a reading that does not land (fill-landing.ts) and reads
  // D53's `separated` — averi refuses it by design while the app holds the value: an EXPECTED MISMATCH failed-holds
  // under iOS's idb and wda, said in its `says` and filed in live-known.ts (ADR 0034 residual 10); ok on Android, where
  // the reading judged had no trailing space.
  { id: 'g1', cell: G, says: 'fill, clear, an IBAN into the field that spaces each group as it ends', calls: [fill(G, 'ibanEager', 'SK3112000000123', true), shows(G, 'ibanEager', 'SK31 1200 0000 123')], judge: holdsShown('ibanEager', 'SK31 1200 0000 123') },
  { id: 'g2', cell: G, says: 'fill, no clear, an IBAN ending on a complete group: the field shows the eager space after it — expected MISMATCH failed-holds by design on iOS (idb, wda; D53 `separated`: averi refuses the trailing mark, the app holds the value); ok on Android (the reading judged there has no trailing space)', calls: [fill(G, 'ibanEager', 'SK3112000000')], judge: holds('ibanEager', 'SK31 1200 0000 ') },
  { id: 'g3', cell: G, says: 'fill, no clear, a phone number the field groups in threes under a `+421` placeholder', calls: [fill(G, 'phoneGrouped', '421903123456')], judge: holds('phoneGrouped', '421 903 123 456') },
  { id: 'g4', cell: G, says: 'fill, clear, a phone number with its `+421` into the field that groups it', calls: [fill(G, 'phoneGrouped', '+421903123456', true)], judge: holds('phoneGrouped', '+421 903 123 456') },
  { id: 'g5', cell: G, says: 'fill, no clear, a phone number typed with its own spaces into the field that groups it', calls: [fill(G, 'phoneGrouped', '+421 903 123 456')], judge: holds('phoneGrouped', '+421 903 123 456') },
  // The same on React Native (`--app react-native`): rn-format's fields, onChangeText reformatting (src/format.ts).
  { id: 'rf1', cell: RF, says: 'fill, no clear, the RN field that groups an IBAN in fours', calls: [fill(RF, 'G.field', 'SK3112000000')], judge: holds('G', 'SK31 1200 0000') },
  { id: 'rf2', cell: RF, says: 'fill, clear, the RN field that groups an amount by thousands', calls: [fill(RF, 'A.field', '1234567,89', true)], judge: holds('A', `1${NBSP}234${NBSP}567,89`) },
  {
    id: 'rf3',
    cell: RF,
    says: 'fill the RN grouping field, then type_text without a selector types on',
    calls: [fill(RF, 'G.field', 'SK31'), { tool: 'type_text', args: { text: '12000000' } }],
    judge: holds('G', 'SK31 1200 0000'),
  },
  { id: 'rf4', cell: RF, says: "a flow's tap + `type:` into the RN grouping field", flows: typeFlow(RF, 'G.field', 'SK3112000000'), calls: [{ tool: 'run_flow', args: { flow: 'type_it' } }], judge: holds('G', 'SK31 1200 0000') },
  { id: 'rf5', cell: RF, says: "a flow's tap + `type_pin:` into the RN amount field", flows: pinFlow(RF, 'A.field', '1234567'), calls: [{ tool: 'run_flow', args: { flow: 'pin_it' } }], judge: holds('A', `1${NBSP}234${NBSP}567`) },
  // L7: rn-format-eager's E (group4eager), D60's live path — React Native on iOS drops a fill's tail (D40's rf1, a
  // 12-character IBAN: "the last 4 … typed again" under idb, "the last 2" under wda), here behind an eager mark. The
  // values put those drops on a group's end, so the reading at the drop ends in the eager space (prefixOf's eager-mark
  // dropped tail) and the full one lands: rfe1 24 characters (4 dropped → 20, `… 4263 `; the full 24 take no mark),
  // rfe2 10 (2 dropped → 8, `SK31 1200 `; the full 10 end mid-group). rfe3 is g2 on React Native: 12 characters, the
  // full reading ends in the mark — an EXPECTED MISMATCH by design on iOS (D53 `separated`), filed in live-known.ts
  // (ADR 0034 residual 10). Read on the device by batch-9 under idb and wda, ×5 each (docs/truth/live-records/
  // ios-rn-*-forms-l7-*.json): rfe1 and rfe2 ok 20 of 20, rfe3 that MISMATCH ×10.
  { id: 'rfe1', cell: RFE, says: 'fill, clear, 24 characters into the RN eager field: a drop of the last 4 leaves `… 4263 ` (the eager mark), the full value takes none', calls: [fill(RFE, 'E.field', 'SK3112000000198742637541', true)], judge: holds('E', 'SK31 1200 0000 1987 4263 7541') },
  { id: 'rfe2', cell: RFE, says: 'fill, no clear, 10 characters into the RN eager field: a drop of the last 2 leaves `SK31 1200 ` (the eager mark), the full value ends mid-group', calls: [fill(RFE, 'E.field', 'SK31120000')], judge: holds('E', 'SK31 1200 00') },
  { id: 'rfe3', cell: RFE, says: 'fill, no clear, an IBAN ending on a complete group into the RN eager field — expected MISMATCH failed-holds by design on iOS (idb, wda; D53 `separated`: averi refuses the trailing mark, the app holds the value); React Native on Android unread', calls: [fill(RFE, 'E.field', 'SK3112000000')], judge: holds('E', 'SK31 1200 0000 ') },
];

// --- the ensure group (backlog D30, ADR 0033): D2's held "no" on a device ---

/**
 * ensure_state on the held cells (fixtures/apps/cells/held.json): `home` detects Home, its ladder's first rung
 * `continue` taps Continue and waits for Home; h3's ladder ends in `wipe`, a flow marked `destructive: true` (a wait on
 * Home that never runs: Continue reaches Home first) — a wipe ahead, so the second look keeps its full window
 * (live-ensure.ts). Not in the default groups: `--groups ensure`; a SKIP among them fails the run (summarize).
 */
const ensureConfig = (cell: string, { wipeAhead = false }: { wipeAhead?: boolean } = {}) => ({
  states: { home: { detect: { element: { id: labId(cell, 'home') } }, reach: ['continue', ...(wipeAhead ? ['wipe'] : [])] } },
  flows: {
    continue: { steps: [{ tap: { id: labId(cell, 'continue') } }, { wait: { element: { id: labId(cell, 'home') }, timeout: '5s' } }] },
    ...(wipeAhead && { wipe: { destructive: true, steps: [{ wait: { element: { id: labId(cell, 'home') }, timeout: '1s' } }] } }),
  },
});
/** What every ensure case shares: its one call, its tree source bound before the launch, a SKIP failing the run. */
const ENSURE_CASE = { calls: [{ tool: 'ensure_state', args: { state: 'home' } }] as Call[], warmUp: true, skipFails: true } as const;
/** An ensure case: its judge made from its cell's catalog `held` (selectCases). */
type EnsureCase = Omit<Case, 'group' | 'judge'> & { judgeOf: (spec: HeldSpec) => Case['judge'] };
const ENSURE: EnsureCase[] = [
  { id: 'h1', cell: 'held-no', says: 'ensure_state from a bare launch onto Welcome, no wipe ahead: the hold ends the look heldS after Welcome, said in one line', ...ensureConfig('held-no'), ...ENSURE_CASE, judgeOf: judgeHeldNo },
  { id: 'h2', cell: 'held-no-spinner', says: 'the same through 4 s of an unlabelled spinner: the hold carries across a spinner phase — Continue tapped only once Welcome itself has held (the spinner\'s idb spelling is block G\'s raw describe-all check)', ...ensureConfig('held-no-spinner'), ...ENSURE_CASE, judgeOf: judgeHeldNo },
  { id: 'h3', cell: 'held-no', says: 'the same with a destructive rung after Continue: no hold — the look keeps its full window', ...ensureConfig('held-no', { wipeAhead: true }), ...ENSURE_CASE, judgeOf: judgeFullWindow },
];

/**
 * The averi.yaml a case runs under, as live.ts#configFor writes it (JSON is YAML): the lab app's identity, on iOS its
 * tree source and the case's `keyboardDismiss`, and the case's `flows` and `states`.
 */
export function caseConfig(source: Source, c: Pick<Case, 'dismiss' | 'flows' | 'states'>, app: LabApp): Record<string, unknown> {
  const { dismiss, flows, states } = c;
  const ios = source === 'uiautomator' ? {} : { ios: { bundleId: LAB_APP[app].bundle, treeSource: source, ...(dismiss !== undefined && { keyboardDismiss: dismiss }) } };
  return { app: { android: { package: LAB_APP[app].package }, ...ios }, ...(states !== undefined && { states }), ...(flows !== undefined && { flows }) };
}

// --- phase 5: the visibility cells, from their static truth ---

let catalogRead: Promise<Catalog> | undefined;
/** The lab's catalog (fixtures/apps/cells.json), read once. */
export const catalogOf = (): Promise<Catalog> => (catalogRead ??= readFile(join(ROOT, 'fixtures/apps/cells.json'), 'utf8').then((t) => JSON.parse(t) as Catalog));
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

/** Which cases a run takes: `--groups`, `--cases`, `--cells`, the platform, and the run's lab app (schema.ts#appOf). */
export interface Selection {
  platform: Platform;
  app: LabApp;
  groups: readonly string[];
  /** `--cases`: these ids only. */
  only?: readonly string[];
  /** `--cells`: the visibility and dismissal cases of these cells only. */
  onlyCells?: readonly string[];
}

/** The cases of a run, in the order it runs them: the forms, the ensure group's, the carousel group's, then the visibility cells', then the dismissal's. */
export async function selectCases({ platform, app, groups, only, onlyCells }: Selection): Promise<Case[]> {
  const catalog = await catalogOf();
  const heldOf = (cell: string): HeldSpec => {
    const spec = catalog.cells.find((x) => x.id === cell)?.held;
    if (spec === undefined) throw new Error(`catalog: held cell ${cell} has no \`held\` (fixtures/apps/cells/held.json)`);
    return spec;
  };
  const cases: Case[] = [
    ...FORMS.map((c) => ({ ...c, group: 'forms' as const })),
    ...ENSURE.map(({ judgeOf, ...c }) => ({ ...c, group: 'ensure' as const, judge: judgeOf(heldOf(c.cell)) })),
    ...CAROUSEL_CASES.map((c) => ({ ...c, group: 'carousel' as const })),
  ];
  if (groups.includes('visibility')) {
    for (const truth of await truthsOf(platform, app)) {
      if (truth.targets.length === 0 || (onlyCells !== undefined && !onlyCells.includes(truth.cell))) continue;
      const asserts = PRESENTED_WINDOW_CELLS.includes(truth.cell) ? truth.targets.filter((t) => t.declared === 'presented-over').map((t) => presentedAssertCase(truth.cell, t)) : [];
      for (const v of [...visibilityCases(truth, platform), ...asserts]) cases.push({ ...v, group: 'visibility', judge: (s, replies, source, launched, after) => v.judge(s, replies, launched, source, after) });
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
        cases.push({
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
  // The run's lab app's cells only (schema.ts#appOf).
  return cases.filter((x) => groups.includes(x.group) && appOf(familyOf(catalog, x.cell)) === app && (only === undefined || only.includes(x.id)) && (x.platforms === undefined || x.platforms.includes(platform)));
}

// --- judging ---

export type Result = { source: Source; c: Case; verdict: LiveVerdict; replies: string[] };

/** What a rejudge selects by: a selection whose platform is the record's, and its app the record's when it names one. */
export type RejudgeSelection = Omit<Selection, 'platform' | 'app'> & { app?: LabApp };

/**
 * Judge one case's reads: the state after the calls; a forms case not ok is read again 3 s later (`late`: a model that
 * catches up was the app's lag, not a lost value) — never a visibility case, whose stop is judged on the state read
 * when scroll_until returned, and which a later read would let a fling finish behind the reply's back. When the re-read
 * comes out the same, the first read's verdict is kept whole — its cls and kind included. The late read is the app's
 * only: the IME region read after the calls (`state.imeTouchable`, a kf case's second read, D69) is carried onto it, so
 * a later read can never turn a verdict over both reads into one over the launch's alone (`lateWithPanel`).
 */
export function judged(c: Case, source: Source, replies: string[], launched: LabState, after: (LabState | undefined)[], state: LabState, late: LabState | undefined, swipes?: SwipeEntry[]): LiveVerdict {
  const log: DeviceLog = swipes === undefined ? {} : { swipes };
  const verdict = c.judge(state, replies, source, launched, after, log);
  if (verdict.outcome === 'ok' || late === undefined) return verdict;
  const again = c.judge(lateWithPanel(state, late), replies, source, launched, after, log);
  return again.outcome === verdict.outcome ? verdict : { ...again, why: `${again.why} (only 3 s later; first read: ${verdict.why})` };
}

/** `late` with the IME region read after the calls (`state.imeTouchable`), where it read none of its own. */
export const lateWithPanel = (state: LabState, late: LabState): LabState =>
  late.imeTouchable !== undefined || state.imeTouchable === undefined ? late : { ...late, imeTouchable: state.imeTouchable };

/** A recorded run judged again with this checkout's judges, no device: the cases `selection` takes, in record order. */
export async function rejudgedResults(record: RunRecord, selection: RejudgeSelection): Promise<Result[]> {
  const selected = await selectCases({ ...selection, platform: record.platform, app: record.app ?? selection.app ?? parseLabApp(undefined) });
  const results: Result[] = [];
  for (const r of record.results) {
    const c = selected.find((x) => x.id === r.id);
    if (c === undefined) continue;
    const verdict: LiveVerdict = r.skip !== undefined || r.state === undefined ? { outcome: 'SKIP', why: r.skip ?? 'no state recorded' } : judged(c, r.source, r.replies, r.launched, r.after, r.state, r.late, r.swipes);
    results.push({ source: r.source, c, verdict, replies: r.replies });
  }
  return results;
}

// --- the summary: every case, a known one marked with its note (live-known.ts); exit 1 on an unknown MISMATCH, and on
// a known case not intermittent that came out ok in a run of this checkout (fixed: strike it off), and on a SKIP of a
// case marked skipFails ---

/** What a run (or a rejudged record) reports: the summary's lines, as live.ts prints them, and its exit code. */
export interface Summary {
  lines: string[];
  exitCode: 0 | 1;
}

/**
 * The summary of a run's results. `side`: the averi the run drove (THIS_CHECKOUT, or a `--side` checkout — a
 * calibration, never held to live-known.ts); `rejudgedFrom`: the record's path, when the results are a record's.
 */
export function summarize({ platform, sources, results, side, rejudgedFrom }: { platform: Platform; sources: readonly Source[]; results: readonly Result[]; side: string; rejudgedFrom?: string }): Summary {
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
  const ofThisCheckout = side === THIS_CHECKOUT;
  /** Known, ok this run, and not intermittent: fixed without being struck off (live-known.ts's ratchet). */
  const fixed = ofThisCheckout ? cleared.filter((r) => knownEntry(platform, r.source, r.c.id)?.intermittent !== true) : [];
  /** A case whose SKIP proves nothing (Case.skipFails: the ensure cases, live-ensure.ts): the run fails on it. */
  const failingSkips = results.filter((r) => r.c.skipFails === true && r.verdict.outcome === 'SKIP');
  const lines = [
    `<!-- averi: ${side}${rejudgedFrom !== undefined ? ` (rejudged from ${rejudgedFrom})` : ''} -->`,
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
  if (failingSkips.length > 0) lines.push(`SKIPPED where a skip proves nothing — the run fails: ${failingSkips.map((r) => `${r.source} ${r.c.id}`).join(', ')}`, '');
  // An ok on a reply accepted under a residual (LiveVerdict.accepted): counted, per residual, against the runs of the
  // cases that accept it.
  for (const residual of [...new Set(results.flatMap((r) => (r.verdict.accepted === undefined ? [] : [r.verdict.accepted])))]) {
    const ids = new Set(results.filter((r) => r.verdict.accepted === residual).map((r) => r.c.id));
    const of = results.filter((r) => ids.has(r.c.id) && r.verdict.outcome !== 'SKIP');
    const counted = results.filter((r) => r.verdict.accepted === residual);
    lines.push(`Accepted under ${residual}: ${counted.length} of ${of.length} judged run(s) of ${[...ids].join(', ')}`, '');
  }
  // The carousel group's ceiling on that acceptance (live-carousel.ts#hedgedCeiling): every judged unaimable leg hedged fails the run.
  const ceiling = hedgedCeiling(results.map((r) => ({ id: r.c.id, outcome: r.verdict.outcome, ...(r.verdict.accepted !== undefined && { accepted: r.verdict.accepted }) })), ofThisCheckout);
  if (ceiling.lines.length > 0) lines.push(...ceiling.lines, '');
  return { lines, exitCode: unknown.length > 0 || fixed.length > 0 || failingSkips.length > 0 || ceiling.fails ? 1 : 0 };
}

/**
 * `live.ts --rejudge <record>`, in process: the record judged again by this checkout's judges and summarized — the
 * lines the CLI prints and its exit code. `from` is the record's path as the CLI was given it (the summary's header).
 */
export async function rejudge(record: RunRecord, from: string, selection: RejudgeSelection): Promise<Summary> {
  const results = await rejudgedResults(record, selection);
  const sources = [...new Set(record.results.map((r) => r.source))];
  return summarize({ platform: record.platform, sources, results, side: record.side, rejudgedFrom: from });
}
