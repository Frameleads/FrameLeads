import { CampaignAutomationMode } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { setLeadListAutomationOverride } from '@/lib/automation/policy';

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('AUTOMATION');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (typeof body?.leadListId !== 'string' || body.leadListId.length > 100 ||
    !Object.values(CampaignAutomationMode).includes(body.mode))
    return NextResponse.json({ error: 'Invalid lead-list override' }, { status: 400 });
  try { return NextResponse.json({ override: await setLeadListAutomationOverride({ userId,
    leadListId: body.leadListId, mode: body.mode }) }); }
  catch { return NextResponse.json({ error: 'Lead list not found for this tenant' }, { status: 404 }); }
}
