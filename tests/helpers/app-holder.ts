import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';

/** The foreground wait's caveat in an answer (AppHolder's `unknown`), or undefined when the answer is another. */
export const caveatOf = (answer: AppHolder): string | undefined => (answer.holder === 'unknown' ? answer.caveat : undefined);

/** A launch's answer as its ⚠ note for the lab app, the text its reply and the flow's line carry (flow/launch.ts#launchApp); none as `{}`. */
export const worded = (answer: AppHolder): { note?: string } => {
  const note = appHolderText({ app: 'dev.averi.lab' }, answer);
  return note === undefined ? {} : { note };
};
