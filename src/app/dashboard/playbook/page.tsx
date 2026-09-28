import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { getOrCreateRevenuePlaybook, listPlaybookRules } from '@/lib/revenue-playbook';
import PlaybookEditor from './PlaybookEditor';

export const dynamic = 'force-dynamic';
export default async function PlaybookPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const playbook = await getOrCreateRevenuePlaybook(user.id);
  const page = await listPlaybookRules({ userId: user.id, take: 51 });
  const rules = page.slice(0, 50);
  return <PlaybookEditor initial={{ name: playbook.name, revision: playbook.revision,
    nextCursor: page.length > 50 ? rules[49].id : null,
    rules: rules.map(rule => ({ id: rule.id, name: rule.name, scenario: rule.scenario, customScenario: rule.customScenario,
      objective: rule.objective, guidance: rule.guidance, nextAction: rule.nextAction,
      responsePrinciples: rule.responsePrinciples, ctaGuidance: rule.ctaGuidance,
      qualificationCondition: rule.qualificationCondition, direction: rule.direction,
      priority: rule.priority, enabled: rule.enabled, source: rule.source })) }} />;
}
