import { describe, expect, it } from 'vitest';
import { createIosTreeSource, IdbEmptyTreeError, IdbTreeSource, parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { rebootSimulatorAdvice } from '../../src/adapters/simulator-reboot.js';
import { fakeFetch, fakeSpawn, tempDerivedData, WDA_STATUS } from '../helpers/fake-wda.js';
import { IOS_ROLE_MAP, type RawIosElement } from '../../src/adapters/ios-node.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { UiNode } from '../../src/adapters/types.js';

/**
 * One element in the vocabulary both backends share, spelled the two ways
 * the backends spell it: an idb describe-all element and a WDA /source node.
 * Every case below runs through BOTH parsers and expects the same UiNode.
 * Until 2026-10-02 each parser carried its own copy of the normalization and
 * each test file pinned its own copy — nothing pinned that they agreed.
 */
const asIdb = (r: RawIosElement) => ({
  type: r.type, AXLabel: r.label, AXUniqueId: r.identifier, AXValue: r.value, frame: r.rect,
});
const asWda = (r: RawIosElement) => ({
  type: r.type, rawIdentifier: r.identifier, label: r.label, value: r.value, rect: r.rect,
  isVisible: '1', isEnabled: '1', children: [],
});
// JSON.stringify drops undefined fields, which is exactly how idb omits them.
const viaIdb = (r: RawIosElement): UiNode => parseIdbDescribeAll(JSON.stringify([asIdb(r)])).children[0];
// Under a typed root: a WDA ROOT must carry a string `type` (that is how the
// parser tells a node from the envelope — a structural rule, not
// normalization), while any node below it is normalized like idb's.
const viaWda = (r: RawIosElement): UiNode => parseWdaSourceValue({ type: 'Window', children: [asWda(r)] }).children[0];

const CASES: { name: string; raw: RawIosElement; expected: Omit<UiNode, 'children'> }[] = [
  {
    name: 'every field set, fractional frame → rounded integer points',
    raw: {
      type: 'Button', label: 'Log in', identifier: 'login_button', value: 'v',
      rect: { x: 20.5, y: 699.6, width: 350.4, height: 48 },
    },
    expected: { role: 'button', label: 'Log in', identifier: 'login_button', value: 'v', rect: { x: 21, y: 700, width: 350, height: 48 } },
  },
  {
    name: 'empty strings are null',
    raw: { type: 'StaticText', label: '', identifier: '', value: '', rect: { x: 0, y: 0, width: 1, height: 1 } },
    expected: { role: 'text', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 1, height: 1 } },
  },
  {
    name: 'nulls are null',
    raw: { type: 'TextField', label: null, identifier: null, value: null, rect: { x: 1, y: 2, width: 3, height: 4 } },
    expected: { role: 'textfield', label: null, identifier: null, value: null, rect: { x: 1, y: 2, width: 3, height: 4 } },
  },
  {
    name: 'absent fields are null and a missing rect is the zero rect',
    raw: { type: 'Image' },
    expected: { role: 'image', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 } },
  },
  {
    name: 'an unknown type is `other`, with its fields kept',
    raw: { type: 'SomeFutureType', label: 'x', identifier: 'y', rect: { x: 0, y: 0, width: 2, height: 2 } },
    expected: { role: 'other', label: 'x', identifier: 'y', value: null, rect: { x: 0, y: 0, width: 2, height: 2 } },
  },
  {
    name: 'no type at all is `other`',
    raw: { label: 'untyped' },
    expected: { role: 'other', label: 'untyped', identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 } },
  },
  {
    // The role map is a plain object: `constructor`, `toString`, ... are
    // answered by its prototype, and before 2026-10-02 both copies returned
    // the FUNCTION as the role (an own-key lookup is the fix, in the one owner).
    name: 'a type that is a prototype key of the role map is `other`, not a function',
    raw: { type: 'constructor', label: 'ctor' },
    expected: { role: 'other', label: 'ctor', identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 } },
  },
  {
    name: 'negative and .5 coordinates round like the rest (half up, towards +∞)',
    raw: { type: 'Other', rect: { x: -2.4, y: 1.5, width: 2.5, height: -1.6 } },
    expected: { role: 'container', label: null, identifier: null, value: null, rect: { x: -2, y: 2, width: 3, height: -2 } },
  },
];

describe('iOS node normalization — one owner, pinned through BOTH tree sources', () => {
  for (const { name, raw, expected } of CASES) {
    it(`idb: ${name}`, () => {
      expect(viaIdb(raw)).toEqual({ ...expected, children: [] });
    });
    it(`wda: ${name}`, () => {
      expect(viaWda(raw)).toEqual({ ...expected, children: [] });
    });
  }

  it('every type in the shared role map lands on the same role through both sources', () => {
    for (const [type, role] of Object.entries(IOS_ROLE_MAP)) {
      expect(viaIdb({ type }).role, type).toBe(role);
      expect(viaWda({ type }).role, type).toBe(role);
    }
  });

  it('each node gets its own rect object — nodes are mutated downstream and must not share one', () => {
    const tree = parseIdbDescribeAll(JSON.stringify([{ type: 'Button' }, { type: 'Button' }]));
    expect(tree.children[0].rect).not.toBe(tree.children[1].rect);
    const nested = parseWdaSourceValue({ type: 'Other', children: [{ type: 'Other' }] });
    expect(nested.rect).not.toBe(nested.children[0].rect);
  });
});

const IDB_DESCRIBE_ALL = JSON.stringify([
  {
    type: 'Button', AXLabel: 'Log in', AXUniqueId: 'login_button', AXValue: '',
    frame: { x: 20.5, y: 700, width: 350, height: 48 },
  },
  {
    type: 'TextField', AXLabel: 'Username', AXUniqueId: 'username_field', AXValue: 'alice',
    frame: { x: 20, y: 400, width: 350, height: 44 },
  },
  { type: 'StaticText', AXLabel: 'Welcome back', AXUniqueId: null, AXValue: null },
]);

describe('parseIdbDescribeAll — the flat list and what only it needs', () => {
  const tree = parseIdbDescribeAll(IDB_DESCRIBE_ALL);

  it('wraps the flat element list under a synthetic 0x0 container root', () => {
    expect(tree).toMatchObject({
      role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(tree.children).toHaveLength(3);
    expect(tree.children.every((c) => c.children.length === 0)).toBe(true); // flat stays flat
  });

  it('normalizes roles, identifiers, values and rounds frames', () => {
    expect(tree.children[0]).toMatchObject({
      role: 'button', label: 'Log in', identifier: 'login_button', value: null,
      rect: { x: 21, y: 700, width: 350, height: 48 },
    });
    expect(tree.children[1]).toMatchObject({ role: 'textfield', value: 'alice' });
    expect(tree.children[2]).toMatchObject({
      role: 'text', identifier: null, rect: { x: 0, y: 0, width: 0, height: 0 },
    });
  });

  it('pairs a same-identifier text BELOW a textfield as its error; the title above is not an error', () => {
    // Measured convention (payment form, 2026-08-05): the field's title AND
    // its validation message share the field's accessibilityIdentifier.
    const withError = parseIdbDescribeAll(
      JSON.stringify([
        {
          type: 'StaticText', AXLabel: 'Amount', AXUniqueId: 'payment.form.amount_input', AXValue: null,
          frame: { x: 20, y: 380, width: 100, height: 18 },
        },
        {
          type: 'TextField', AXLabel: 'Amount', AXUniqueId: 'payment.form.amount_input', AXValue: '',
          frame: { x: 20, y: 400, width: 350, height: 44 },
        },
        {
          type: 'StaticText', AXLabel: 'Value is too small', AXUniqueId: 'payment.form.amount_input', AXValue: null,
          frame: { x: 20, y: 448, width: 200, height: 16 },
        },
        {
          type: 'TextField', AXLabel: 'Note', AXUniqueId: 'note_input', AXValue: null,
          frame: { x: 20, y: 500, width: 350, height: 44 },
        },
      ]),
    );
    const amount = withError.children.find((n) => n.role === 'textfield' && n.identifier === 'payment.form.amount_input');
    expect(amount?.error).toBe('Value is too small');
    const note = withError.children.find((n) => n.identifier === 'note_input');
    expect(note?.error).toBeUndefined();
  });

  it('leaves error unset when no same-identifier text sits below the field', () => {
    expect(tree.children[1].error).toBeUndefined();
  });

  it('a payload that is not an array is a loud error, not an empty screen', () => {
    expect(() => parseIdbDescribeAll('{"elements":[]}')).toThrow(/did not return an array/);
  });
});

function fakeExec(responses: Record<string, string>) {
  const calls: { full: string; timeoutMs?: number }[] = [];
  const fn: ExecFn = async (cmd, args, opts): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push({ full, timeoutMs: opts?.timeoutMs });
    for (const [prefix, out] of Object.entries(responses)) {
      if (full.startsWith(prefix)) return { stdout: Buffer.from(out), stderr: '' };
    }
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
}

describe('IdbTreeSource — the idb adapter at the seam', () => {
  it('read runs describe-all for the bound UDID (never the `booted` alias) under a 15 s budget, after the Xcode probe', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const tree = await new IdbTreeSource({ udid: 'AAAA-1111', exec: fn }).read();
    expect(calls[0]?.full).toBe('xcrun --find simctl'); // xcode-env.ts, so DEVELOPER_DIR is injected where xcode-select is broken
    expect(calls.at(-1)).toEqual({ full: 'idb ui describe-all --json --udid AAAA-1111', timeoutMs: 15_000 });
    expect(tree.children[0]).toMatchObject({ role: 'button', identifier: 'login_button' });
  });

  it('every read is a fresh graph — a node mutated after one read is not seen by the next', async () => {
    const { fn } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const source = new IdbTreeSource({ udid: 'AAAA-1111', exec: fn });
    const first = await source.read();
    first.children[0].label = 'mutated';
    expect((await source.read()).children[0].label).toBe('Log in');
  });

  it('dispose has nothing to release: resolves, runs nothing, and a read still works afterwards', async () => {
    const { fn, calls } = fakeExec({ 'idb ui describe-all': IDB_DESCRIBE_ALL });
    const source = new IdbTreeSource({ udid: 'AAAA-1111', exec: fn });
    await source.dispose();
    await source.dispose();
    expect(calls).toEqual([]);
    expect((await source.read()).children).toHaveLength(3);
  });
});

// docs/bugs/2026-10-06-ios-idb-empty-tree-persists-on-pin-screen.md: idb
// returned a lone 0×0 Application for minutes on a RENDERED screen. Read as
// a tree, nothing matched it, so `absent` passed and the ensure_state ladder
// escalated into its clearState rung. It is a read error now; the signature
// is NARROW — no element with any area — so idb's normal launch transient, a
// lone FULL-FRAME Application, stays a tree.
describe('IdbTreeSource — an empty tree is a read error, not a screen on which nothing matches', () => {
  const ZERO = { x: 0, y: 0, width: 0, height: 0 };
  const read = (payload: unknown[]) =>
    new IdbTreeSource({ udid: 'AAAA-1111', exec: fakeExec({ 'idb ui describe-all': JSON.stringify(payload) }).fn }).read();

  it('`[]` throws IdbEmptyTreeError naming the empty list', async () => {
    const error = await read([]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IdbEmptyTreeError);
    expect((error as Error).message).toMatch(/^idb returned an empty accessibility tree \(an empty list\)/);
  });

  it('the measured payload — a LABELLED Application at {{0, 0}, {0, 0}} — throws, and the message names the cause, the check, the trigger and the ways out', async () => {
    const error = await read([{ type: 'Application', AXLabel: 'dbosbanking', AXFrame: '{{0, 0}, {0, 0}}', frame: ZERO }]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IdbEmptyTreeError);
    // The cause alone on the first line (what a trace quotes), the advice beneath it:
    // the trigger (an earlier WDA session — docs/bugs/2026-10-07-one-wda-session-
    // makes-idb-stick-until-reboot.md), then the ways out in order of cost: terminate-then-launch
    // (a launch_app on the running app keeps the stuck pid — docs/bugs/2026-10-07-idb-empty-tree-
    // advice-relaunch-does-not-restart.md), a reboot, the WDA source.
    expect((error as Error).message).toBe(
      'idb returned an empty accessibility tree (only a 0×0 Application)\n' +
        'The app may still be rendered: idb can stay stuck like this for minutes on a rendered screen. ' +
        'Compare with screenshot; if the screen is rendered, the tree source is stuck, not the app. ' +
        'The measured trigger is an earlier WebDriverAgent session on this simulator (e.g. treeSource: wda; ' +
        'likely any XCTest-based driver): every app launched after it starts with an empty idb tree. ' +
        'averi re-enables accessibility automation before each launch, but only a NEW app process picks it up: ' +
        'terminate the app and launch it again through averi (terminate_app, then launch_app) — a launch_app on the ' +
        'running app keeps the same stuck process; if that does not clear it, ' +
        'reboot the simulator (`xcrun simctl shutdown AAAA-1111 && xcrun simctl boot AAAA-1111`); ' +
        'app.ios.treeSource: wda in averi.yaml reads the tree through WebDriverAgent instead',
    );
  });

  // 2026-10-08 (round-3 device check, finding 5): a healthy idb can return
  // this shape 0.4 s after a launch. The adapter's `settle` re-read
  // (IosAdapter.uiTree) throws the error again with `reread`, and only that
  // form says so; the source's own, unretried form — what every poller
  // quotes — carries no re-read clause and no launch sentence.
  it('the source\'s error is the unretried form: no re-read clause, no "read again" advice', async () => {
    const error = (await read([{ type: 'Application', frame: ZERO }]).catch((e: unknown) => e)) as IdbEmptyTreeError;
    expect(error.reread).toBeUndefined();
    expect(error.message).not.toMatch(/retried|read again|one more read|launch_app returned/);
  });

  it('with `reread`, the first line is verbatim and the advice opens with the re-read, then the unretried advice whole', () => {
    const plain = new IdbEmptyTreeError('AAAA-1111', ['Application']).message;
    const retried = new IdbEmptyTreeError('AAAA-1111', ['Application'], { reread: 1_000 }).message;
    const [head, ...advice] = plain.split('\n');
    expect(retried).toBe(
      `${head}\n` +
        'The read was retried once after 1 s and was still empty; a healthy idb had a tree with area ' +
        'by +1 s on 10 of 10 measured launches, so the rest of this applies (a first render slower than that on ' +
        'a loaded host is unmeasured: if launch_app returned under about two seconds ago, one more read settles it). ' +
        advice.join('\n'),
    );
  });

  // 2026-10-08 (iOS adapter stack review, candidate 2): the reboot names the
  // simulator the source is BOUND to — not `<udid>`, not simctl's `booted` —
  // and nothing in the advice points at the server's stderr, which the agent
  // reading the tool result cannot see.
  it('the reboot advice names the bound simulator, through the one owner, and never says stderr, <udid> or booted', async () => {
    const error = await new IdbTreeSource({ udid: 'BBBB-2222', exec: fakeExec({ 'idb ui describe-all': '[]' }).fn })
      .read()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IdbEmptyTreeError);
    const message = (error as Error).message;
    expect(message).toContain(`if that does not clear it, ${rebootSimulatorAdvice('BBBB-2222')}; `);
    expect(message).toContain('`xcrun simctl shutdown BBBB-2222 && xcrun simctl boot BBBB-2222`');
    expect(message).not.toMatch(/stderr/i);
    expect(message).not.toContain('<udid>');
    expect(message).not.toMatch(/\bbooted\b/);
  });

  it('several elements, every one zero-area (or degenerate), still throws — area, not count, is the signature; and only an Application is called one', async () => {
    const lone = await read([{ type: 'Other', frame: ZERO }]).catch((e: unknown) => e);
    expect((lone as Error).message).toMatch(/^idb returned an empty accessibility tree \(1 element, none with any area\)\n/);
    await expect(
      read([
        { type: 'Application', frame: ZERO },
        { type: 'StaticText', AXLabel: 'ghost', frame: { x: 10, y: 10, width: 0, height: 20 } },
        { type: 'Button', AXLabel: 'flat', frame: { x: 10, y: 10, width: 20, height: -1 } },
      ]),
    ).rejects.toThrow(/^idb returned an empty accessibility tree \(3 elements, none with any area\)\n/);
  });

  it('a lone FULL-FRAME Application passes — idb\'s normal launch transient is a tree, not an error', async () => {
    const tree = await read([{ type: 'Application', AXLabel: 'MyPort', frame: { x: 0, y: 0, width: 402, height: 874 } }]);
    expect(tree.children).toEqual([expect.objectContaining({ label: 'MyPort', rect: { x: 0, y: 0, width: 402, height: 874 } })]);
  });

  it('a 1×1 element is enough area to be a tree — the threshold is "any", not "screen-sized"', async () => {
    const tree = await read([{ type: 'Application', frame: ZERO }, { type: 'Other', frame: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(tree.children).toHaveLength(2);
  });

  it('a normal tree passes, its zero-area elements included', async () => {
    const tree = await read(JSON.parse(IDB_DESCRIBE_ALL) as unknown[]);
    expect(tree.children).toHaveLength(3);
    expect(tree.children[2]).toMatchObject({ role: 'text', rect: ZERO });
  });

  it('the parser itself stays pure: parseIdbDescribeAll still parses the stuck payload — only a READ refuses it', () => {
    expect(parseIdbDescribeAll(JSON.stringify([{ type: 'Application', frame: ZERO }])).children).toHaveLength(1);
  });
});

describe('createIosTreeSource — which backend a kind gets, pinned by what the source DOES', () => {
  // Both fakes are handed to BOTH kinds: a kind wired to the wrong backend
  // shows up as the wrong fake being driven, not as a class name.
  async function fakes(describeAll: string) {
    const { dd } = await tempDerivedData(true);
    const spawner = fakeSpawn();
    const fetcher = fakeFetch((url) => {
      if (url.endsWith('/status')) return spawner.spawns.length === 0 ? 'refused' : { status: 200, body: WDA_STATUS };
      return { status: 200, body: { value: { type: 'Application', label: 'FromWDA', children: [] } } };
    });
    const exec = fakeExec({ 'idb ui describe-all': describeAll });
    return {
      spawner, fetcher, exec,
      deps: { exec: exec.fn, fetchFn: fetcher.fn, spawnFn: spawner.fn, derivedDataPath: dd, pollIntervalMs: 5 },
    };
  }

  it("'idb': a read is one describe-all carrying `--udid <the given id>`; no WebDriverAgent is spawned or asked", async () => {
    const { spawner, fetcher, exec, deps } = await fakes(IDB_DESCRIBE_ALL);
    const tree = await createIosTreeSource('idb', 'AAAA-1111', deps).read();
    expect(exec.calls.at(-1)?.full).toBe('idb ui describe-all --json --udid AAAA-1111');
    expect(tree.children[0]).toMatchObject({ identifier: 'login_button' });
    expect(spawner.spawns).toEqual([]);
    expect(fetcher.urls).toEqual([]);
  });

  it("'wda': a read brings a WebDriverAgent up for the given id and parses /source; idb is never asked for a tree", async () => {
    const { spawner, fetcher, exec, deps } = await fakes(IDB_DESCRIBE_ALL);
    const tree = await createIosTreeSource('wda', 'BBBB-2222', deps).read();
    expect(spawner.spawns).toHaveLength(1);
    expect(spawner.spawns[0].args).toContain('id=BBBB-2222');
    expect(fetcher.urls.at(-1)).toMatch(/\/source\?format=json$/);
    expect(tree).toMatchObject({ role: 'container', label: 'FromWDA' });
    expect(exec.calls.filter((c) => c.full.startsWith('idb'))).toEqual([]);
  });
});
