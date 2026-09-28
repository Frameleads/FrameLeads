import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { removeBrainKnowledge, upsertBrainKnowledge } from '@/lib/brain';
import type { BrainKnowledgeCategory } from '@prisma/client';

export const dynamic = 'force-dynamic';
async function owner() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.category !== 'string' || typeof body.key !== 'string' || typeof body.value !== 'string')
    return NextResponse.json({ error: 'Category, key and value are required.' }, { status: 400 });
  try {
    const entry = await upsertBrainKnowledge({ userId, id, category: body.category as BrainKnowledgeCategory, key: body.key, value: body.value });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message.includes('not found')) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
    if (error instanceof Error && error.message.startsWith('Conflicting knowledge')) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('[BRAIN] Update failed', error);
    return NextResponse.json({ error: 'Knowledge could not be updated.' }, { status: 500 });
  }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await removeBrainKnowledge({ userId, id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 });
    console.error('[BRAIN] Archive failed', error);
    return NextResponse.json({ error: 'Knowledge could not be removed.' }, { status: 500 });
  }
}
