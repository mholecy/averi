import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Platform, SourceKind } from '../../scripts/differential/corpus.js';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, type Expectation } from '../../scripts/differential/golden-spec.js';
import { liveGeometry, visibilityCases, type VisibilityCase } from '../../scripts/truth/live-visibility.js';
import type { CellTruth, LabState, TargetTruth } from '../../scripts/truth/schema.js';
import { fullyAsked, judgedContext, judgedGeometry, stopAsk, stringUnlistedBy, tapAsk, unlistedBy, type StopAsk, type TapAsk } from '../../scripts/truth/target-contract.js';
import { geometryOf, probePoint } from '../../scripts/truth/truth.js';
import { probeDelivered } from '../../scripts/differential/golden-spec/base.js';

// The target contract (scripts/truth/target-contract.ts): what a target is asked, decided once — and both goldens its
// consumers. The parity block below runs over every committed truth (tests/fixtures/truth): for every target both the
// replayed golden (golden-spec.ts#expectations) and the live golden (live-visibility.ts#visibilityCases) ask, the
// clauses they stamp are equal, and their two judges agree on a refusal that sent nothing and fired nothing.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = `${ROOT}tests/fixtures/truth`;

const target = (over: Partial<TargetTruth>): TargetTruth => ({ tag: 'T', id: 'lab.c.T', color: '#000000', declared: 'open', frame: { x: 51, y: 400, width: 300, height: 64 }, reached: true, probe: [], drawn: 1, seen: '#000000', ...over });
/** The iPhone 17 in points (status band 62, home indicator 34); the averi_lab AVD (status 63, navigation 66 px). */
const IOS = { screen: { width: 402, height: 874 }, safeArea: { top: 62, left: 0, bottom: 34, right: 0 } };
const ANDROID = { screen: { width: 1080, height: 2220 }, safeArea: { top: 63, left: 0, bottom: 66, right: 0 } };

describe('the contract\'s rules', () => {
  it('iOS\'s home-indicator band is no band — one judged context for both goldens; Android\'s navigation band is one', () => {
    // A target 51,800 300x50 on iOS overlaps the home-indicator band (840–874) past the slack: measured band-overlap:nav,
    // judged whole — by the replay (judgedGeometry over the capture) and the live golden (liveGeometry over the state) alike.
    const t = target({ frame: { x: 51, y: 800, width: 300, height: 50 }, geometry: 'band-overlap:nav' });
    expect(judgedGeometry('ios', t, IOS)).toBe('whole');
    expect(liveGeometry({ cell: 'c', ready: true, scale: 3, screen: { x: 0, y: 0, ...IOS.screen }, safeArea: IOS.safeArea, frames: { T: t.frame }, events: [] }, 'ios', 'T', undefined)).toBe('whole');
    expect(geometryOf(t.frame, { screen: { x: 0, y: 0, ...IOS.screen }, safeArea: IOS.safeArea })).toBe('band-overlap:nav');
    expect(judgedGeometry('ios', target({ frame: { x: 51, y: 847, width: 300, height: 20 }, geometry: 'nav-band' }), IOS)).toBe('whole');
    expect(judgedGeometry('ios', target({ frame: { x: 51, y: 21, width: 300, height: 20 }, geometry: 'status-band' }), IOS)).toBe('status-band');
    expect(judgedGeometry('android', target({ frame: { x: 0, y: 2160, width: 825, height: 50 }, geometry: 'nav-band' }), ANDROID)).toBe('nav-band');
    expect(judgedContext('ios', IOS, undefined).safeArea).toEqual({ top: 62, left: 0, bottom: 0, right: 0 });
    expect(judgedContext('android', ANDROID, undefined).safeArea).toEqual(ANDROID.safeArea);
    // Without the capture's screen: as measured.
    expect(judgedGeometry('ios', t, undefined)).toBe('band-overlap:nav');
  });
  it('over the committed truth the judged geometry is the measured one but for iOS\'s home-indicator band: bands\' N and Q', () => {
    const differ = captures()
      .filter((c, i, all) => all.findIndex((x) => x.run === c.run && x.truth.cell === c.truth.cell) === i)
      .flatMap(({ platform, truth, run }) => truth.targets.filter((t) => judgedGeometry(platform, t, truth) !== t.geometry).map((t) => `${run}/${truth.cell}.${t.tag} ${t.geometry} → ${judgedGeometry(platform, t, truth)}`));
    expect(differ).toEqual(['ios-iphone17-ios27/bands.Q band-overlap:nav → whole', 'ios-iphone17-ios27/bands.N nav-band → whole']);
  });
  it('over the committed truth the judged geometry is geometryOf in the judged context — the one the live golden judges a state in', () => {
    const differ = captures().flatMap(({ platform, truth, run }) =>
      truth.targets
        .filter((t) => t.geometry !== undefined)
        .map((t) => ({ t, judged: judgedGeometry(platform, t, truth), again: geometryOf(t.frame, judgedContext(platform, truth, t.scrollView)) }))
        .filter(({ judged, again }) => judged !== again)
        .map(({ t, judged, again }) => `${run}/${truth.cell}.${t.tag}: ${judged} vs ${again}`),
    );
    expect(differ).toEqual([]);
  });
  it('the tap\'s clause by the truth and the judged geometry', () => {
    expect(tapAsk(target({}), 'whole')).toEqual({ must: 'fire', inside: 'node' });
    expect(tapAsk(target({ drawn: 0.5 }), 'whole')).toBeUndefined();
    expect(tapAsk(target({ declared: 'presented-over', reached: false }), 'off-screen')).toEqual({ must: 'refuse', remedy: 'close it first' });
    expect(tapAsk(target({ declared: 'presented-over' }), 'whole')).toBeUndefined();
    for (const g of ['off-screen', 'outside-scroll-view', 'sliver'] as const) expect(tapAsk(target({ reached: g === 'sliver' }), g)).toEqual({ must: 'refuse', remedy: 'scroll_until' });
    expect(tapAsk(target({}), 'partly-centre-in')).toEqual({ must: 'fire', inside: 'visible' });
    expect(tapAsk(target({}), 'chrome-overlap:tabBar')).toEqual({ must: 'fire', inside: 'visible' });
    expect(tapAsk(target({ reached: false, reachedAtPiece: true }), 'centre-out')).toEqual({ must: 'land-or-refuse', inside: 'piece' });
    expect(tapAsk(target({ reached: false }), 'under-chrome:fab')).toEqual({ must: 'refuse' });
    expect(tapAsk(target({ reached: false }), 'status-band')).toEqual({ must: 'refuse' });
    expect(tapAsk(target({}), 'nav-band')).toEqual({ must: 'land-or-refuse', inside: 'visible' });
  });
  it('fully asked of a cut target and a chrome-overlapped one; of a band or band-overlapped one in a scroll view only', () => {
    for (const g of ['partly-centre-in', 'centre-out', 'sliver', 'chrome-overlap:stickyHeader'] as const) expect(fullyAsked(g, undefined)).toBe(true);
    for (const g of ['status-band', 'nav-band', 'band-overlap:status'] as const) {
      expect(fullyAsked(g, undefined)).toBe(false);
      expect(fullyAsked(g, 'page')).toBe(true);
    }
    for (const g of ['whole', 'off-screen', 'outside-scroll-view', 'under-chrome:fab'] as const) expect(fullyAsked(g, 'page')).toBe(false);
  });
  it('the plain stop holds where a centre-based stop may stop; fully only on a whole target', () => {
    expect(stopAsk('band-overlap:nav', false)).toEqual({ fully: false, holds: true });
    expect(stopAsk('band-overlap:nav', true)).toEqual({ fully: true, holds: false });
    expect(stopAsk('nav-band', false)).toEqual({ fully: false, holds: false });
    expect(stopAsk('whole', true)).toEqual({ fully: true, holds: true });
  });
  it('unlisted: only where the capture\'s tree of that source said it does not list the target (its node, its string)', () => {
    expect(unlistedBy({ listed: { uiautomator: false, wda: true } }, 'uiautomator')).toBe("the capture's uiautomator tree does not list it");
    expect(unlistedBy({ listed: { uiautomator: false, wda: true } }, 'wda')).toBeUndefined();
    expect(unlistedBy({}, 'idb')).toBeUndefined();
    expect(stringUnlistedBy({ textListed: { uiautomator: false } }, 'uiautomator')).toMatch(/lists no node carrying the string/);
    expect(stringUnlistedBy({ textListed: { uiautomator: true } }, 'uiautomator')).toBeUndefined();
  });
});

// --- static ↔ live parity over the committed truth ---

interface Capture {
  platform: Platform;
  source: SourceKind;
  truth: CellTruth;
  run: string;
}

function captures(): Capture[] {
  const out: Capture[] = [];
  for (const run of readdirSync(CORPUS)) {
    const manifest = JSON.parse(readFileSync(`${CORPUS}/${run}/manifest.json`, 'utf8')) as { platform: Platform; captures: { source: SourceKind; truth?: string }[] };
    for (const c of manifest.captures) {
      if (c.truth === undefined) continue;
      out.push({ platform: manifest.platform, source: c.source, run, truth: JSON.parse(readFileSync(`${CORPUS}/${run}/${c.truth}`, 'utf8')) as CellTruth });
    }
  }
  return out;
}

const outcome = (reply: string, device: string[] = []): Outcome => ({ reply, device }) as unknown as Outcome;
/** A refusal that sent nothing, naming the clause's remedy where it has one (as averi's refusals word them). */
const refusal = (ask: TapAsk) => `ERROR id:"x" was not tapped${ask.must === 'refuse' && ask.remedy !== undefined ? ` — ${ask.remedy === 'scroll_until' ? 'scroll_until it first' : 'close it first'}` : ''}; nothing was tapped`;
/** The app as its capture laid it out (the live judge's state), the target's own tap logged or not. */
const appAt = (truth: CellTruth, t: TargetTruth, fired: boolean): LabState => ({
  cell: truth.cell,
  ready: true,
  scale: truth.scale,
  screen: { x: 0, y: 0, ...truth.screen },
  frames: { [t.tag]: t.frame },
  events: fired ? [{ kind: 'tap', tag: t.tag, at: 1 }] : [],
  ...(truth.safeArea !== undefined && { safeArea: truth.safeArea }),
  ...(truth.scrollViews !== undefined && { scrollViews: truth.scrollViews }),
  ...(truth.chrome !== undefined && { chrome: truth.chrome }),
  strokes: [],
});
/** Where a `Tapped` lands for the clause: the probe's delivered touch, or — for a piece — the piece's centre. */
const tapPoint = (t: TargetTruth, ask: TapAsk) => ('inside' in ask && ask.inside === 'piece' && t.piece != null ? probePoint(t.piece) : probeDelivered(t));

interface Pair {
  key: string;
  platform: Platform;
  source: SourceKind;
  truth: CellTruth;
  t: TargetTruth;
  row: Expectation;
  live: VisibilityCase;
}

describe('static ↔ live: for every committed truth target both goldens ask, the same clause, judged alike', () => {
  const pairs: Pair[] = [];
  /** The live stop clauses no replayed row asks — the coverage the replay leaves to the live golden. */
  const liveOnly: string[] = [];
  for (const { platform, source, truth, run } of captures()) {
    const cases = visibilityCases(truth, platform);
    for (const t of truth.targets) {
      const rows = expectations(platform, t, truth, source).filter((e) => e.live === undefined);
      const key = (what: string) => `${run}/${truth.cell}.${source} ${t.tag} ${what}`;
      const at = { platform, source, truth, t };
      const tap = cases.find((c) => c.id === `tap:${truth.cell}.${t.tag}`);
      const tapRow = rows.find((r) => r.verb === 'tap');
      if (tap !== undefined && tapRow !== undefined) pairs.push({ key: key('tap'), row: tapRow, live: tap, ...at });
      for (const fully of [false, true]) {
        const live = cases.find((c) => c.id === `scroll:${truth.cell}.${t.tag}${fully ? '.fully' : ''}` && c.asks !== undefined);
        if (live === undefined) continue;
        const row = rows.find((r) => r.verb === (fully ? 'fully' : 'scroll_until') && r.asks !== undefined);
        if (row === undefined) liveOnly.push(`${t.geometry} ${fully ? 'fully' : 'plain'}`);
        else pairs.push({ key: key(fully ? 'fully' : 'scroll_until'), row, live, ...at });
      }
    }
  }
  const taps = pairs.filter((p) => p.row.verb === 'tap');
  const stops = pairs.filter((p) => p.row.verb !== 'tap');

  it('the corpus is asked by both (taps and stops)', () => {
    expect(taps.length).toBeGreaterThan(150);
    expect(stops.length).toBeGreaterThan(20);
  });

  it('the recorded clauses are equal', () => {
    const differ = pairs.filter((p) => JSON.stringify(p.row.asks) !== JSON.stringify(p.live.asks)).map((p) => `${p.key}: static ${JSON.stringify(p.row.asks)}, live ${JSON.stringify(p.live.asks)}`);
    expect(differ).toEqual([]);
  });

  it('a refusal that sent and fired nothing: both judges accept it unless the tap must fire', () => {
    const differ = taps.flatMap((p) => {
      const ask = p.live.asks as TapAsk;
      const reply = refusal(ask);
      const staticOk = p.row.judge(outcome(reply)) === undefined;
      const app = appAt(p.truth, p.t, false);
      const liveOk = p.live.judge(app, [reply], app, p.source, []).outcome === 'ok';
      return staticOk === liveOk && staticOk === (ask.must !== 'fire') ? [] : [`${p.key} (${JSON.stringify(ask)}): static ${staticOk ? 'accepts' : 'rejects'}, live ${liveOk ? 'accepts' : 'rejects'}`];
    });
    expect(differ).toEqual([]);
  });

  it('a `Tapped` that fired the target alone, sent where the clause lands it: the replay accepts it unless the tap must be refused; the live oracle always (the app logged the target alone — the contract\'s header)', () => {
    const differ = taps.flatMap((p) => {
      const ask = p.live.asks as TapAsk;
      const at = tapPoint(p.t, ask);
      const staticOk = p.row.judge(outcome(`Tapped id:"${p.t.id}"`, [`${p.platform === 'ios' ? 'idb ui' : 'adb shell input'} tap ${at.x} ${at.y}`])) === undefined;
      const liveOk = p.live.judge(appAt(p.truth, p.t, true), [`Tapped id:"${p.t.id}"`], appAt(p.truth, p.t, false), p.source, []).outcome === 'ok';
      return staticOk === (ask.must !== 'refuse') && liveOk ? [] : [`${p.key} (${JSON.stringify(ask)}): static ${staticOk ? 'accepts' : 'rejects'}, live ${liveOk ? 'accepts' : 'rejects'}`];
    });
    expect(differ).toEqual([]);
  });

  it('a stop with no swipe on the target where its capture lays it out: both judges accept it exactly where the stop holds', () => {
    const differ = stops.flatMap((p) => {
      const ask = p.live.asks as StopAsk;
      const reply = `Element id:"${p.t.id}" ${ask.fully ? 'fully ' : ''}visible after 0 swipes`;
      const staticOk = p.row.judge(outcome(reply)) === undefined;
      const launched = appAt(p.truth, p.t, false);
      const liveOk = p.live.judge(appAt(p.truth, p.t, true), [reply, `Tapped id:"${p.t.id}"`], launched, p.source, [launched]).outcome === 'ok';
      return staticOk === liveOk && staticOk === ask.holds ? [] : [`${p.key} (${JSON.stringify(ask)}): static ${staticOk ? 'accepts' : 'rejects'}, live ${liveOk ? 'accepts' : 'rejects'}`];
    });
    expect(differ).toEqual([]);
  });

  // The replay asks R-land and R-fully of a cut target, no plain stop (golden-spec/edges.ts) — the coverage left to the
  // live golden; a centre-out target in a scroll view would join it (none in the committed truth).
  it('what the live golden asks that no replayed row does: only the plain stop on a target cut with its centre in what shows', () => {
    expect([...new Set(liveOnly)].sort()).toEqual(['partly-centre-in plain']);
  });
});
