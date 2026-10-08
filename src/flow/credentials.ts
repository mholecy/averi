import { SetupError, type AveriConfig } from './config.js';

/**
 * Credentials: which values a flow's `$name` and `${VAR}` stand for.
 *
 * 2026-10-04 (architecture review, C2). Until this date the values travelled
 * through `process.env`: the loader wrote `.env.averi` INTO it (keeping a
 * module-level set of the names it had written, to refresh them), the
 * credential resolver read `AVERI_ENV` out of it, and the engine read every
 * `${VAR}` out of it at STEP time. Three modules shared one hidden global,
 * and the engine's interface silently included an ordering rule nobody's
 * type stated: construct it only after `loadProjectConfig`, never after
 * `parseConfig` or `loadConfig`, or `.env.averi` was skipped and the user was
 * told to create a file they already had. Config tests scrubbed the global by
 * hand with unique variable names.
 *
 * Now the environment is a VALUE. The loader (flow/load.ts) assembles it once
 * — the real process environment over the sibling `.env.averi`, the same
 * precedence as before — and hands it beside the config; this module turns
 * config + environment + the requested environment name into frozen
 * `Credentials`, and `process.env` is read in exactly one function under
 * flow/ (the loader's) and written nowhere. The ordering rule is now a
 * parameter: an engine cannot be built without the environment it resolves
 * from.
 *
 * Expansion stays LAZY, at the step that uses the value, exactly as before:
 * a declared credential whose `${VAR}` is unset fails the run that types it,
 * not every run — an `sms` credential only the OTP flow needs must not fail a
 * plain login. Eager resolution at construction was rejected for that reason.
 */

/**
 * The environment a run sees — the values `${VAR}` expands from. Assembled by
 * the loader, never `process.env` itself; `undefined` marks a name that is
 * not set, as in the real environment.
 */
export type EnvValues = Readonly<Record<string, string | undefined>>;

export interface ResolvedValue {
  value: string;
  /** True when the value came from a credential or a `${VAR}` — register it for redaction. */
  secret: boolean;
}

export interface Credentials {
  /** The environment actually applied, or undefined when running on base only. */
  readonly environment: string | undefined;
  /**
   * The credential NAMES the active environment overrides, in declaration
   * order; empty on base only. Computed where the layering is applied, so the
   * engine's first trace line reads it here instead of re-deriving it from
   * `cfg.environments` (2026-10-05: until then the layering rule had two
   * owners).
   */
  readonly overriddenNames: readonly string[];
  /**
   * `$name` → credentials[name] → `${VAR}` expansion from the env; a bare
   * `${VAR}` expands too; plain strings pass through. Throws SetupError —
   * which aborts the reach ladder rather than escalating it — for an
   * undeclared credential, an unset or EMPTY variable, or a credential
   * declared as "" — a secret is never empty — naming what to declare or
   * set.
   */
  resolve(raw: string): ResolvedValue;
}

/**
 * Pick the credential set for a run: base `credentials:` overlaid per-key with
 * `environments.<name>.credentials`, resolved ONCE so a run cannot type one
 * environment's username and another's password. An unknown name throws here;
 * since 2026-10-05 the run layer calls this as a pre-flight so the refusal
 * lands before any device is touched (run/preflight.ts#refuseUnknownEnvironment),
 * and the engine resolves for itself once more, before any STEP.
 *
 * Precedence, most specific first: explicit `requested` (tool argument) →
 * `AVERI_ENV` (settable from `.env.averi`, so switching backend is one line in
 * an already-gitignored file) → `defaultEnvironment:` → base only.
 *
 * Why this exists: one username for two backends caused an hour's misdiagnosis
 * on 2026-08-06 — the wrong login name is rejected by the bank one screen AFTER
 * it is typed, so an environment mix-up presents as a credentials problem.
 */
export function resolveCredentials(cfg: AveriConfig, env: EnvValues, requested?: string): Credentials {
  const name = requested ?? env.AVERI_ENV ?? cfg.defaultEnvironment;
  const base = cfg.credentials ?? {};
  let templates: Readonly<Record<string, string>> = base;
  let overriddenNames: readonly string[] = [];
  if (name !== undefined) {
    const known = Object.keys(cfg.environments ?? {});
    const environmentEntry = cfg.environments?.[name];
    if (!environmentEntry) {
      const source =
        requested !== undefined ? 'requested'
        : env.AVERI_ENV !== undefined ? 'AVERI_ENV'
        : 'defaultEnvironment';
      throw new SetupError(
        `Unknown environment "${name}" (from ${source}) — known: ${known.join(', ') || '(none declared)'}`,
      );
    }
    templates = { ...base, ...environmentEntry.credentials };
    overriddenNames = Object.freeze(Object.keys(environmentEntry.credentials ?? {}));
  }
  const environment = name;

  // " (needed for credential "x" in environment "y")" — who the refused value
  // was for, empty for a bare `${VAR}` in a step.
  const neededFor = (credential?: string): string =>
    credential ?
      ` (needed for credential "${credential}"` +
      `${environment === undefined ? '' : ` in environment "${environment}"`})`
    : '';

  /**
   * THE rule, one owner: a secret is never empty. Since 2026-10-07 the
   * adapters type "" as a no-op on both platforms, so a step that typed an
   * empty secret would pass — `fill` as `***`, `type_pin` as "0 digits" — and
   * the bank would reject the login one screen later: the 2026-08-06
   * misdiagnosis shape this module exists to prevent.
   *
   * An empty secret has exactly two origins, and each gets the remedy for
   * its origin — one builder each, the pair below and nothing else in averi
   * words this refusal:
   * - emptyVariable: a `${VAR}` that is unset or set but EMPTY (a `PASSWORD=` line in
   *   .env.averi parses to ""). Refused per VARIABLE, even when the text
   *   around it would leave the whole value non-empty (`Bearer ${TOKEN}`):
   *   an empty variable is the misconfiguration either way.
   * - emptyCredential: a credential whose template is itself empty (`credentials:
   *   { password: "" }`), the one way a `$name` can be empty once every
   *   variable in it is non-empty. Until 2026-10-08 this was typed as
   *   nothing and the step passed (after-ios-idb review #4) — the variable
   *   check was the only one, and a literal never meets a variable.
   *
   * Lazy like every other refusal here: at the step that uses the value, not
   * at load — a base `password: ""` that every environment overrides is
   * never typed, and an unused credential must not fail a run that does not
   * need it. A PLAIN step value (`fill: { value: "" }`, `type_text ""`) is
   * not a secret and never comes through here: "clear this field" stays
   * writable.
   */
  const emptyVariable = (variable: string, unset: boolean, credential?: string): SetupError =>
    // An exported variable wins over .env.averi (flow/load.ts#envBeside), so
    // an empty one in the shell or CI shadows a real value in the file: "set
    // it in .env.averi" would then change nothing — say so.
    new SetupError(
      unset ?
        `Environment variable ${variable} is not set${neededFor(credential)} — set it in .env.averi beside averi.yaml, or export it, and retry`
      : `Environment variable ${variable} is set but empty${neededFor(credential)} — give it a value in .env.averi beside averi.yaml, or export it with one; ` +
          'an empty variable exported in the shell or CI shadows the value in .env.averi, so unset it there, and retry',
    );

  const emptyCredential = (credential: string): SetupError => {
    // Name the layer the empty template came from: the remedy is an edit
    // THERE, and an environment that overrides a good base value with ""
    // must not send the reader to the base.
    const declaredUnder =
      environment !== undefined && overriddenNames.includes(credential) ?
        `environments.${environment}.credentials`
      : 'credentials:';
    return new SetupError(
      `Credential "$${credential}" is empty` +
        `${environment === undefined ? '' : ` in environment "${environment}"`} ` +
        `(declared as "" under ${declaredUnder}) — give it a value there ` +
        '(a ${VAR} set in .env.averi keeps the secret out of averi.yaml), and retry',
    );
  };

  const expand = (template: string, credential?: string): string =>
    template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, variable: string) => {
      const value = env[variable];
      if (value === undefined || value === '') throw emptyVariable(variable, value === undefined, credential);
      return value;
    });

  return Object.freeze({
    environment,
    overriddenNames,
    resolve(raw: string): ResolvedValue {
      if (raw.startsWith('$') && !raw.startsWith('${')) {
        const key = raw.slice(1);
        const template = templates[key];
        if (template === undefined) {
          const where =
            environment === undefined ?
              'declare it under credentials:'
            : `declare it under credentials: or environments.${environment}.credentials`;
          throw new SetupError(`Unknown credential "$${key}" — ${where}`);
        }
        // Two facts, two checks: a template that is "" is the author's
        // declaration (refused with the layer to edit); a non-empty template
        // whose expansion is "" cannot happen — expand refuses every empty
        // variable — so it is a plain Error, a bug here, not a config remedy.
        if (template === '') throw emptyCredential(key);
        const value = expand(template, key);
        if (value === '') throw new Error(`Credential "$${key}" expanded to an empty value — a bug in flow/credentials.ts`);
        return { value, secret: true };
      }
      if (raw.includes('${')) return { value: expand(raw), secret: true };
      return { value: raw, secret: false };
    },
  });
}
