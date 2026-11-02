/**
 * The truth harness's wait (scripts/truth/lab-device.ts#pause), recorded and not waited on. A test file installs it
 * with
 *   vi.mock('../../scripts/truth/lab-device.js', async (original) => ({ ...(await original<object>()), ...(await import('../helpers/pause-recorder.js')) }));
 * — the rest of lab-device.ts the real one — and pins the DELAY SEQUENCE (`pauses`). The capture's probe
 * (capture-run.ts#probe) gives the app 1 s to log its tap; behind a fake lab that logs as it taps, that second is pure
 * idle (T1: 37 s of truth.test.ts and geometry.test.ts). Not a re-export of lab-device.ts: inside the mock, that import
 * would resolve to the mock itself.
 */
export const pauses: number[] = [];

export const pause = async (ms: number): Promise<void> => {
  pauses.push(ms);
};

export const resetPauses = (): void => {
  pauses.length = 0;
};
