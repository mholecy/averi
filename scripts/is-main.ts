import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at `importMetaUrl` (its `import.meta.url`) is the script node was started with — every script's
 * entry guard: `if (isMain(import.meta.url)) …`.
 *
 * Real paths on both sides: node resolves symlinks in import.meta.url but not in process.argv[1], so through a symlink
 * (/tmp → /private/tmp on macOS, a symlinked checkout) a plain comparison is false, and the script exits 0 having done
 * nothing — a gate that passes idle (D46). The URL is decoded, never compared as text: a path with a space or non-ASCII
 * is percent-encoded in it. No argv[1] (a REPL, `node -e`), or one that does not resolve: false.
 */
export function isMain(importMetaUrl: string): boolean {
  const started = process.argv[1];
  if (started === undefined) return false;
  try {
    return realpathSync(started) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
