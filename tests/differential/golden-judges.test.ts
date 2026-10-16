import { describe, expect, it } from 'vitest';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, formExpectations, type Expectation, type FormExpectation } from '../../scripts/differential/golden-spec.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect, TargetTruth } from '../../scripts/truth/schema.js';

// Every judge of the golden spec (scripts/differential/golden-spec/*.ts, behind the façade golden-spec.ts), each on
// replies it must accept and replies it must reject — including the "not in the tree" replies: judged by their effect
// where the row's judge rejects them (its own reason), vacuous (`not in the tree:`) where it would accept them, and
// accepted only by a row whose truth allows the target to be absent. The ratchet (golden.test.ts) guards only the
// judges that mismatch today; this table pins the rest, so a judge gone vacuous (`() => undefined`) fails here.

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
type Case = readonly [reply: string, device: readonly string[], verdict: 'ok' | RegExp];

const TIMED_OUT = 'ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear';
const NEVER = 'ERROR scroll_until id:"lab.x" failed after 2 swipes (…) — element never appeared in the tree';
const NOT_FOUND = '1/1 asserts FAILED\nFAIL  element id:"lab.x" … — not found within 1 s';
const PASS = 'All 1 asserts passed\nPASS  element id:"lab.x" …';
const FAIL = '1/1 asserts FAILED\nFAIL  element id:"lab.x" … — expected … got …';
const IDB_SWIPE = (y: number) => `idb ui swipe 201 ${y} 201 115 --duration 0.3`;
const NOT_IN_TREE = /^not in the tree: /;

function check(judge: Expectation['judge'], cases: readonly Case[]) {
  for (const [reply, device, verdict] of cases) {
    const why = judge({ reply, device: [...device] } satisfies Outcome);
    if (verdict === 'ok') expect(why, `${reply} | ${device.join(' | ')}`).toBeUndefined();
    else expect(why, `${reply} | ${device.join(' | ')}`).toMatch(verdict);
  }
}

const target = (over: Partial<TargetTruth>): TargetTruth => ({
  tag: 'A',
  id: 'lab.x',
  color: '#E53935',
  declared: 'open',
  frame: rect(51, 110, 300, 64),
  reached: true,
  probe: [{ kind: 'touch', tag: '201,142' }],
  drawn: 1,
  seen: '#E53935',
  ...over,
});

const pick = <E extends Expectation>(rows: readonly E[], verb: string, tag?: string): E => {
  const r = rows.find((x) => x.verb === verb && (tag === undefined || (x as Partial<FormExpectation>).target === tag));
  if (r === undefined) throw new Error(`no ${tag ?? ''} ${verb} row`);
  return r;
};

describe('a coloured target, open', () => {
  const rows = expectations('ios', target({}), undefined, 'wda');
  it.each<[string, readonly Case[]]>([
    ['tap', [['Tapped id:"lab.x"', ['idb ui tap 201 142'], 'ok'], ['ERROR id:"lab.x" is under …; nothing was tapped', [], /^not tapped/], [TIMED_OUT, [], /^not tapped: ERROR Timed out/]]],
    ['colour', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    [
      'scroll_until',
      [
        ['Element id:"lab.x" fully visible after 0 swipes', [], 'ok'],
        ['Element id:"lab.x" fully visible after 1 swipe', [IDB_SWIPE(459)], /^swiped 1×/],
        ['ERROR scroll_until … stopped before any swipe', [], /^stopped/],
        [NEVER, [IDB_SWIPE(459)], /^stopped: .*never appeared in the tree/],
      ],
    ],
  ])('%s', (verb, cases) => check(pick(rows, verb).judge, cases));
  // The probe at (201,142) fired it (its touch logged there); the middle third of its 300x64 frame around that point is ±50 x ±10.67.
  it.each<[string, TargetTruth, readonly Case[]]>([
    [
      'tap at its probe point',
      target({}),
      [
        ['Tapped id:"lab.x"', ['idb ui tap 201 142'], 'ok'],
        // own-parts' N: the tree's node narrower than the app's frame, its centre 9 pt off the probe
        ['Tapped id:"lab.x"', ['idb ui tap 210 142'], 'ok'],
        ['Tapped id:"lab.x"', ['idb ui tap 250 152'], 'ok'],
        // #26: moved 20 pt off the probe, to "the uncovered part", where no probe fired
        ['Tapped id:"lab.x" at (201,162) — its centre (201,142) is under button "Cards" …; tapped the uncovered part 300x24', ['idb ui tap 201 162'], /^Tapped moved off a cover over its centre, on a target measured uncovered: .*under button/],
        ['Tapped id:"lab.x"', ['idb ui tap 201 162'], /^Tapped off its probe point \(201,142\) at \(201,162\)/],
        ['Tapped id:"lab.x"', ['idb ui tap 201 153'], /^Tapped off its probe point \(201,142\) at \(201,153\)/],
        ['Tapped id:"lab.x"', ['idb ui tap 252 142'], /^Tapped off its probe point/],
        ['Tapped id:"lab.x"', ['idb ui tap 201 142', 'idb ui tap 201 170'], /^Tapped off its probe point \(201,142\) at \(201,170\)/],
        ['Tapped id:"lab.x"', [], /^Tapped, but no tap sent/],
        // a tap averi says it moved off a cover over its centre: wrong on a target measured uncovered, however near
        ['Tapped id:"lab.x" at (201,150) — its centre (201,142) is under button "Cards" (201,140 82x64), drawn over it; tapped the uncovered part 300x24', ['idb ui tap 201 150'], /^Tapped moved off a cover over its centre/],
        ['Tapped id:"lab.x" at (201,150) — its centre (201,142) is under button "Cards" (201,140 82x64), drawn over it; tapped the uncovered part 300x24 above the soft keyboard', ['idb ui tap 201 150'], /^Tapped moved off a cover over its centre/],
      ],
    ],
    [
      'the touch the app logged (within TOUCH_SLACK of the centre), not the frame centre',
      target({ probe: [{ kind: 'touch', tag: '201.0,144.0' }] }),
      [
        // 10 pt off the logged touch (in reach), 12 pt off the frame's centre (out of it)
        ['Tapped id:"lab.x"', ['idb ui tap 201 154'], 'ok'],
        ['Tapped id:"lab.x"', ['idb ui tap 201 155'], /^Tapped off its probe point \(201,144\) at \(201,155\)/],
      ],
    ],
    [
      'a small target: at least one unit (the tools\' rounding)',
      target({ frame: rect(100, 100, 3, 3), probe: [{ kind: 'touch', tag: '102,102' }] }),
      [
        ['Tapped id:"lab.x"', ['adb shell input tap 101 101'], 'ok'],
        ['Tapped id:"lab.x"', ['adb shell input tap 102 104'], /^Tapped off its probe point \(102,102\) at \(102,104\)/],
      ],
    ],
  ])('%s', (_, t, cases) => check(pick(expectations('ios', t, undefined, 'wda'), 'tap').judge, cases));
});

describe('a coloured target beneath a presented layer', () => {
  const rows = expectations('ios', target({ declared: 'presented-over', reached: false, drawn: 0, seen: '#B72E2A' }), undefined, 'wda');
  it.each<[string, readonly Case[]]>([
    [
      'tap',
      [
        ['ERROR … an alert is presented over it — close it first; nothing was tapped', [], 'ok'],
        ['ERROR … close it first', ['idb ui tap 201 142'], /^refused, but sent idb ui tap/],
        ['Tapped id:"lab.x"', [], /^Tapped/],
        ['ERROR id:"lab.x" is under container … scroll_until it first', [], /^refused without "close it first"/],
        [TIMED_OUT, [], /^refused without "close it first": ERROR Timed out/],
        [TIMED_OUT, ['idb ui tap 201 142'], /^refused, but sent idb ui tap/],
        [`${TIMED_OUT} — close it first; nothing was tapped`, [], NOT_IN_TREE],
      ],
    ],
    ['colour', [[FAIL.replace('expected … got …', 'container … is drawn over the element … close it first'), [], 'ok'], [PASS, [], /^passed on #B72E2A/], [NOT_FOUND, [], NOT_IN_TREE]]],
    [
      'scroll_until',
      [
        ['ERROR scroll_until … stopped before any swipe … close it first', [], 'ok'],
        ['ERROR scroll_until … stopped before any swipe', [], /^no "close it first"/],
        ['Element id:"lab.x" fully visible after 0 swipes', [], /^no "close it first"/],
        [NEVER, [IDB_SWIPE(459)], /^swiped 1× beneath a presented layer/],
        ['ERROR scroll_until id:"lab.x" never appeared in the tree — close it first', [], NOT_IN_TREE],
      ],
    ],
  ])('%s', (verb, cases) => check(pick(rows, verb).judge, cases));
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
const control = (tag: string, over: Partial<ControlTruth>): ControlTruth => ({
  tag,
  id: `lab.f.${tag}`,
  kind: 'field',
  frame: rect(20, 160, 362, 34),
  situation: 'open',
  reached: true,
  probe: [{ kind: 'touch', tag: '201.0,177.0' }],
  ...over,
});

// One form truth with a row of every kind: a paired and an unpaired field error, a screen-level error that pairs
// with none, titles, a plain and a secure value, and a control in every situation.
const form: CellTruth = {
  cell: 'form-basic',
  layer: 'none',
  device: 'test',
  screen: { width: 402, height: 874 },
  scale: 3,
  targets: [],
  form: {
    fields: [
      field('name', 160, { value: 'Ann', error: { id: 'lab.f.name', text: 'Required' }, errorFrame: rect(20, 200, 150, 16) }),
      field('iban', 256, { error: { id: 'IbanError', text: 'Bad IBAN' }, errorFrame: rect(20, 296, 150, 16) }),
      field('pin', 352, { kind: 'pin', value: '1234' }),
    ],
    controls: [
      control('name', {}),
      control('submit', { kind: 'button', frame: rect(20, 516, 362, 46) }),
      control('vs', { frame: rect(20, 604, 362, 34), situation: 'under-keyboard', reached: false }),
      control('country', { situation: 'presented-over', reached: false }),
      control('row.ST', { kind: 'row', frame: undefined, situation: 'not-rendered', reached: false, probe: [] }),
      control('row.AL', { kind: 'row', frame: rect(20, 900, 362, 44), situation: 'off-screen', reached: false, probe: [] }),
      control('phone', { frame: rect(20, 530, 362, 34), situation: 'covered', reached: false, probe: [{ kind: 'touch', tag: '201.0,547.0' }, { kind: 'submit', tag: 'invalid' }] }),
    ],
    keyboard: { frame: rect(0, 573, 402, 301), field: 'name' },
    screenError: { id: 'lab.f.screen', text: 'Check the form', frame: rect(20, 700, 362, 20) },
    submits: [],
    sheet: rect(0, 300, 402, 574),
  },
};

describe('the form rows', () => {
  const rows = formExpectations('ios', form, 'wda');

  it('every kind of row is asked', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual([
      'name error',
      'name.title text',
      'name text',
      'iban error',
      'iban.title text',
      'pin.title text',
      'pin text',
      'screenError error',
      'name tap',
      'submit tap',
      'submit scroll_until',
      'vs tap',
      'vs scroll_until',
      'country tap',
      'country scroll_until',
      'row.ST tap',
      'row.ST scroll_until',
      'row.AL tap',
      'row.AL scroll_until',
      'phone tap',
      'phone scroll_until',
    ]);
  });

  it.each<[string, string, readonly Case[]]>([
    ['a paired field error passes', 'name error', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ['an error named neither way fails', 'iban error', [[FAIL, [], 'ok'], [PASS, [], /^passed/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['a screen-level error pairs with no field', 'screenError error', [[FAIL, [], 'ok'], [PASS, [], /^passed/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['a title reads as drawn', 'name.title text', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ["a value reads as the model's", 'name text', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ['a secure value never reads back', 'pin text', [[FAIL, [], 'ok'], [PASS, [], /^passed: the secure field/], [NOT_FOUND, [], NOT_IN_TREE]]],
    ['an open control is tapped', 'name tap', [['Tapped id:"lab.f.name"', ['idb ui tap 201 177'], 'ok'], ['ERROR … nothing was tapped', [], /^not tapped/], [TIMED_OUT, [], /^not tapped: ERROR Timed out/]]],
    [
      'the pinned submit is reached with no swipe',
      'submit scroll_until',
      [
        ['Element id:"lab.f.submit" fully visible after 0 swipes', [], 'ok'],
        ['Element … after 1 swipe', [IDB_SWIPE(459)], /^swiped 1×/],
        ['ERROR scroll_until … under the soft keyboard', [], /^stopped/],
        [NEVER, [], /^stopped: .*never appeared in the tree/],
      ],
    ],
    [
      'a field under the keyboard: tap refused naming it',
      'vs tap',
      [
        ['ERROR The soft keyboard covers id:"lab.f.vs" … nothing was tapped', [], 'ok'],
        ['ERROR The soft keyboard covers id:"lab.f.vs"', ['idb ui tap 201 621'], /^refused, but sent/],
        ['Tapped id:"lab.f.vs"', [], /^Tapped/],
        ['ERROR id:"lab.f.vs" is under container …', [], /^refused without naming the keyboard/],
        [TIMED_OUT, [], /^refused without naming the keyboard: ERROR Timed out/],
      ],
    ],
    [
      'a field under the keyboard: scroll_until swipes, touching down above the keyboard',
      'vs scroll_until',
      [
        ['Element id:"lab.f.vs" fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        ['ERROR scroll_until … failed after 1 swipe — the soft keyboard …', [IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.vs" fully visible after 0 swipes', [], /^reached with no swipe, under the keyboard/],
        ['Element id:"lab.f.vs" fully visible after 1 swipe', [IDB_SWIPE(700)], /^touched down under the keyboard at \(201,700\)/],
        [NEVER, [IDB_SWIPE(459)], NOT_IN_TREE],
        [NEVER, [IDB_SWIPE(700)], /^touched down under the keyboard at \(201,700\)/],
      ],
    ],
    [
      'a field under the picker sheet: tap refused, close it first',
      'country tap',
      [
        ['ERROR … a screen is presented over it — close it first; nothing was tapped', [], 'ok'],
        ['Tapped id:"lab.f.country"', [], /^Tapped/],
        ['ERROR … under button "Albania"', [], /^refused without "close it first"/],
        [TIMED_OUT, [], /^refused without "close it first": ERROR Timed out/],
      ],
    ],
    [
      'a field under the picker sheet: scroll_until stops, close it first',
      'country scroll_until',
      [
        ['ERROR scroll_until … stopped before any swipe … close it first', [], 'ok'],
        ['ERROR … close it first', [IDB_SWIPE(459)], /^swiped 1× beneath the sheet/],
        ['Element … fully visible after 0 swipes', [], /^no "close it first"/],
        [NEVER, [], /^no "close it first": .*never appeared in the tree/],
        [NEVER, [IDB_SWIPE(459), IDB_SWIPE(459)], /^swiped 2× beneath the sheet/],
        ['ERROR scroll_until id:"lab.x" never appeared in the tree — close it first', [], NOT_IN_TREE],
      ],
    ],
    [
      'a lazy row not laid out: no tap sent — absent from the tree is allowed',
      'row.ST tap',
      [[TIMED_OUT, [], 'ok'], ['ERROR … nothing was tapped', [], 'ok'], ['Tapped id:"lab.f.row.ST"', [], /^Tapped/], ['ERROR …', ['idb ui tap 201 800'], /^refused, but sent/]],
    ],
    [
      'a lazy row not laid out: scroll_until swipes for it on the sheet — absent from the tree is allowed',
      'row.ST scroll_until',
      [
        [NEVER, [IDB_SWIPE(459), IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.row.ST" fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        [NEVER, [], /^no swipe: /],
        ['Element … after 1 swipe', [IDB_SWIPE(200)], /^touched down off the sheet at \(201,200\)/],
      ],
    ],
    ['a row off the screen: no tap sent — absent from the tree is allowed', 'row.AL tap', [[TIMED_OUT, [], 'ok'], ['Tapped id:"lab.f.row.AL"', [], /^Tapped/]]],
    [
      'a row off the screen: scroll_until swipes for it on the sheet — absent from the tree is allowed',
      'row.AL scroll_until',
      [
        [NEVER, [IDB_SWIPE(459)], 'ok'],
        [NEVER, [], /^no swipe: /],
      ],
    ],
    [
      'a field under the pinned submit: no tap sent',
      'phone tap',
      [['ERROR … under button "Continue" … nothing was tapped', [], 'ok'], ['Tapped id:"lab.f.phone"', ['idb ui tap 201 547'], /^Tapped/], ['ERROR …', ['idb ui tap 201 547'], /^refused, but sent/], [TIMED_OUT, [], NOT_IN_TREE]],
    ],
    [
      'a field under the pinned submit: not reached with no swipe',
      'phone scroll_until',
      [
        ['ERROR scroll_until … failed after 3 swipes — under button "Continue"', [IDB_SWIPE(459)], 'ok'],
        ['Element … fully visible after 1 swipe', [IDB_SWIPE(459)], 'ok'],
        ['Element id:"lab.f.phone" fully visible after 0 swipes', [], /^reached with no swipe where a tap fires submit invalid/],
        [NEVER, [IDB_SWIPE(459)], NOT_IN_TREE],
      ],
    ],
  ])('%s', (_name, key, cases) => {
    const [tag, verb] = key.split(' ');
    check(pick(rows, verb, tag).judge, cases);
  });
});

// Phase 2b's Android form rows: an error asserted as text, the under-keyboard tap after `back` (reached, or not — the
// bar dropped back over it), the colour asked with the keyboard's, and a covered field's tap moved to its piece.
const KEY = (y: number) => `adb shell input tap 540 ${y}`;
const BACK = 'adb shell input keyevent 4';
const ANDROID_FORM: CellTruth = {
  cell: 'form-keyboard',
  layer: 'none',
  device: 'test',
  screen: { width: 1080, height: 2220 },
  scale: 1,
  targets: [],
  afterBack: { state: 'form-keyboard.after-back.state.json', trees: { uiautomator: 'form-keyboard.after-back.xml' } },
  form: {
    fields: [field('name', 330, { frame: rect(55, 330, 970, 99), error: { id: 'IbanError', text: 'Enter the recipient’s name' }, errorFrame: rect(55, 440, 600, 40) })],
    controls: [
      control('vs', { frame: rect(55, 1478, 970, 99), situation: 'under-keyboard', reached: false, probe: [], seen: '#FFFFFF', reachedAfterBack: true, probeAfterBack: [{ kind: 'touch', tag: '540,1528' }, { kind: 'focus', tag: 'vs' }] }),
      control('note', { frame: rect(55, 2024, 970, 99), situation: 'under-keyboard', reached: false, probe: [], reachedAfterBack: false, probeAfterBack: [{ kind: 'touch', tag: '540,2074' }, { kind: 'submit', tag: 'invalid' }], pieceAfterBack: rect(55, 2126, 970, 14), reachedAtPieceAfterBack: true }),
      control('phone', { frame: rect(55, 1296, 970, 99), situation: 'covered', reached: false, probe: [{ kind: 'touch', tag: '540,1346' }, { kind: 'submit', tag: 'invalid' }], piece: rect(55, 1370, 970, 25), reachedAtPiece: true }),
    ],
    keyboard: { frame: rect(0, 1398, 1080, 822), field: 'postcode' },
    screenError: { id: 'lab.f.banner_error', text: 'Payment wasn’t sent', frame: rect(55, 1700, 970, 50) },
    submits: [],
  },
};

describe('the Android form rows (phase 2b)', () => {
  const rows = formExpectations('android', ANDROID_FORM, 'uiautomator');
  const row = (key: string) => {
    const [tag, verb] = key.split(' ');
    return pick(rows, verb, tag);
  };

  it('every kind of row is asked', () => {
    expect(rows.map((r) => `${r.target} ${r.verb}`)).toEqual([
      'name error',
      'screenError error',
      'vs tap',
      'vs colour',
      'vs scroll_until',
      'note tap',
      'note scroll_until',
      'phone tap',
      'phone scroll_until',
    ]);
  });

  it('errors are asserted as text, not as a field\'s error', () => {
    expect(row('name error').call.args.asserts).toEqual([{ element: { text: 'Enter the recipient’s name' }, timeout: 1_000 }]);
    expect(row('screenError error').call.args.asserts).toEqual([{ element: { text: 'Payment wasn’t sent' }, timeout: 1_000 }]);
  });

  it.each<[string, string, readonly Case[]]>([
    ['an error read as text passes', 'name error', [[PASS, [], 'ok'], [FAIL, [], /^failed/], [NOT_FOUND, [], /^failed: .*not found within/]]],
    ['a screen-level message read as text passes', 'screenError error', [[PASS, [], 'ok'], [FAIL, [], /^failed/]]],
    [
      'under the keyboard, reached after back: Tapped after one back, one tap inside it',
      'vs tap',
      [
        ['Tapped id:"lab.f.vs" (the soft keyboard covered …; hidden before tapping)', [BACK, KEY(1528)], 'ok'],
        ['Tapped id:"lab.f.vs"', [KEY(1528)], /^Tapped without a back before the tap/],
        ['Tapped id:"lab.f.vs"', [KEY(1528), BACK], /^Tapped without a back before the tap/],
        ['Tapped id:"lab.f.vs"', [BACK, KEY(1300)], /^Tapped at \(540,1300\), not once inside its frame/],
        ['Tapped id:"lab.f.vs"', [BACK, KEY(1528), KEY(1530)], /not once inside its frame/],
        ['Tapped id:"lab.f.vs"', [BACK], /^Tapped without a back before the tap|not once inside/],
        ['ERROR … nothing was tapped', [], /^not tapped/],
      ],
    ],
    ['the colour under the keyboard fails: a pass measured the keyboard', 'vs colour', [[FAIL, [], 'ok'], [PASS, [], /^passed on #FFFFFF, the keyboard's/]]],
    [
      'under the keyboard, NOT reached at its centre after back (the bar dropped over it): never there; Tapped only inside its piece after back',
      'note tap',
      [
        ['ERROR … nothing was tapped', [], 'ok'],
        ['Tapped id:"lab.f.note" (the soft keyboard covered …; hidden before tapping)', [BACK, KEY(2133)], 'ok'],
        ['Tapped id:"lab.f.note"', [BACK, KEY(2074)], /^tapped at its centre \(540,2074\), which after back fires submit invalid/],
        ['ERROR …', [BACK, KEY(2074)], /^tapped at its centre/],
        ['Tapped id:"lab.f.note"', [BACK, KEY(2100)], /^Tapped outside its piece after back at \(540,2100\)/],
        ['Tapped id:"lab.f.note"', [BACK, KEY(2133), KEY(2100)], /^Tapped outside its piece after back at \(540,2100\)/],
        ['Tapped id:"lab.f.note"', [BACK], /^Tapped with no tap sent/],
        ['ERROR …', [BACK, KEY(2133)], /^refused, but sent/],
      ],
    ],
    [
      'covered, its piece reached: refused, or Tapped inside the piece',
      'phone tap',
      [
        ['ERROR … nothing was tapped', [], 'ok'],
        ['Tapped id:"lab.f.phone"', [KEY(1391)], 'ok'],
        ['Tapped id:"lab.f.phone"', [KEY(1346)], /^Tapped outside its piece at \(540,1346\)/],
        ['Tapped id:"lab.f.phone"', [KEY(1391), KEY(1346)], /^Tapped outside its piece at \(540,1346\)/],
        ['Tapped id:"lab.f.phone"', [], /^Tapped with no tap sent/],
        ['ERROR …', [KEY(1391)], /^refused, but sent/],
      ],
    ],
  ])('%s', (_name, key, cases) => check(row(key).judge, cases));

  it('note\'s row says what the tap after back fired, and is replayed where the layout after back was captured (its piece then)', () => {
    expect(row('note tap').says).toMatch(/after one back a tap there fires submit invalid/);
    expect(row('note tap').live).toBeUndefined();
    // Live only where no layout after back was captured — keyed on the truth's afterBack, not on the piece: a captured
    // layout with no piece after back is replayed (no Tapped admitted).
    const noLayout = formExpectations('android', { ...ANDROID_FORM, afterBack: undefined }, 'uiautomator');
    expect(pick(noLayout, 'tap', 'note').live).toMatch(/live\.ts k5/);
    const noPiece = formExpectations('android', { ...ANDROID_FORM, form: { ...ANDROID_FORM.form!, controls: ANDROID_FORM.form!.controls.map((c) => (c.tag === 'note' ? { ...c, pieceAfterBack: undefined, reachedAtPieceAfterBack: undefined } : c)) } }, 'uiautomator');
    expect(pick(noPiece, 'tap', 'note').live).toBeUndefined();
    check(pick(noPiece, 'tap', 'note').judge, [['Tapped id:"lab.f.note"', [BACK, KEY(2133)], /^Tapped, where no tap after back reached it/]]);
  });

  it('a piece after back that no probe reached admits no Tapped', () => {
    const unreached = formExpectations('android', { ...ANDROID_FORM, form: { ...ANDROID_FORM.form!, controls: ANDROID_FORM.form!.controls.map((c) => (c.tag === 'note' ? { ...c, reachedAtPieceAfterBack: false } : c)) } }, 'uiautomator');
    check(pick(unreached, 'tap', 'note').judge, [
      ['Tapped id:"lab.f.note"', [BACK, KEY(2133)], /^Tapped, where no tap after back reached it/],
      ['ERROR … nothing was tapped', [], 'ok'],
    ]);
  });
});
