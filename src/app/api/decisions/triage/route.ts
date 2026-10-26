import { NextResponse } from 'next/server';
import { triageInboundSignal } from '@/lib/decision/triage';
import { canManuallyAnalyze } from '@/lib/decision/rollout';
import { runAutopilot } from '@/lib/automation/actions';
import { syncResponseSLAForDecision } from '@/lib/response-sla/service';
import { assessRevenueAtRisk } from '@/lib/revenue-risk/service';
import { featureAccessErrorForTier, getAuthenticatedEntitlementUser } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';
import { prisma } from '@/lib/prisma';
import { UNCERTAIN_ANALYSIS_REASON } from '@/lib/decision/pending-recovery';
import { MicroPilotLimitError, releaseUnstartedMicroPilotDecision, reserveMicroPilotDecision } from '@/lib/micro-pilot-limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const entitlementUser = await getAuthenticatedEntitlementUser();
  if (!entitlementUser) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const isPilot = entitlementUser.tier === 'MICRO_PILOT';
  const entitlementError = featureAccessErrorForTier(entitlementUser.tier, 'DECISION_ENGINE');
  if (entitlementError && !isPilot) return entitlementError;
  const { id: userId } = entitlementUser;
  if (!canManuallyAnalyze()) return NextResponse.json({ error: 'Decision analysis is disabled.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.signalId !== 'string' || !body.signalId.trim() || body.signalId.length > 100 ||
    (body.retryOfDecisionId != null && (typeof body.retryOfDecisionId !== 'string' || body.retryOfDecisionId.length > 100)) ||
    (body.confirmProviderRequestEnded != null && typeof body.confirmProviderRequestEnded !== 'boolean'))
    return NextResponse.json({ error: 'Valid signal ID required.' }, { status: 400 });
  let reservedProspectId: string | null = null;
  let providerRequestStarted = false;
  try {
    if (isPilot) {
      if (body.retryOfDecisionId) return NextResponse.json({ error: 'Micro-Pilot decisions allow one initial analysis per prospect. Re-analysis is locked.' }, { status: 403 });
      const signal = await prisma.inboundSignal.findFirst({ where: { id: body.signalId.trim(), userId }, select: { id: true, prospectId: true, generatedLeadId: true } });
      if (!signal) return NextResponse.json({ error: 'Signal not found.' }, { status: 404 });
      if (!signal.prospectId) return NextResponse.json({ error: 'A verified tenant-owned prospect is required for trial analysis.' }, { status: 403 });
      const existing = await prisma.decision.findFirst({ where: { userId, prospectId: signal.prospectId }, select: { id: true } });
      if (existing) return NextResponse.json({ error: 'This prospect already has a trial decision. Re-analysis is locked.' }, { status: 403 });
      try { await reserveMicroPilotDecision(userId, signal.prospectId); }
      catch (error) {
        if (error instanceof MicroPilotLimitError) return NextResponse.json({ error: error.limit,
          remaining: error.limit === 'DECISIONS_EXHAUSTED' ? 0 : undefined }, { status: 403 });
        throw error;
      }
      reservedProspectId = signal.prospectId;
    }
    if (body.retryOfDecisionId) {
      const prior = await prisma.decision.findFirst({ where: { id: body.retryOfDecisionId, userId,
        inputMessage: { sourceType: 'INBOUND_SIGNAL', sourceId: body.signalId.trim() } }, select: { reviewReasons: true } });
      if (prior?.reviewReasons.includes(UNCERTAIN_ANALYSIS_REASON)) {
        if (body.confirmProviderRequestEnded !== true)
          return NextResponse.json({ error: 'Verify the prior provider request has ended before re-analysis.' }, { status: 409 });
        console.info('[TRIAGE_UNCERTAIN_RETRY_CONFIRMED]', JSON.stringify({ userId, decisionId: body.retryOfDecisionId }));
      }
    }
    const result = await triageInboundSignal({ userId, signalId: body.signalId.trim(),
      retryOfDecisionId: body.retryOfDecisionId || undefined, microPilotReserved: isPilot },
      { onProviderRequestStart: () => { providerRequestStarted = true; } });
    if (isPilot && reservedProspectId && !providerRequestStarted && (!result.decision || result.decision.source === 'UNAVAILABLE'))
      await releaseUnstartedMicroPilotDecision(userId, reservedProspectId);
    let automation = null;
    if (result.decision) {
      if (hasFeatureAccess(entitlementUser.tier, 'AUTOMATION')) {
        try { const resolved = await runAutopilot({ userId, decisionId: result.decision.id });
          automation = { state: resolved.state, reasons: 'reasons' in resolved ? resolved.reasons : [] }; }
        catch { console.error('[AUTOMATION] Resolution failed after Decision persistence'); }
        try { await assessRevenueAtRisk({ userId, decisionId: result.decision.id }); }
        catch { console.error('[RESPONSE_SLA] Risk assessment unavailable; unknown duration may apply'); }
        try { await syncResponseSLAForDecision({ userId, decisionId: result.decision.id }); }
        catch { console.error('[RESPONSE_SLA] Materialization failed after Decision persistence'); }
      }
    }
    // Read the authoritative lifetime count after reservation/release rather than
    // estimating from UI clicks. A failure to read must never discard a persisted Decision.
    const usage = isPilot && prisma.user?.findUnique ? await prisma.user.findUnique({
      where: { id: userId }, select: { microPilotDecisionsUsed: true },
    }).catch(() => null) : null;
    const remaining = usage ? Math.max(0, 3 - usage.microPilotDecisionsUsed) : undefined;
    return NextResponse.json({ ...result, automation, ...(isPilot ? { remaining } : {}) });
  } catch (error) {
    // A provider request that started may have incurred cost even if the result
    // was lost or persistence failed. Retain that reservation to prevent an unsafe retry.
    if (isPilot && reservedProspectId && !providerRequestStarted)
      await releaseUnstartedMicroPilotDecision(userId, reservedProspectId).catch(() => false);
    if (error instanceof Error && /not found|Retry source/.test(error.message)) return NextResponse.json({ error: 'Signal or retry source not found.' }, { status: 404 });
    console.error('[DECISION_TRIAGE] Failed', error);
    return NextResponse.json({ error: 'Decision triage could not complete. The inbound reply remains saved.' }, { status: 500 });
  }
}
