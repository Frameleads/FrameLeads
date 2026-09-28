import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { ProspectIntelligenceNotFound } from '@/lib/prospects/intelligence';
import { qualifyProspect, qualifyProspectsBatch } from '@/lib/prospects/qualification';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.prospectId !== undefined && (typeof body.prospectId !== 'string' || !body.prospectId.trim() || body.prospectId.length > 128) || body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 128)) {
    return NextResponse.json({ error: 'Invalid qualification request.' }, { status: 400 });
  }
  try {
    const result = body.prospectId
      ? await qualifyProspect({ userId: user.id, prospectId: body.prospectId }, prisma)
      : await qualifyProspectsBatch({ userId: user.id, cursor: body.cursor, maxPages: 1 }, prisma);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof ProspectIntelligenceNotFound) return NextResponse.json({ error: 'Prospect not found.' }, { status: 404 });
    console.error('[SCOUT] Qualification failed:', error);
    return NextResponse.json({ error: 'Qualification failed.' }, { status: 500 });
  }
}
