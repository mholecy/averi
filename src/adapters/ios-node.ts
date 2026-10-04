import { zeroRect, type Rect, type UiNode } from './types.js';

/**
 * The normalized iOS node and its vocabulary — pure: no process, no device.
 * Both tree sources (ios-tree-source.ts for idb, wda-source.ts for WDA's
 * payload) build their nodes through normalizeIosElement, and flow/config.ts
 * takes the kind enum from here, so none of them needs to load exec or the
 * Xcode probe to parse a payload or a YAML file. Split out of
 * ios-tree-source.ts on review (2026-10-02): importing the pure WDA parser
 * had started to pull in child_process.
 */

/**
 * The configured kind — `app.ios.treeSource` in averi.yaml, the registry's
 * cache key, and the one place the two literals are written. flow/config.ts
 * builds its enum from the tuple; mcp/registry.ts keys its cache on the type
 * and picks the adapter (ios-tree-source.ts, wda-tree-source.ts) from it.
 */
export const IOS_TREE_SOURCE_KINDS = ['idb', 'wda'] as const;
export type IosTreeSourceKind = (typeof IOS_TREE_SOURCE_KINDS)[number];
/** Native projects see no change by default; RN projects opt into `wda`. */
export const DEFAULT_IOS_TREE_SOURCE: IosTreeSourceKind = 'idb';

/**
 * iOS element `type` → normalized role vocabulary, shared by both tree
 * sources (wda-source.ts extends it with structural types only the nested
 * tree has). One owner per rule — the two copies this replaced were
 * identical and would have drifted.
 */
export const IOS_ROLE_MAP: Record<string, string> = {
  Button: 'button',
  StaticText: 'text',
  TextField: 'textfield',
  SecureTextField: 'textfield',
  TextView: 'textfield',
  Image: 'image',
  Switch: 'switch',
  Toggle: 'switch',
  CheckBox: 'checkbox',
  RadioButton: 'radiobutton',
  Slider: 'slider',
  ProgressIndicator: 'progress',
  WebView: 'webview',
  ScrollView: 'scrollable',
  Table: 'scrollable',
  CollectionView: 'scrollable',
  Cell: 'container',
  Window: 'container',
  Other: 'container',
};

/**
 * What both backends report per element, once each has read its own field
 * names (idb: AXLabel/AXUniqueId/AXValue/frame; WDA: label/rawIdentifier/
 * value/rect). Every field is optional because both payloads omit or null
 * fields freely — the normalizer is where "absent, null and empty are all
 * null" is decided, once.
 */
export interface RawIosElement {
  type?: string;
  label?: string | null;
  identifier?: string | null;
  value?: string | null;
  rect?: Rect;
}

/**
 * The per-node rule both sources apply: role via the given map (unknown →
 * `other`; an OWN key only — a plain-object map answers `constructor` and
 * friends from its prototype, and a type named like one produced a node
 * whose role was a function, in both copies, until 2026-10-02),
 * empty/null/absent strings → null, rects rounded to integer
 * points (both backends emit fractional points; selectors and the geometry
 * layer want integers), a missing rect → zeroRect(). Until 2026-10-02 this
 * was written out twice, in ios.ts and wda-source.ts, and the tests pinned
 * each copy separately — nothing pinned that they agreed. The rect is a
 * fresh object per node: nodes are mutated downstream and must not share one.
 */
export function normalizeIosElement(
  el: RawIosElement,
  roles: Record<string, string>,
  children: UiNode[],
): UiNode {
  const type = el.type ?? '';
  return {
    role: Object.hasOwn(roles, type) ? roles[type] : 'other',
    label: emptyToNull(el.label),
    identifier: emptyToNull(el.identifier),
    value: emptyToNull(el.value),
    rect: el.rect
      ? {
          x: Math.round(el.rect.x),
          y: Math.round(el.rect.y),
          width: Math.round(el.rect.width),
          height: Math.round(el.rect.height),
        }
      : zeroRect(),
    children,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}
