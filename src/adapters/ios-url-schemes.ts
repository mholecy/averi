/**
 * Which app a deep link names (D49a, 2026-11-02; ADR 0032's D49a amendment): the URL's scheme, and the schemes an
 * app declares in its Info.plist's `CFBundleURLTypes`. `simctl appinfo` and `simctl listapps` carry no URL types
 * (measured on the lab simulator, iOS 27.0); the app's own Info.plist does, read on the host with
 * `plutil -extract CFBundleURLTypes json -o - <Path>/Info.plist` — measured on the lab app:
 *
 *     [{"CFBundleURLName":"dev.averi.lab","CFBundleURLSchemes":["averilab"]}]
 *
 * IosAdapter runs the command (and caches the answer per bundle); this module only reads it.
 */

/**
 * The URL's scheme (RFC 3986: a letter, then letters, digits, `+`, `-`, `.`, up to the first `:`), lower-cased —
 * iOS matches a scheme regardless of case. undefined when the text has none (`home`, `/path`, `:x`).
 */
export function linkScheme(url: string): string | undefined {
  return /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1].toLowerCase();
}

/**
 * Whether a link is a web link: `http` / `https` — a universal link or Safari's, never the project's custom scheme,
 * so the adapter expects no app for it (whether iOS confirms an associated-domain link opened by `simctl openurl` is
 * unmeasured — D49b's device check).
 */
export const isWebScheme = (scheme: string): boolean => scheme === 'http' || scheme === 'https';

/**
 * What `plutil -extract` writes to stderr (exit 1) when the plist has no such key — measured on macOS 26 with a
 * plist holding none: `Info.plist: Could not extract value, error: No value at that key path or invalid key path:
 * CFBundleURLTypes`. An app that declares no URL types: no scheme of its own, not a read failure.
 */
export const NO_SUCH_KEY = /No value at that key path/;

/**
 * The schemes in `plutil -extract CFBundleURLTypes json`'s output, lower-cased: every string in every entry's
 * `CFBundleURLSchemes`. THROWS on any other shape (not JSON, not an array of dictionaries, schemes that are not an
 * array of strings) — an Info.plist this reader was not written for, which the caller says it could not read rather
 * than treating as "declares none". An entry with no `CFBundleURLSchemes` (a URL type naming only a role) adds none.
 */
export function urlSchemes(json: string): string[] {
  const types: unknown = JSON.parse(json);
  if (!Array.isArray(types)) throw new Error('CFBundleURLTypes is not an array');
  const schemes: string[] = [];
  for (const type of types) {
    if (typeof type !== 'object' || type === null || Array.isArray(type)) throw new Error('a CFBundleURLTypes entry is not a dictionary');
    const listed: unknown = (type as Record<string, unknown>).CFBundleURLSchemes;
    if (listed === undefined) continue;
    if (!Array.isArray(listed) || !listed.every((s) => typeof s === 'string')) {
      throw new Error('CFBundleURLSchemes is not an array of strings');
    }
    for (const s of listed) schemes.push(s.toLowerCase());
  }
  return schemes;
}
