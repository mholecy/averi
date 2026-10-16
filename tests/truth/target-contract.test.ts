import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Platform, SourceKind } from '../../scripts/differential/corpus.js';
import type { Outcome } from '../../scripts/differential/differential.js';
import { expectations, type Expectation } from '../../scripts/differential/golden-spec.js';
import { visibilityCases, type VisibilityCase } from '../../scripts/truth/live-visibility.js';
import type { CellTruth, LabState, TargetTruth } from '../../scripts/truth/schema.js';
import { fullyAsked, homeIndicatorBand, judgedGeometry, judgedSafeArea, stopAsk, tapAsk, unlistedBy, type TapAsk } from '../../scripts/truth/target-contract.js';

// The target contract (scripts/truth/target-contract.ts): what a target is asked, decided once — and both goldens its
// consumers. The parity block below runs over every committed truth (tests/fixtures/truth): for every target both the
// replayed golden (golden-spec.ts#expectations) and the live golden (live-visibility.ts#visibilityCases) ask, the
// clauses they stamp are equal, and their two judges agree on a refusal that sent nothing and fired nothing.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS = `${ROOT}tests/fixtures/truth`;

const target = (over: Partial<TargetTruth>): TargetTruth => ({ tag: 'T', id: 'lab.c.T', color: '#000000', declared: 'open', frame: { x: 51, y: 400, width: 300, height: 64 }, reached: true, probe: [], drawn: 1, seen: '#000000', ...over });

describe('the contract\'s rules', () => {
  it('iOS\'s home-indicator band is no band: judged whole, its tap must fire; Android\'s navigation band is one', () => {
    expect(homeIndicatorBand('ios', 'nav-band')).toBe(true);
    expect(homeIndicatorBand('android', 'nav-band')).toBe(false);
    expect(judgedGeometry('ios', 'nav-band')).toBe('whole');
    expect(judgedGeometry('ios', 'status-band')).toBe('status-band');
    expect(judgedGeometry('android', 'nav-band')).toBe('nav-band');
    expect(tapAsk('ios', target({ geometry: 'nav-band' }))).toEqual({ must: 'fire', inside: 'node' });
    expect(tapAsk('android', target({ geometry: 'nav-band' }))).toEqual({ must: 'land-or-refuse', inside: 'visible' });
    expect(tapAsk('android', target({ geometry: 'nav-band', reached: false }))).toEqual({ must: 'refuse' });
    expect(judgedSafeArea('ios', { top: 62, left: 0, bottom: 34, right: 0 })).toEqual({ top: 62, left: 0, bottom: 0, right: 0 });
    expect(judgedSafeArea('android', { top: 63, left: 0, bottom: 66, right: 0 })).toEqual({ top: 63, left: 0, bottom: 66, right: 0 });
  });
  it('the tap\'s clause by the truth', () => {
    expect(tapAsk('ios', target({}))).toEqual({ must: 'fire', inside: 'node' });
    expect(tapAsk('ios', target({ drawn: 0.5 }))).toBeUndefined();
    expect(tapAsk('ios', target({ declared: 'presented-over', reached: false }))).toEqual({ must: 'refuse', remedy: 'close it first' });
    expect(tapAsk('ios', target({ declared: 'presented-over' }))).toBeUndefined();
    for (const g of ['off-screen', 'outside-scroll-view', 'sliver'] as const) expect(tapAsk('ios', target({ geometry: g, reached: g === 'sliver' }))).toEqual({ must: 'refuse', remedy: 'scroll_until' });
    expect(tapAsk('ios', target({ geometry: 'partly-centre-in' }))).toEqual({ must: 'fire', inside: 'visible' });
    expect(tapAsk('ios', target({ geometry: 'chrome-overlap:tabBar' }))).toEqual({ must: 'fire', inside: 'visible' });
    expect(tapAsk('ios', target({ geometry: 'centre-out', reached: false, reachedAtPiece: true }))).toEqual({ must: 'land-or-refuse', inside: 'piece' });
    expect(tapAsk('ios', target({ geometry: 'under-chrome:fab', reached: false }))).toEqual({ must: 'refuse' });
    expect(tapAsk('ios', target({ geometry: 'status-band', reached: false }))).toEqual({ must: 'refuse' });
  });
  it('fully asked of a cut target and a chrome-overlapped one; of a band or band-overlapped one in a scroll view only', () => {
    for (const g of ['partly-centre-in', 'centre-out', 'sliver', 'chrome-overlap:stickyHeader'] as const) expect(fullyAsked('android', { geometry: g })).toBe(true);
    for (const g of ['status-band', 'nav-band', 'band-overlap:status'] as const) {
      expect(fullyAsked('android', { geometry: g })).toBe(false);
      expect(fullyAsked('android', { geometry: g, scrollView: 'page' })).toBe(true);
    }
    expect(fullyAsked('ios', { geometry: 'nav-band', scrollView: 'page' })).toBe(false);
    for (const g of ['whole', 'off-screen', 'outside-scroll-view', 'under-chrome:fab'] as const) expect(fullyAsked('android', { geometry: g, scrollView: 'page' })).toBe(false);
  });
  it('the plain stop holds where a centre-based stop may stop; fully only on a whole target', () => {
    expect(stopAsk('android', { geometry: 'band-overlap:nav' }, false)).toEqual({ fully: false, holds: true });
    expect(stopAsk('android', { geometry: 'band-overlap:nav' }, true)).toEqual({ fully: true, holds: false });
    expect(stopAsk('android', { geometry: 'nav-band' }, false)).toEqual({ fully: false, holds: false });
    expect(stopAsk('ios', { geometry: 'nav-band' }, true)).toEqual({ fully: true, holds: true });
  });
  it('unlisted: only where the capture\'s tree of that source said it does not list the target', () => {
    expect(unlistedBy({ listed: { uiautomator: false, wda: true } }, 'uiautomator')).toBe("the capture's uiautomator tree does not list it");
    expect(unlistedBy({ listed: { uiautomator: false, wda: true } }, 'wda')).toBeUndefined();
    expect(unlistedBy({}, 'idb')).toBeUndefined();
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

const launched: LabState = { cell: 'c', ready: true, screen: { x: 0, y: 0, width: 402, height: 874 }, scale: 3, frames: {}, events: [] };
const outcome = (reply: string): Outcome => ({ reply, device: [] }) as unknown as Outcome;
/** A refusal that sent nothing, naming the clause's remedy where it has one (as averi's refusals word them). */
const refusal = (ask: TapAsk) => `ERROR id:"x" was not tapped${ask.must === 'refuse' && ask.remedy !== undefined ? ` — ${ask.remedy === 'scroll_until' ? 'scroll_until it first' : 'close it first'}` : ''}; nothing was tapped`;

describe('static ↔ live: for every committed truth target both goldens ask, the same clause', () => {
  const all = captures();
  const pairs: { key: string; row: Expectation; live: VisibilityCase }[] = [];
  /** The live stop clauses no replayed row asks — the coverage the replay leaves to the live golden. */
  const liveOnly: string[] = [];
  for (const { platform, source, truth, run } of all) {
    const cases = visibilityCases(truth, platform);
    for (const t of truth.targets) {
      const rows = expectations(platform, t, truth, source).filter((e) => e.live === undefined);
      const key = (what: string) => `${run}/${truth.cell}.${source} ${t.tag} ${what}`;
      const tap = cases.find((c) => c.id === `tap:${truth.cell}.${t.tag}`);
      const tapRow = rows.find((r) => r.verb === 'tap');
      if (tap !== undefined && tapRow !== undefined) pairs.push({ key: key('tap'), row: tapRow, live: tap });
      for (const fully of [false, true]) {
        const live = cases.find((c) => c.id === `scroll:${truth.cell}.${t.tag}${fully ? '.fully' : ''}` && c.asks !== undefined);
        if (live === undefined) continue;
        const row = rows.find((r) => r.verb === (fully ? 'fully' : 'scroll_until') && r.asks !== undefined);
        if (row === undefined) liveOnly.push(`${t.geometry} ${fully ? 'fully' : 'plain'}`);
        else pairs.push({ key: key(fully ? 'fully' : 'scroll_until'), row, live });
      }
    }
  }

  it('the corpus is asked by both (taps and stops)', () => {
    expect(pairs.filter((p) => p.row.verb === 'tap').length).toBeGreaterThan(150);
    expect(pairs.filter((p) => p.row.verb !== 'tap').length).toBeGreaterThan(20);
  });

  it('the stamped clauses are equal', () => {
    const differ = pairs.filter((p) => JSON.stringify(p.row.asks) !== JSON.stringify(p.live.asks)).map((p) => `${p.key}: static ${JSON.stringify(p.row.asks)}, live ${JSON.stringify(p.live.asks)}`);
    expect(differ).toEqual([]);
  });

  it('the two judges agree on a refusal that sent nothing and fired nothing: accepted unless the tap must fire', () => {
    const differ = pairs
      .filter((p) => p.row.verb === 'tap')
      .flatMap((p) => {
        const ask = p.live.asks as TapAsk;
        const reply = refusal(ask);
        const staticOk = p.row.judge(outcome(reply)) === undefined;
        const liveOk = p.live.judge(launched, [reply], launched, 'wda', []).outcome === 'ok';
        return staticOk === liveOk && staticOk === (ask.must !== 'fire') ? [] : [`${p.key} (${JSON.stringify(ask)}): static ${staticOk ? 'accepts' : 'rejects'}, live ${liveOk ? 'accepts' : 'rejects'}`];
      });
    expect(differ).toEqual([]);
  });

  // The replay asks R-land and R-fully of a cut target, no plain stop (golden-spec/edges.ts) — the coverage left to the
  // live golden; a centre-out target in a scroll view would join it (none in the committed truth).
  it('what the live golden asks that no replayed row does: only the plain stop on a target cut with its centre in what shows', () => {
    expect([...new Set(liveOnly)].sort()).toEqual(['partly-centre-in plain']);
  });
});
