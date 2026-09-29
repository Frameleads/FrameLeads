import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { getResponseSLAPolicy, saveResponseSLAPolicy } from '@/lib/response-sla/policy';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export async function GET() {
  const entitlementError = await requireFeatureAccess('RESPONSE_SLA');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ policy: await getResponseSLAPolicy(userId) });
}
export async function PATCH(request: Request) {
  const entitlementError = await requireFeatureAccess('RESPONSE_SLA');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  try { return NextResponse.json({ policy: await saveResponseSLAPolicy(userId, await request.json()) }); }
  catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[RESPONSE_SLA] Settings save failed');
    return NextResponse.json({ error: 'Response SLA settings could not be saved' }, { status: 500 });
  }
}
