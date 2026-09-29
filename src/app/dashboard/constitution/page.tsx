import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { resolveScoutUser } from '@/lib/scout-data';
import { detectConstitutionConflicts, getOrCreateSalesConstitution, listConstitutionRules } from '@/lib/sales-constitution';
import ConstitutionEditor from './ConstitutionEditor';
import EnterprisePaywall from '@/components/EnterprisePaywall';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export default async function ConstitutionPage() {
  const jar = await cookies();
  const user = await resolveScoutUser(prisma, jar.get('frameleads_session')?.value, jar.get('user_email')?.value);
  if (!user) redirect('/login');
  const tier = await getUserEntitlementTier(user.id);
  if (!hasFeatureAccess(tier, 'CONSTITUTION_MANAGEMENT')) {
    return <EnterprisePaywall userTier={tier} featureName="Sales Constitution"><div aria-hidden="true"><ConstitutionEditor initial={{ name: 'Sales Constitution', revision: 0, rules: [], conflicts: [], nextCursor: null }} /></div></EnterprisePaywall>;
  }
  const constitution = await getOrCreateSalesConstitution(user.id);
  const [page, conflictResult] = await Promise.all([listConstitutionRules({ userId: user.id, take: 51 }), detectConstitutionConflicts({ userId: user.id })]);
  const rules = page.slice(0, 50);
  return <EnterprisePaywall userTier={tier} featureName="Sales Constitution"><ConstitutionEditor initial={{ name: constitution.name, revision: constitution.revision,
    nextCursor: page.length > 50 ? rules[49].id : null, conflicts: conflictResult.conflicts,
    rules: rules.map(rule => ({ id: rule.id, name: rule.name, category: rule.category, effect: rule.effect,
      description: rule.description, constraint: rule.constraint, actionTypes: rule.actionTypes, severity: rule.severity,
      scope: rule.scope, priority: rule.priority,
      enabled: rule.enabled, source: rule.source })) }} /></EnterprisePaywall>;
}
