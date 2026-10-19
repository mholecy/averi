// A9 diagnosis: raw idb typing into the RN lab app's single-line field N (rn-field), no averi.
// usage: node diag.mjs <mode> <runs> <text> [out.jsonl]
// modes: burst | chunk<N>[-<ms>] | burst+tail
import { execFile } from 'node:child_process';
import { readFile, appendFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';

const run = promisify(execFile);
const UDID = '3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348';
const [mode, runsArg, text, out] = process.argv.slice(2);
const runs = Number(runsArg);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const idb = (...a) => run('idb', [...a, '--udid', UDID], { timeout: 60_000 });
const container = (await run('xcrun', ['simctl', 'get_app_container', UDID, 'dev.averi.lab.rn', 'data'])).stdout.trim();
const stateFile = join(container, 'Documents', 'lab-state.json');
const value = async () => JSON.parse(await readFile(stateFile, 'utf8')).fields.N.value;

async function clear() {
  await idb('ui', 'key-sequence', ...Array(30).fill('42'));
  await idb('ui', 'key-sequence', ...Array(30).fill('76'));
  await pause(400);
}

async function type(t) {
  const m = /^chunk(\d+)(?:-(\d+))?$/.exec(mode);
  if (m === null) return idb('ui', 'text', t);
  const n = Number(m[1]);
  const gap = Number(m[2] ?? 0);
  for (let i = 0; i < t.length; i += n) {
    await idb('ui', 'text', t.slice(i, i + n));
    if (gap > 0) await pause(gap);
  }
}

let lost = 0;
let lostAfterTail = 0;
for (let i = 0; i < runs; i++) {
  await clear();
  const before = await value();
  const t0 = Date.now();
  await type(text);
  const ms = Date.now() - t0;
  await pause(1500);
  const got = await value();
  const rec = { mode, i, before, ms, got, whole: got === text };
  if (got !== text) lost++;
  if (mode === 'burst+tail' && got !== text && text.startsWith(got)) {
    await idb('ui', 'text', text.slice(got.length));
    await pause(1500);
    rec.afterTail = await value();
    if (rec.afterTail !== text) lostAfterTail++;
  }
  console.log(JSON.stringify(rec));
  if (out) await appendFile(out, JSON.stringify({ text, ...rec }) + '\n');
}
console.log(JSON.stringify({ mode, text, runs, lost, ...(mode === 'burst+tail' && { lostAfterTail }) }));
