// Throwaway, a no-change check: Settings' "Network & internet" cut at its list's top, fully: true up, then the same call again. It does not reach the held path. node --import tsx settings-network.mts <out.json>
const WT = process.env.T12_WT!;
const { writeFile, mkdir } = await import('node:fs/promises');
const { execFileSync } = await import('node:child_process');
const { Client } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
const { InMemoryTransport } = await import(`${WT}/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js`);
const { loadSide } = await import(`${WT}/scripts/differential/side.ts`);
const { callReply } = await import(`${WT}/scripts/truth/replies.ts`);
const out = process.argv[2];
const device = 'emulator-5554';
const adb = (...a: string[]) => execFileSync('adb', ['-s', device, ...a], { encoding: 'utf8', maxBuffer: 1 << 26 });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LIST_TOP = 297;
const rowOf = (xml: string) => {
  const m = /text="Network &amp; internet"[^>]*bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(xml);
  return m === null ? undefined : { x: +m[1], y: +m[2], width: +m[3] - +m[1], height: +m[4] - +m[2] };
};
const dump = () => adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
const averi = await loadSide(process.env.T12_SIDE ?? WT);
const registry = averi.registry({ factory: (p: any, id: string, o: any) => averi.defaultFactory(p, id, o), discovery: async (p: string) => (p !== 'android' ? [] : [{ id: device, platform: 'android', name: 'averi_lab', osVersion: 'lab', state: 'booted' }]) });
const server = averi.createAveriServer({ registry, version: 'live-golden' });
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
const client = new Client({ name: 't11', version: '0' });
await client.connect(b);
const dir = `${process.env.TMPDIR}/t12-s-${process.pid}`; await mkdir(dir, { recursive: true });
const config = `${dir}/a.yaml`; await writeFile(config, JSON.stringify({ app: { android: { package: 'com.android.settings' } } }));
adb('shell', 'am', 'force-stop', 'com.android.settings');
adb('shell', 'am', 'start', '-W', '-a', 'android.settings.SETTINGS');
await pause(1500);
adb('shell', 'input', 'swipe', '540', '1900', '540', '1376', '1500');
await pause(1200);
const before = rowOf(dump());
// The premise: the text lies flush on the list's top, cut (74 tall whole).
const flush = before !== undefined && before.y === LIST_TOP && before.height > 0 && before.height < 74;
const call = async () => { const t = Date.now(); const reply = await callReply(client, 'scroll_until', { platform: 'android', selector: 'text:"Network & internet"', direction: 'up', fully: true, configPath: config }); return { reply, ms: Date.now() - t }; };
const first = await call();
const afterFirst = rowOf(dump());
const second = await call();
const afterSecond = rowOf(dump());
// The oracle: what the screen shows after both.
execFileSync('sh', ['-c', `adb -s ${device} exec-out screencap -p > '${out.replace(/\.json$/, '.png')}'`]);
await writeFile(out, JSON.stringify({ side: process.env.T12_SIDE === undefined ? 'this' : process.env.T12_SIDE.split("/").pop(), flush, before, first, afterFirst, second, afterSecond }) + '\n');
console.log(JSON.stringify({ flush, before, afterFirst, afterSecond, first: first.reply.slice(0, 260), firstMs: first.ms, second: second.reply.slice(0, 260), secondMs: second.ms }));
await client.close(); await server.close(); await registry.shutdown();
adb('shell', 'am', 'force-stop', 'com.android.settings');
