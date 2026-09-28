import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const signalId = new URL(request.url).searchParams.get('signalId');
  if (!signalId || signalId.length > 100) return NextResponse.json({ error: 'Signal ID required.' }, { status: 400 });
  const signal = await prisma.inboundSignal.findFirst({ where: { id: signalId, userId }, select: { id: true } });
  if (!signal) return NextResponse.json({ error: 'Signal not found.' }, { status: 404 });
  const decision = await prisma.decision.findFirst({ where: { userId,
    inputMessage: { sourceType: 'INBOUND_SIGNAL', sourceId: signalId } },
    orderBy: { createdAt: 'desc' }, include: { trace: true } });
  return NextResponse.json({ decision });
}
