// T19's read-back: node analyze.mjs <run dir>. Labels each block by the raw-strokes reads around it (no averi: 142-px,
// 300-ms `input swipe`s on carousel-recycler-free, short when 1 in 4 or more carry 94 px or less, T12's label-group rule),
// and each run by its own first probe (the same 142-px, 300-ms stroke from rest after the pre-drag; control only).
// Per stroke averi sent: the app's carry between its touch-down and the next one; 0 = the app took no motion.
import { readFileSync, readdirSync } from 'fs';
const dir = process.argv[2];
const idx = readFileSync(`${dir}/index.txt`, 'utf8').split('\n');
const raw = (n) => { try { return readFileSync(`${dir}/raw-${n}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return undefined; } };
const label = (rows) => { if (!rows) return { state: 'none' }; const c = rows.flatMap((r) => r.strokes.map((s) => s.carry)); const short = c.filter((x) => x <= 94).length; return { short, n: c.length, zero: c.filter((x) => x === 0).length, pre: rows.map((r) => r.pre), carries: c, state: short * 4 >= c.length ? 'short' : 'fast' }; };
// block membership from the index
const blockOf = {}; let block = 0; const when = {};
for (const l of idx) { const m = l.match(/^block (\d+)/); if (m) block = +m[1]; const b = l.match(/^before (\S+) (\S+)/); if (b) { blockOf[b[1]] = block; when[b[1]] = b[2]; } }
// carries of the strokes averi sent: touches after the launch, each one's strokes until the next touch
function carries(r, view) {
  const launchedTouches = (r.launched.events ?? []).filter((e) => e.kind === 'touch').length;
  const ev = r.state.events ?? []; const touches = ev.filter((e) => e.kind === 'touch').slice(launchedTouches);
  const tapAt = ev.find((e) => e.kind === 'tap')?.at;
  const sw = touches.filter((t) => tapAt === undefined || Math.abs(t.at - tapAt) > 0.05); // the tap's own touch is not a stroke
  const st = (r.state.strokes ?? []).filter((s) => s.view === view);
  return sw.map((t, i) => { const end = sw[i + 1]?.at ?? tapAt ?? Infinity; return st.filter((s) => s.at >= t.at && s.at < end).reduce((a, s) => a + (s.to - s.from), 0); });
}
const outcome = (log, id) => (log.match(new RegExp(`^- (ok|LOUD|MISMATCH|SKIP)\\b[^\\n]*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')) ?? [])[1] ?? '?';
const consecutiveZero = (c) => c.some((x, i) => i > 0 && x === 0 && c[i - 1] === 0);
const rows = [];
const files = readdirSync(dir).filter((f) => /^(control|flush)-\d+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
for (const f of files) {
  const nm = f.replace('.json', ''); const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')); const log = readFileSync(`${dir}/${nm}.log.txt`, 'utf8');
  const b = blockOf[nm];
  for (const r of j.results) {
    const control = r.id === 'lv-d62-control';
    const view = control ? 'carousel' : r.id.includes('.P.') ? 'upper' : 'lower';
    const c = carries(r, view);
    const reply = r.replies?.[0] ?? '';
    const claim = /fully visible after/.test(reply) && !/^ERROR/.test(reply);
    const hedged = /may (still )?be cut/.test(reply);
    const tag = control ? 'C' : r.id.includes('.P.') ? 'P' : 'S';
    const fr = r.state.frames?.[tag]; const clip = r.state.scrollViews?.[view];
    const cutR = control && fr && clip ? Math.max(0, fr.x + fr.width - (clip.x + clip.width)) : undefined;
    const cutB = !control && fr && clip ? Math.max(0, fr.y + fr.height - (clip.y + clip.height)) : undefined;
    rows.push({ run: nm, id: r.id, at: when[nm], block: b, pre: control ? r.launched.offsets?.carousel : undefined, first: c[0], carries: c, sent: control ? r.swipes?.length : undefined, touches: c.length,
      held: c.filter((x) => x === 0).length, firstHeld: c[0] === 0, twoInRow: consecutiveZero(c), outcome: outcome(log, r.id), claim, hedged, cut: cutR ?? cutB, reply: reply.slice(0, 160) });
  }
}
const blocks = [...new Set(rows.map((r) => r.block))];
const bl = Object.fromEntries(blocks.map((b) => [b, { before: label(raw(b)), after: label(raw(b + 1)) }]));
for (const r of rows) { const L = bl[r.block]; r.state = L.before.state === L.after.state ? L.before.state : `${L.before.state}->${L.after.state}`; r.probeState = r.first === undefined || r.id !== 'lv-d62-control' ? '-' : r.first <= 94 ? 'short' : 'fast'; }
console.log('raw reads (no averi):');
for (let n = 1; raw(n); n++) { const L = label(raw(n)); console.log(`  raw-${n} ${L.state} ${L.short}/${L.n} at <=94, zero ${L.zero}, pre ${L.pre.join(' ')}, carries ${L.carries.join(' ')}`); }
console.log('runs:');
for (const r of rows) console.log(`  ${r.run} ${r.id.replace('scroll:scroll-bounded-flush.', '')} ${r.at} block ${r.block} [${r.state}; probe ${r.probeState}] pre ${r.pre ?? '-'} carries ${r.carries.join(',')} held ${r.held}${r.firstHeld ? ' FIRST-HELD' : ''}${r.twoInRow ? ' TWO-IN-ROW' : ''} ${r.outcome}${r.claim ? ' CLAIM' : ''}${r.hedged ? ' hedged' : ''} cut ${r.cut} | ${r.reply}`);
const sum = (pred) => rows.filter(pred).length;
const tally = (st) => { const R = rows.filter((r) => r.state === st); const c = R.filter((r) => r.id === 'lv-d62-control'); const f = R.filter((r) => r.id !== 'lv-d62-control');
  const strokes = R.flatMap((r) => r.carries);
  return `${st}: control ${c.length} (false claims ${c.filter((r) => r.claim && r.cut > 0).length}, first probe held ${c.filter((r) => r.firstHeld).length}, probe <=94 ${c.filter((r) => r.first <= 94).length}, outcomes ${JSON.stringify(c.reduce((a, r) => ({ ...a, [r.outcome]: (a[r.outcome] ?? 0) + 1 }), {}))}); flush P/S ${f.length} (false claims ${f.filter((r) => r.claim && r.cut > 0).length}, first held ${f.filter((r) => r.firstHeld).length}); strokes ${strokes.length}, held ${strokes.filter((x) => x === 0).length}, two held in a row ${R.filter((r) => r.twoInRow).length}`; };
console.log('tally:');
for (const st of [...new Set(rows.map((r) => r.state))]) console.log('  ' + tally(st));
console.log(`  all: false claims ${sum((r) => r.claim && r.cut > 0)}, held strokes ${rows.reduce((a, r) => a + r.held, 0)} of ${rows.reduce((a, r) => a + r.carries.length, 0)}, first held ${sum((r) => r.firstHeld)}, two in a row ${sum((r) => r.twoInRow)}`);
