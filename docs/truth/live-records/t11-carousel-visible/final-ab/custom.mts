// Throwaway: extra cases through the real run-case.ts cycle, no harness change. node --import tsx custom.ts <record> <case id>
const WT = process.env.T11_WT!;
const { mkdir, writeFile } = await import('node:fs/promises');
const { Client } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { loadSide } = await import(`${WT}/scripts/differential/side.ts`);
const { AndroidLab, LAB_AVD } = await import(`${WT}/scripts/truth/lab-device.ts`);
const { hookSwipes, SwipeHook, CAROUSEL_CASES } = await import(`${WT}/scripts/truth/live-carousel.ts`);
const { caseConfig, ROOT } = await import(`${WT}/scripts/truth/live-cases.ts`);
const { callReply } = await import(`${WT}/scripts/truth/replies.ts`);
const { runCase } = await import(`${WT}/scripts/truth/run-case.ts`);
const [recordPath, which] = process.argv.slice(2);
const device = 'emulator-5554';
const control = CAROUSEL_CASES.find((c: any) => c.id === 'lv-d62-control');
const ok = (s: any, replies: string[]) => ({ outcome: 'ok', why: replies.map((r) => r.slice(0, 100)).join(' | ') });
const fully = (cell: string, tag: string, direction: string, extra = {}) => ({ tool: 'scroll_until', args: { selector: `id:"lab.${cell}.${tag}"`, direction, fully: true, ...extra } });
const CASES: Record<string, any> = {
  // m3: the control with room for two swallowed strokes in a row.
  'ctl-12': { ...control, id: 'ctl-12', group: 'carousel', reads: { swipes: {}, late: false }, calls: [{ tool: 'scroll_until', args: { ...control.calls[0].args, maxSwipes: 12, timeoutMs: 40000 } }], judge: ok },
  // The hedge's "calling again tells": sticky R, the same call twice.
  // The one predicted harm: a content-end pass with no budget for the retry, then a repeat call.
  'sticky-R-2': { id: 'sticky-R-2', group: 'carousel', cell: 'scroll-sticky-cut', says: 'R fully, maxSwipes 2, then again', reads: { late: false }, calls: [fully('scroll-sticky-cut', 'R', 'down', { maxSwipes: 2 }), fully('scroll-sticky-cut', 'R', 'down')], judge: ok },
  'again-sticky-R': { id: 'again-sticky-R', group: 'carousel', cell: 'scroll-sticky-cut', says: 'R fully, twice', reads: { late: false }, calls: [fully('scroll-sticky-cut', 'R', 'down'), fully('scroll-sticky-cut', 'R', 'down')], judge: ok },
};
const c = CASES[which];
const averi = await loadSide(process.env.T11_SIDE ?? WT);
const hook = new SwipeHook();
const lab = new AndroidLab(device, { app: 'native' });
await lab.guard();
const registry = averi.registry({ factory: (p: any, id: string, o: any) => hookSwipes(averi.defaultFactory(p, id, o), hook), discovery: async (p: string) => (p !== 'android' ? [] : [{ id: device, platform: 'android', name: LAB_AVD, osVersion: 'lab', state: 'booted' }]) });
const server = averi.createAveriServer({ registry, version: 'live-golden' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 't11', version: '0' });
await client.connect(b);
const cfgDir = `${process.env.TMPDIR}/t11-${process.pid}`; await mkdir(cfgDir, { recursive: true });
const run = await runCase(c, 'uiautomator', { lab, callTool: (call: any, config: string) => callReply(client, call.tool, { platform: 'android', ...call.args, configPath: config }), configFor: async (s: any) => { const p = `${cfgDir}/a.yaml`; await writeFile(p, JSON.stringify(caseConfig(s, c, 'native'))); return p; }, swipes: hook, note: console.error });
await writeFile(recordPath, JSON.stringify({ platform: 'android', side: 'this checkout', results: [run.record] }) + '\n');
for (const r of run.record.replies) console.log(r.slice(0, 400));
await client.close(); await server.close(); await registry.shutdown(); await lab.close();
