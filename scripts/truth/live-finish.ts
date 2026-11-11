import { writeFile } from 'node:fs/promises';
import { errorMessage } from '../../src/util/error-message.js';
import type { DeviceLabel } from './device-state.js';
import type { RunRecord } from './live-cases.js';

/**
 * live.ts's finish, after the cases (or after one threw): the record first, then the closes (D82). T16's first live
 * smoke (2026-11-10, `--groups carousel --cases lv-d62-control`) lost its record: the emulator went offline during the
 * after read (T16 caught that as the label's error), then `am force-stop` in AndroidLab's close (lab-device.ts) threw
 * `adb: device offline`, and the write came after the closes. Now:
 *
 *  1. the carousel group's device label (T16) goes into the record;
 *  2. the record is written (`--record`), before anything closes: what the cases read and how they were judged does not
 *     rest on a device that may be gone;
 *  3. every closer is tried, each whatever the one before it threw — the MCP connection's (client, server, registry:
 *     the registry's shutdown is what stops the adapters' child processes, so node can exit) and the lab's (the app
 *     force-stopped or terminated, WDA shut down) are independent: a dead device must not keep the server's processes
 *     alive, nor a failed MCP close skip the force-stop. A closer that throws is one stderr line, `close: <name> failed
 *     — <why>`, never a throw: the run's verdict is the cases' (the summary's, its exit code untouched), a failed
 *     cleanup no part of it — when a dead device is why, the record's device label or a case's reads say so already,
 *     and lab-run (batch/lab-run.ts) judges a block by main's rejudge of the record, not by live.ts's exit code.
 *
 * A write that fails is said at once (`record: <path> not written — <why>`) and still throws (the run's evidence is
 * lost: loud by design), but only after every closer ran: an unclosed registry would keep node alive past the throw.
 * The write is attempted first all the same, so a closer that hangs cannot cost the record.
 */

/** One thing live.ts closes, named for its stderr line. */
export interface Closer {
  name: string;
  close(): Promise<void>;
}

export interface Finish {
  record: RunRecord;
  /** `--record`'s file; none: nothing written. */
  recordPath?: string;
  /** The carousel group's labelling (device-state.ts#deviceLabelling); none: no deviceLabel key. */
  deviceLabel?: () => DeviceLabel;
  /** In the order they are tried. */
  closers: readonly Closer[];
  /** Where a failed close is said (live.ts: stderr). */
  note: (line: string) => void;
}

export async function finishRun({ record, recordPath, deviceLabel, closers, note }: Finish): Promise<void> {
  if (deviceLabel !== undefined) record.deviceLabel = deviceLabel();
  let lost: unknown;
  let failed = false;
  if (recordPath !== undefined) {
    try {
      await writeFile(recordPath, JSON.stringify(record) + '\n');
    } catch (e) {
      failed = true;
      lost = e;
      // Said at once: thrown from live.ts's `finally`, this error replaces any a case threw (live.ts's `catch` said
      // that one on stderr first), and the line keeps the lost record seen beside it.
      note(`record: ${recordPath} not written — ${errorMessage(e)}`);
    }
  }
  for (const c of closers) {
    try {
      await c.close();
    } catch (e) {
      note(`close: ${c.name} failed — ${errorMessage(e)}`);
    }
  }
  if (failed) throw lost;
}
