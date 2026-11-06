import { ExecError } from './exec.js';
import { linkScheme } from './ios-url-schemes.js';

/** What `simctl openurl` prints when no app on the simulator takes the link's scheme, exit 115 (backlog D65: batch-4, batch-9, batch-13; `nosuch://` on 2026-10-07). */
const NO_HANDLER = /\(domain=LSApplicationWorkspaceErrorDomain, code=115\)/;

/**
 * No app on this simulator handles the link's scheme: a thrown fact, not an `AppHolder` answer. The link did not open and
 * nothing holds it, so the call must still fail (a flow's step too), where every AppHolder answer is a link that went out
 * (ADR 0043). Worded here as thrown errors are (app-holder-text.ts's header): `message` is what the MCP SDK and the flow
 * engine's guard quote, and neither may ask an adapter's type.
 */
export class NoLinkHandlerError extends Error {
  constructor(
    readonly scheme: string,
    cause: ExecError,
  ) {
    super(
      `No app on this simulator handles ${scheme}: links, so nothing opened (simctl openurl: LSApplicationWorkspaceErrorDomain, code 115). ` +
        "A link to an app's own scheme needs that app installed.",
      { cause },
    );
    this.name = 'NoLinkHandlerError';
  }
}

/** The fact in what `simctl openurl <url>` threw, or undefined for any other failure. */
export function noLinkHandler(thrown: unknown, url: string): NoLinkHandlerError | undefined {
  if (!(thrown instanceof ExecError) || !NO_HANDLER.test(thrown.stderr)) return undefined;
  const scheme = linkScheme(url);
  return scheme === undefined ? undefined : new NoLinkHandlerError(scheme, thrown);
}
