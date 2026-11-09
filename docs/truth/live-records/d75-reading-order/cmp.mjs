// D75 live: each case's verdict on base vs fix, from the two runs' logs. node cmp.mjs <base.log> <fix.log>
import { readFileSync } from 'fs';
const load = (p) => new Map(readFileSync(p, 'utf8').split('\n').map((l) => l.match(/^(uiautomator) (\S+) (\S+?)( \(known[^)]*\))?:/)).filter(Boolean).map((m) => [m[2], m[3] + (m[4] ?? '')]));
const [b, f] = process.argv.slice(2).map(load);
const ids = [...new Set([...b.keys(), ...f.keys()])];
const tally = (m) => Object.entries([...m.values()].reduce((a, v) => ((a[v] = (a[v] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`base: ${b.size} cases (${tally(b)})\nfix:  ${f.size} cases (${tally(f)})`);
const diff = ids.filter((k) => b.get(k) !== f.get(k));
console.log(`changed verdicts: ${diff.length}`);
for (const k of diff) console.log(`  ${k}: ${b.get(k) ?? '-'} -> ${f.get(k) ?? '-'}`);
