import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExecError } from '../../src/adapters/exec.js';
import { NoLinkHandlerError, noLinkHandler } from '../../src/adapters/ios-link-failure.js';

/**
 * simctl's stderr for `openurl <udid> tel:…` (batch-13 rerun 2, main 51778d00, iOS 27.0, idb, 2/2 byte-identical; exit 115).
 * NOT that capture's bytes: batch-13 recorded them in its scratch output, which no longer exists. This fixture holds only
 * the fragments the repo recorded, in their order: the domain and code and the "failed to open" line from backlog row D65,
 * the last line from docs/plans/2026-10-07-top4-device-check.md row 10c. The capture had four lines.
 */
const TEL_STDERR = readFileSync(new URL('../fixtures/simctl-openurl-tel-exit115-stderr-shape-from-d65-row.txt', import.meta.url), 'utf8');
const failed = (stderr: string, exitCode: number | null = 115, timedOut = false) => new ExecError('xcrun simctl openurl U tel:+421900123456', exitCode, stderr, timedOut);

describe('noLinkHandler (D65)', () => {
  it('reads simctl\'s code 115 as a fact naming the scheme, and words it', () => {
    const cause = failed(TEL_STDERR);
    const found = noLinkHandler(cause, 'tel:+421900123456');
    expect(found).toBeInstanceOf(NoLinkHandlerError);
    expect(found?.scheme).toBe('tel');
    expect(found?.cause).toBe(cause);
    expect(found?.name).toBe('NoLinkHandlerError');
    expect(found?.message).toBe(
      'No app on this simulator handles tel: links, so nothing opened (simctl openurl: LSApplicationWorkspaceErrorDomain, code 115). ' +
        'A link to an app\'s own scheme needs that app installed.',
    );
  });

  it('names a custom scheme as the link has it, lower-cased', () => {
    expect(noLinkHandler(failed('(domain=LSApplicationWorkspaceErrorDomain, code=115)'), 'NoSuch://nothing')?.scheme).toBe('nosuch');
  });

  it('asks the domain and the code, not the exit', () => {
    expect(noLinkHandler(failed('(domain=LSApplicationWorkspaceErrorDomain, code=115)', 1), 'tel:1')).toBeInstanceOf(NoLinkHandlerError);
  });

  it('leaves every other failure alone', () => {
    for (const stderr of ['(domain=LSApplicationWorkspaceErrorDomain, code=1150)', '(domain=LSApplicationWorkspaceErrorDomain, code=11)', '(domain=NSOSStatusErrorDomain, code=115)', 'code=115', 'Unable to boot device']) {
      expect(noLinkHandler(failed(stderr), 'tel:1')).toBeUndefined();
    }
    expect(noLinkHandler(new Error('(domain=LSApplicationWorkspaceErrorDomain, code=115)'), 'tel:1')).toBeUndefined();
    expect(noLinkHandler('(domain=LSApplicationWorkspaceErrorDomain, code=115)', 'tel:1')).toBeUndefined();
  });

  it('leaves a url with no scheme to name alone', () => {
    expect(noLinkHandler(failed(TEL_STDERR), 'not a url')).toBeUndefined();
  });
});
