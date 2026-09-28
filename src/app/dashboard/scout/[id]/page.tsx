export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getScoutProspect, resolveScoutUser } from '@/lib/scout-data';
import ScoutDetail from '../ScoutDetail';

export default async function ScoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const user = await resolveScoutUser(
    prisma,
    cookieStore.get('frameleads_session')?.value,
    cookieStore.get('user_email')?.value,
  );
  if (!user) redirect('/login');
  const { id } = await params;
  const prospect = await getScoutProspect(prisma, user.id, id);
  if (!prospect) notFound();
  return <ScoutDetail prospect={prospect} />;
}
