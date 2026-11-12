/**
 * `text` with `note` on a line of its own, `⚠ <note>` — or `text` alone when there is no note. The one spelling of a
 * claim note's line (DeviceAdapter.claimNote, A41a): on a claiming reply (run/claims.ts), and on a refusal of a value
 * only WebDriverAgent types after `treeSource: auto` fell back to idb (interact/type-text.ts, adapters/ios.ts).
 */
export const withNoteLine = (text: string, note: string | undefined): string => (note === undefined ? text : `${text}\n⚠ ${note}`);
