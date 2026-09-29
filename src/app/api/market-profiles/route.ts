import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { BUILT_IN_MARKET_PROFILES, listMarketProfiles, saveMarketProfile } from '@/lib/market-messaging';
import { requireFeatureAccess, getAuthenticatedEntitlementUser } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
async function owner() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}
export async function GET() {
  const entitlementError = await requireFeatureAccess('BUILTIN_MARKET_MESSAGING');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const entitlementUser = await getAuthenticatedEntitlementUser();
  try { return NextResponse.json({ profiles: hasFeatureAccess(entitlementUser?.tier, 'CUSTOM_MARKET_PROFILES') ? await listMarketProfiles(userId) : [], builtins: BUILT_IN_MARKET_PROFILES }); }
  catch (error) { console.error('[MARKET PROFILE] Read failed', error); return NextResponse.json({ error: 'Market profiles could not be loaded.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('CUSTOM_MARKET_PROFILES');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try { return NextResponse.json({ profile: await saveMarketProfile({ userId, data: body }) }, { status: 201 }); }
  catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && (error.message.includes('overlap') || error.message.includes('P2034'))) return NextResponse.json({ error: 'An enabled profile already claims one of those countries. Refresh and try again.' }, { status: 409 });
    console.error('[MARKET PROFILE] Create failed', error); return NextResponse.json({ error: 'Market profile could not be saved.' }, { status: 500 });
  }
}
