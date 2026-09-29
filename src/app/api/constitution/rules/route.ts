import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { createConstitutionRule, type ConstitutionRuleInput } from '@/lib/sales-constitution';
import { requireFeatureAccess } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const entitlementError = await requireFeatureAccess('CONSTITUTION_MANAGEMENT');
  if (entitlementError) return entitlementError;
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Rule data is required.' }, { status: 400 });
  try {
    const rule = await createConstitutionRule({ userId, ...{
      name: body.name, category: body.category, effect: body.effect, description: body.description,
      constraint: body.constraint, actionTypes: body.actionTypes, severity: body.severity, scope: body.scope,
      priority: body.priority, enabled: body.enabled,
    } as ConstitutionRuleInput });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[CONSTITUTION] Create failed', error);
    return NextResponse.json({ error: 'Rule could not be saved.' }, { status: 500 });
  }
}
