import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { recordDecisionOutcome, validateOutcomeInput } from '@/lib/outcome-learning/outcomes';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('OUTCOME_CAPTURE');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  try {
    const input = validateOutcomeInput(await request.json());
    return NextResponse.json(await recordDecisionOutcome({ userId, ...input }));
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
    console.error('[OUTCOME_LEARNING] Outcome recording failed', error);
    return NextResponse.json({ error: 'Outcome could not be recorded' }, { status: 500 });
  }
}
