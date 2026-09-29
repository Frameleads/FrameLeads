import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { setProspectHold } from '@/lib/automation/policy';

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('AUTOMATION');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.prospectId !== 'string' || body.prospectId.length > 100 || typeof body.active !== 'boolean' ||
    (body.reason != null && (typeof body.reason !== 'string' || body.reason.length > 360)))
    return NextResponse.json({ error: 'Invalid hold request' }, { status: 400 });
  try { return NextResponse.json({ hold: await setProspectHold({ userId, prospectId: body.prospectId,
    active: body.active, reason: body.reason }) }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof TypeError ? error.message : 'Prospect or hold not found for this tenant' },
      { status: error instanceof TypeError ? 400 : 404 });
  }
}
