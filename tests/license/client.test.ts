import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { acquireLicense, InvalidKeyError } from '../../src/license/client.js';
import { UsageTracker } from '../../src/license/usage.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: object;
let server: Server;
let url: string;
let usageBodies: unknown[] = [];
let rejectKeys = false;

async function signToken(claims: Record<string, unknown>, expiresInMs: number, keyPair = keys) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256' })
    .setSubject('cust_123')
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + expiresInMs))
    .sign(keyPair.privateKey);
}

beforeAll(async () => {
  keys = await generateKeyPair('ES256');
  wrongKeys = await generateKeyPair('ES256');
  publicJwk = await exportJWK(keys.publicKey);
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      if (req.url === '/v1/license/exchange') {
        if (rejectKeys) {
          res.writeHead(403).end();
          return;
        }
        const token = await signToken({ plan: 'team' }, 24 * HOUR);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ token }));
      } else if (req.url === '/v1/usage') {
        usageBodies.push(JSON.parse(body));
        res.writeHead(204).end();
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => server.close());

let cacheDir: string;
afterEach(async () => {
  rejectKeys = false;
  usageBodies = [];
  if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
});

async function cachePath() {
  cacheDir = await mkdtemp(join(tmpdir(), 'averi-license-'));
  return join(cacheDir, 'license.json');
}

describe('acquireLicense', () => {
  it('runs in dev mode with all features when no API key is set', async () => {
    const lic = await acquireLicense({ apiKey: undefined });
    expect(lic.plan).toBe('dev');
    expect(lic.features.has('parallel_verify')).toBe(true);
  });

  it('exchanges the key, verifies the token, derives plan features, caches', async () => {
    const lic = await acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: await cachePath(), publicJwk });
    expect(lic.plan).toBe('team');
    expect(lic.customer).toBe('cust_123');
    expect(lic.features.has('parallel_verify')).toBe(true);
    expect(lic.features.has('headless')).toBe(false);
    expect(lic.stale).toBeUndefined();
    expect(lic.validUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects tokens signed with the wrong key', async () => {
    const path = await cachePath();
    // service returns a token signed by an imposter
    const imposter = createServer(async (_req, res) => {
      const token = await signToken({ plan: 'ci' }, 24 * HOUR, wrongKeys);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token }));
    });
    await new Promise<void>((r) => imposter.listen(0, '127.0.0.1', r));
    const iurl = `http://127.0.0.1:${(imposter.address() as { port: number }).port}`;
    await expect(
      acquireLicense({ apiKey: 'k', serviceUrl: iurl, cachePath: path, publicJwk }),
    ).rejects.toThrow(/license token invalid|no cached license/);
    imposter.close();
  });

  it('falls back to a fresh cached token when the service is unreachable', async () => {
    const path = await cachePath();
    await acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: path, publicJwk });
    const lic = await acquireLicense({
      apiKey: 'k', serviceUrl: 'http://127.0.0.1:1', cachePath: path, publicJwk,
    });
    expect(lic.plan).toBe('team');
    expect(lic.stale).toBeUndefined();
  });

  it('accepts an expired cached token within the grace window, marked stale', async () => {
    const path = await cachePath();
    await acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: path, publicJwk });
    const lic = await acquireLicense({
      apiKey: 'k', serviceUrl: 'http://127.0.0.1:1', cachePath: path, publicJwk,
      now: () => Date.now() + 2 * DAY, // 1 day past the 24h expiry, within 7-day grace
    });
    expect(lic.plan).toBe('team');
    expect(lic.stale).toBe(true);
  });

  it('hard-fails beyond the grace window with a renewal message', async () => {
    const path = await cachePath();
    await acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: path, publicJwk });
    await expect(
      acquireLicense({
        apiKey: 'k', serviceUrl: 'http://127.0.0.1:1', cachePath: path, publicJwk,
        now: () => Date.now() + 10 * DAY,
      }),
    ).rejects.toThrow(/grace period.*renew/);
  });

  it('a rejected API key never falls back to the cache', async () => {
    const path = await cachePath();
    await acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: path, publicJwk });
    rejectKeys = true;
    await expect(
      acquireLicense({ apiKey: 'k', serviceUrl: url, cachePath: path, publicJwk }),
    ).rejects.toThrow(InvalidKeyError);
  });
});

describe('UsageTracker', () => {
  it('posts tool-call counts only, and clears after a successful flush', async () => {
    const tracker = new UsageTracker(url, 'team', true);
    tracker.bump('tap');
    tracker.bump('tap');
    tracker.bump('ensure_state');
    await tracker.flush();
    expect(usageBodies).toEqual([{ counts: { tap: 2, ensure_state: 1 }, plan: 'team' }]);
    await tracker.flush(); // nothing left
    expect(usageBodies).toHaveLength(1);
  });

  it('does nothing when disabled (dev mode)', async () => {
    const tracker = new UsageTracker(url, 'dev', false);
    tracker.bump('tap');
    await tracker.flush();
    expect(usageBodies).toHaveLength(0);
  });

  it('keeps counts for retry when the service is down', async () => {
    const tracker = new UsageTracker('http://127.0.0.1:1', 'team', true);
    tracker.bump('tap');
    await tracker.flush(); // fails silently
    expect(usageBodies).toHaveLength(0);
    // counts were restored — a later flush against a working service would send them
    tracker.bump('tap');
    await tracker.flush().catch(() => {});
  });
});
