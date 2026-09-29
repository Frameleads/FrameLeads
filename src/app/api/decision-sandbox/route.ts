import { NextResponse } from 'next/server';
import { authenticatedAutomationUserId, validMutationOrigin } from '@/lib/automation/auth';
import { prisma } from '@/lib/prisma';
import { simulateDecision, validateSimulationInput } from '@/lib/decision/simulation';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const entitlementError = await requireFeatureAccess('DECISION_SANDBOX');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const decisions = await prisma.decision.findMany({ where: { userId, status: { not: 'PENDING' } },
    orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, createdAt: true, primaryIntent: true, status: true,
      prospect: { select: { firstName: true, lastName: true, companyName: true } } } });
  return NextResponse.json({ decisions });
}

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('DECISION_SANDBOX');
  if (entitlementError) return entitlementError;
  const userId = await authenticatedAutomationUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!validMutationOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  try {
    const input = validateSimulationInput(await request.json());
    return NextResponse.json({ simulation: await simulateDecision({ userId, ...input }) });
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError)
      return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /not found for tenant/.test(error.message))
      return NextResponse.json({ error: 'Decision not found' }, { status: 404 });
    console.error('[DECISION_SANDBOX] Simulation failed', error);
    return NextResponse.json({ error: 'Simulation could not complete. No operational action was taken.' }, { status: 500 });
  }
}
