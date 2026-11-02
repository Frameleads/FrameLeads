import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthenticatedEntitlementUser, featureAccessErrorForTier } from '@/lib/auth-guard';
import { actOnDecision } from '@/lib/automation/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Explicit, tenant-owned human send. Never call the legacy /api/dispatch stub.
 * The canonical automation executor re-evaluates all policy and suppression
 * inputs, atomically claims the Decision, sends through native SMTP, and audits
 * the actor and override reason. Neither the browser nor this route can
 * declare a Decision approved or invent recipient identity.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });

  const user = await getAuthenticatedEntitlementUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const accessError = featureAccessErrorForTier(user.tier, 'INBOX_TRIAGE') ||
    featureAccessErrorForTier(user.tier, 'BASE_OUTBOUND');
  if (accessError) return accessError;
  // Micro-Pilot sends are deliberately restricted to the existing Sandbox flow.
  if (user.tier === 'MICRO_PILOT')
    return NextResponse.json({ error: 'Use the protected Micro-Pilot Sandbox send flow.' }, { status: 403 });

  const input = await request.json().catch(() => null);
  const signalId = typeof input?.signalId === 'string' ? input.signalId.trim() : '';
  const decisionId = typeof input?.decisionId === 'string' ? input.decisionId.trim() : '';
  const editedReply = typeof input?.editedReply === 'string' ? input.editedReply.trim() : '';
  const overrideReason = typeof input?.overrideReason === 'string' ? input.overrideReason.trim() : '';
  const requestKey = typeof input?.requestKey === 'string' ? input.requestKey : '';
  if (!signalId || signalId.length > 128 || !decisionId || decisionId.length > 128 ||
    !editedReply || editedReply.length > 4000 || overrideReason.length < 12 || overrideReason.length > 500 ||
    !/^[\w:-]{8,128}$/.test(requestKey) || input?.confirmSend !== true) {
    return NextResponse.json({ error: 'Confirm the send, enter a 12–500 character approval reason and a valid draft.' },
      { status: 400 });
  }

  try {
    const signal = await prisma.inboundSignal.findFirst({
      where: { id: signalId, userId: user.id, status: 'PENDING' },
      select: { id: true, prospectId: true, generatedLeadId: true },
    });
    if (!signal?.prospectId)
      return NextResponse.json({ error: 'An active, tenant-owned prospect is required.' }, { status: 409 });
    const latestDecision = await prisma.decision.findFirst({
      where: { userId: user.id, prospectId: signal.prospectId,
        inputMessage: { sourceType: 'INBOUND_SIGNAL', sourceId: signal.id } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    if (!latestDecision || latestDecision.id !== decisionId)
      return NextResponse.json({ error: 'Analyze the reply and use its latest Decision before sending.' },
        { status: 409 });

    const outcome = await actOnDecision({
      userId: user.id, decisionId, requestKey,
      action: 'EDIT_AND_SEND', editedReply, overrideReason,
    });
    if (outcome.state === 'EXECUTED')
      return NextResponse.json({ success: true, state: 'EXECUTED', reused: outcome.reused });
    const reasons = 'reasons' in outcome && Array.isArray(outcome.reasons) ? outcome.reasons : [];
    return NextResponse.json({
      success: false, state: outcome.state, reasons,
      error: outcome.state === 'FAILED_UNCERTAIN'
        ? 'Send outcome uncertain. Do not retry until delivery is verified.'
        : 'The reply was not sent. Resolve the listed policy, suppression, integration or authorization checks.',
    }, { status: 409 });
  } catch (error) {
    console.error('[INBOX_MANUAL_SEND] Failed', error instanceof Error ? error.name : 'Unknown');
    return NextResponse.json({ error: 'Unable to authorize or complete this send.' }, { status: 500 });
  }
}
