import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { requireFeatureAccess } from '@/lib/auth-guard';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { archiveConstitutionRule, updateConstitutionRule, type ConstitutionRuleInput } from '@/lib/sales-constitution';

export const dynamic = 'force-dynamic';
async function owner() {
  const jar = await cookies();
  return (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entitlementError = await requireFeatureAccess('CONSTITUTION_MANAGEMENT');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Rule data is required.' }, { status: 400 });
  try {
    const rule = await updateConstitutionRule({ userId, id, ...{
      name: body.name, category: body.category, effect: body.effect, description: body.description,
      constraint: body.constraint, actionTypes: body.actionTypes, severity: body.severity, scope: body.scope,
      priority: body.priority, enabled: body.enabled,
    } as ConstitutionRuleInput });
    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && error.message.includes('not found')) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });
    console.error('[CONSTITUTION] Update failed', error);
    return NextResponse.json({ error: 'Rule could not be updated.' }, { status: 500 });
  }
}
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const entitlementError = await requireFeatureAccess('CONSTITUTION_MANAGEMENT');
  if (entitlementError) return entitlementError;
  const userId = await owner();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    await archiveConstitutionRule({ userId, id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });
    console.error('[CONSTITUTION] Archive failed', error);
    return NextResponse.json({ error: 'Rule could not be archived.' }, { status: 500 });
  }
}
