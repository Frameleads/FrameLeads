import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getBrainKnowledge } from '@/lib/brain';
import BrainEditor from './BrainEditor';
import CorePaywall from '@/components/CorePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export default async function BrainPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  if (!hasFeatureAccess(tier, 'BRAIN')) {
    return <CorePaywall userTier={tier} featureName="FrameLeads Brain"><div aria-hidden="true"><BrainEditor initial={{ revision: 0, compactSummary: '', entries: [] }} /></div></CorePaywall>;
  }
  const [brain, entries] = await Promise.all([
    prisma.frameLeadsBrain.findUnique({ where: { userId: user.id }, select: { revision: true, compactSummary: true } }),
    getBrainKnowledge({ userId: user.id, take: 100 }),
  ]);
  return <CorePaywall userTier={tier} featureName="FrameLeads Brain"><BrainEditor initial={{ revision: brain?.revision ?? 0, compactSummary: brain?.compactSummary ?? '',
    entries: entries.map(entry => ({ id: entry.id, category: entry.category, key: entry.key, value: entry.value,
      sourceType: entry.sourceType, verification: entry.verification, importance: entry.importance })) }} /></CorePaywall>;
}
