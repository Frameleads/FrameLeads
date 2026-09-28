import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { getAutomationPolicy, saveAutomationPolicy } from '@/lib/automation/policy';

export const dynamic = 'force-dynamic';
export async function GET() {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const [policy, lists, overrides] = await Promise.all([
    getAutomationPolicy(userId),
    prisma.leadList.findMany({ where: { userId }, select: { id: true, name: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.automationCampaignOverride.findMany({ where: { userId }, select: { leadListId: true, mode: true } }),
  ]);
  return NextResponse.json({ policy, lists, overrides });
}
export async function PATCH(request: Request) {
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  try { return NextResponse.json({ policy: await saveAutomationPolicy(userId, await request.json()) }); }
  catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[AUTOMATION_SETTINGS] Save failed');
    return NextResponse.json({ error: 'Could not save automation settings' }, { status: 500 });
  }
}
