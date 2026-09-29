import { cookies } from 'next/headers';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { saveICPProfile } from '@/lib/prospects/qualification';

export const dynamic = 'force-dynamic';

async function userId() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}

export async function GET() {
  const entitlementError = await requireFeatureAccess('ICP');
  if (entitlementError) return entitlementError;
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const profile = await prisma.iCPProfile.findUnique({ where: { userId: id } });
  return NextResponse.json({ profile });
}

export async function PUT(request: Request) {
  const entitlementError = await requireFeatureAccess('ICP');
  if (entitlementError) return entitlementError;
  const id = await userId();
  if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const input = await request.json().catch(() => null);
  try {
    const profile = await saveICPProfile(prisma, id, input);
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[SCOUT] ICP profile save failed:', error);
    return NextResponse.json({ error: 'ICP profile could not be saved.' }, { status: 500 });
  }
}
