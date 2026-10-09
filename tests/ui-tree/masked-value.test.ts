import { describe, expect, it } from 'vitest';
import { hasBullet, isMaskedValue } from '../../src/ui-tree/masked-value.js';

describe('masked-value — one owner for the mask characters', () => {
  it('isMaskedValue: a non-empty reading of mask characters only, any of • ● ∙ · *', () => {
    for (const masked of ['••••', '●●', '∙∙∙', '···', '***', '•●∙·*']) expect(isMaskedValue(masked)).toBe(true);
    for (const plain of ['', 'abc', '•••a', 'a*b']) expect(isMaskedValue(plain)).toBe(false);
  });

  it('hasBullet: a • or ● anywhere — a partly masked reading — but never * or ·, which are ordinary text too', () => {
    expect(hasBullet('•••••t')).toBe(true);
    expect(hasBullet('a●b')).toBe(true);
    expect(hasBullet('pa*ss·word')).toBe(false);
    expect(hasBullet('∙x')).toBe(false);
    expect(hasBullet('')).toBe(false);
  });
});
