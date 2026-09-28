import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import ICPSettings from './ICPSettings';

export const dynamic = 'force-dynamic';

export default async function ScoutSettingsPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const profile = await prisma.iCPProfile.findUnique({ where: { userId: user.id } });
  return <ICPSettings initial={profile ? {
    name: profile.name, isActive: profile.isActive, qualificationPolicy: profile.qualificationPolicy,
    targetTitles: profile.targetTitles, targetSeniorities: profile.targetSeniorities,
    targetIndustries: profile.targetIndustries, targetGeographies: profile.targetGeographies,
    excludedTitles: profile.excludedTitles, excludedIndustries: profile.excludedIndustries,
    excludedDomains: profile.excludedDomains, requiredKeywords: profile.requiredKeywords,
    excludedKeywords: profile.excludedKeywords, companySizeMin: profile.companySizeMin,
    companySizeMax: profile.companySizeMax,
  } : null} />;
}
