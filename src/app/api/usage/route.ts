import { NextResponse } from 'next/server';
import { verifiedCustomerUser } from '@/lib/customer-session';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { getAuthenticatedUsage } from '@/lib/allowance-context';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET() {
  const user = await verifiedCustomerUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  try {
    const counters = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { leadsProcessed: true, microPilotOutboundUsed: true } });
    const tier = await getUserEntitlementTier(user.id);
    return NextResponse.json(await getAuthenticatedUsage(user.id, tier, counters), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Allowance could not be verified. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
