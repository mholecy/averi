import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classify, DeviceRunConverter, sessionTrees } from '../../scripts/differential/convert.js';

// The converter's reading of a device-check run directory: which file is which capture, what the server's
// session.log holds, and that a screen read many times is taken once.

const tree = (label: string, extra: Record<string, unknown> = {}) => ({
  role: 'container',
  label,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 402, height: 874 },
  children: [],
  ...extra,
});
const idbList = (label: string) => [
  { type: 'Application', AXLabel: label, AXUniqueId: null, AXFrame: '{{0, 0}, {402, 874}}', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { type: 'Button', AXLabel: 'OK', AXUniqueId: 'ok', frame: { x: 10, y: 10, width: 50, height: 20 } },
];

describe('classify', () => {
  it.each([
    ['a raw idb describe-all list', JSON.stringify(idbList('Skeleton Internal')), 'ios', ['capture', 'idb', 'raw']],
    ['a raw WDA /source?format=json body', JSON.stringify({ value: { type: 'Application', label: 'Contacts' }, sessionId: null }), 'ios', ['capture', 'wda', 'raw']],
    ['a uiautomator dump', '<?xml version="1.0"?><hierarchy rotation="0"><node bounds="[0,0][1,1]"/></hierarchy>', 'android', ['capture', 'uiautomator', 'raw']],
    ['a saved idb ui_snapshot after its header line', `#77 (0.4s)\n${JSON.stringify(tree('', { flatList: true }))}`, 'ios', ['capture', 'idb', 'normalized']],
    ['a saved WDA ui_snapshot', JSON.stringify(tree('Contacts')), 'ios', ['capture', 'wda', 'normalized']],
    ['a filtered snapshot (a list of nodes)', `#71 (1.7s)\n${JSON.stringify([tree('a'), tree('b')])}`, 'ios', ['skip', 'a filtered snapshot: a node list, not a tree']],
    ['WDA\'s XML /source', '<?xml version="1.0" encoding="UTF-8"?><XCUIElementTypeApplication/>', 'ios', ['skip', 'WDA XML source: no parser reads that format']],
    ['WDA\'s XML /source in its JSON envelope', '{\n  "value" : "<?xml version=\\"1.0\\"?><XCUIElementTypeApplication/>"\n}', 'ios', ['skip', 'WDA XML source: no parser reads that format']],
    ['a flattened text listing', "button id=None lab='add address' val='' 20,969 362x51", 'ios', ['skip', 'not a tree (no JSON in it: a text listing or a log)'], 'a.txt'],
    ['a .json that holds no tree (a tool listing)', '#1 (0.0s)\n## list_devices\n{"type":"object"}', 'ios', ['skip', 'not a tree'], 'tools.json'],
  ] as const)('%s', (_name, text, platform, want, file?: string) => {
    const c = classify(text, platform, file);
    expect(c.kind === 'capture' ? [c.kind, c.source, c.form] : [c.kind, c.reason]).toEqual(want);
  });
});

describe('sessionTrees', () => {
  it('every unfiltered ui_snapshot result that is a tree, with its call number; filtered calls and error results are not', () => {
    const log = [
      '--- #1 2026-10-13T17:10:24Z CALL __list {}',
      '--- #1 RESULT (0.0s)',
      '## list_devices',
      `--- #7 2026-10-13T17:11:00Z CALL ui_snapshot {"platform":"ios"}`,
      '--- #7 RESULT (0.4s)',
      JSON.stringify(tree('first {brace} "quoted"'), null, 2),
      '⏎ a note after the tree',
      `--- #8 2026-10-13T17:11:01Z CALL ui_snapshot {"platform":"ios","filter":"id:x"}`,
      '--- #8 RESULT (0.3s)',
      JSON.stringify([tree('filtered')]),
      `--- #9 2026-10-13T17:11:02Z CALL ui_snapshot {"platform":"ios"}`,
      '--- #9 RESULT (1.0s) ERROR',
      'idb returned an empty accessibility tree',
      `--- #10 2026-10-13T17:11:03Z CALL ui_snapshot {"platform":"android","filter":""}`,
      '--- #10 RESULT (2.0s)',
      JSON.stringify(tree('second')),
    ].join('\n');
    expect(sessionTrees(log).map(([call, t]) => [call, t.label])).toEqual([
      ['7', 'first {brace} "quoted"'],
      ['10', 'second'],
    ]);
  });
});

describe('DeviceRunConverter', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-convert-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads subdirectories, takes a payload read many times once (key order aside), and drops a logged tree some run saved as a file', async () => {
    const run = join(dir, 'run12-ios');
    await mkdir(join(run, 'F1poll'), { recursive: true });
    await writeFile(join(run, 'F1poll', '1.json'), JSON.stringify(idbList('A')));
    await writeFile(join(run, 'F1poll', '2.json'), JSON.stringify(idbList('A').map((e) => Object.fromEntries(Object.entries(e).reverse()))));
    await writeFile(join(run, 'F1poll', '3.json'), JSON.stringify(idbList('B')));
    await writeFile(join(run, 'snap.json'), `#5 (1.0s)\n${JSON.stringify(tree('Saved'))}`);
    await writeFile(join(run, 'a.txt'), "button id=None lab='x'");
    await writeFile(
      join(run, 'session.log'),
      [`--- #5 t CALL ui_snapshot {"platform":"ios"}`, '--- #5 RESULT (1.0s)', JSON.stringify(tree('Saved')), `--- #6 t CALL ui_snapshot {"platform":"ios"}`, '--- #6 RESULT (1.0s)', JSON.stringify(tree('Only logged'))].join('\n'),
    );
    const convert = new DeviceRunConverter();
    const b = await convert.files(run);
    await convert.sessions(run, b);
    expect(b.manifest.captures.map((c) => [c.file, c.source, c.form])).toEqual([
      ['F1poll.1.json', 'idb', 'raw'],
      ['F1poll.3.json', 'idb', 'raw'],
      ['snap.json', 'wda', 'normalized'],
      ['session-6.json', 'wda', 'normalized'],
    ]);
    expect(convert.counts.get('run12-ios')).toEqual({ files: 3, fileRepeats: 1, skipped: ['a.txt (not a tree (no JSON in it: a text listing or a log))'], logged: 2, loggedTaken: 1 });
    expect(b.manifest.note).toMatch(/a\.txt/);
  });
});
