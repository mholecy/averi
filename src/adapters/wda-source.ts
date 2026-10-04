import { IOS_ROLE_MAP, normalizeIosElement } from './ios-node.js';
import { attachFieldErrors, everyNode } from './field-errors.js';
import type { Rect, UiNode } from './types.js';

/**
 * Parser for WebDriverAgent's sessionless `GET /source?format=json` — the
 * NESTED XCUIElement tree, kept nested (unlike idb's flat AX-element list).
 * The nesting is the point of the WDA path: React Native puts `testID` on the
 * HOST VIEW, which WDA reports as an `Other` node WITH `rawIdentifier` while
 * idb's AX output drops it entirely (measured 2026-08-12, WDA 16.1.7,
 * fixtures in tests/fixtures/wda-source-*.json).
 */

/**
 * WDA element `type` → normalized role. Types arrive WITHOUT the
 * "XCUIElementType" prefix (measured: plain "StaticText", "Other", ...).
 * The shared iOS vocabulary (ios-node.ts) plus structural types only
 * the nested tree has.
 */
const ROLE_MAP: Record<string, string> = {
  ...IOS_ROLE_MAP,
  // Structural types that never appear in idb's flat AX list:
  Application: 'container',
  NavigationBar: 'container',
  TabBar: 'container',
  Alert: 'container',
  Keyboard: 'container',
  StatusBar: 'container',
};

/**
 * Relevant subset of a WDA source node. `rawIdentifier` is THE
 * accessibilityIdentifier; `name` merely mirrors it with label fallbacks —
 * never read `name`. `rect` is points with clean numbers (the string `frame`
 * and `nativeFrame` also exist; ignore them). `isVisible`/`isEnabled` are
 * "1"/"0" strings; invisible nodes are KEPT — iOS keeps off-screen nodes in
 * its tree and the assert layer relies on that (see `absent` in flow/config).
 */
interface WdaElement {
  type?: string;
  rawIdentifier?: string | null;
  label?: string | null;
  value?: string | null;
  rect?: Rect;
  children?: WdaElement[] | null;
}

/** Parse the raw `/source?format=json` response body. */
export function parseWdaSource(json: string): UiNode {
  return parseWdaSourceValue(JSON.parse(json));
}

/**
 * Parse an already-JSON.parsed `/source` payload (WdaServer.source() returns
 * parsed `unknown`). Accepts the `{ value: <root>, sessionId }` envelope or a
 * bare root node — a node is recognized by its string `type`, which the
 * envelope lacks, so a node's own string `value` field cannot mislead the
 * unwrap. The root comes back as returned (Application → container), not
 * under a synthetic wrapper: selectors walk the root like any node.
 */
export function parseWdaSourceValue(value: unknown): UiNode {
  const tree = toUiNode(unwrapEnvelope(value));
  // Nested tree, flat rule: rects are absolute, so a walk is all it takes.
  attachFieldErrors(everyNode(tree));
  return tree;
}

function unwrapEnvelope(value: unknown): WdaElement {
  if (isElement(value)) return value;
  if (isRecord(value) && isElement(value.value)) return value.value;
  throw new Error(
    'WDA /source payload has no element root — expected { value: { type, ... } } or a bare node',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isElement(value: unknown): value is WdaElement {
  return isRecord(value) && typeof value.type === 'string';
}

function toUiNode(el: WdaElement): UiNode {
  return normalizeIosElement(
    { type: el.type, label: el.label, identifier: el.rawIdentifier, value: el.value, rect: el.rect },
    ROLE_MAP,
    (el.children ?? []).map(toUiNode),
  );
}
