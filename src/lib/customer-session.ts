import { cookies } from 'next/headers';
import { prisma } from './prisma';

/** B6 never treats an arbitrary cookie or browser-supplied email as tenant authority. */
export async function verifyCustomerSession(token: string | undefined, db = prisma, request = fetch) {
  if (!token || token.length > 4096) return null;
  try {
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
    return db.user.findFirst({ where: { whopId, email: email.trim().toLowerCase() }, select: { id: true, tier: true, email: true } });
  } catch { return null; }
}
export async function verifiedCustomerUser() {
  return verifyCustomerSession((await cookies()).get('frameleads_session')?.value);
}
