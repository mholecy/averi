import { readFile } from 'node:fs/promises';
import { IosAdapter } from '../../src/adapters/ios.js';
import { IdbTreeSource, type ApplicationLabel, type IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import type { ExecFn, ExecResult } from '../../src/adapters/exec.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { alertInWda } from '../../src/adapters/ios-system-alert.js';
import type { UiNode } from '../../src/adapters/types.js';
import { appinfo } from './simctl-appinfo.js';

/**
 * The lab app (dev.averi.lab, scheme `averilab`) on an IosAdapter with a fake exec — the D49a/D54/D56 foreground-wait
 * fakes, shared by tests/adapters/ios-deep-link.test.ts and the end-to-end reply and flow tests built on them
 * (tests/mcp/ios-alert-replies.test.ts, tests/flow/launch-alert.test.ts). A caller mocks src/util/sleep.js with the
 * sleep recorder and fakes Date, so the wait's deadline plays out in virtual time.
 */

export const LAB = 'dev.averi.lab';
export const LAB_PATH = '/Sim/Containers/Bundle/Application/5E1F/AveriLab.app';
export const LAB_INFO = appinfo('AveriLab', 'AveriLab', { path: LAB_PATH, executable: 'AveriLab' });
/** `plutil -extract CFBundleURLTypes json` of the lab app, as measured. */
export const LAB_TYPES = '[{"CFBundleURLName":"dev.averi.lab","CFBundleURLSchemes":["averilab"]}]';
export const PLUTIL = `plutil -extract CFBundleURLTypes json -o - ${LAB_PATH}/Info.plist`;
export const WRITES = [
  'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility AutomationEnabled -bool true',
  'xcrun simctl spawn AAAA-1111 defaults write com.apple.Accessibility ApplicationAccessibilityEnabled -bool true',
];
export const openurl = (url: string) => `xcrun simctl openurl AAAA-1111 ${url}`;
/** D58: the lab scheme's pre-approval for simctl's opener, the answer an Open tap on "Open in “AveriLab”?" records. */
export const APPROVAL =
  'xcrun simctl spawn AAAA-1111 defaults write com.apple.launchservices.schemeapproval com.apple.CoreSimulator.CoreSimulatorBridge-->averilab -string dev.averi.lab';

export const bundle = (bundleId: string): ApplicationLabel => ({ kind: 'bundle', bundleId });
export const label = (text: string): ApplicationLabel => ({ kind: 'label', label: text });
export const SPRINGBOARD = bundle('com.apple.springboard');

/**
 * An IosAdapter over a source whose applicationLabel answers in turn from `answers` (the last repeats) — the
 * `kind` given — and an exec answering `simctl appinfo` with `info`, plutil with `types` and the scheme pre-approval's
 * `defaults write` (D58) with `approval` (an Error rejects each); `hook`, when given, runs first on every one.
 * Every exec command line but xcode-env's one-time `xcrun --find simctl` is recorded.
 */
export function lab(
  answers: Array<ApplicationLabel | Error>,
  opts: {
    kind?: IosTreeSourceKind;
    info?: string | Error | (() => string | Error);
    types?: string | Error;
    tree?: UiNode | Error;
    approval?: Error;
    /** Runs first on every recorded command line: it may wait, or throw to reject the command. */
    hook?: (full: string) => Promise<void>;
  } = {},
) {
  const calls: string[] = [];
  let asked = 0;
  let reads = 0;
  const source: IosTreeSource = {
    kind: opts.kind ?? 'wda',
    read: () => Promise.reject(new Error('unused')),
    // WdaTreeSource.systemAlert's part (D54: one short /source at the bound): `tree` is what it reads, unset not expected.
    systemAlert: async () => {
      reads++;
      const tree = opts.tree ?? new Error('unused');
      if (tree instanceof Error) throw tree;
      return alertInWda(structuredClone(tree));
    },
    applicationLabel: async () => {
      const a = answers[Math.min(asked++, answers.length - 1)];
      if (a instanceof Error) throw a;
      return a;
    },
    dispose: () => Promise.resolve(),
  };
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    if (full !== 'xcrun --find simctl') await opts.hook?.(full);
    const answer = (out: string | Error) => {
      if (out instanceof Error) throw out;
      return { stdout: Buffer.from(out), stderr: '' };
    };
    if (full.startsWith('xcrun simctl appinfo')) return answer(typeof opts.info === 'function' ? opts.info() : (opts.info ?? LAB_INFO));
    if (full.startsWith('plutil ')) return answer(opts.types ?? LAB_TYPES);
    if (full.includes('com.apple.launchservices.schemeapproval')) return answer(opts.approval ?? '');
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { adapter: new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: source }), calls, asks: () => asked, reads: () => reads };
}

/**
 * iOS's "Open in “AveriLab”?" as batch-5 D49A captured it (E2): idb lists the alert alone under SpringBoard; WDA's
 * /source holds the Alert.
 */
const fixture = async (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
export const IDB_ALERT = JSON.stringify((JSON.parse(await fixture('idb-springboard-open-in-alert.json')) as { elements: unknown[] }).elements);
export const WDA_ALERT = parseWdaSourceValue(JSON.parse(await fixture('wda-capture-springboard-open-in-alert.json')));
/** The lab app in front, as idb lists it (batch-5 case-rs-idb-E6, its four targets cut to one). */
export const IDB_LAB = JSON.stringify([
  { type: 'Application', AXLabel: 'AveriLab', frame: { x: 0, y: 0, width: 402, height: 874 } },
  { type: 'Button', AXLabel: 'Target A', AXUniqueId: 'lab.open.A', frame: { x: 51, y: 110, width: 300, height: 64 } },
]);
export const DESCRIBE_ALL = 'idb ui describe-all --json --udid AAAA-1111';

/** An IosAdapter on the REAL idb source, its describe-all answering from `reads` in turn (the last repeats). */
export function idbLab(reads: string[], info = LAB_INFO) {
  const calls: string[] = [];
  let read = 0;
  const exec: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    if (full !== 'xcrun --find simctl') calls.push(full);
    const out = (s: string) => ({ stdout: Buffer.from(s), stderr: '' });
    if (full === DESCRIBE_ALL) return out(reads[Math.min(read++, reads.length - 1)]);
    if (full.startsWith('xcrun simctl appinfo')) return out(info);
    if (full.startsWith('plutil ')) return out(LAB_TYPES);
    return out('');
  };
  const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: new IdbTreeSource({ udid: 'AAAA-1111', exec }) });
  return { adapter, calls, describeAlls: () => calls.filter((c) => c === DESCRIBE_ALL).length };
}

/** The launch's ⚠ note over IDB_ALERT or WDA_ALERT (D56), byte for byte. */
export const LAUNCH_ALERT_NOTE =
  'iOS has not brought dev.averi.lab forward yet: a system alert is up, "Open in “AveriLab”?" — buttons "Cancel" at ' +
  '(127, 474), "Open" at (275, 474). Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y ' +
  '(averi taps nothing itself); every launch stays behind the alert until it is answered — then read again before ' +
  'trusting a read';
