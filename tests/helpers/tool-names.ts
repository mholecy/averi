/**
 * The tool vocabulary, in registration order — the one owner of "which tools
 * and how many" for the tests. tests/mcp/tools.test.ts pins the names against
 * the module in memory; tests/mcp/server.test.ts pins that the spawned entry
 * serves the same list. A new tool is added here once.
 */
export const TOOL_NAMES = [
  'list_devices',
  'select_device',
  'install_app',
  'launch_app',
  'terminate_app',
  'open_deep_link',
  'screenshot',
  'ui_snapshot',
  'tap',
  'swipe',
  'type_text',
  'scroll_until',
  'press_key',
  'ensure_state',
  'run_flow',
  'assert',
  'verify',
  'get_logs',
] as const;
