import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticatedAutomationUserId } from '@/lib/automation/auth';
import { resolveAutomationMode } from '@/lib/automation/resolve';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const signalId = new URL(request.url).searchParams.get('signalId');
  if (!signalId || signalId.length > 100) return NextResponse.json({ error: 'Signal ID required' }, { status: 400 });
  const signal = await prisma.inboundSignal.findFirst({ where: { id: signalId, userId }, select: { id: true } });
  if (!signal) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
  const decision = await prisma.decision.findFirst({ where: { userId,
    inputMessage: { sourceType: 'INBOUND_SIGNAL', sourceId: signalId } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (!decision) return NextResponse.json({ automation: null });
  try {
    const resolved = await resolveAutomationMode({ userId, decisionId: decision.id });
    const assignment = await prisma.decisionAssignment.findUnique({ where: { userId_decisionId: { userId, decisionId: decision.id } } });
    return NextResponse.json({ automation: { decisionId: decision.id, requestedMode: resolved.requestedMode,
      resolvedMode: resolved.resolvedMode, state: resolved.state, reasons: resolved.reasons,
      policyRevision: resolved.policyRevision, currentConstitutionRevision: resolved.currentConstitutionRevision,
      ruleIds: resolved.constitutionRuleIds, assignment: assignment ? { queue: assignment.queue, status: assignment.status } : null,
      prospectId: resolved.decision.prospectId, hold: resolved.hold?.active ? { reason: resolved.hold.reason } : null } });
  } catch { return NextResponse.json({ error: 'Automation state could not load' }, { status: 500 }); }
}
