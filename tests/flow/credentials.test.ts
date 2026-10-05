import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import { resolveCredentials } from '../../src/flow/credentials.js';

/**
 * flow/credentials.ts: config + environment + requested name → frozen
 * credentials. The environment is a plain object here — the module reads no
 * `process.env`, so nothing is set up or scrubbed (2026-10-04, C2; the tests
 * these replace lived in config.test.ts and set `process.env.AVERI_ENV`).
 */

const MULTI_ENV = `
app:
  ios: { bundleId: md.bank.app }
credentials:
  username: \${AVERI_BANK_USERNAME}
  pin: \${AVERI_BANK_PIN}
environments:
  alfons_dev:
    credentials:
      username: \${AVERI_ALFONS_USERNAME}
  starterkit:
    credentials:
      username: \${AVERI_STARTERKIT_USERNAME}
flows:
  login:
    steps:
      - type_pin: { value: $pin }
`;

describe('resolveCredentials', () => {
  const cfg = () => parseConfig(MULTI_ENV);
  const ENV = {
    AVERI_BANK_USERNAME: 'bank.user',
    AVERI_BANK_PIN: '1234',
    AVERI_ALFONS_USERNAME: 'martha.key',
    AVERI_STARTERKIT_USERNAME: 'starter.user',
  };

  it('returns base credentials when no environment is selected', () => {
    const r = resolveCredentials(cfg(), ENV);
    expect(r.environment).toBeUndefined();
    expect(r.resolve('$username')).toEqual({ value: 'bank.user', secret: true });
  });

  it('overlays only the keys the environment declares, inheriting the rest', () => {
    const r = resolveCredentials(cfg(), ENV, 'starterkit');
    expect(r.environment).toBe('starterkit');
    expect(r.resolve('$username').value).toBe('starter.user');
    // the shared secret is NOT repeated per environment and must still resolve
    expect(r.resolve('$pin').value).toBe('1234');
  });

  it('prefers the explicit request over AVERI_ENV', () => {
    expect(resolveCredentials(cfg(), { ...ENV, AVERI_ENV: 'alfons_dev' }, 'starterkit').environment).toBe('starterkit');
  });

  it('falls back to AVERI_ENV — read from the environment handed in, never from the process — then to defaultEnvironment', () => {
    expect(resolveCredentials(cfg(), { ...ENV, AVERI_ENV: 'starterkit' }).environment).toBe('starterkit');

    const withDefault = parseConfig(MULTI_ENV.replace('environments:', 'defaultEnvironment: alfons_dev\nenvironments:'));
    expect(resolveCredentials(withDefault, ENV).environment).toBe('alfons_dev');
  });

  it('names the source when the environment is unknown — the mix-up must not be silent', () => {
    expect(() => resolveCredentials(cfg(), ENV, 'nope')).toThrow(/Unknown environment "nope" \(from requested\)/);
    expect(() => resolveCredentials(cfg(), { ...ENV, AVERI_ENV: 'nope' })).toThrow(/from AVERI_ENV/);
  });

  it('rejects a defaultEnvironment that is not declared', () => {
    expect(() => parseConfig(MULTI_ENV.replace('environments:', 'defaultEnvironment: typo\nenvironments:'))).toThrow(
      /defaultEnvironment "typo" is not declared/,
    );
  });

  it('names exactly the credentials the environment overrides, in declaration order; none on base only', () => {
    expect(resolveCredentials(cfg(), ENV).overriddenNames).toEqual([]);
    expect(resolveCredentials(cfg(), ENV, 'starterkit').overriddenNames).toEqual(['username']);
    // frozen like the rest: the engine's trace line reads it, nothing may edit it
    expect(Object.isFrozen(resolveCredentials(cfg(), ENV, 'starterkit').overriddenNames)).toBe(true);
  });

  it('is frozen: a run cannot swap credentials under itself', () => {
    expect(Object.isFrozen(resolveCredentials(cfg(), ENV))).toBe(true);
  });
});

describe('Credentials.resolve — $name, ${VAR}, plain', () => {
  const cfg = parseConfig(MULTI_ENV);
  const ENV = { AVERI_BANK_USERNAME: 'bank.user', AVERI_BANK_PIN: '1234' };

  it('a plain string passes through and is not a secret', () => {
    expect(resolveCredentials(cfg, ENV).resolve('Continue')).toEqual({ value: 'Continue', secret: false });
  });

  it('a bare ${VAR} expands from the environment and is a secret', () => {
    expect(resolveCredentials(cfg, { ...ENV, TOKEN: 't0k' }).resolve('Bearer ${TOKEN}')).toEqual({
      value: 'Bearer t0k',
      secret: true,
    });
  });

  it('an undeclared credential names where to declare it — base only, or the environment too', () => {
    expect(() => resolveCredentials(cfg, ENV).resolve('$nonexistent')).toThrow(
      'Unknown credential "$nonexistent" — declare it under credentials:',
    );
    expect(() => resolveCredentials(cfg, ENV, 'starterkit').resolve('$nonexistent')).toThrow(
      'Unknown credential "$nonexistent" — declare it under credentials: or environments.starterkit.credentials',
    );
  });

  it('an unset variable names the variable, the credential and the environment, and says where to set it', () => {
    expect(() => resolveCredentials(cfg, ENV).resolve('${AVERI_TEST_MISSING}')).toThrow(
      'Environment variable AVERI_TEST_MISSING is not set — set it in .env.averi beside averi.yaml, or export it, and retry',
    );
    expect(() => resolveCredentials(cfg, ENV, 'starterkit').resolve('$username')).toThrow(
      'Environment variable AVERI_STARTERKIT_USERNAME is not set (needed for credential "username" in environment "starterkit") — set it in .env.averi beside averi.yaml, or export it, and retry',
    );
  });

  it('expansion is lazy: a declared credential whose variable is unset fails only the step that uses it', () => {
    const creds = resolveCredentials(cfg, { AVERI_BANK_USERNAME: 'bank.user' }); // no pin
    expect(creds.resolve('$username').value).toBe('bank.user');
    expect(() => creds.resolve('$pin')).toThrow(/AVERI_BANK_PIN is not set/);
  });
});
