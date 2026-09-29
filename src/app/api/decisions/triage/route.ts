import { NextResponse } from 'next/server';
import { triageInboundSignal } from '@/lib/decision/triage';
import { canManuallyAnalyze } from '@/lib/decision/rollout';
import { runAutopilot } from '@/lib/automation/actions';
import { syncResponseSLAForDecision } from '@/lib/response-sla/service';
import { assessRevenueAtRisk } from '@/lib/revenue-risk/service';
import { featureAccessErrorForTier, getAuthenticatedEntitlementUser } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const entitlementUser = await getAuthenticatedEntitlementUser();
  if (!entitlementUser) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const entitlementError = featureAccessErrorForTier(entitlementUser.tier, 'DECISION_ENGINE');
  if (entitlementError) return entitlementError;
  const { id: userId } = entitlementUser;
  if (!canManuallyAnalyze()) return NextResponse.json({ error: 'Decision analysis is disabled.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.signalId !== 'string' || !body.signalId.trim() || body.signalId.length > 100 ||
    (body.retryOfDecisionId != null && (typeof body.retryOfDecisionId !== 'string' || body.retryOfDecisionId.length > 100)))
    return NextResponse.json({ error: 'Valid signal ID required.' }, { status: 400 });
  try {
    const result = await triageInboundSignal({ userId, signalId: body.signalId.trim(),
      retryOfDecisionId: body.retryOfDecisionId || undefined });
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
    return NextResponse.json({ ...result, automation });
  } catch (error) {
    if (error instanceof Error && /not found|Retry source/.test(error.message)) return NextResponse.json({ error: 'Signal or retry source not found.' }, { status: 404 });
    console.error('[DECISION_TRIAGE] Failed', error);
    return NextResponse.json({ error: 'Decision triage could not complete. The inbound reply remains saved.' }, { status: 500 });
  }
}
