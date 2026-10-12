import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { isBareTree, treeShape } from '../../src/ui-tree/bare-tree.js';
import { absenceVerdict, presenceVerdict } from '../../src/ui-tree/verdict.js';
import { node } from '../helpers/fake.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * The bare-tree rule against what the three sources REALLY return, run
 * through the real parsers (docs/bugs/2026-10-06-ui-snapshot-empty-right-
 * after-launch.md and its addendum). Every wrapper is named by its
 * framework, and a loaded screen can consist of labelled container/other
 * nodes only — both review rounds of 2026-10-06 are pinned here.
 */

const FULL = { x: 0, y: 0, width: 402, height: 874 };
const ZERO = { x: 0, y: 0, width: 0, height: 0 };

const idb = (...els: Record<string, unknown>[]) =>
  parseIdbDescribeAll(JSON.stringify([{ type: 'Application', AXLabel: 'MyPort', AXUniqueId: null, AXValue: null, frame: FULL }, ...els]));
const ax = (type: string, label: string | null, frame: { x: number; y: number; width: number; height: number }, id: string | null = null) => ({
  type, AXLabel: label, AXUniqueId: id, AXValue: null, frame,
});
const wda = (...children: Record<string, unknown>[]) =>
  parseWdaSourceValue({ value: { type: 'Application', label: 'MyPort', rect: FULL, children: [{ type: 'Window', rect: FULL, children }] } });
const wdaMyPort = () => parseWdaSource(readFileSync(new URL('../fixtures/wda-source-rn-myport.json', import.meta.url), 'utf8'));
const androidXml = (inner: string) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="md.bank.app" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="" class="android.widget.LinearLayout" package="md.bank.app" content-desc="" bounds="[0,0][1080,2400]">
      <node index="0" text="" resource-id="android:id/content" class="android.widget.FrameLayout" package="md.bank.app" content-desc="" bounds="[0,0][1080,2400]">${inner}</node>
    </node>
    <node index="1" text="" resource-id="android:id/statusBarBackground" class="android.view.View" package="md.bank.app" content-desc="" bounds="[0,0][1080,128]"/>
    <node index="2" text="" resource-id="android:id/navigationBarBackground" class="android.view.View" package="md.bank.app" content-desc="" bounds="[0,2274][1080,2400]"/>
  </node>
</hierarchy>`;

describe('isBareTree: the empty / unrendered trees each source emits ARE bare', () => {
  it('idb, measured 2026-10-06 17:02–17:07: ONLY an Application at AXFrame {{0, 0}, {0, 0}} for 4+ minutes on the rendered PIN screen — a 0×0 root with one empty other child', () => {
    const measured = parseIdbDescribeAll(JSON.stringify([{ type: 'Application', AXFrame: '{{0, 0}, {0, 0}}', frame: ZERO }]));
    expect(measured.rect).toEqual(ZERO);
    expect(measured.children).toEqual([expect.objectContaining({ role: 'other', label: null, rect: ZERO, children: [] })]);
    expect(isBareTree(measured)).toBe(true);
    // The same with the app's name on it — the label of a 0×0 Application is not content.
    const labelled = parseIdbDescribeAll(JSON.stringify([{ type: 'Application', AXLabel: 'dbosbanking', AXFrame: '{{0, 0}, {0, 0}}', frame: ZERO }]));
    expect(isBareTree(labelled)).toBe(true);
  });

  it('idb, launching: the flat list holds only the labelled, full-screen Application element', () => {
    expect(isBareTree(idb())).toBe(true);
  });

  it('WDA, launching: Application "MyPort" → Window → empty Other + unlabeled Image, despite the labelled root', () => {
    expect(isBareTree(wda({ type: 'Other', rect: FULL, children: [] }, { type: 'Image', rect: { x: 151, y: 387, width: 100, height: 100 }, children: [] }))).toBe(true);
  });

  it('Android, launching: the decor chain with android:id/content and the bar backgrounds (ids stripped to "content" etc.)', () => {
    expect(isBareTree(parseDump(androidXml('')))).toBe(true);
  });

  it('a lone spinner or splash image is a loading screen', () => {
    expect(isBareTree(wda({ type: 'ProgressIndicator', rect: { x: 181, y: 417, width: 40, height: 40 }, children: [] }))).toBe(true);
    expect(isBareTree(idb(ax('Image', null, { x: 151, y: 200, width: 100, height: 100 })))).toBe(true);
  });

  it('WDA, measured 2026-10-06 (finportal RN splash, 7 nodes: Application "MyPort" → Window → containers → an IDENTIFIED, unlabeled Image "SplashScreenLogo"): bare', () => {
    const splash = parseWdaSourceValue({
      value: {
        type: 'Application',
        label: 'MyPort',
        rawIdentifier: null,
        rect: FULL,
        children: [
          {
            type: 'Window',
            rect: FULL,
            children: [
              {
                type: 'Other',
                rect: FULL,
                children: [
                  {
                    type: 'Other',
                    rect: FULL,
                    children: [
                      {
                        type: 'Other',
                        rect: FULL,
                        children: [{ type: 'Image', label: null, rawIdentifier: 'SplashScreenLogo', rect: { x: 101, y: 337, width: 200, height: 200 }, children: [] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect([...everyNode(splash)].map((n) => n.role).sort()).toEqual(['container', 'container', 'container', 'container', 'container', 'image']);
    expect([...everyNode(splash)].find((n) => n.role === 'image')).toMatchObject({ label: null, identifier: 'SplashScreenLogo' });
    expect(isBareTree(splash)).toBe(true);
  });
});

describe('isBareTree: loaded screens are NOT bare', () => {
  it('the real RN fixture (tests/fixtures/wda-source-rn-myport.json)', () => {
    expect(isBareTree(wdaMyPort())).toBe(false);
  });
  it('idb: Application + Button + StaticText', () => {
    expect(isBareTree(idb(ax('Button', 'Log in', { x: 20, y: 500, width: 362, height: 44 }, 'login_button'), ax('StaticText', 'Welcome back', { x: 20, y: 100, width: 200, height: 20 })))).toBe(false);
  });
  it('Android: the decor chain with one TextView', () => {
    expect(isBareTree(parseDump(androidXml(
      '<node index="0" text="Enter your PIN" resource-id="" class="android.widget.TextView" package="md.bank.app" content-desc="" bounds="[100,400][980,480]"/>',
    )))).toBe(false);
  });

  // Review round 2 (2026-10-06): screens whose content is labelled
  // container/other nodes only — a roles-only rule called all eight bare.
  it('idb UIKit: Heading + Cell rows + Link (Cell → container; Heading, Link → other)', () => {
    expect(isBareTree(idb(
      ax('Heading', 'Accounts', { x: 16, y: 60, width: 200, height: 30 }),
      ax('Cell', 'Current account, 1 200 EUR', { x: 0, y: 120, width: 402, height: 64 }),
      ax('Cell', 'Savings, 350 EUR', { x: 0, y: 184, width: 402, height: 64 }),
      ax('Link', 'Terms', { x: 16, y: 800, width: 60, height: 20 }),
    ))).toBe(false);
  });
  it('idb RN welcome: unlabeled logo + role-less Pressables surfacing as Other with the merged label', () => {
    expect(isBareTree(idb(
      ax('Image', null, { x: 151, y: 200, width: 100, height: 100 }),
      ax('Other', 'Log in', { x: 20, y: 600, width: 362, height: 48 }),
      ax('Other', 'Register', { x: 20, y: 660, width: 362, height: 48 }),
    ))).toBe(false);
  });
  it('idb Group with a merged label', () => {
    expect(isBareTree(idb(ax('Group', 'Balance, 1 200 EUR', { x: 16, y: 100, width: 370, height: 80 })))).toBe(false);
  });
  it('idb SwiftUI .combine card (Other) + Heading', () => {
    expect(isBareTree(idb(
      ax('Other', 'Select transaction type, 1 of 13 selected', { x: 16, y: 300, width: 370, height: 120 }),
      ax('Heading', 'Payments', { x: 16, y: 60, width: 200, height: 30 }),
    ))).toBe(false);
  });
  it('WDA RN: an Other with a label AND a testID', () => {
    expect(isBareTree(wda({ type: 'Other', label: 'Log in', rawIdentifier: 'welcome.login', rect: { x: 20, y: 600, width: 362, height: 48 }, children: [] }))).toBe(false);
  });
  it('WDA Cell / Link / Tab with labels', () => {
    expect(isBareTree(wda(
      { type: 'Cell', label: 'Current account', rect: { x: 0, y: 120, width: 402, height: 64 }, children: [] },
      { type: 'Link', label: 'Terms', rect: { x: 16, y: 800, width: 60, height: 20 }, children: [] },
      { type: 'Tab', label: 'Home', rect: { x: 0, y: 820, width: 134, height: 54 }, children: [] },
    ))).toBe(false);
  });
  it('Android Flutter: android.view.View with a content-desc', () => {
    expect(isBareTree(parseDump(androidXml(
      '<node index="0" text="" resource-id="" class="android.view.View" package="md.bank.app" content-desc="Log in" bounds="[60,1600][1020,1740]"/>',
    )))).toBe(false);
  });
  it('Android Compose: a merged clickable View carrying text', () => {
    expect(isBareTree(parseDump(androidXml(
      '<node index="0" text="Log in" resource-id="" class="android.view.View" package="md.bank.app" content-desc="" bounds="[60,1600][1020,1740]"/>',
    )))).toBe(false);
  });
});

describe('isBareTree: what counts as content', () => {
  const under = (...leaves: Partial<UiNode>[]) =>
    node({ role: 'container', label: 'MyPort', rect: FULL, children: [node({ role: 'container', rect: FULL, children: leaves.map(node) })] });

  it('any readable or interactive role, even unlabeled; an image or progress indicator only when LABELLED — an identifier alone is the splash shape', () => {
    expect(isBareTree(under({ role: 'text', label: 'Enter your PIN' }))).toBe(false);
    expect(isBareTree(under({ role: 'textfield' }))).toBe(false); // an empty, unlabeled field is still something to act on
    expect(isBareTree(under({ role: 'scrollable' }))).toBe(false); // a scroll view is the app's own rendering
    expect(isBareTree(under({ role: 'image', label: 'Bank logo' }))).toBe(false);
    expect(isBareTree(under({ role: 'image', identifier: 'SplashScreenLogo' }))).toBe(true); // expo-splash-screen; Android 12+ system splash icon likewise
    expect(isBareTree(under({ role: 'image' }))).toBe(true);
    expect(isBareTree(under({ role: 'progress' }))).toBe(true);
    expect(isBareTree(under({ role: 'progress', label: 'In progress' }))).toBe(false);
  });

  it('a container/other counts with a label or value — not an identifier alone (the Android decor shape) — and only when not a wrapper by size', () => {
    expect(isBareTree(under({ role: 'container', identifier: 'home_root' }))).toBe(true);
    expect(isBareTree(under({ role: 'other', identifier: 'statusBarBackground' }))).toBe(true);
    expect(isBareTree(under({ role: 'other', label: 'Log in' }))).toBe(false); // RN Pressable, UIKit Cell, Compose clickable
    expect(isBareTree(under({ role: 'other', value: 'x' }))).toBe(false);
    expect(isBareTree(under({ role: 'container', label: 'Current account, 1 200 EUR' }))).toBe(false);
    expect(isBareTree(under({ role: 'other', label: 'Welcome screen', rect: FULL }))).toBe(true); // 100 %: a wrapper, whatever it says
    expect(isBareTree(under({ role: 'other', label: 'Nearly full', rect: { x: 0, y: 60, width: 402, height: 814 } }))).toBe(true); // 93 %
    expect(isBareTree(under({ role: 'other', label: 'Content area', rect: { x: 0, y: 120, width: 402, height: 700 } }))).toBe(false); // 80 %
  });

  it('accepted cost: a labelled full-screen RN root alone is bare — one accessible root collapsing the screen cannot be checked from the tree anyway', () => {
    expect(isBareTree(wda({ type: 'Other', label: 'Welcome screen', rect: FULL, children: [] }))).toBe(true);
  });

  it('no geometry at all (every rect zero-area) is the measured idb empty tree: a labelled structural node is a wrapper there, not content', () => {
    expect(isBareTree(node({ role: 'container', rect: ZERO, children: [node({ role: 'other', label: 'dbosbanking', rect: ZERO })] }))).toBe(true);
    expect(isBareTree(node({ role: 'container', rect: ZERO, children: [node({ role: 'other', rect: ZERO })] }))).toBe(true);
    // Non-structural content still counts without geometry; and a zero-rect
    // labelled other beside a sized node is small, so it counts.
    expect(isBareTree(node({ role: 'container', rect: ZERO, children: [node({ role: 'text', label: 'Loading…', rect: ZERO })] }))).toBe(false);
    expect(isBareTree(node({ role: 'container', rect: FULL, children: [node({ role: 'other', label: 'Log in', rect: ZERO })] }))).toBe(false);
  });

  it('the root counts like any node, and a full-screen text/button still counts — only structural roles are judged by size', () => {
    expect(isBareTree(node({ role: 'button', label: 'OK', rect: FULL }))).toBe(false);
    expect(isBareTree(wda({ type: 'StaticText', label: 'Loading your accounts', rect: FULL, children: [] }))).toBe(false);
  });
});

/**
 * SpringBoard's launch tree (docs/bugs/2026-10-08-ios-launch-transition-tree-
 * reads-as-rendered.md): measured on an iPhone 17 simulator, iOS 27.0, idb,
 * in the first ~2 s after launch_app — the status bar and the app's icon
 * zooming in, beside a full-screen Application labelled ' '. Rebuilt from the
 * note's printed tree as idb's raw elements, through the real parser.
 */
const axv = (type: string, label: string | null, frame: { x: number; y: number; width: number; height: number }, id: string | null, value: string | null) => ({
  type, AXLabel: label, AXUniqueId: id, AXValue: value, frame,
});
// The note printed the normalized tree, so the status items' raw idb type is
// not recorded — only that it normalized to `other`, i.e. it is no key of
// IOS_ROLE_MAP (whose `Other` is `container`). 'StatusItem' stands in for it.
const STATUS_BAR = [
  axv('StaticText', '18:29', { x: 50, y: 22, width: 48, height: 22 }, null, null),
  axv('StatusItem', 'Cellular', { x: 285, y: 25, width: 20, height: 14 }, null, 'No signal'),
  axv('StatusItem', null, { x: 314, y: 26, width: 18, height: 13 }, '3 of 3 Wi-Fi bars', 'SSID, 3 of 3 Wi-Fi bars'),
  axv('StatusItem', '100 % battery power', { x: 341, y: 25, width: 29, height: 14 }, null, 'Not charging'),
];
const LAUNCH_ICON = axv('Button', 'Skeleton Internal', { x: -2, y: 234, width: 406, height: 406 }, 'Skeleton Internal', null);
const springBoard = (...els: Record<string, unknown>[]) =>
  parseIdbDescribeAll(JSON.stringify([axv('Application', ' ', FULL, null, null), ...STATUS_BAR, ...els]));
/** A loaded PIN screen in idb's shape (constructed, not measured): the prompt and the keypad. */
const PIN_SCREEN = [
  axv('StaticText', 'Enter your PIN to log in', { x: 40, y: 180, width: 322, height: 24 }, null, null),
  ...['1', '2', '3'].map((d, i) => axv('Button', d, { x: 40 + i * 110, y: 500, width: 100, height: 64 }, `pin_key_${d}`, null)),
];

describe('isBareTree: SpringBoard\'s launch tree on iOS 27 (measured 2026-10-08) is bare', () => {
  it('the 7-node read 0.3 s after launch_app — status bar + the zooming app icon — is bare, so presence and absence are both unknown', () => {
    const tree = springBoard(LAUNCH_ICON);
    expect(treeShape(tree)).toBe('7 nodes (roles: other ×4, button ×1, container ×1, text ×1)'); // the note's timeline line
    expect(isBareTree(tree)).toBe(true);
    const pin = (t: UiNode) => [...everyNode(t)].filter((n) => n.label === 'Enter your PIN to log in');
    expect(presenceVerdict(pin(tree), tree)).toBe('unknown');
    expect(absenceVerdict(pin(tree), { width: 402, height: 874 }, tree)).toBe('unknown'); // the absent assert / detect that PASSED
  });

  it('the 6-node reads at 1.5–2.1 s — the status bar alone — are bare', () => {
    const tree = springBoard();
    expect(treeShape(tree)).toBe('6 nodes (roles: other ×4, container ×1, text ×1)');
    expect(isBareTree(tree)).toBe(true);
  });

  it('the icon is the launch icon by being the one button beside a status bar — no frame is asked of it (an earlier zoom frame is unmeasured)', () => {
    expect(isBareTree(springBoard(axv('Button', 'Skeleton Internal', { x: 170, y: 400, width: 62, height: 62 }, null, null)))).toBe(true);
  });
});

describe('isBareTree: a status bar is not a reason to call a loaded screen bare', () => {
  it('a loaded screen with a status bar and content is not bare (should a source ever put the status bar in an app\'s tree)', () => {
    expect(isBareTree(springBoard(...PIN_SCREEN))).toBe(false);
    expect(isBareTree(springBoard(PIN_SCREEN[0]))).toBe(false); // one text below the band is content
    expect(isBareTree(springBoard(LAUNCH_ICON, PIN_SCREEN[0]))).toBe(false); // a button is a launch icon only when ALONE
    expect(isBareTree(springBoard(axv('Button', 'Log in', { x: 20, y: 600, width: 362, height: 48 }, null, null), axv('Button', 'Register', { x: 20, y: 660, width: 362, height: 48 }, null, null)))).toBe(false);
  });

  it('a loaded screen whose only content is ONE button: not bare without a status bar in its tree (the measured app trees have none); bare beside one — the accepted, safe cost', () => {
    const lone = axv('Button', 'Continue', { x: 20, y: 760, width: 362, height: 48 }, 'continue', null);
    expect(isBareTree(idb(lone))).toBe(false);
    expect(isBareTree(idb(LAUNCH_ICON))).toBe(false); // even the measured icon's shape: without a status bar it is an app's button
    expect(isBareTree(springBoard(lone))).toBe(true);
  });

  it('the band is skipped only when it holds a clock: content at the top of a screen with no clock still counts (test fakes, an edge-to-edge Android app)', () => {
    expect(isBareTree(idb(ax('StaticText', 'Accounts', { x: 16, y: 20, width: 200, height: 30 })))).toBe(false);
    expect(isBareTree(parseDump(androidXml(
      '<node index="0" text="Settings" resource-id="" class="android.widget.TextView" package="md.bank.app" content-desc="" bounds="[48,40][600,140]"/>',
    )))).toBe(false);
    // A time BELOW the band is the app's text, not a status bar.
    expect(isBareTree(idb(ax('StaticText', '18:29', { x: 40, y: 400, width: 100, height: 30 })))).toBe(false);
  });

  it('the Android decor is bare as before (it holds no clock, so neither clause applies)', () => {
    expect(isBareTree(parseDump(androidXml('')))).toBe(true);
  });

  it('a status-bar clock in other locales (inferred): the WHOLE label is a time — 6:29, Finnish 18.29, Arabic-Indic digits, "6:29 PM", "6:29 p.m.", 下午6:29; not a price, a date or a title', () => {
    const withClock = (clock: string) =>
      parseIdbDescribeAll(JSON.stringify([axv('Application', ' ', FULL, null, null), axv('StaticText', clock, { x: 50, y: 22, width: 48, height: 22 }, null, null), STATUS_BAR[3]]));
    for (const clock of ['18:29', '6:29', '18.29', '٦:٢٩', '6:29 PM', '6:29 p.m.', '下午6:29', '6:29 अपराह्न']) expect(isBareTree(withClock(clock)), clock).toBe(true);
    for (const text of ['Loading', '100 %', '1.200 EUR', 'Departs 10:30', 'Total €12.50', '$4.99', '08.10.2026', '18 h 29', '18:29x9', '18:290']) expect(isBareTree(withClock(text)), text).toBe(false);
  });
});

/**
 * Review of 2026-10-08 (M1): with a clock found anywhere in a label inside
 * the top 8 %, these loaded screens — none with a status bar — read bare.
 * Each must stay content.
 */
describe('isBareTree: app content shaped like a clock is not a status bar', () => {
  const IPAD = { x: 0, y: 0, width: 1024, height: 1366 };
  const wdaOn = (rect: typeof IPAD, ...children: Record<string, unknown>[]) =>
    parseWdaSourceValue({ value: { type: 'Application', label: 'Trips', rect, children: [{ type: 'Window', rect, children }] } });
  const LANDSCAPE = { x: 0, y: 0, width: 874, height: 402 };

  it('iPad WDA navigation bar "Departs 10:30" + Back + Share, and one "Check in" button', () => {
    expect(isBareTree(wdaOn(IPAD,
      { type: 'StaticText', label: 'Departs 10:30', rect: { x: 440, y: 36, width: 144, height: 22 }, children: [] },
      { type: 'Button', label: 'Back', rect: { x: 8, y: 30, width: 80, height: 40 }, children: [] },
      { type: 'Button', label: 'Share', rect: { x: 960, y: 30, width: 50, height: 40 }, children: [] },
      { type: 'Button', label: 'Check in', rect: { x: 20, y: 1200, width: 984, height: 56 }, children: [] },
    ))).toBe(false);
  });
  it('iPad navigation bar "Total €12.50" + Back, and an unlabeled image', () => {
    expect(isBareTree(wdaOn(IPAD,
      { type: 'StaticText', label: 'Total €12.50', rect: { x: 440, y: 36, width: 144, height: 22 }, children: [] },
      { type: 'Button', label: 'Back', rect: { x: 8, y: 30, width: 80, height: 40 }, children: [] },
      { type: 'Image', label: null, rect: { x: 312, y: 400, width: 400, height: 400 }, children: [] },
    ))).toBe(false);
  });
  it('iPhone landscape idb (no status bar): compact navigation bar "Meeting 10:30" + Back, and "Join"', () => {
    expect(isBareTree(parseIdbDescribeAll(JSON.stringify([
      axv('Application', 'Meet', LANDSCAPE, null, null),
      axv('StaticText', 'Meeting 10:30', { x: 337, y: 4, width: 200, height: 24 }, null, null),
      axv('Button', 'Back', { x: 8, y: 0, width: 60, height: 32 }, null, null),
      axv('Button', 'Join', { x: 700, y: 340, width: 150, height: 44 }, null, null),
    ])))).toBe(false);
  });
  it('an edge-to-edge camera: a recording timer "00:12" at y 54 and a "Stop recording" button — a clock with no status item beside it', () => {
    expect(isBareTree(idb(
      ax('StaticText', '00:12', { x: 170, y: 54, width: 62, height: 14 }),
      ax('Button', 'Stop recording', { x: 161, y: 760, width: 80, height: 80 }),
    ))).toBe(false);
  });
  it('a price "$4.99" at y 50 and a "Buy" button', () => {
    expect(isBareTree(idb(ax('StaticText', '$4.99', { x: 20, y: 50, width: 60, height: 18 }), ax('Button', 'Buy', { x: 20, y: 760, width: 362, height: 48 })))).toBe(false);
  });
});

/** The status bar's edges (review of 2026-10-08, m3): each pin fails if the band is widened or its gates are dropped. */
describe('isBareTree: what the status bar takes, and no more', () => {
  const onSpringBoard = (...els: Record<string, unknown>[]) => springBoard(...els);
  const BUTTON = axv('Button', 'Start', { x: 20, y: 760, width: 362, height: 48 }, null, null);

  it('a node straddling the status bar\'s line (top inside it, bottom below the clock + slack) counts', () => {
    expect(isBareTree(onSpringBoard(axv('StaticText', 'Hello', { x: 120, y: 40, width: 100, height: 20 }, null, null), BUTTON))).toBe(false);
  });
  it('a clock-shaped text below the cap is no clock: the labelled items at the top count, beside a button', () => {
    expect(isBareTree(parseIdbDescribeAll(JSON.stringify([
      axv('Application', ' ', FULL, null, null),
      ...STATUS_BAR.slice(1),
      axv('StaticText', '18:29', { x: 40, y: 400, width: 100, height: 30 }, null, null),
      BUTTON,
    ])))).toBe(false);
  });
  it('a navigation title holding a time at 62…106 is past the 8 % cap (70), even beside a labelled item in its row', () => {
    expect(isBareTree(idb(
      ax('StaticText', '10:30', { x: 170, y: 62, width: 62, height: 44 }),
      ax('Other', 'Timer header', { x: 0, y: 62, width: 402, height: 44 }),
      ax('Button', 'Start', { x: 20, y: 760, width: 362, height: 48 }),
    ))).toBe(false);
  });
  it('the clock is a `text`: an `other` reading 18:29 makes no status bar, and the items count', () => {
    expect(isBareTree(parseIdbDescribeAll(JSON.stringify([
      axv('Application', ' ', FULL, null, null),
      axv('StatusItem', '18:29', { x: 50, y: 22, width: 48, height: 22 }, null, null),
      ...STATUS_BAR.slice(1),
      LAUNCH_ICON,
    ])))).toBe(false);
  });
  it('a status item is a labelled or valued container/other: a navigation bar\'s Back button, or an unlabeled other, beside a whole-label time is none', () => {
    const navBar = (...els: Record<string, unknown>[]) => parseIdbDescribeAll(JSON.stringify([
      axv('Application', 'Timer', FULL, null, null),
      axv('StaticText', '10:30', { x: 170, y: 22, width: 62, height: 22 }, null, null),
      ...els,
      axv('Button', 'Start', { x: 20, y: 760, width: 362, height: 48 }, null, null),
    ]));
    expect(isBareTree(navBar(axv('Button', 'Back', { x: 8, y: 20, width: 60, height: 24 }, null, null)))).toBe(false);
    expect(isBareTree(navBar(axv('Other', null, { x: 300, y: 24, width: 40, height: 18 }, null, null)))).toBe(false);
  });
  it('a status item may end a little below the clock (within 1 % of the screen): 6 pt below on the measured screen still makes a status bar', () => {
    expect(isBareTree(parseIdbDescribeAll(JSON.stringify([
      axv('Application', ' ', FULL, null, null),
      STATUS_BAR[0],
      axv('StatusItem', '100 % battery power', { x: 341, y: 36, width: 29, height: 14 }, null, 'Not charging'), // ends at 50, the clock at 44
      LAUNCH_ICON,
    ])))).toBe(true);
  });
  it('a clock alone, with no status item beside it, is no status bar', () => {
    expect(isBareTree(parseIdbDescribeAll(JSON.stringify([axv('Application', ' ', FULL, null, null), STATUS_BAR[0], LAUNCH_ICON])))).toBe(false);
  });
});
