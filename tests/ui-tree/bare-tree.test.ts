import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource, parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { isBareTree } from '../../src/ui-tree/bare-tree.js';
import { node } from '../helpers/fake.js';

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
    expect(isBareTree(parseUiautomatorXml(androidXml('')))).toBe(true);
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
    expect(isBareTree(parseUiautomatorXml(androidXml(
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
    expect(isBareTree(parseUiautomatorXml(androidXml(
      '<node index="0" text="" resource-id="" class="android.view.View" package="md.bank.app" content-desc="Log in" bounds="[60,1600][1020,1740]"/>',
    )))).toBe(false);
  });
  it('Android Compose: a merged clickable View carrying text', () => {
    expect(isBareTree(parseUiautomatorXml(androidXml(
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
