/** Wait `ms`. One owner so "waits, not sleeps" stays a design rule, not a habit. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
