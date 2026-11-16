/**
 * The one owner of "reboot this simulator" as advice: one spelling of the
 * command, with the UDID in it, so the agent that reads a tool result can act
 * on the advice without looking up the UDID the process that threw it knew.
 *
 * The builder takes the BOUND UDID — never simctl's `booted` alias, which
 * would reboot whichever simulator happens to be booted, not the one averi
 * drives (adapters are always bound, discovery.ts). It returns a clause,
 * lower-case and without a full stop, so each site keeps its own lead-in ("if
 * it repeats, …", "if that does not clear it, …") and its own punctuation. A
 * test (tests/adapters/simulator-reboot.test.ts) scans src/'s code (comments
 * stripped) and fails if the reboot command is spelled anywhere else.
 *
 * Not here: the advice that names a reboot without a command
 * (run/app-health.ts's appAlive: unknown line, which has no UDID in scope, and
 * the registry's "reboot it or select_device another one") — neither spells
 * the command, so neither duplicates this one.
 */
export function rebootSimulatorAdvice(udid: string): string {
  return `reboot the simulator (\`xcrun simctl shutdown ${udid} && xcrun simctl boot ${udid}\`)`;
}
