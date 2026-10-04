import { describe, expect, it } from 'vitest';
import { fillText, tapText } from '../../src/mcp/tool-text.js';

describe('tap and type_text response lines', () => {
  it('tapText names the selector, and the resolution note when there was one', () => {
    expect(tapText('id:go', undefined)).toBe('Tapped id:go');
    expect(tapText('id:go', '2 matches; picked the only interactive one (button)')).toBe(
      'Tapped id:go (2 matches; picked the only interactive one (button))',
    );
  });

  it('fillText names the selector, the length, whether it cleared first, the note, and the ⚠ warning on its own line', () => {
    expect(fillText('id:amount', 4, false, undefined, undefined)).toBe('Filled id:amount (4 characters)');
    expect(fillText('id:amount', 4, true, undefined, undefined)).toBe('Filled id:amount (4 characters, cleared first)');
    expect(fillText('id:pw', 16, false, '2 matches; picked the only interactive one (textfield)', undefined)).toBe(
      'Filled id:pw (16 characters) (2 matches; picked the only interactive one (textfield))',
    );
    expect(
      fillText('id:pw', 16, false, undefined, 'masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace'),
    ).toBe(
      'Filled id:pw (16 characters)\n⚠ masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    );
  });
});
