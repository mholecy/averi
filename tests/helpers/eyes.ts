import { unseen, type Eyes } from '../../src/ui-tree/eyes.js';

/**
 * Eyes for a test that pins nothing they would see: `fully` answers as the verbs once answered when no eyes were wired
 * ("… a screenshot could not tell (no screenshot was taken)"), `order` sees no pair (the listing's untold order). The
 * verbs that ask the eyes require them since A30 (ADR 0024, amendment A30) — production wires verify/eyes.ts#eyesOn at
 * the composition root; a test that is not about the eyes hands these. A test about them hands its own table.
 */
export const NO_EYES: Eyes = {
  fully: async (question) => unseen(question, 'no screenshot was taken'),
  order: async () => [],
};
