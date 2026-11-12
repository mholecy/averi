/**
 * A pre-warm's one rule (A41b; ADR 0046's A41b amendment), for WdaTreeSource.prewarm and AutoTreeSource.prewarm:
 * run `start` in the background and return at once — never awaited, never rejecting, nothing once `released()`.
 * Only when WebDriverAgent's build is cached (`wda.buildCached`): an uncached first build is up to 10 minutes of
 * xcodebuild beside the agent's own work, unasked, and the first read builds it instead.
 */
export function startInBackgroundIfBuilt(
  wda: { buildCached(): Promise<boolean> },
  released: () => boolean,
  start: () => Promise<unknown>,
): void {
  if (released()) return;
  const run = async (): Promise<void> => {
    if ((await wda.buildCached()) && !released()) await start();
  };
  void run().catch(() => undefined);
}
