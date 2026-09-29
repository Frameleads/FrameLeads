import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { reviewLearningSuggestion } from '@/lib/outcome-learning/learning';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entitlementError = await requireFeatureAccess('OUTCOME_LEARNING');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const { id } = await params;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['status', 'note'].includes(key))) throw new TypeError('Invalid review input');
    return NextResponse.json({ suggestion: await reviewLearningSuggestion({ userId, suggestionId: id,
      status: body.status, note: body.note }) });
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Open suggestion not found' }, { status: 404 });
    console.error('[OUTCOME_LEARNING] Suggestion review failed', error);
    return NextResponse.json({ error: 'Suggestion could not be reviewed' }, { status: 500 });
  }
}
