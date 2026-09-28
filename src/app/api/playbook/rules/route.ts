import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { createPlaybookRule, type PlaybookRuleInput } from '@/lib/revenue-playbook';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const jar = await cookies();
  const userId = (await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value))?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Rule data is required.' }, { status: 400 });
  try {
    const rule = await createPlaybookRule({ userId, ...{
      name: body.name, scenario: body.scenario, customScenario: body.customScenario,
      objective: body.objective, guidance: body.guidance, nextAction: body.nextAction,
      responsePrinciples: body.responsePrinciples, ctaGuidance: body.ctaGuidance,
      qualificationCondition: body.qualificationCondition, direction: body.direction,
      priority: body.priority, enabled: body.enabled,
    } as PlaybookRuleInput });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error('[PLAYBOOK] Create failed', error);
    return NextResponse.json({ error: 'Rule could not be saved.' }, { status: 500 });
  }
}
