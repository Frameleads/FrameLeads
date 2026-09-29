import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getBrainKnowledge, rebuildBrainFromCanonicalSources, upsertBrainKnowledge } from '@/lib/brain';
import type { BrainKnowledgeCategory } from '@prisma/client';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
async function owner() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}
export async function GET() {
  const entitlementError = await requireFeatureAccess('BRAIN');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await rebuildBrainFromCanonicalSources(userId);
    const [brain, entries] = await Promise.all([
      prisma.frameLeadsBrain.findUnique({ where: { userId }, select: { revision: true, compactSummary: true } }),
      getBrainKnowledge({ userId, take: 100 }),
    ]);
    return NextResponse.json({ brain, entries });
  } catch (error) {
    console.error('[BRAIN] Read failed', error);
    return NextResponse.json({ error: 'Brain knowledge could not be loaded.' }, { status: 500 });
  }
}
export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('BRAIN');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof body.category !== 'string' || typeof body.key !== 'string' || typeof body.value !== 'string')
    return NextResponse.json({ error: 'Category, key and value are required.' }, { status: 400 });
  try {
    const entry = await upsertBrainKnowledge({ userId, category: body.category as BrainKnowledgeCategory, key: body.key, value: body.value });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message.startsWith('Conflicting knowledge'))
      return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('[BRAIN] Create failed', error);
    return NextResponse.json({ error: 'Knowledge could not be saved.' }, { status: 500 });
  }
}
