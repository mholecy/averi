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
   * `$name` → credentials[name] → `${VAR}` expansion from the env; a bare
   * `${VAR}` expands too; plain strings pass through. Throws SetupError —
   * which aborts the reach ladder rather than escalating it — for an
   * undeclared credential or an unset variable, naming what to declare or set.
   */
  resolve(raw: string): ResolvedValue;
}

/**
 * Pick the credential set for a run: base `credentials:` overlaid per-key with
 * `environments.<name>.credentials`, resolved ONCE so a run cannot type one
 * environment's username and another's password, and so an unknown name fails
 * before the device is touched rather than mid-login.
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
  if (name !== undefined) {
    const known = Object.keys(cfg.environments ?? {});
    const overrides = cfg.environments?.[name];
    if (!overrides) {
      const source =
        requested !== undefined ? 'requested'
        : env.AVERI_ENV !== undefined ? 'AVERI_ENV'
        : 'defaultEnvironment';
      throw new SetupError(
        `Unknown environment "${name}" (from ${source}) — known: ${known.join(', ') || '(none declared)'}`,
      );
    }
    templates = { ...base, ...overrides.credentials };
  }
  const environment = name;

  const expand = (template: string, credential?: string): string =>
    template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, variable: string) => {
      const value = env[variable];
      if (value === undefined) {
        const forWhom =
          credential ?
            ` (needed for credential "${credential}"` +
            `${environment === undefined ? '' : ` in environment "${environment}"`})`
          : '';
        throw new SetupError(
          `Environment variable ${variable} is not set${forWhom} — set it in .env.averi beside averi.yaml, or export it, and retry`,
        );
      }
      return value;
    });

  return Object.freeze({
    environment,
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
        return { value: expand(template, key), secret: true };
      }
      if (raw.includes('${')) return { value: expand(raw), secret: true };
      return { value: raw, secret: false };
    },
  });
}
