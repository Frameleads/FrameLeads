import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getOrCreateRevenuePlaybook, listPlaybookRules } from '@/lib/revenue-playbook';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const cursor = new URL(request.url).searchParams.get('cursor') || undefined;
    const [playbook, page] = await Promise.all([getOrCreateRevenuePlaybook(userId), listPlaybookRules({ userId, take: 51, cursor })]);
    const rules = page.slice(0, 50);
    return NextResponse.json({ playbook: { id: playbook.id, name: playbook.name, revision: playbook.revision },
      rules, nextCursor: page.length > 50 ? rules[49].id : null });
  } catch (error) {
    console.error('[PLAYBOOK] Read failed', error);
    return NextResponse.json({ error: 'Playbook could not be loaded.' }, { status: 500 });
  }
}
