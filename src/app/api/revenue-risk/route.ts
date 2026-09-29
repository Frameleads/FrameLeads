import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId } from '@/lib/automation/auth';
import { assessRevenueAtRisk } from '@/lib/revenue-risk/service';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const entitlementError = await requireFeatureAccess('REVENUE_RISK');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const decisionId = new URL(request.url).searchParams.get('decisionId');
  if (!decisionId || decisionId.length > 100) return NextResponse.json({ error: 'Decision ID required' }, { status: 400 });
  try {
    const risk = await assessRevenueAtRisk({ userId, decisionId });
    return NextResponse.json({ risk: { decisionId: risk.decisionId, status: risk.status, score: risk.score,
      band: risk.band, confidence: risk.confidence, reasons: risk.reasons,
      components: risk.components, sourceReferences: risk.sourceReferences,
      scoringVersion: risk.scoringVersion, evaluatedAt: risk.evaluatedAt } });
  } catch (error) {
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found for this tenant' }, { status: 404 });
    console.error('[REVENUE_RISK] Assessment failed');
    return NextResponse.json({ error: 'Revenue priority could not be assessed' }, { status: 500 });
  }
}
