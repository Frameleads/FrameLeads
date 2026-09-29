import { cookies } from 'next/headers';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { NextResponse } from 'next/server';
import { QualificationOverride } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { ProspectIntelligenceNotFound } from '@/lib/prospects/intelligence';
import { setQualificationOverride } from '@/lib/prospects/qualification';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('ICP');
  if (entitlementError) return entitlementError;
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.prospectId !== 'string' || !body.prospectId.trim() || body.prospectId.length > 128 || !Object.values(QualificationOverride).includes(body.override)) {
    return NextResponse.json({ error: 'Valid Prospect and decision required.' }, { status: 400 });
  }
  try {
    const qualification = await setQualificationOverride({ userId: user.id, prospectId: body.prospectId, override: body.override }, prisma);
    return NextResponse.json({ status: qualification.status, override: qualification.override });
  } catch (error) {
    if (error instanceof ProspectIntelligenceNotFound) return NextResponse.json({ error: 'Prospect not found.' }, { status: 404 });
    console.error('[SCOUT] Qualification override failed:', error);
    return NextResponse.json({ error: 'Could not save this decision.' }, { status: 500 });
  }
}
