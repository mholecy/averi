import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isMain } from '../is-main.js';

/**
 * A log made fit for the release record (docs/release.md, Gate D): every host path replaced by a label — the checkout
 * by `<repo>`, the temporary folder by `<tmp>`, home by `~`, each as given and as resolved (/tmp → /private/tmp on
 * macOS), and any `<path>=<label>` the caller adds (the run's `--out` as `<out>`). docs/ is held to no host path
 * (tests/docs/path-hygiene.test.ts), so a log committed under docs/releases/ must pass through this first.
 *
 *   node --import tsx scripts/release/clean-log.ts [<path>=<label> …] < raw.txt > name.log.txt
 */

export type Sub = readonly [path: string, label: string];

/** `text` with each path replaced by its label, the longest path first; an empty or root path is skipped. */
export function scrub(text: string, subs: readonly Sub[]): string {
  return [...subs]
    .filter(([p]) => p.length > 1)
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((s, [p, label]) => s.split(p).join(label), text);
}

const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** The host's paths and their labels: the checkout, the temporary folder, home (each resolved too), then `extra`. */
export function hostPaths(host: { repo: string; tmp: string; home: string; real: (p: string) => string }, extra: readonly Sub[]): Sub[] {
  const both = (p: string, label: string): Sub[] => {
    const given = trim(p);
    const resolved = trim(host.real(given));
    return resolved === given ? [[given, label]] : [[given, label], [resolved, label]];
  };
  return [...both(host.repo, '<repo>'), ...both(host.tmp, '<tmp>'), ...both(host.home, '~'), ...extra.flatMap(([p, label]) => both(p, label))];
}

/** The caller's `<path>=<label>` arguments, split at the last `=`; one with no path before it throws. */
export function subsOf(argv: readonly string[]): Sub[] {
  return argv.map((a): Sub => {
    const at = a.lastIndexOf('=');
    if (at <= 0) throw new Error(`clean-log: <path>=<label>, not "${a}"`);
    return [a.slice(0, at), a.slice(at + 1)];
  });
}

if (isMain(import.meta.url)) {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const subs = hostPaths({ repo: fileURLToPath(new URL('../..', import.meta.url)), tmp: tmpdir(), home: homedir(), real }, subsOf(process.argv.slice(2)));
  process.stdout.write(scrub(Buffer.concat(chunks).toString('utf8'), subs));
}
