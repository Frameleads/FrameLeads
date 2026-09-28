import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getBrainKnowledge, rebuildBrainFromCanonicalSources } from '@/lib/brain';
import BrainEditor from './BrainEditor';

export const dynamic = 'force-dynamic';
export default async function BrainPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  await rebuildBrainFromCanonicalSources(user.id);
  const [brain, entries] = await Promise.all([
    prisma.frameLeadsBrain.findUnique({ where: { userId: user.id }, select: { revision: true, compactSummary: true } }),
    getBrainKnowledge({ userId: user.id, take: 100 }),
  ]);
  return <BrainEditor initial={{ revision: brain?.revision ?? 0, compactSummary: brain?.compactSummary ?? '',
    entries: entries.map(entry => ({ id: entry.id, category: entry.category, key: entry.key, value: entry.value,
      sourceType: entry.sourceType, verification: entry.verification, importance: entry.importance })) }} />;
}
