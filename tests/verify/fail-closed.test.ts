import { describe, expect, it } from 'vitest';
import { failClosed } from '../../src/verify/fail-closed.js';

/**
 * The trailing full stop has one owner since 2026-10-08: a reason that is
 * another component's sentence (an adapter's transport error, a recognizer's
 * message) must not read `attention.; failing closed`.
 */
describe('failClosed', () => {
  it('drops one trailing full stop from the reason', () => {
    expect(failClosed('the device needs attention.', 'color')).toBe('the device needs attention; failing closed, color unchecked');
  });

  it('leaves a reason without one, and an ellipsis, as written', () => {
    expect(failClosed('no stop', 'rendered text')).toBe('no stop; failing closed, rendered text unchecked');
    expect(failClosed('cut off...', 'geometry')).toBe('cut off...; failing closed, geometry unchecked');
  });
});
