import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { triageInboundSignal } from '@/lib/decision/triage';
import { canManuallyAnalyze } from '@/lib/decision/rollout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canManuallyAnalyze()) return NextResponse.json({ error: 'Decision analysis is disabled.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.signalId !== 'string' || !body.signalId.trim() || body.signalId.length > 100 ||
    (body.retryOfDecisionId != null && (typeof body.retryOfDecisionId !== 'string' || body.retryOfDecisionId.length > 100)))
    return NextResponse.json({ error: 'Valid signal ID required.' }, { status: 400 });
  try {
    const result = await triageInboundSignal({ userId, signalId: body.signalId.trim(),
      retryOfDecisionId: body.retryOfDecisionId || undefined });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /not found|Retry source/.test(error.message)) return NextResponse.json({ error: 'Signal or retry source not found.' }, { status: 404 });
    console.error('[DECISION_TRIAGE] Failed', error);
    return NextResponse.json({ error: 'Decision triage could not complete. The inbound reply remains saved.' }, { status: 500 });
  }
}
