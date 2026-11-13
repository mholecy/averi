/**
 * `text` with `note` on a line of its own, `⚠ <note>` — or `text` alone when there is no note, or when `text` already
 * carries that line. The one spelling of a claim note's line (DeviceAdapter.claimNote, A41a): on a claiming reply, and
 * on a refusal of a value only WebDriverAgent types after `treeSource: auto` fell back to idb. Said once: a flow's
 * refused `fill:` carries it from its refusal, and its FlowError, the run's error and verify's reply would each add it
 * again.
 */
export const withNoteLine = (text: string, note: string | undefined): string =>
  note === undefined || text.includes(`⚠ ${note}`) ? text : `${text}\n⚠ ${note}`;
