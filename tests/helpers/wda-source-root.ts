/**
 * The element root of a WDA fixture's payload — the payload itself when it is a bare node, else its `value` — or
 * undefined when that is no element (no string `type`): one of WDA's other answers (an activeAppInfo envelope, a
 * `/wda/keys` body, the D43 gate's corpus) or averi's own ui_snapshot, never a `/source` tree. The one shape test the
 * fixture sweeps share (tests/helpers/ios-trees.ts, wda-source-visibility.test.ts).
 */
export function wdaSourceRoot<T extends { type?: unknown }>(raw: T & { value?: unknown }): T | undefined {
  const root = (typeof raw.type === 'string' ? raw : raw.value) as T | null | undefined;
  return typeof root?.type === 'string' ? root : undefined;
}
