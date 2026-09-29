export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getScoutProspect, resolveScoutUser } from '@/lib/scout-data';
import ScoutDetail from '../ScoutDetail';
import { getProspectMemoryContext } from '@/lib/prospects/memory';
import CorePaywall from '@/components/CorePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import type { ScoutProspectDetail } from '@/lib/scout-data';
import { hasFeatureAccess } from '@/lib/entitlements';

export default async function ScoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const user = await resolveScoutUser(
    prisma,
    cookieStore.get('frameleads_session')?.value,
    cookieStore.get('user_email')?.value,
  );
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  if (!hasFeatureAccess(tier, 'SCOUT')) {
    const emptyProspect: ScoutProspectDetail = { id: '', name: 'Prospect', companyName: 'Company', websiteUrl: null,
      email: null, jobTitle: null, industry: null, country: null, location: null, companySizeMin: null,
      companySizeMax: null, qualification: null, intelligence: null };
    return <CorePaywall userTier={tier} featureName="Scout"><div aria-hidden="true"><ScoutDetail prospect={emptyProspect} /></div></CorePaywall>;
  }
  const { id } = await params;
  const prospect = await getScoutProspect(prisma, user.id, id);
  if (!prospect) notFound();
  const memory = await getProspectMemoryContext({ userId: user.id, prospectId: id, purpose: 'SCOUT', maxEvents: 6 }, prisma);
  return <CorePaywall userTier={tier} featureName="Scout"><><ScoutDetail prospect={prospect} /><section aria-labelledby="prospect-memory-heading" className="mx-auto mt-6 max-w-7xl rounded-2xl border border-border/60 bg-card/50 p-5 sm:p-6"><h2 id="prospect-memory-heading" className="text-sm font-semibold uppercase tracking-[0.14em]">Prospect memory</h2><p className="mt-2 text-xs text-muted-foreground">Recent recorded activity for this prospect.</p>{memory.events.length ? <ol className="mt-4 space-y-3">{memory.events.map(event => <li key={event.id} className="border-l-2 border-border pl-3 text-sm"><span className="font-medium">{event.eventType.replaceAll('_', ' ')}</span><span className="ml-2 text-muted-foreground">{event.description}</span><time className="ml-2 text-xs text-muted-foreground" dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleDateString()}</time></li>)}</ol> : <p className="mt-4 text-sm text-muted-foreground">No activity recorded yet.</p>}</section></></CorePaywall>;
}
