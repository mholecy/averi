import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';

// The Android lab app's deep links (fixtures/apps/android/src/main/AndroidManifest.xml): averilab://cell/… has one
// handler (the cases of D49, D54 and D58 open a cell by it), averilab://shared/… two — MainActivity and its alias
// `.Twin` (L7, D55: a link the system's resolver answers with a chooser), and so does averilab://pair/… (D55c: the same
// two handlers, for a chooser with no last-chosen entry; "Just once" left one for `shared`, lab fact 5).

type Node = Record<string, unknown>;
const list = (v: unknown): Node[] => (v === undefined ? [] : Array.isArray(v) ? (v as Node[]) : [v as Node]);

const manifest = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' }).parse(
  readFileSync(new URL('../../fixtures/apps/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8'),
) as { manifest: { application: Node } };
const app = manifest.manifest.application;
const components = [...list(app.activity), ...list(app['activity-alias'])];

/** The components with a VIEW filter for averilab://<host>, by name. */
const handlersOf = (host: string) =>
  components
    .filter((c) =>
      list(c['intent-filter']).some(
        (f) => list(f.action).some((a) => a['android:name'] === 'android.intent.action.VIEW') && list(f.data).some((d) => d['android:scheme'] === 'averilab' && d['android:host'] === host),
      ),
    )
    .map((c) => c['android:name']);

describe('the Android lab app\'s deep-link handlers', () => {
  it('averilab://cell: one handler, MainActivity', () => {
    expect(handlersOf('cell')).toEqual(['.MainActivity']);
  });

  it('averilab://shared (D55): two — MainActivity and its exported alias .Twin, which targets it', () => {
    expect(handlersOf('shared')).toEqual(['.MainActivity', '.Twin']);
    expect(list(app['activity-alias'])).toEqual([expect.objectContaining({ 'android:name': '.Twin', 'android:exported': 'true', 'android:targetActivity': '.MainActivity' })]);
  });

  it('averilab://pair (D55c): the same two — a two-handler link with no last-chosen entry yet, for a fresh chooser', () => {
    expect(handlersOf('pair')).toEqual(['.MainActivity', '.Twin']);
  });
});
