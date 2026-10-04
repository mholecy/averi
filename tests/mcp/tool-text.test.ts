import { describe, expect, it } from 'vitest';
import { fillText, launchText, tapText } from '../../src/mcp/tool-text.js';

describe('tap and type_text response lines', () => {
  it('tapText names the selector, and the resolution note when there was one', () => {
    expect(tapText('id:go', undefined)).toBe('Tapped id:go');
    expect(tapText('id:go', '2 matches; picked the only interactive one (button)')).toBe(
      'Tapped id:go (2 matches; picked the only interactive one (button))',
    );
  });

  it('fillText names the selector, the length, whether it cleared first, the note, and the ⚠ warning on its own line', () => {
    expect(fillText('id:amount', { length: 4, cleared: false })).toBe('Filled id:amount (4 characters)');
    expect(fillText('id:amount', { length: 4, cleared: true })).toBe('Filled id:amount (4 characters, cleared first)');
    expect(fillText('id:pw', { length: 16, cleared: false, note: '2 matches; picked the only interactive one (textfield)' })).toBe(
      'Filled id:pw (16 characters) (2 matches; picked the only interactive one (textfield))',
    );
    expect(
      fillText('id:pw', {
        length: 16,
        cleared: false,
        warning: 'masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
      }),
    ).toBe(
      'Filled id:pw (16 characters)\n⚠ masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    );
  });
});

describe('launch_app response line', () => {
  it('names the app and the platform; nothing else when there is no activity and no wipe', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'ios' })).toBe('Launched md.bank.app on ios');
    expect(launchText({ appId: 'md.bank.app', platform: 'android', clearState: false })).toBe('Launched md.bank.app on android');
  });

  it('shows the activity that was used, by its last path segment', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: '.MainActivity' })).toBe(
      'Launched md.bank.app/.MainActivity on android',
    );
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: 'md.bank.app/md.bank.ui.MainActivity' })).toBe(
      'Launched md.bank.app/md.bank.ui.MainActivity on android',
    );
  });

  it('says when the state was cleared', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: '.MainActivity', clearState: true })).toBe(
      'Launched md.bank.app/.MainActivity on android (state cleared)',
    );
  });
});
