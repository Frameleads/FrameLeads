import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import DecisionSandboxClient from './DecisionSandboxClient';
import EnterprisePaywall from '@/components/EnterprisePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export default async function DecisionSandboxPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  return <EnterprisePaywall userTier={tier} featureName="Decision Sandbox"><DecisionSandboxClient /></EnterprisePaywall>;
}
