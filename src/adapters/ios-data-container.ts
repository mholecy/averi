/**
 * `launch_app { clearState: true }` on iOS (A44, ADR 0047): simctl has no `pm clear`, so IosAdapter wipes the app's
 * data container in place (`simctl get_app_container <udid> <bundle> data`) — and leaves it as a fresh install has
 * it, not empty. A fresh container holds the standard folders, empty; an app may write into Documents/ without
 * creating it, and fails (often silently) when the folder is gone. IosAdapter owns the terminate and the container's
 * path, checked here first (isAppDataContainer); this module the files.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeRegExp } from '../util/regex.js';

/** The folders a fresh install's data container holds (Library itself with them), each empty. */
export const FRESH_CONTAINER_DIRS = ['Documents', 'Library/Caches', 'Library/Preferences', 'SystemData', 'tmp'] as const;

/** The container manager's own record of the container (its identity, not the app's data): kept. */
export const CONTAINER_METADATA = '.com.apple.mobile_container_manager.metadata.plist';

/**
 * Whether `path` is one app data container of simulator `udid`: `…/<udid>/data/Containers/Data/Application/<GUID>`, a
 * trailing slash allowed, the UDID compared without case (as APFS compares paths) and literally. Nothing else is
 * wiped: not the folder above, not another simulator's, not a bundle container, not a path with dot segments.
 */
export function isAppDataContainer(path: string, udid: string): boolean {
  // A dot segment inside the path; one at either end is refused by the pattern's own anchors.
  if (/\/\.\.?\//.test(path)) return false;
  return new RegExp(`^/.*/${escapeRegExp(udid)}/data/Containers/Data/Application/[0-9A-Fa-f-]+/?$`, 'i').test(path);
}

/**
 * Everything the app wrote goes — every top-level entry but CONTAINER_METADATA, whole — then FRESH_CONTAINER_DIRS are
 * made again: what is left is a fresh install's layout, whatever the app had made of it. An entry gone between the
 * listing and its removal (the system writing beside the wipe) is no failure.
 */
export async function resetDataContainer(container: string): Promise<void> {
  for (const entry of await readdir(container)) {
    if (entry !== CONTAINER_METADATA) await rm(join(container, entry), { recursive: true, force: true });
  }
  for (const dir of FRESH_CONTAINER_DIRS) await mkdir(join(container, dir), { recursive: true });
}
