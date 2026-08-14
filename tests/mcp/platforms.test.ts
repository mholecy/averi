import { describe, expect, it } from 'vitest';
import { normalizePlatforms, PLATFORM_ORDER } from '../../src/mcp/platforms.js';

describe('normalizePlatforms', () => {
  it('defaults to both platforms when the input is omitted', () => {
    expect(normalizePlatforms()).toEqual(['android', 'ios']);
  });

  it('returns a fresh array for the default — callers cannot mutate PLATFORM_ORDER', () => {
    const platforms = normalizePlatforms();
    expect(platforms).not.toBe(PLATFORM_ORDER);
    platforms.reverse();
    expect(PLATFORM_ORDER).toEqual(['android', 'ios']);
  });

  it('passes single platforms through', () => {
    expect(normalizePlatforms(['android'])).toEqual(['android']);
    expect(normalizePlatforms(['ios'])).toEqual(['ios']);
  });

  it('normalizes caller order to android-then-ios (screenshot pairing convention)', () => {
    expect(normalizePlatforms(['ios', 'android'])).toEqual(['android', 'ios']);
  });

  it('collapses duplicates — a duplicate platform must not produce two legs', () => {
    expect(normalizePlatforms(['ios', 'ios'])).toEqual(['ios']);
    expect(normalizePlatforms(['android', 'ios', 'android'])).toEqual(['android', 'ios']);
  });
});
