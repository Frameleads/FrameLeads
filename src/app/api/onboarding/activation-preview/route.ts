import { getAuthenticatedEntitlementUser } from '@/lib/auth-guard';
import { validMutationOrigin } from '@/lib/automation/auth';
import { boundedLifecycleBody } from '@/lib/customer-lifecycle';
import { prisma } from '@/lib/prisma';
import { realPreviewReply } from '@/lib/decision/activation-preview';
import { triageInboundSignal } from '@/lib/decision/triage';
import { canManuallyAnalyze } from '@/lib/decision/rollout';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function previewUser() {
  const session = await getAuthenticatedEntitlementUser();
  if (!session) return null;
  // Read the paid tier directly. An admin UI override cannot grant a Micro-Pilot preview.
  const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, tier: true } });
  return user?.tier === 'MICRO_PILOT' ? user : null;
}
export async function GET() {
  const user = await previewUser();
  if (!user) return Response.json({ code: 'MICRO_PILOT_REQUIRED' }, { status: 403 });
  const decision = await prisma.decision.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, recommendedNextAction: true, reviewReasons: true } });
  if (decision) return Response.json({ allowance: 0, decision }, { headers: { 'Cache-Control': 'no-store' } });
  const rows = await prisma.inboundSignal.findMany({ where: { userId: user.id, prospectId: { not: null },
    sourceType: { in: ['WEBHOOK', 'IMAP_NATIVE'] }, signalType: 'EMAIL_REPLY', sourceMessageId: { not: null } },
    orderBy: { createdAt: 'asc' }, take: 25,
    select: { id: true, userId: true, prospectId: true, sourceType: true, signalType: true, sourceMessageId: true, rawEmail: true, createdAt: true } });
  const signals = [];
  for (const row of rows) if (realPreviewReply(row, user.id) && await prisma.generatedLead.findFirst({
    where: { userId: user.id, prospectId: row.prospectId }, select: { id: true } }))
    signals.push({ id: row.id, receivedAt: row.createdAt });
  return Response.json({ allowance: 1, signals }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!validMutationOrigin(request)) return Response.json({ code: 'ORIGIN_REJECTED' }, { status: 403 });
  const user = await previewUser();
  if (!user) return Response.json({ code: 'MICRO_PILOT_REQUIRED' }, { status: 403 });
  if (!canManuallyAnalyze()) return Response.json({ code: 'DECISION_ANALYSIS_DISABLED' }, { status: 403 });
  try {
    const body = JSON.parse(await boundedLifecycleBody(request));
    if (!body || Object.keys(body).length !== 1 || typeof body.signalId !== 'string' || !body.signalId.trim() || body.signalId.length > 100)
      return Response.json({ code: 'INVALID_REQUEST' }, { status: 400 });
    const result = await triageInboundSignal({ userId: user.id, signalId: body.signalId.trim(), activationPreview: true });
    // No autopilot, execution attempt, provider send, or scheduler is called by this route.
    return Response.json({ decision: result.decision && { id: result.decision.id, status: result.decision.status,
      recommendedNextAction: result.decision.recommendedNextAction, reviewReasons: result.decision.reviewReasons },
      reused: result.reused, allowance: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const safe = ['ACTIVATION_PREVIEW_EXHAUSTED', 'REAL_PROVIDER_REPLY_REQUIRED', 'CONTROLLED_WORKFLOW_PROSPECT_REQUIRED', 'DECISION_ENGINE_LOCKED'];
    return Response.json({ code: safe.includes(code) ? code : 'PREVIEW_UNAVAILABLE' }, { status: safe.includes(code) ? 403 : 503 });
  }
}
