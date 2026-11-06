import type { AppHolder } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';

/** A wait's unconfirmed answer (AppHolder's `unknown`) as a link's ⚠ text; undefined when the answer is another. */
export const linkTextOf = (answer: AppHolder): string | undefined =>
  answer.holder === 'unknown' ? appHolderText({ link: 'unused: the words read the answer\'s app' }, answer) : undefined;

/** The same as a launch's ⚠ text. */
export const launchTextOf = (answer: AppHolder): string | undefined =>
  answer.holder === 'unknown' ? appHolderText({ app: answer.app }, answer) : undefined;

/** A launch's answer as its ⚠ note for the lab app, the text its reply and the flow's line carry (flow/launch.ts#launchApp); none as `{}`. */
export const worded = (answer: AppHolder): { note?: string } => {
  const note = appHolderText({ app: 'dev.averi.lab' }, answer);
  return note === undefined ? {} : { note };
};
