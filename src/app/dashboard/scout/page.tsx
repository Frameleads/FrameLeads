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
  const profile = await prisma.iCPProfile.findUnique({ where: { userId: user.id }, select: {
    isActive: true, targetTitles: true, targetSeniorities: true, targetIndustries: true, targetGeographies: true,
    excludedTitles: true, excludedIndustries: true, excludedDomains: true, requiredKeywords: true,
    excludedKeywords: true, companySizeMin: true, companySizeMax: true,
  } });
  const profileState = !profile ? 'missing' : !profile.isActive ? 'inactive' :
    !([profile.targetTitles, profile.targetSeniorities, profile.targetIndustries, profile.targetGeographies,
      profile.excludedTitles, profile.excludedIndustries, profile.excludedDomains, profile.requiredKeywords,
      profile.excludedKeywords].some(values => values.length > 0) || profile.companySizeMin !== null || profile.companySizeMax !== null)
      ? 'incomplete' : 'ready';
  return <CorePaywall userTier={tier} featureName="Scout"><ScoutWorkspace prospects={prospects} profileState={profileState} /></CorePaywall>;
}
