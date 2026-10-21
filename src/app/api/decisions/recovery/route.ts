import { NextResponse } from 'next/server';
import { featureAccessErrorForTier, getAuthenticatedEntitlementUser } from '@/lib/auth-guard';
import { markStalledDecisionForReview } from '@/lib/decision/pending-recovery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await getAuthenticatedEntitlementUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const entitlementError = featureAccessErrorForTier(user.tier, 'DECISION_ENGINE');
  if (entitlementError) return entitlementError;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.decisionId !== 'string' || !body.decisionId.trim() || body.decisionId.length > 100)
    return NextResponse.json({ error: 'Valid decision ID required.' }, { status: 400 });
  const result = await markStalledDecisionForReview({ userId: user.id, decisionId: body.decisionId.trim() });
  const code = result.status === 'NOT_FOUND' ? 404 : result.status === 'TOO_RECENT' ? 409 : 200;
  return NextResponse.json(result, { status: code });
}
