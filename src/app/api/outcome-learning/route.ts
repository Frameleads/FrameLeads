import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { getOutcomeLearningDashboard, refreshOutcomeLearnings } from '@/lib/outcome-learning/learning';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET() {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getOutcomeLearningDashboard(userId));
}
export async function POST(request: Request) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  try { return NextResponse.json(await refreshOutcomeLearnings(userId)); }
  catch (error) {
    console.error('[OUTCOME_LEARNING] Refresh failed', error);
    return NextResponse.json({ error: 'Learnings could not be refreshed' }, { status: 500 });
  }
}
