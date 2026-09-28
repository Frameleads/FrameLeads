import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { detectConstitutionConflicts, getOrCreateSalesConstitution, listConstitutionRules } from '@/lib/sales-constitution';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
    const constitution = await getOrCreateSalesConstitution(userId);
    const [page, conflictResult] = await Promise.all([listConstitutionRules({ userId, take: 51, cursor }), detectConstitutionConflicts({ userId })]);
    const rules = page.slice(0, 50);
    return NextResponse.json({ constitution: { id: constitution.id, name: constitution.name, revision: constitution.revision },
      rules, conflicts: conflictResult.conflicts, nextCursor: page.length > 50 ? rules[49].id : null });
  } catch (error) {
    if (error instanceof Error && error.message.includes('cursor not found')) return NextResponse.json({ error: 'Invalid cursor.' }, { status: 400 });
    console.error('[CONSTITUTION] Read failed', error);
    return NextResponse.json({ error: 'Constitution could not be loaded.' }, { status: 500 });
  }
}
