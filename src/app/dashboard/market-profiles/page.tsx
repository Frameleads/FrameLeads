import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import MarketProfiles from '../brain/MarketProfiles';
import EnterprisePaywall from '@/components/EnterprisePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export default async function MarketProfilesPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  return <EnterprisePaywall userTier={tier} featureName="Custom Market Profiles"><main className="mx-auto w-full max-w-[1680px] space-y-6 py-6">
    <header><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Communication context</p>
      <h1 className="mt-1 text-2xl font-semibold">Market Profiles</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Adapt email presentation by prospect market while preserving your Brain, Playbook, and governance.</p>
      <p className="mt-1 text-xs text-muted-foreground">Communication preference only — not a legal-permission engine.</p></header>
    <MarketProfiles />
  </main></EnterprisePaywall>;
}
