import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExecError } from '../../src/adapters/exec.js';
import { NoLinkHandlerError, noLinkHandler } from '../../src/adapters/ios-link-failure.js';

/**
 * simctl's stderr for `openurl <udid> tel:+421900123456`, exit 115: batch-13 rerun 2, main 51778d00, iOS 27.0, idb, 2/2
 * byte-identical (the D65 probe's reply, its first line, exec's, cut off: it holds the udid). batch-9's D58 P3 reads the same.
 */
const TEL_STDERR = readFileSync(new URL('../fixtures/simctl-openurl-tel-exit115-b13-stderr.txt', import.meta.url), 'utf8');
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

  it('the fixture is the four lines batch-13 recorded, its shape what the fact is read from', () => {
    expect(TEL_STDERR.trim().split('\n')).toEqual([
      'An error was encountered processing the command (domain=LSApplicationWorkspaceErrorDomain, code=115):',
      'Simulator device failed to open tel:+421900123456.',
      'Underlying error (domain=LSApplicationWorkspaceErrorDomain, code=115):',
      '\tThe operation couldn’t be completed. (LSApplicationWorkspaceErrorDomain error 115.)',
    ]);
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
