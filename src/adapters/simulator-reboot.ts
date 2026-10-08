/**
 * The one owner of "reboot this simulator" as advice (2026-10-08, the iOS
 * adapter stack review's candidate 2, its minimal version). Before it the
 * command was spelled three times — the failed pre-launch accessibility
 * write's stderr line and the screenshot refusal in ios.ts, and
 * IdbEmptyTreeError in ios-tree-source.ts — in two spellings (with and
 * without a code span); the tree source's copy said `<udid>` because the
 * error was built without the simulator it was read from, and wda.ts's
 * foreign-WebDriverAgent refusal said only "reboot the simulator" though it
 * knew the UDID. The agent that reads a tool result had to look the UDID up
 * before it could act on the advice, though the process that threw it knew it.
 *
 * The builder takes the BOUND UDID — never simctl's `booted` alias, which
 * would reboot whichever simulator happens to be booted, not the one averi
 * drives (adapters are always bound since 2026-10-08, discovery.ts). It
 * returns a clause, lower-case and without a full stop, so each site keeps
 * its own lead-in ("if it repeats, …", "if that does not clear it, …") and
 * its own punctuation. A test (tests/adapters/simulator-reboot.test.ts)
 * scans src/'s code (comments stripped) and fails if the reboot command is
 * spelled anywhere else.
 *
 * Not here: the advice that names a reboot without a command
 * (run/verify.ts's appAlive: unknown line, which has no UDID in scope, and
 * the registry's "reboot it or select_device another one") — neither spells
 * the command, so neither duplicates this one.
 */
export function rebootSimulatorAdvice(udid: string): string {
  return `reboot the simulator (\`xcrun simctl shutdown ${udid} && xcrun simctl boot ${udid}\`)`;
}
