import { describe, expect, it } from 'vitest';
import type { Platform } from '../../src/adapters/types.js';
import {
  NO_CONFIG,
  OPTIONAL_CONFIG,
  REQUIRED_CONFIG,
  REQUIRED_CONFIG_AND_ENV,
  type ConfigPolicy,
} from '../../src/flow/tool-config.js';
import { TOOL_CONFIG } from '../../src/mcp/config-policy.js';

/**
 * The tool → policy mapping (mcp/config-policy.ts), pinned as data. Moved
 * here from tests/flow/tool-config.test.ts with the table itself (review
 * round 1); what each policy DOES is pinned there, and through the protocol
 * in tests/mcp/tools.test.ts.
 */

describe('TOOL_CONFIG — what each config-reading tool reads, per platform', () => {
  const PLATFORMS: Platform[] = ['android', 'ios'];
  const NONE_NAMED = { activity: undefined, intent: undefined };

  /**
   * The whole table as data, the same one ARCHITECTURE.md §5 prints. A row
   * changed here is a user-visible change: which tools fail beside a broken
   * or missing averi.yaml, and which read .env.averi.
   */
  it('is the documented table', () => {
    const row = (policyOf: (p: Platform) => ConfigPolicy) => Object.fromEntries(PLATFORMS.map((p) => [p, policyOf(p)]));
    expect({
      install_app: row(() => TOOL_CONFIG.install_app()),
      'launch_app (nothing named)': row((p) => TOOL_CONFIG.launch_app({ platform: p, ...NONE_NAMED })),
      'launch_app (activity named)': row((p) => TOOL_CONFIG.launch_app({ platform: p, activity: '.X', intent: undefined })),
      'launch_app (intent given)': row((p) => TOOL_CONFIG.launch_app({ platform: p, activity: undefined, intent: { action: 'android.intent.action.SEND' } })),
      ui_snapshot: row(TOOL_CONFIG.ui_snapshot),
      tap: row(TOOL_CONFIG.tap),
      type_text: row(TOOL_CONFIG.type_text),
      scroll_until: row(TOOL_CONFIG.scroll_until),
      assert: row(() => TOOL_CONFIG.assert()),
      ensure_state: row(() => TOOL_CONFIG.ensure_state()),
      run_flow: row(() => TOOL_CONFIG.run_flow()),
      verify: row(() => TOOL_CONFIG.verify()),
    }).toEqual({
      install_app: { android: REQUIRED_CONFIG, ios: REQUIRED_CONFIG },
      'launch_app (nothing named)': { android: OPTIONAL_CONFIG, ios: NO_CONFIG },
      'launch_app (activity named)': { android: NO_CONFIG, ios: NO_CONFIG },
      'launch_app (intent given)': { android: NO_CONFIG, ios: NO_CONFIG },
      ui_snapshot: { android: NO_CONFIG, ios: OPTIONAL_CONFIG },
      tap: { android: NO_CONFIG, ios: OPTIONAL_CONFIG },
      type_text: { android: NO_CONFIG, ios: OPTIONAL_CONFIG },
      scroll_until: { android: NO_CONFIG, ios: OPTIONAL_CONFIG },
      assert: { android: OPTIONAL_CONFIG, ios: OPTIONAL_CONFIG },
      ensure_state: { android: REQUIRED_CONFIG_AND_ENV, ios: REQUIRED_CONFIG_AND_ENV },
      run_flow: { android: REQUIRED_CONFIG_AND_ENV, ios: REQUIRED_CONFIG_AND_ENV },
      verify: { android: REQUIRED_CONFIG_AND_ENV, ios: REQUIRED_CONFIG_AND_ENV },
    });
  });
});
