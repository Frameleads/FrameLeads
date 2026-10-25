import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser, runScoutResearch } from '@/lib/scout-data';
import { ProspectIntelligenceNotFound } from '@/lib/prospects/intelligence';
import { researchProspectICP } from '@/lib/prospects/research';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { qualifyProspect } from '@/lib/prospects/qualification';
import { MicroPilotLimitError, releaseUnstartedMicroPilotResearch, reserveMicroPilotResearch } from '@/lib/micro-pilot-limits';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('PROSPECT_RESEARCH');
  if (entitlementError) return entitlementError;
  try {
    const cookieStore = await cookies();
    const user = await resolveScoutUser(
      prisma,
      cookieStore.get('frameleads_session')?.value,
    );
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null);
    const prospectId = typeof body?.prospectId === 'string' ? body.prospectId.trim() : '';
    if (!prospectId || prospectId.length > 128 || (body.forceRefresh !== undefined && typeof body.forceRefresh !== 'boolean') || (body.overrideQualification !== undefined && typeof body.overrideQualification !== 'boolean')) {
      return NextResponse.json({ success: false, error: 'Valid prospectId and forceRefresh are required.' }, { status: 400 });
    }
    const isMicroPilot = await getUserEntitlementTier(user.id) === 'MICRO_PILOT';
    if (isMicroPilot) {
      const priorIntelligence = await prisma.prospectIntelligence.findUnique({
        where: { userId_prospectId: { userId: user.id, prospectId } }, select: { researchStatus: true },
      });
      if (priorIntelligence?.researchStatus === 'READY' && body.forceRefresh !== true)
        return NextResponse.json(await runScoutResearch(user.id, prospectId, false, researchProspectICP, false));
      if (body.forceRefresh === true || body.overrideQualification === true) return NextResponse.json({ success: false,
        error: 'Micro-Pilot allows one research operation per qualified prospect.' }, { status: 403 });
      const qualification = await qualifyProspect({ userId: user.id, prospectId }, prisma);
      if (qualification.status !== 'QUALIFIED') return NextResponse.json({ success: false,
        error: qualification.status === 'REJECTED' ? 'Prospect does not meet the saved ICP requirements.' : 'Qualify this prospect against your saved ICP before research.' }, { status: 409 });
      try { await reserveMicroPilotResearch(user.id, prospectId); }
      catch (error) {
        if (error instanceof MicroPilotLimitError) return NextResponse.json({ success: false, error: error.limit,
          remaining: error.limit === 'RESEARCH_EXHAUSTED' ? 0 : undefined }, { status: 403 });
        throw error;
      }
    }
    const result = await runScoutResearch(user.id, prospectId, body.forceRefresh === true, researchProspectICP, body.overrideQualification === true);
    if (isMicroPilot && result.status === 'FAILED' && result.retryableWithoutCharge)
      await releaseUnstartedMicroPilotResearch(user.id, prospectId);
    return NextResponse.json({ success: true, status: result.status, evidenceCount: result.evidenceCount, warnings: result.warnings });
  } catch (error) {
    if (error instanceof ProspectIntelligenceNotFound) {
      return NextResponse.json({ success: false, error: 'Prospect not found.' }, { status: 404 });
    }
    console.error('[SCOUT] Research request failed:', error);
    return NextResponse.json({ success: false, error: 'Research could not be started. Please retry.' }, { status: 500 });
  }
}
