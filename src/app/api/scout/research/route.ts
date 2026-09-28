import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser, runScoutResearch } from '@/lib/scout-data';
import { ProspectIntelligenceNotFound } from '@/lib/prospects/intelligence';
import { researchProspectICP } from '@/lib/prospects/research';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const user = await resolveScoutUser(
      prisma,
      cookieStore.get('frameleads_session')?.value,
      cookieStore.get('user_email')?.value,
    );
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null);
    const prospectId = typeof body?.prospectId === 'string' ? body.prospectId.trim() : '';
    if (!prospectId || prospectId.length > 128 || (body.forceRefresh !== undefined && typeof body.forceRefresh !== 'boolean') || (body.overrideQualification !== undefined && typeof body.overrideQualification !== 'boolean')) {
      return NextResponse.json({ success: false, error: 'Valid prospectId and forceRefresh are required.' }, { status: 400 });
    }
    const result = await runScoutResearch(user.id, prospectId, body.forceRefresh === true, researchProspectICP, body.overrideQualification === true);
    return NextResponse.json({ success: true, status: result.status, evidenceCount: result.evidenceCount, warnings: result.warnings });
  } catch (error) {
    if (error instanceof ProspectIntelligenceNotFound) {
      return NextResponse.json({ success: false, error: 'Prospect not found.' }, { status: 404 });
    }
    console.error('[SCOUT] Research request failed:', error);
    return NextResponse.json({ success: false, error: 'Research could not be started. Please retry.' }, { status: 500 });
  }
}
