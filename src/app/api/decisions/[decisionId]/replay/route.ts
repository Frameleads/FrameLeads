import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId } from '@/lib/automation/auth';
import { getDecisionReplay } from '@/lib/decision/replay';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ decisionId: string }> }) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { decisionId } = await params;
  if (!decisionId || decisionId.length > 100) return NextResponse.json({ error: 'Invalid Decision ID' }, { status: 400 });
  try { return NextResponse.json({ replay: await getDecisionReplay({ userId, decisionId }) }); }
  catch (error) {
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
    console.error('[DECISION_REPLAY] Read failed', error);
    return NextResponse.json({ error: 'Decision Replay could not load' }, { status: 500 });
  }
}
