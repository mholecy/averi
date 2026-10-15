import type { ReplyKind } from '../../../scripts/differential/golden-spec.js';
import type { Family } from '../../../scripts/truth/schema.js';

// What every family's KNOWN file (tests/differential/golden/<family>.known.ts) is written with; golden.test.ts
// aggregates them. A family's file lists the known mismatches and the checks per capture of ITS cells only
// (fixtures/apps/cells/<family>.json) — golden.test.ts refuses a row filed under another family.

export const IOS = 'ios-iphone17-ios27';
export const ANDROID = 'android-averi_lab-api33';

export interface Known {
  /** What the mismatch says first, up to its `: ` — the judge's reason, or `not in the tree` (vacuous). */
  cls: string;
  /** What kind of reply it is (GoldenCheck.kind, golden-spec.ts#replyKind): a timeout turned refusal fails here. */
  kind: ReplyKind;
  /** The taps and swipes the device was sent (GoldenCheck.calls), in order. */
  calls: readonly string[];
  note: string;
  /**
   * What the row is, beside `cls` (which stays the judge's reason, matched against the mismatch): `bug:<file>` a bug
   * note under docs/bugs that the row reproduces — red until its fix; `residual:<decision>` a mismatch accepted by a
   * decision (an ADR, an owner's ruling: calibration.json's `residual:` statuses) — red by design. Absent: neither
   * filed yet (a tree source's limit, described in `note`). golden.test.ts checks that a `bug:` names a note that
   * exists.
   */
  as?: Classed;
}

export type Classed = `bug:${string}` | `residual:${string}`;

/** One family's ratchet: its known mismatches by `<run>/<file> <target> <verb>`, and its checks per capture. */
export interface KnownFile {
  family: Family;
  known: Record<string, Known>;
  counts: Record<string, number>;
}

/** The rows `<file> <tag> <verb>` of every tag and verb, each known as `k`. */
export const keys = (file: string, tags: readonly string[], verbs: readonly string[], k: Known) =>
  tags.flatMap((t) => verbs.map((v) => [`${file} ${t} ${v}`, { cls: k.cls, kind: k.kind, calls: k.calls, note: k.note, ...(k.as !== undefined && { as: k.as }) }] as const));

export const NOT_IN_TREE = 'not in the tree';
export const NO_CLOSE_IT_FIRST = 'refused without "close it first"';
export const twice = (swipe: string) => [swipe, swipe];
/** idb's scroll_until stroke on a 402x874 screen: from 80 % to 20 % of it. */
export const IDB_STROKE = 'idb ui swipe 201 699 201 175 --duration 0.3';
/** The same stroke above the keyboard (its top at y 573): touching down at 472. */
export const IDB_STROKE_ABOVE_KEYBOARD = 'idb ui swipe 201 472 201 118 --duration 0.3';
export const ADB_STROKE = 'adb shell input swipe 540 1776 540 444 1334';
