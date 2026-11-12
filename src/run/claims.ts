import type { DeviceAdapter } from '../adapters/types.js';
import { withNoteLine } from '../util/note-line.js';

/**
 * The claim note on what a tool says (A41a, docs/adr/0046-the-ios-tree-source-is-webdriveragent-when-it-comes-up.md):
 * an adapter whose tree source fell back (DeviceAdapter.claimNote — iOS `treeSource: auto` reading through idb) puts
 * its line, `⚠ <note>`, after every reply that claims what it read. Asked after the call, whose first read made the
 * choice. A leaf of the replies, beside run-reply.ts: the tools (mcp/tools.ts) wrap tap, fill and scroll_until replies
 * in `claimed`; the compositions here wrap assert, ensure_state, run_flow (commands.ts) and verify (verify.ts).
 */

/**
 * `reply` with the note of the first of `adapters` that has one, on its own last line — unless the reply already
 * carries it (withNoteLine); `reply` alone otherwise.
 */
export function claimed(adapters: readonly DeviceAdapter[], reply: string): string {
  return withNoteLine(reply, adapters.find((a) => a.claimNote !== undefined)?.claimNote);
}

/**
 * What an engine run throws, with the adapter's note: a failed flow's error (flow/engine.ts#FlowError) lists the ✓
 * lines of the taps and fills before the step that failed — claims too. A NEW error of the same message with the note
 * line after it, the caught one its cause; the caught error itself, unchanged, when there is no note or it is no Error.
 */
export function claimedError(adapter: DeviceAdapter, e: unknown): unknown {
  if (adapter.claimNote === undefined || !(e instanceof Error)) return e;
  return new Error(withNoteLine(e.message, adapter.claimNote), { cause: e });
}
