import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { SandboxHandoffError, sendProspectToSandbox } from '@/lib/prospects/sandbox-handoff';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('SCOUT');
  if (entitlementError) return entitlementError;
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const prospectId = typeof body?.prospectId === 'string' ? body.prospectId.trim() : '';
  if (!prospectId || prospectId.length > 128) return NextResponse.json({ error: 'Valid prospectId required.' }, { status: 400 });
  try {
    return NextResponse.json(await sendProspectToSandbox({ userId: user.id, prospectId }, prisma));
  } catch (error) {
    if (error instanceof SandboxHandoffError) return NextResponse.json({ error: error.message, reason: error.reason }, {
      status: error.reason === 'NOT_FOUND' ? 404 : 409,
    });
    console.error('[SCOUT] Sandbox handoff failed:', error);
    return NextResponse.json({ error: 'Could not send this prospect to Sandbox. Please retry.' }, { status: 500 });
  }
}
