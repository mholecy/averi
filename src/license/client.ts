import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { importJWK, jwtVerify, type JWTPayload } from 'jose';

/**
 * License client (ARCHITECTURE.md §6): exchange AVERI_API_KEY for a signed
 * ~24h JWT, cache it, degrade gracefully offline (7-day grace past expiry),
 * hard fail only beyond grace. Without an API key the server runs in dev
 * mode — pre-launch behavior; flips to hard-require at GA.
 */

export type Plan = 'solo' | 'team' | 'ci' | 'dev';

export interface Entitlements {
  plan: Plan;
  features: Set<string>;
  customer?: string;
  /** Token expiry; undefined in dev mode. */
  validUntil?: Date;
  /** True when running on a cached token past exp but within grace. */
  stale?: boolean;
}

const PLAN_FEATURES: Record<Plan, string[]> = {
  solo: ['core'],
  team: ['core', 'parallel_verify', 'baselines'],
  ci: ['core', 'parallel_verify', 'baselines', 'headless'],
  dev: ['core', 'parallel_verify', 'baselines', 'headless'],
};

export const DEFAULT_SERVICE_URL = 'https://api.averi.dev';
const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Production token-verification key (public half; the private key lives in
 * the license service). PLACEHOLDER until the service is provisioned —
 * regenerate and pin before GA.
 */
const PROD_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'placeholder-provision-before-ga_______________',
  y: 'placeholder-provision-before-ga_______________',
};

export interface LicenseOptions {
  apiKey?: string;
  serviceUrl?: string;
  cachePath?: string;
  /** Verification key override (tests). */
  publicJwk?: object;
  now?: () => number;
  graceMs?: number;
}

export async function acquireLicense(opts: LicenseOptions = {}): Promise<Entitlements> {
  const apiKey = opts.apiKey ?? process.env.AVERI_API_KEY;
  if (!apiKey) {
    return { plan: 'dev', features: new Set(PLAN_FEATURES.dev) };
  }

  const serviceUrl = opts.serviceUrl ?? process.env.AVERI_LICENSE_URL ?? DEFAULT_SERVICE_URL;
  const cachePath = opts.cachePath ?? join(homedir(), '.averi', 'license.json');
  const now = opts.now ?? Date.now;
  const graceMs = opts.graceMs ?? GRACE_MS;
  const key = await importJWK(opts.publicJwk ?? PROD_PUBLIC_JWK, 'ES256');

  let exchangeError: Error | undefined;
  try {
    const token = await exchange(serviceUrl, apiKey);
    const payload = await verify(token, key, now, 0);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify({ token, fetchedAt: now() }));
    return toEntitlements(payload, false);
  } catch (e) {
    if (e instanceof InvalidKeyError) throw e; // rejected key ≠ offline; no cache fallback
    exchangeError = e instanceof Error ? e : new Error(String(e));
  }

  // Offline / service unavailable: fall back to the cached token.
  let cached: { token: string } | undefined;
  try {
    cached = JSON.parse(await readFile(cachePath, 'utf8'));
  } catch {
    throw new Error(
      `License check failed and no cached license exists: ${exchangeError.message}`,
    );
  }
  const payload = await verify(cached!.token, key, now, graceMs);
  const expMs = (payload.exp ?? 0) * 1000;
  const stale = expMs < now();
  return toEntitlements(payload, stale);
}

async function exchange(serviceUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${serviceUrl}/v1/license/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new InvalidKeyError(`License service rejected the API key (${res.status})`);
    }
    throw new Error(`License service error: ${res.status}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('License service returned no token');
  return body.token;
}

/** An explicitly rejected key must never fall back to a cached token. */
export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

async function verify(
  token: string,
  key: Awaited<ReturnType<typeof importJWK>>,
  now: () => number,
  graceMs: number,
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, key, {
      currentDate: new Date(now()),
      clockTolerance: Math.ceil(graceMs / 1000),
    });
    return payload;
  } catch (e) {
    const reason = e instanceof Error && e.message.includes('exp')
      ? `license expired more than the ${Math.round(graceMs / 86_400_000)}-day grace period ago — renew your subscription`
      : `license token invalid: ${e instanceof Error ? e.message : String(e)}`;
    throw new Error(reason);
  }
}

function toEntitlements(payload: JWTPayload, stale: boolean): Entitlements {
  const plan = (payload.plan as Plan) ?? 'solo';
  const features = new Set(
    Array.isArray(payload.features) && payload.features.length > 0
      ? (payload.features as string[])
      : PLAN_FEATURES[plan] ?? PLAN_FEATURES.solo,
  );
  return {
    plan,
    features,
    customer: payload.sub,
    validUntil: payload.exp ? new Date(payload.exp * 1000) : undefined,
    ...(stale ? { stale: true } : {}),
  };
}
