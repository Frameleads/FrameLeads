export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { listScoutProspects, resolveScoutUser } from '@/lib/scout-data';
import ScoutWorkspace from './ScoutWorkspace';

export default async function ScoutPage() {
  const cookieStore = await cookies();
  const user = await resolveScoutUser(
    prisma,
    cookieStore.get('frameleads_session')?.value,
    cookieStore.get('user_email')?.value,
  );
  if (!user) redirect('/login');
  const prospects = await listScoutProspects(prisma, user.id);
  return <ScoutWorkspace prospects={prospects} />;
}
