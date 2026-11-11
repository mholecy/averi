import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { focusOf } from '../../../scripts/truth/batch/lab-chooser.js';

// TL5 (backlog A22; ADR 0020: a lab check does not judge with the code under test): --check's focus read is judged by
// the harness's own reader of the focused activity (chooser-readers.ts#focusedAppOf and #isChooser, live-chooser.ts's),
// never by src's android-chooser.ts#chooserInFocus. Pinned here with src's parser replaced by one that always answers
// the chooser, and then by one that never does: focusOf's word stays the device text's either way.

const answer = vi.hoisted(() => ({ chooser: undefined as string | undefined }));
vi.mock('../../../src/adapters/android-chooser.js', async (original) => ({
  ...(await original<object>()),
  chooserInFocus: () => answer.chooser,
}));

const ok = (out: string) => ({ code: 0, timedOut: false, signal: null, out, err: '' });
const fixture = (name: string): string => readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', name), 'utf8');
const LAUNCHER = fixture('dumpsys-window-focus-api33-b10-launcher.txt');
const CHOOSER = fixture('dumpsys-window-focus-api33-b10-chooser.txt');

describe('focusOf judges with the harness\'s reader, not src\'s chooserInFocus (TL5, ADR 0020)', () => {
  it('src\'s parser answering a chooser over the launcher\'s read: focusOf still reads no chooser', () => {
    answer.chooser = 'android/com.android.internal.app.ResolverActivity';
    expect(focusOf(ok(LAUNCHER))).toEqual({ state: 'read', chooser: undefined });
  });

  it('src\'s parser answering none over the chooser\'s read: focusOf still reads the chooser', () => {
    answer.chooser = undefined;
    expect(focusOf(ok(CHOOSER))).toEqual({ state: 'read', chooser: 'android/com.android.internal.app.ResolverActivity' });
  });
});
