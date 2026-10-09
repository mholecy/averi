/**
 * Reading `xcrun simctl appinfo` — split out of ios-foreground.ts on review
 * (2026-10-09): parsing an old-style plist is its own concern, apart from
 * the foreground wait that uses the names and IosAdapter that runs the
 * command (and caches the answer per bundle).
 */

/**
 * The names an app's Application element may carry, from `xcrun simctl
 * appinfo <udid> <bundle>`: CFBundleDisplayName, then CFBundleName — the
 * home-screen name falls back to the latter when the former is absent, and
 * accepting both costs nothing. The output is an old-style (OpenStep) plist:
 *
 *     {
 *         CFBundleDisplayName = "Skeleton Internal";
 *         CFBundleName = Skeleton;
 *         Extensions = { …; CFBundleName = WidgetExt; … };
 *     }
 *
 * Only TOP-LEVEL keys count (topLevelEntries): a nested dictionary — an
 * extension's, a group container map — may carry the same keys for
 * something else. Values are quoted when they have spaces or punctuation,
 * bare otherwise; inside quotes `\"`, `\\`, `\n`, `\t` and `\Uxxxx`
 * (non-ASCII) escapes are decoded. An octal escape (`\341`, a raw byte) is
 * NOT decoded — not seen in simctl's output; a name carrying one would not
 * match, and the foreground wait's note (ios-foreground.ts) says so. Parsed
 * here rather than through `plutil` to keep the lookup one exec. Neither
 * key → `[]`.
 */
export function appInfoNames(stdout: string): string[] {
  const entries = topLevelEntries(stdout);
  const names: string[] = [];
  for (const key of ['CFBundleDisplayName', 'CFBundleName']) {
    const value = entries.get(key);
    if (value === undefined || value.startsWith('{') || value.startsWith('(')) continue;
    const name = unquote(value).trim();
    if (name !== '' && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * `key = value;` statements of the outermost dictionary, raw values. A
 * character walk that tracks quotes (a `;` or brace inside a string is
 * text) and brace depth (a nested dictionary's statements are not the
 * top level's; its closing `};` ends the statement that holds it).
 */
function topLevelEntries(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  let depth = 0;
  let inQuote = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '\\') i++;
      else if (c === '"') inQuote = false;
      continue;
    }
    if (c === '"') inQuote = true;
    else if (c === '{') {
      depth++;
      if (depth === 1) start = i + 1;
    } else if (c === '}') depth--;
    else if (c === ';' && depth === 1) {
      const m = /^\s*("(?:[^"\\]|\\.)*"|[^\s=]+)\s*=\s*([\s\S]*?)\s*$/.exec(text.slice(start, i));
      if (m !== null && !entries.has(unquote(m[1]))) entries.set(unquote(m[1]), m[2]);
      start = i + 1;
    }
  }
  return entries;
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  return value.slice(1, -1).replace(/\\(U[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
  });
}
