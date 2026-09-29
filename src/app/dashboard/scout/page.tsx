export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { listScoutProspects, resolveScoutUser } from '@/lib/scout-data';
import ScoutWorkspace from './ScoutWorkspace';
import CorePaywall from '@/components/CorePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

export default async function ScoutPage() {
  const cookieStore = await cookies();
  const user = await resolveScoutUser(
    prisma,
    cookieStore.get('frameleads_session')?.value,
    cookieStore.get('user_email')?.value,
  );
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  if (!hasFeatureAccess(tier, 'SCOUT')) {
    return <CorePaywall userTier={tier} featureName="Scout"><div aria-hidden="true"><ScoutWorkspace prospects={[]} /></div></CorePaywall>;
  }
  const prospects = await listScoutProspects(prisma, user.id);
  return <CorePaywall userTier={tier} featureName="Scout"><ScoutWorkspace prospects={prospects} /></CorePaywall>;
}
