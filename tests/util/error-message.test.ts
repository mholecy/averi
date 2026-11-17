import { describe, expect, it } from 'vitest';
import { errorHeadline } from '../../src/util/error-message.js';

describe('errorHeadline', () => {
  it('is the first line of an Error message, the lines beneath it dropped', () => {
    expect(errorHeadline(new Error('Command failed (exit 1): idb screenshot\nstderr line\nmore'))).toBe('Command failed (exit 1): idb screenshot');
  });

  it('is the whole message when it has one line, and empty when the message is', () => {
    expect(errorHeadline(new Error('one line'))).toBe('one line');
    expect(errorHeadline(new Error(''))).toBe('');
  });

  it('reads a thrown value that is no Error as its string', () => {
    expect(errorHeadline('plain\nstring')).toBe('plain');
    expect(errorHeadline(42)).toBe('42');
    expect(errorHeadline(undefined)).toBe('undefined');
    expect(errorHeadline({ toString: () => 'custom\nrest' })).toBe('custom');
  });
});
