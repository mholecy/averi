/**
 * `text` with `note` on a line of its own, `⚠ <note>` — or `text` alone when there is no note, or when `text` already
 * carries that line. The one spelling of a claim note's line (DeviceAdapter.fallback): on a claiming reply, and on a
 * refusal of a value only WebDriverAgent types after `treeSource: auto` fell back to idb. Said once: a message passed
 * up through several layers that each add the note shows it once.
 */
export const withNoteLine = (text: string, note: string | undefined): string =>
  note === undefined || text.includes(`⚠ ${note}`) ? text : `${text}\n⚠ ${note}`;
