import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { createIosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { listIosDevices } from '../../src/adapters/discovery.js';
import { AdapterRegistry } from '../../src/mcp/registry.js';
import { createAveriServer } from '../../src/mcp/tools.js';
import { BUNDLE, LabDevice, pause } from './lab-device.js';
import type { LabState } from './schema.js';

/**
 * The live golden (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 1b — phase 5's mode brought forward for the
 * forms): averi's verbs that CHANGE state — a fill with and without clear, typing into the focused field, a fill on the
 * secure field and on a prefilled one, a tap under the keyboard with and without a dismissal, a picker row reached by
 * scroll_until — run through averi's MCP tools against the REAL lab simulator, and the app's own model (the state
 * file, Form.swift) is the oracle. A replayed tree cannot judge these: typing changes nothing in it.
 *
 *   node --import tsx scripts/truth/live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda] [--cases b1,p4] [--shots <dir>]
 *
 * The server is built as tests/mcp/tools.test.ts builds one (createAveriServer over the SDK's in-memory transport and
 * a real Client), over a REAL AdapterRegistry whose factory constructs the iOS adapter itself: averi gives WDA port
 * 8100 to the first simulator a process asks for, and 8100/8101 may belong to another session's WebDriverAgent — here
 * the WDA source takes `--wda-port` (default 8120, capture.ts's). Discovery lists the lab simulator only, so no tool
 * call can bind another booted device. Each case launches its cell in a fresh process (simctl, as the capture does —
 * not averi's launch_app, which is not under test here), runs its calls, waits for the app to write, and reads the
 * model.
 *
 * Outcome per case:
 *  - ok: the model holds what the case asked for, and averi's reply does not contradict it;
 *  - LOUD: the model does not hold it, and averi said so (an error, or "NOT verified") — honest, not a pass;
 *  - MISMATCH: averi claimed what did not happen ("Filled", "Tapped" with the model unchanged), or failed what did;
 *  - SKIP: a keyboard case whose launch shows no soft keyboard — the simulator hides it once it has seen HID typing
 *    (idb ui text); LabDevice.launch writes the simulator's keyboard preferences back before every launch, and the
 *    keyboard's cases run first besides.
 * Not a vitest test: it needs the simulator. Exit code 1 on a MISMATCH.
 */

const { values } = parseArgs({
  options: { udid: { type: 'string' }, 'wda-port': { type: 'string' }, sources: { type: 'string' }, cases: { type: 'string' }, shots: { type: 'string' } },
});
if (values.udid === undefined) throw new Error('usage: live.ts --udid <lab simulator> [--wda-port 8120] [--sources idb,wda] [--cases b1,p4]');
const udid = values.udid;
const port = Number(values['wda-port'] ?? 8120);
const sources = (values.sources ?? 'idb,wda').split(',') as IosTreeSourceKind[];
const only = values.cases?.split(',');
/** Where a case that is not ok leaves its screenshot (`--shots <dir>`), for the evidence. */
const shots = values.shots;
if (shots !== undefined) await mkdir(shots, { recursive: true });
const lab = new LabDevice(udid);

// --- the cases ---

interface Call {
  tool: 'type_text' | 'tap' | 'scroll_until' | 'assert';
  args: Record<string, unknown>;
}

type Verdict = { outcome: 'ok' | 'LOUD' | 'MISMATCH' | 'SKIP'; why: string };

interface Case {
  id: string;
  cell: string;
  says: string;
  /** averi.yaml `app.ios.keyboardDismiss` for this case. */
  dismiss?: unknown[];
  /** The case is about the soft keyboard: judged only when the launch shows it (else SKIP). */
  keyboard?: true;
  calls: Call[];
  judge(state: LabState, replies: string[], source: IosTreeSourceKind): Verdict;
}

const id = (cell: string, tag: string) => `id:"lab.${cell}.${tag}"`;
const fill = (cell: string, tag: string, text: string, clear?: boolean): Call => ({
  tool: 'type_text',
  args: { selector: id(cell, tag), text, ...(clear !== undefined && { clear }) },
});
const valueOf = (s: LabState, tag: string) => s.fields?.[tag]?.value;
const claims = (reply: string) => /^(Filled|Cleared|Tapped)/.test(reply) && !/NOT verified/.test(reply);
const failedReply = (reply: string) => reply.startsWith('ERROR');
const short = (reply: string) => reply.split('\n')[0].slice(0, 220);

/** The model must hold `want` in `tag`; the last reply's claim is held to it (LOUD / MISMATCH as above). */
const holds =
  (tag: string, want: string) =>
  (s: LabState, replies: string[]): Verdict => {
    const got = valueOf(s, tag);
    const last = replies[replies.length - 1];
    if (got === want) {
      return failedReply(last) ? { outcome: 'MISMATCH', why: `the app holds ${JSON.stringify(got)}, but averi failed: ${short(last)}` } : { outcome: 'ok', why: short(last) };
    }
    return claims(last)
      ? { outcome: 'MISMATCH', why: `averi says ${short(last)} — the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}` }
      : { outcome: 'LOUD', why: `the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}; averi: ${short(last)}` };
  };

const P = 'form-prefilled';
const B = 'form-basic';
const K = 'form-keyboard';
const TITLE = { tap: { text: 'Transfer details' } };

const CASES: Case[] = [
  // The keyboard's cases first: once the simulator has seen HID typing (idb ui text) it shows no soft keyboard
  // ("typing with a hardware keyboard keeps the software keyboard from showing", src/adapters/ios.ts) until
  // LabDevice.launch writes its keyboard preferences back — first, so a failure of that write cannot skip them.
  {
    id: 'k1',
    cell: K,
    keyboard: true,
    says: 'a tap under the keyboard, no dismissal configured: refused, the focus stays',
    calls: [{ tool: 'tap', args: { selector: id(K, 'vs') } }],
    judge: (s, [reply]) =>
      s.focus !== 'postcode' ? { outcome: 'MISMATCH', why: `the focus moved to ${s.focus}: ${short(reply)}` }
      : reply.startsWith('Tapped') ? { outcome: 'MISMATCH', why: `averi says ${short(reply)} — the focus stayed on postcode` }
      : { outcome: 'ok', why: short(reply) },
  },
  {
    id: 'k2',
    cell: K,
    keyboard: true,
    dismiss: [TITLE],
    says: 'a tap under the keyboard, keyboardDismiss on the title: wda hides it and taps; idb refuses (the list is inert)',
    calls: [{ tool: 'tap', args: { selector: id(K, 'vs') } }],
    judge: (s, [reply], source) => {
      const tapped = reply.startsWith('Tapped');
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
      return fired === reply.startsWith('Tapped') ? { outcome: fired ? 'ok' : 'LOUD', why: short(reply) } : { outcome: 'MISMATCH', why: `averi says ${short(reply)} — submits: ${(s.submits ?? []).length}` };
    },
  },
  {
    id: 'k3',
    cell: K,
    keyboard: true,
    dismiss: [TITLE],
    says: 'a fill under the keyboard with a dismissal',
    calls: [fill(K, 'note', 'Thanks - ok')],
    judge: (s, replies, source) => {
      const v = holds('note', 'Thanks - ok')(s, replies);
      // idb cannot hide the keyboard: a refusal with the field untouched is the documented answer there.
      return source === 'idb' && v.outcome === 'LOUD' && valueOf(s, 'note') === '' ? { outcome: 'ok', why: `refused (idb): ${short(replies[0])}` } : v;
    },
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
    says: 'fixing a field drops its error, and assert … error reads that from the live tree',
    calls: [
      fill('form-errors', 'name', 'Jan'),
      { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-errors.name' }, error: 'Enter the recipient’s name', timeout: 2_000 }] } },
      { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-errors.email' }, error: 'That’s not an e-mail – check the “@”', timeout: 2_000 }] } },
    ],
    judge: (s, [, gone, still]) => {
      if (s.fields?.name?.error !== null) return { outcome: 'LOUD', why: `the fill did not clear the app's error: ${JSON.stringify(s.fields?.name)}` };
      if (gone.startsWith('All 1 asserts passed')) return { outcome: 'MISMATCH', why: `assert read the error the app no longer shows: ${short(gone)}` };
      if (!still.startsWith('All 1 asserts passed')) return { outcome: 'MISMATCH', why: `the e-mail's error, still shown, failed: ${short(still)}` };
      return { outcome: 'ok', why: 'name: error gone; email: error still read' };
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
      if (chosen) return failedReply(scroll) || failedReply(tap) ? { outcome: 'MISMATCH', why: `chosen, but averi failed: ${short(scroll)} / ${short(tap)}` } : { outcome: 'ok', why: short(scroll) };
      return tap.startsWith('Tapped') ? { outcome: 'MISMATCH', why: `averi says ${short(tap)} — the app chose ${JSON.stringify(valueOf(s, 'country'))}` } : { outcome: 'LOUD', why: `${short(scroll)} / ${short(tap)}` };
    },
  },
];

// --- the server: a real registry, the lab simulator only, WDA on a port of its own ---

async function connect(): Promise<{ client: Client; close(): Promise<void> }> {
  const registry = new AdapterRegistry({
    factory: (_platform, deviceId, opts) => new IosAdapter({ udid: deviceId, treeSource: createIosTreeSource(opts?.treeSource ?? 'idb', deviceId, { port }) }),
    discovery: async (platform) => (platform === 'ios' ? (await listIosDevices()).filter((d) => d.id === udid) : []),
  });
  const server = createAveriServer({ registry, version: 'live-golden' });
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
async function configFor(source: IosTreeSourceKind, dismiss: unknown[] | undefined): Promise<string> {
  const path = join(configDir, `averi-${source}${dismiss === undefined ? '' : '-dismiss'}.yaml`);
  // JSON is YAML.
  await writeFile(path, JSON.stringify({ app: { android: { package: 'dev.averi.lab' }, ios: { bundleId: BUNDLE, treeSource: source, ...(dismiss !== undefined && { keyboardDismiss: dismiss }) } } }));
  return path;
}

async function callTool(client: Client, call: Call, configPath: string): Promise<string> {
  try {
    const r = await client.callTool({ name: call.tool, arguments: { platform: 'ios', ...call.args, configPath } }, undefined, { timeout: 300_000 });
    const text = (r.content as { type: string; text?: string }[]).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
    return `${r.isError === true ? 'ERROR ' : ''}${text}`;
  } catch (e) {
    return `ERROR (thrown) ${(e as Error).message}`;
  }
}

const results: { source: IosTreeSourceKind; c: Case; verdict: Verdict; replies: string[] }[] = [];
const { client, close } = await connect();
try {
  // Cases outer, sources inner: the keyboard's cases run on both sources before anything types.
  for (const c of CASES.filter((x) => only === undefined || only.includes(x.id))) {
    for (const source of sources) {
      const launched = await lab.launch(c.cell);
      if (c.keyboard && launched.keyboard?.visible !== true) {
        const verdict: Verdict = { outcome: 'SKIP', why: 'no soft keyboard at launch (the simulator saw HID typing; see LabDevice.launch)' };
        results.push({ source, c, verdict, replies: [] });
        console.error(`${source} ${c.id} SKIP: ${verdict.why}`);
        continue;
      }
      const config = await configFor(source, c.dismiss);
      const replies: string[] = [];
      for (const call of c.calls) replies.push(await callTool(client, call, config));
      await pause(800);
      const state = (await lab.state())!;
      let verdict = c.judge(state, replies, source);
      if (verdict.outcome !== 'ok') {
        // A miss is read again 3 s later: a model that catches up was the app's lag, not a lost value.
        await pause(3_000);
        const late = c.judge((await lab.state())!, replies, source);
        if (late.outcome !== verdict.outcome) verdict = { ...late, why: `${late.why} (only 3 s later; first read: ${verdict.why})` };
        if (shots !== undefined && verdict.outcome !== 'ok') await lab.simctl('io', udid, 'screenshot', join(shots, `${source}-${c.id}-${Date.now()}.png`));
      }
      results.push({ source, c, verdict, replies });
      console.error(`${source} ${c.id} ${verdict.outcome}: ${verdict.why}`);
    }
  }
} finally {
  await close();
  await lab.simctl('terminate', udid, BUNDLE).catch(() => undefined);
}

const count = (o: Verdict['outcome']) => results.filter((r) => r.verdict.outcome === o).length;
const lines = [`# Live golden: ${results.length} cases, ${count('ok')} ok, ${count('LOUD')} loud, ${count('MISMATCH')} mismatches, ${count('SKIP')} skipped`, ''];
for (const source of sources) {
  lines.push(`## ${source}`);
  for (const r of results.filter((x) => x.source === source)) {
    lines.push(`- ${r.verdict.outcome === 'ok' ? 'ok' : r.verdict.outcome} ${r.c.id} ${r.c.cell}: ${r.c.says} — ${r.verdict.why}`);
    if (r.verdict.outcome !== 'ok') for (const [i, reply] of r.replies.entries()) lines.push(`    ${r.c.calls[i].tool} → ${reply.replaceAll('\n', ' ⏎ ').slice(0, 400)}`);
  }
  lines.push('');
}
console.log(lines.join('\n'));
if (count('MISMATCH') > 0) process.exitCode = 1;
