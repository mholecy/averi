/**
 * Where a cut refusal's coordinate escape (`… tap by coordinates`) stands against the remedies it names: how many of
 * them come first (`dismiss it first`, `scroll_until it`, `scroll again`), none after it (else it throws), and whether
 * the escape closes its sentence (its parentheses closed, then the end, `; nothing was tapped`, or the full stop) — all
 * within that sentence. F2A1's order, the owner's decision of 2026-10-18 (the way past kept, the remedy before it) —
 * read by the tap's and scroll_until's tests over the lab's real form-keyboard captures (tests/interact/tap-judgement
 * .test.ts, tests/interact/scroll.test.ts).
 */
export function remedyThenEscape(reply: string): { remedies: number; escapeLast: boolean } {
  const escape = reply.indexOf('tap by coordinates');
  if (escape < 0) throw new Error(`no coordinate escape: ${reply}`);
  // The escape's own sentence: up to the full stop that closes it (`). ` — a later sentence, such as the keyboard
  // note scroll_until appends for the rounds it judged above the IME, is no clause of this advice).
  const end = reply.indexOf('). ', escape);
  const sentence = end < 0 ? reply : reply.slice(0, end + 2);
  const at = (re: RegExp) => [...sentence.matchAll(re)].map((m) => m.index!);
  const remedies = [/dismiss it first/g, /scroll_until it/g, /scroll again/g].flatMap(at);
  if (remedies.some((i) => i > escape)) throw new Error(`a remedy after the coordinate escape: ${reply}`);
  const rest = sentence.slice(escape + 'tap by coordinates'.length);
  return { remedies: remedies.length, escapeLast: /^\)+(?:; nothing was tapped|\.)?$/.test(rest) };
}
