import type { Platform } from '../adapters/types.js';

/**
 * Canonical leg order for `verify`: android first, then ios. Fixed regardless
 * of caller order so the "first image android, second ios" screenshot
 * convention holds whenever both platforms run.
 */
export const PLATFORM_ORDER: readonly Platform[] = ['android', 'ios'];

/**
 * Emptiness is a caller error the zod schema rejects before this runs, so an
 * empty input never reaches here.
 */
export function normalizePlatforms(input?: readonly Platform[]): Platform[] {
  if (input === undefined) return [...PLATFORM_ORDER];
  return PLATFORM_ORDER.filter((p) => input.includes(p));
}
