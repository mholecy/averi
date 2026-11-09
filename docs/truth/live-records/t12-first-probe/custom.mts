// T12, throwaway: extra cases through the real run-case.ts cycle, no harness change. node --import tsx custom.mts <record> <case id>
// T12_WT: the harness checkout (the fix's); T12_SIDE: the checkout whose src answers (base or fix).
const WT = process.env.T12_WT!;
const { mkdir, writeFile } = await import('node:fs/promises');
const { Client } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { loadSide } = await import(`${WT}/scripts/differential/side.ts`);
const { AndroidLab, LAB_AVD } = await import(`${WT}/scripts/truth/lab-device.ts`);
const { hookSwipes, SwipeHook, CAROUSEL_CASES } = await import(`${WT}/scripts/truth/live-carousel.ts`);
const { caseConfig } = await import(`${WT}/scripts/truth/live-cases.ts`);
const { callReply } = await import(`${WT}/scripts/truth/replies.ts`);
const { runCase } = await import(`${WT}/scripts/truth/run-case.ts`);
const [recordPath, which] = process.argv.slice(2);
const device = 'emulator-5554';
const dropFirst = CAROUSEL_CASES.find((c: any) => c.id === 'lv-t12-drop-first');
const ok = (s: any, replies: string[]) => ({ outcome: 'ok', why: replies.map((r) => r.slice(0, 100)).join(' | ') });
const fully = (cell: string, tag: string, direction: string, extra = {}) => ({ tool: 'scroll_until', args: { selector: `id:"lab.${cell}.${tag}"`, direction, fully: true, ...extra } });
const CASES: Record<string, any> = {
  // The residual's record, not a pass: the first two strokes dropped — two held first probes, which read `checked`.
  'lv-t12-drop-two-first': { ...dropFirst, id: 'lv-t12-drop-two-first', group: 'carousel', reads: { swipes: { drop: [1, 2] }, late: false } },
  // The cost with no budget for the second probe: scroll-sticky-rest's R at rest, one swipe.
  'rest-R-1': { id: 'rest-R-1', group: 'carousel', cell: 'scroll-sticky-rest', says: 'R at rest, fully, maxSwipes 1', reads: { late: false }, calls: [fully('scroll-sticky-rest', 'R', 'down', { maxSwipes: 1 })], judge: ok },
};
const c = CASES[which];
if (c === undefined) throw new Error(`no case ${which}`);
const averi = await loadSide(process.env.T12_SIDE ?? WT);
const hook = new SwipeHook();
const lab = new AndroidLab(device, { app: 'native' });
await lab.guard();
const registry = averi.registry({ factory: (p: any, id: string, o: any) => hookSwipes(averi.defaultFactory(p, id, o), hook), discovery: async (p: string) => (p !== 'android' ? [] : [{ id: device, platform: 'android', name: LAB_AVD, osVersion: 'lab', state: 'booted' }]) });
const server = averi.createAveriServer({ registry, version: 'live-golden' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 't12', version: '0' });
await client.connect(b);
const cfgDir = `${process.env.TMPDIR}/t12-${process.pid}`; await mkdir(cfgDir, { recursive: true });
const run = await runCase(c, 'uiautomator', { lab, callTool: (call: any, config: string) => callReply(client, call.tool, { platform: 'android', ...call.args, configPath: config }), configFor: async (s: any) => { const p = `${cfgDir}/a.yaml`; await writeFile(p, JSON.stringify(caseConfig(s, c, 'native'))); return p; }, swipes: hook, note: console.error });
await writeFile(recordPath, JSON.stringify({ platform: 'android', side: 'this checkout', results: [run.record] }) + '\n');
for (const r of run.record.replies) console.log(r.slice(0, 400));
await client.close(); await server.close(); await registry.shutdown(); await lab.close();
