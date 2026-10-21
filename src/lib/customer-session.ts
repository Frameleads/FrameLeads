import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { isAuthSmokeSessionToken, verifyAuthSmokeSession } from './auth-smoke-session';

/** A Whop OAuth access token is the only browser credential accepted as identity. */
export async function verifyCustomerSession(token: string | undefined, db = prisma, request = fetch) {
  if (!token || token.length > 4096) return null;
  try {
    const smokeUserId = verifyAuthSmokeSession(token, process.env.AUTH_SMOKE_SESSION_SECRET);
    if (isAuthSmokeSessionToken(token) && !smokeUserId) return null;
    if (smokeUserId) {
      return db.user.findFirst({
        where: { id: smokeUserId, email: { endsWith: '@frameleads.invalid' }, whopId: { startsWith: 'auth-smoke:' } },
        select: { id: true, tier: true, email: true, whopId: true },
      });
    }
    const response = await request('https://api.whop.com/oauth/userinfo', {
      headers: { authorization: 'Bearer ' + token }, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > 8000) return null;
    const profile = JSON.parse(raw);
    const whopId = profile.sub || profile.id || profile.data?.id;
    const email = profile.email || profile.data?.email;
    if (typeof whopId !== 'string' || !whopId || whopId.length > 100 || typeof email !== 'string' || email.length > 254) return null;
    // Whop's verified subject is the canonical principal. The email is profile
    // data only; a browser-supplied email is never consulted for tenant lookup.
    return db.user.findUnique({ where: { whopId }, select: { id: true, tier: true, email: true, whopId: true } });
  } catch { return null; }
}
export async function verifiedCustomerUser(db = prisma) {
  return verifyCustomerSession((await cookies()).get('frameleads_session')?.value, db);
}
