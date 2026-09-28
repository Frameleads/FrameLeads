import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { actOnDecision } from '@/lib/automation/actions';

export async function POST(request: Request) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.decisionId !== 'string' || body.decisionId.length > 100 ||
    typeof body.action !== 'string' || typeof body.requestKey !== 'string')
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  try {
    const result = await actOnDecision({ userId, decisionId: body.decisionId,
      action: body.action, requestKey: body.requestKey, editedReply: body.editedReply,
      reason: body.reason, queue: body.queue });
    return NextResponse.json({ state: result.state, reasons: 'reasons' in result ? result.reasons : [], reused: result.reused });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found for this tenant' }, { status: 404 });
    console.error('[AUTOMATION_ACTION] Failed');
    return NextResponse.json({ error: 'Could not complete governed action' }, { status: 500 });
  }
}
