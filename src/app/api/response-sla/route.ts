import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId } from '@/lib/automation/auth';
import { assessRevenueAtRisk } from '@/lib/revenue-risk/service';
import { displayResponseSLA } from '@/lib/response-sla/deadline';
import { getResponseSLAPolicy } from '@/lib/response-sla/policy';
import { syncResponseSLAForDecision } from '@/lib/response-sla/service';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const decisionId = new URL(request.url).searchParams.get('decisionId');
  if (!decisionId || decisionId.length > 100) return NextResponse.json({ error: 'Decision ID required' }, { status: 400 });
  try {
    await assessRevenueAtRisk({ userId, decisionId });
    const [sla, policy] = await Promise.all([syncResponseSLAForDecision({ userId, decisionId }), getResponseSLAPolicy(userId)]);
    return NextResponse.json({ sla: sla ? { id: sla.id, status: sla.status, startedAt: sla.startedAt,
      dueAt: sla.dueAt, breachedAt: sla.breachedAt, resolvedAt: sla.resolvedAt, cancelledAt: sla.cancelledAt,
      escalationLevel: sla.escalationLevel, escalationReason: sla.escalationReason,
      assignmentId: sla.assignmentId, riskScoreAtStart: sla.riskScoreAtStart,
      riskBandAtStart: sla.riskBandAtStart, riskConfidenceAtStart: sla.riskConfidenceAtStart,
      policyRevision: sla.policyRevision, resolutionReason: sla.resolutionReason,
      display: displayResponseSLA({ status: sla.status, startedAt: sla.startedAt,
        dueAt: sla.dueAt, dueSoonPercent: policy.dueSoonPercent }) } : null,
      dueSoonPercent: policy.dueSoonPercent });
  } catch (error) {
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found for this tenant' }, { status: 404 });
    console.error('[RESPONSE_SLA] Read failed');
    return NextResponse.json({ error: 'Response SLA could not load' }, { status: 500 });
  }
}
