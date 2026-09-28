import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { detectConstitutionConflicts, getOrCreateSalesConstitution, listConstitutionRules } from '@/lib/sales-constitution';
import ConstitutionEditor from './ConstitutionEditor';

export const dynamic = 'force-dynamic';
export default async function ConstitutionPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const constitution = await getOrCreateSalesConstitution(user.id);
  const [page, conflictResult] = await Promise.all([listConstitutionRules({ userId: user.id, take: 51 }), detectConstitutionConflicts({ userId: user.id })]);
  const rules = page.slice(0, 50);
  return <ConstitutionEditor initial={{ name: constitution.name, revision: constitution.revision,
    nextCursor: page.length > 50 ? rules[49].id : null, conflicts: conflictResult.conflicts,
    rules: rules.map(rule => ({ id: rule.id, name: rule.name, category: rule.category, effect: rule.effect,
      description: rule.description, constraint: rule.constraint, actionTypes: rule.actionTypes, severity: rule.severity,
      scope: rule.scope, priority: rule.priority,
      enabled: rule.enabled, source: rule.source })) }} />;
}
