import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { dismissalOf, expectations, formExpectations, type Expectation } from '../../scripts/differential/golden-spec.js';
import { readDismissalProbe } from '../../scripts/truth/truth.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// Phase 3 B5's rows (scripts/differential/golden-spec/false-covers.ts and the shared-identifier form row of
// golden-spec/forms.ts): what lies over a target in a tree yet is no cover — a text's own control, a toolbar over the
// keyboard dismissal — and a title that is no error.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const out = (reply: string, device: string[] = []): Outcome => ({ reply, device });
const by = (rows: readonly Expectation[], verb: string) => {
  const r = rows.find((x) => x.verb === verb);
  if (r === undefined) throw new Error(`no ${verb} row`);
  return r;
};

describe('a text target on its own control (own-parts: #8, #18)', () => {
  const t: TargetTruth = {
    tag: 'L',
    id: 'lab.own-parts.L',
    text: 'LOGIN',
    color: '#3949AB',
    declared: 'open',
    frame: rect(489, 389, 102, 46),
    reached: true,
    probe: [{ kind: 'touch', tag: '540,412' }],
    drawn: 0.97,
    seen: '#3949AB',
  };
  const rows = expectations('android', t, undefined, 'uiautomator');

  it('asks a tap and a scroll_until by its text, never its colour — then its text rows (golden-spec/text.ts)', () => {
    expect(rows.filter((r) => r.verb === 'tap' || r.verb === 'scroll_until').map((r) => `${r.verb} ${String(r.call.args.selector)} ${r.says}`)).toEqual(['tap text:"LOGIN" Tapped at its probe point (540,412)', 'scroll_until text:"LOGIN" reached with no swipe']);
    expect(rows.map((r) => r.verb)).toEqual(['tap', 'scroll_until', 'text', 'ocr']);
  });
  it('tap: Tapped; refused as under its own button is the mismatch (#8)', () => {
    expect(by(rows, 'tap').judge(out('Tapped text:"LOGIN"', ['adb shell input tap 540 412']))).toBeUndefined();
    expect(by(rows, 'tap').judge(out('ERROR text:"LOGIN" is under button (171,346 738x168) at its centre (540,412), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped'))).toMatch(
      /^not tapped: .*under button/,
    );
  });
  it('scroll_until: reached with no swipe; the "layout defect" stop is the mismatch', () => {
    expect(by(rows, 'scroll_until').judge(out('Element text:"LOGIN" visible after 0 swipes'))).toBeUndefined();
    expect(by(rows, 'scroll_until').judge(out('ERROR scroll_until text:"LOGIN" failed after 2 swipes — under button …', ['adb shell input swipe 540 1776 540 444 1334']))).toMatch(/^stopped: /);
  });
  it('a text target not drawn as its control, or not reached, asks nothing', () => {
    expect(expectations('android', { ...t, drawn: 0.9 }, undefined, 'uiautomator')).toEqual([]);
    expect(expectations('android', { ...t, reached: false }, undefined, 'uiautomator')).toEqual([]);
  });
});

const field = (tag: string, y: number, over: Partial<FieldTruth> = {}): FieldTruth => ({
  tag,
  id: `lab.f.${tag}`,
  kind: 'text',
  title: tag,
  titleId: `lab.f.${tag}.title`,
  frame: rect(20, y, 362, 34),
  value: '',
  focused: false,
  error: null,
  ...over,
});
const control = (tag: string, situation: ControlTruth['situation'], y: number): ControlTruth => ({
  tag,
  id: `lab.toolbar-dismiss.${tag}`,
  kind: 'field',
  frame: rect(20, y, 362, 34),
  situation,
  reached: situation === 'open',
  probe: [{ kind: 'touch', tag: `201.0,${y + 17}.0` }],
});
const TITLE = { id: 'lab.toolbar-dismiss.title', frame: rect(140, 73, 122, 22), reached: true, probe: [{ kind: 'touch' as const, tag: '201.0,84.0' }] };
const dismissCell = (over: { title?: typeof TITLE; dismiss?: unknown[] } = {}): CellTruth => ({
  cell: 'toolbar-dismiss',
  layer: 'toolbar-screen',
  device: 'test',
  screen: { width: 402, height: 874 },
  scale: 3,
  targets: [],
  config: { ios: { keyboardDismiss: over.dismiss ?? [{ tap: { id: TITLE.id } }] } },
  form: {
    fields: [],
    controls: [control('postcode', 'open', 300), control('vs', 'under-keyboard', 620)],
    keyboard: { frame: rect(0, 573, 402, 301), field: 'postcode' },
    screenError: null,
    submits: [],
    title: over.title ?? TITLE,
  },
});

describe('R-dismiss on a form whose config taps its title (toolbar-dismiss: #7, #19)', () => {
  it('under WDA the under-keyboard field asks R-dismiss in place of the form\'s "refused naming the keyboard" tap', () => {
    const rows = formExpectations('ios', dismissCell(), 'wda');
    expect(rows.map((r) => `${r.target} ${r.verb} ${r.says}`)).toEqual([
      'postcode tap Tapped',
      'vs scroll_until not reached without a swipe; every touch-down above the keyboard\'s top (y 573)',
      'vs tap R-dismiss: the keyboard dismissed by tapping id:"lab.toolbar-dismiss.title", nothing else tapped',
    ]);
    const tap = rows[2];
    expect(tap.judge(out('ERROR The soft keyboard covers id:"lab.toolbar-dismiss.vs" … none of the configured dismissals is usable on this screen (tap id:"lab.toolbar-dismiss.title": covered by toolbar "Toolbar"). Nothing was tapped'))).toMatch(
      /^no tap on the dismissal id:"lab.toolbar-dismiss.title" \(refused for a toolbar\)/,
    );
    expect(tap.judge(out('ERROR Tapped id:"lab.toolbar-dismiss.title" at (201,84) to hide the soft keyboard covering id:"lab.toolbar-dismiss.vs", but it is still up … nothing else was tapped', ['idb ui tap 201 84']))).toBeUndefined();
  });
  it('R-dismiss: nothing else tapped — in a replayed tree the keyboard stays, so a tap under it presses a key and `Tapped` is false', () => {
    const tap = formExpectations('ios', dismissCell(), 'wda')[2];
    expect(tap.judge(out('Tapped id:"lab.toolbar-dismiss.vs"', ['idb ui tap 201 84', 'idb ui tap 201 621']))).toBe('tapped under the keyboard at (201,621): Tapped id:"lab.toolbar-dismiss.vs"');
    expect(tap.judge(out('ERROR the keyboard is still up', ['idb ui tap 201 84', 'idb ui tap 201 621']))).toMatch(/^tapped under the keyboard at \(201,621\)/);
    expect(tap.judge(out('Tapped id:"lab.toolbar-dismiss.vs"', ['idb ui tap 201 84']))).toBe('Tapped while the keyboard still covers it: Tapped id:"lab.toolbar-dismiss.vs"');
  });
  it('a field under the keyboard with no keyboard frame in the truth is refused loudly, not judged by a looser row', () => {
    const noKeyboard = dismissCell();
    noKeyboard.form = { ...noKeyboard.form!, keyboard: null };
    expect(() => formExpectations('ios', noKeyboard, 'wda')).toThrow(/vs under the keyboard, but the truth holds no keyboard frame/);
    expect(() => formExpectations('ios', noKeyboard, 'idb')).not.toThrow();
  });
  it('under idb (the list inert there) the form\'s own row stands', () => {
    expect(formExpectations('ios', dismissCell(), 'idb').map((r) => `${r.target} ${r.verb} ${r.says}`)).toContain('vs tap refused naming the keyboard, nothing tapped');
  });
  it('no dismissal row when the config taps something else, or the title\'s probe did not end the editing', () => {
    expect(dismissalOf(dismissCell({ dismiss: [{ tap: { id: 'other' } }] }))).toBeUndefined();
    expect(dismissalOf(dismissCell({ dismiss: [{ accessory: true }] }))).toBeUndefined();
    expect(dismissalOf(dismissCell({ title: { ...TITLE, reached: false } }))).toBeUndefined();
    expect(formExpectations('ios', dismissCell({ title: { ...TITLE, reached: false } }), 'wda').map((r) => r.says)).toContain('refused naming the keyboard, nothing tapped');
  });
  it('the title\'s probe: reached when the tap ended the editing and was delivered', () => {
    expect(readDismissalProbe([{ kind: 'touch', tag: '201.0,84.0' }, { kind: 'focus', tag: '' }])).toEqual({ reached: true, probe: [{ kind: 'touch', tag: '201.0,84.0' }] });
    expect(readDismissalProbe([{ kind: 'touch', tag: '201.0,84.0' }]).reached).toBe(false);
    expect(readDismissalProbe([{ kind: 'focus', tag: '' }]).reached).toBe(false);
  });
});

describe('a pristine form whose fields and titles share one identifier (form-shared-id: FE2)', () => {
  const C = 'lab.form-shared-id.component';
  const shared = (tag: string, y: number) => field(tag, y, { id: C, titleId: C, title: `${tag}*`, titleFrame: rect(28, y - 10, 60, 16) });
  const fields = [shared('amount', 150), shared('iban', 220), shared('bic', 290)];
  const truth: CellTruth = {
    cell: 'form-shared-id',
    layer: 'none',
    device: 'test',
    screen: { width: 402, height: 874 },
    scale: 3,
    targets: [],
    form: {
      fields,
      controls: [
        ...fields.map((f): ControlTruth => ({ tag: f.tag, id: C, kind: 'field', frame: f.frame, situation: 'open', reached: true, probe: [] })),
        { tag: 'submit', id: 'lab.form-shared-id.submit', kind: 'button', frame: rect(20, 400, 362, 44), situation: 'open', reached: true, probe: [] },
      ],
      keyboard: null,
      screenError: null,
      submits: [],
    },
  };
  const rows = formExpectations('ios', truth, 'wda');

  it('each field with a same-identifier title below it: its error assert, asked with that title, must fail; no tap by the shared id', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual(['amount error', 'iban error', 'submit tap']);
    expect(rows[0].call.args.asserts).toEqual([{ element: { id: C, role: 'textfield' }, error: 'iban*', timeout: 1000 }]);
    expect(rows[1].call.args.asserts).toMatchObject([{ error: 'bic*' }]);
  });
  it('a pass is the mismatch: the next field\'s title read as this one\'s error', () => {
    expect(rows[0].judge(out('All 1 asserts passed'))).toBe('passed: All 1 asserts passed');
    expect(rows[0].judge(out('0/1 asserts FAILED\nFAIL  element id:"lab.form-shared-id.component" role:"textfield" with error "iban*" exists — element found but error was: null, null, null'))).toBeUndefined();
  });
  it('a same-identifier title below the field but in another column (no horizontal overlap) asks no such row', () => {
    const side = [shared('amount', 150), { ...shared('iban', 220), titleFrame: rect(390, 210, 10, 16) }];
    expect(formExpectations('ios', { ...truth, form: { ...truth.form!, fields: side, controls: [] } }, 'wda')).toEqual([]);
  });
  it('a field showing an error, or a title below it with another identifier, asks no such row', () => {
    const named = formExpectations('ios', { ...truth, form: { ...truth.form!, fields: [field('a', 150, { titleFrame: rect(28, 140, 60, 16) }), field('b', 220, { titleFrame: rect(28, 210, 60, 16) })], controls: [] } }, 'wda');
    expect(named).toEqual([]);
  });
});
