import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import OutcomeLearningClient from './OutcomeLearningClient';

export const dynamic = 'force-dynamic';
export default async function OutcomeLearningPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  return <OutcomeLearningClient />;
}
