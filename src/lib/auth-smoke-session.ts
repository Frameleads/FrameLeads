import { createHmac, timingSafeEqual } from 'node:crypto';

export const AUTH_SMOKE_SESSION_PREFIX = 'frameleads-smoke-v1';
const AUDIENCE = 'frameleads-local-auth-smoke';
const MAX_LIFETIME_SECONDS = 15 * 60;

function localSmokeModeAllowed() {
  return process.env.NODE_ENV === 'development' && process.env.VERCEL !== '1' && !process.env.VERCEL_ENV;
}

export function createAuthSmokeSession(userId: string, secret: string, now = Date.now()) {
  if (!localSmokeModeAllowed() || secret.length < 32 || !/^c[a-z0-9]{10,30}$/i.test(userId)) {
    throw new Error('AUTH_SMOKE_SESSION_DISABLED');
  }
  const payload = Buffer.from(JSON.stringify({ aud: AUDIENCE, sub: userId, exp: Math.floor(now / 1000) + MAX_LIFETIME_SECONDS })).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${AUTH_SMOKE_SESSION_PREFIX}.${payload}`).digest('base64url');
  return `${AUTH_SMOKE_SESSION_PREFIX}.${payload}.${signature}`;
}

export function isAuthSmokeSessionToken(token: string) {
  return token.startsWith(`${AUTH_SMOKE_SESSION_PREFIX}.`);
}

export function verifyAuthSmokeSession(token: string, secret: string | undefined, now = Date.now()) {
  if (!localSmokeModeAllowed() || !secret || secret.length < 32) return null;
  const [prefix, payload, signature, extra] = token.split('.');
  if (prefix !== AUTH_SMOKE_SESSION_PREFIX || !payload || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(`${AUTH_SMOKE_SESSION_PREFIX}.${payload}`).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.aud !== AUDIENCE || typeof claims.sub !== 'string' || !/^c[a-z0-9]{10,30}$/i.test(claims.sub)) return null;
    if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)
      || claims.exp > Math.floor(now / 1000) + MAX_LIFETIME_SECONDS) return null;
    return claims.sub as string;
  } catch { return null; }
}
