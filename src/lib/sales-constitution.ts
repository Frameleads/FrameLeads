import { ConstitutionActionType as ActionType, ConstitutionCategory as Category,
  ConstitutionEffect as Effect, ConstitutionSource as Source, ConstitutionSeverity as Severity,
  ConstitutionScope as Scope, ConstitutionChangeType as ChangeType, type Prisma,
  type PrismaClient, type SalesConstitutionRule } from '@prisma/client';
import { prisma } from './prisma';
import { identityTransaction } from './prospects/identity';

export type ConstitutionConstraint =
  | { kind: 'DISCOUNT_PERCENT'; threshold: number; comparison: 'GT' | 'GTE' }
  | { kind: 'MIN_CONTRACT_MONTHS'; minimum: number }
  | { kind: 'PROHIBITED_CLAIM'; terms: string[] }
  | { kind: 'TOPIC'; topic: Category }
  | { kind: 'UNSUBSCRIBE' }
  | { kind: 'CUSTOM_MANUAL' };
export type ConstitutionRuleInput = {
  name: string; category: Category; effect: Effect; description: string;
  constraint: ConstitutionConstraint; actionTypes: ActionType[]; severity?: Severity; scope?: Scope;
  priority?: number; enabled?: boolean;
};
export type ConstitutionAction = {
  actionType: ActionType; proposedDiscountPercent?: number | null; proposedContractMonths?: number | null;
  proposedClaim?: string | null; topic?: Category | null; unsubscribeConfirmed?: boolean | null; scope?: Scope | null;
};
/** Hard Constitution results outrank all lower-authority guidance and recommendations. */
export const CONSTITUTION_AUTHORITY = 'SALES_CONSTITUTION' as const;
export const POLICY_AUTHORITY_ORDER = ['HARD_SAFETY_COMPLIANCE', 'SALES_CONSTITUTION', 'FUTURE_RISK_CONTROLS',
  'REVENUE_PLAYBOOK', 'BRAIN_COMMUNICATION_PREFERENCES', 'AI_RECOMMENDATION'] as const;
export type ConstitutionPurpose = 'reply_decision' | 'outbound' | 'pricing' | 'discount' | 'legal' |
  'security' | 'compliance' | 'commercial' | 'meeting' | 'sandbox';
const purposeCategories: Record<ConstitutionPurpose, Category[]> = {
  reply_decision: [Category.CLAIM, Category.LEGAL, Category.COMPLIANCE, Category.SECURITY, Category.PRIVACY, Category.COMMUNICATION],
  outbound: [Category.OUTREACH, Category.UNSUBSCRIBE, Category.CLAIM, Category.COMMUNICATION],
  pricing: [Category.PRICING, Category.DISCOUNT, Category.COMMERCIAL_TERM, Category.APPROVAL],
  discount: [Category.DISCOUNT, Category.PRICING, Category.APPROVAL],
  legal: [Category.LEGAL, Category.CONTRACT, Category.COMPLIANCE, Category.DATA_HANDLING],
  security: [Category.SECURITY, Category.PRIVACY, Category.DATA_HANDLING],
  compliance: [Category.COMPLIANCE, Category.LEGAL, Category.PRIVACY],
  commercial: [Category.COMMERCIAL_TERM, Category.CONTRACT, Category.COMMITMENT, Category.DISCOUNT],
  meeting: [Category.COMMUNICATION, Category.COMMITMENT],
  sandbox: [Category.CLAIM, Category.CAPABILITY, Category.OUTREACH, Category.COMMUNICATION],
};
const enumValues = <T extends string>(value: unknown, values: Record<string, T>, label: string): T => {
  if (typeof value !== 'string' || !Object.values(values).includes(value as T)) throw new TypeError(`Invalid ${label}`);
  return value as T;
};
const own = (userId: string) => { if (typeof userId !== 'string' || !userId.trim()) throw new TypeError('Authenticated userId required'); return userId.trim(); };
// User is the tenant identity in this repository; there is no owner/admin/member role model.
export function authorizeConstitutionMutation(userId: string, actorId?: string) {
  const tenant = own(userId), actor = own(actorId ?? userId);
  if (actor !== tenant) throw new Error('Constitution actor is not authorized for this tenant');
  return { userId: tenant, actorId: actor };
}
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const boundedText = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'string' || value.length > max || !clean(value)) throw new TypeError(`${label} is required or too long`);
  return clean(value);
};
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const shape = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Unknown constraint field');
};
const positive = (value: unknown, label: string, max: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new TypeError(`Invalid ${label}`);
  return value;
};

export function validateConstitutionConstraint(value: unknown): ConstitutionConstraint {
  if (!plain(value)) throw new TypeError('Constraint must be an object');
  switch (value.kind) {
    case 'DISCOUNT_PERCENT':
      shape(value, ['kind', 'threshold', 'comparison']);
      if (!['GT', 'GTE'].includes(value.comparison as string)) throw new TypeError('Invalid discount comparison');
      return { kind: 'DISCOUNT_PERCENT', threshold: positive(value.threshold, 'discount threshold', 100), comparison: value.comparison as 'GT' | 'GTE' };
    case 'MIN_CONTRACT_MONTHS':
      shape(value, ['kind', 'minimum']);
      if (!Number.isInteger(value.minimum) || (value.minimum as number) < 1 || (value.minimum as number) > 1200) throw new TypeError('Invalid minimum contract months');
      return { kind: 'MIN_CONTRACT_MONTHS', minimum: value.minimum as number };
    case 'PROHIBITED_CLAIM': {
      shape(value, ['kind', 'terms']);
      if (!Array.isArray(value.terms) || !value.terms.length || value.terms.length > 20) throw new TypeError('Claim terms must contain 1–20 phrases');
      return { kind: 'PROHIBITED_CLAIM', terms: value.terms.map(term => boundedText(term, 'Claim term', 120)) };
    }
    case 'TOPIC':
      shape(value, ['kind', 'topic']);
      return { kind: 'TOPIC', topic: enumValues(value.topic, Category, 'topic') };
    case 'UNSUBSCRIBE':
    case 'CUSTOM_MANUAL':
      shape(value, ['kind']);
      return { kind: value.kind };
    default: throw new TypeError('Unknown constraint kind');
  }
}
export function validateConstitutionRule(input: ConstitutionRuleInput) {
  if (!plain(input)) throw new TypeError('Rule data is required');
  const category = enumValues(input.category, Category, 'category');
  const effect = enumValues(input.effect, Effect, 'effect');
  const severity = input.severity == null ? Severity.MEDIUM : enumValues(input.severity, Severity, 'severity');
  const scope = input.scope == null ? Scope.GLOBAL : enumValues(input.scope, Scope, 'scope');
  if (!Array.isArray(input.actionTypes) || !input.actionTypes.length || input.actionTypes.length > 6 ||
    new Set(input.actionTypes).size !== input.actionTypes.length) throw new TypeError('Select 1–6 distinct action types');
  const actionTypes = input.actionTypes.map(v => enumValues(v, ActionType, 'action type'));
  const constraint = validateConstitutionConstraint(input.constraint);
  const expected: Partial<Record<ConstitutionConstraint['kind'], ActionType>> = {
    DISCOUNT_PERCENT: ActionType.DISCOUNT, MIN_CONTRACT_MONTHS: ActionType.CONTRACT,
    PROHIBITED_CLAIM: ActionType.CLAIM, UNSUBSCRIBE: ActionType.OUTREACH,
  };
  if (expected[constraint.kind] && (actionTypes.length !== 1 || actionTypes[0] !== expected[constraint.kind]))
    throw new TypeError(`${constraint.kind} requires ${expected[constraint.kind]} action`);
  if (constraint.kind === 'DISCOUNT_PERCENT' && category !== Category.DISCOUNT) throw new TypeError('Discount constraint requires DISCOUNT category');
  if (constraint.kind === 'MIN_CONTRACT_MONTHS' && category !== Category.CONTRACT && category !== Category.COMMERCIAL_TERM)
    throw new TypeError('Contract constraint requires CONTRACT or COMMERCIAL_TERM category');
  if (constraint.kind === 'UNSUBSCRIBE' && category !== Category.UNSUBSCRIBE) throw new TypeError('Unsubscribe constraint requires UNSUBSCRIBE category');
  if (constraint.kind === 'TOPIC' && constraint.topic !== category) throw new TypeError('Topic must match rule category');
  const priority = input.priority ?? 1;
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw new TypeError('Priority must be 1–3');
  if (input.enabled != null && typeof input.enabled !== 'boolean') throw new TypeError('Enabled must be boolean');
  return { name: boundedText(input.name, 'Name', 120), category, effect, severity, scope,
    description: boundedText(input.description, 'Description', 3000), constraint, actionTypes, priority, enabled: input.enabled ?? true };
}

async function root(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error('Constitution not found for authenticated user');
  return tx.salesConstitution.upsert({ where: { userId }, create: { userId }, update: {} });
}
export function getOrCreateSalesConstitution(userId: string, db: PrismaClient = prisma) {
  return identityTransaction(db, tx => root(tx, own(userId)));
}
export async function getConstitutionRevision(userId: string, db: PrismaClient = prisma) {
  return (await getOrCreateSalesConstitution(userId, db)).revision;
}
export async function listConstitutionRules(input: { userId: string; take?: number; cursor?: string; includeArchived?: boolean }, db: PrismaClient = prisma) {
  const userId = own(input.userId);
  const constitution = await getOrCreateSalesConstitution(userId, db);
  if (input.cursor && !await db.salesConstitutionRule.findFirst({ where: { userId, constitutionId: constitution.id, id: input.cursor }, select: { id: true } }))
    throw new Error('Constitution cursor not found for authenticated user');
  return db.salesConstitutionRule.findMany({ where: { userId, constitutionId: constitution.id, ...(input.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { id: 'asc' }, take: Math.min(100, Math.max(1, input.take ?? 50)),
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
}
function auditState(rule: SalesConstitutionRule) {
  return { name: rule.name, category: rule.category, effect: rule.effect, severity: rule.severity,
    scope: rule.scope, description: rule.description, constraint: rule.constraint, actionTypes: rule.actionTypes,
    priority: rule.priority, enabled: rule.enabled, archivedAt: rule.archivedAt?.toISOString() ?? null };
}
async function writeAudit(tx: Prisma.TransactionClient, input: { userId: string; actorId: string; constitutionId: string;
  constitutionRevision: number; ruleId: string; changeType: ChangeType;
  before?: SalesConstitutionRule | null; after?: SalesConstitutionRule | null }) {
  return tx.salesConstitutionRevisionEvent.create({ data: { userId: input.userId, actorId: input.actorId,
    constitutionId: input.constitutionId, constitutionRevision: input.constitutionRevision,
    ruleId: input.ruleId, changeType: input.changeType,
    beforeState: input.before ? auditState(input.before) as Prisma.InputJsonValue : undefined,
    afterState: input.after ? auditState(input.after) as Prisma.InputJsonValue : undefined } });
}
export async function listConstitutionRevisionEvents(input: { userId: string; take?: number; cursor?: string }, db: PrismaClient = prisma) {
  const userId = own(input.userId), constitution = await getOrCreateSalesConstitution(userId, db);
  if (input.cursor && !await db.salesConstitutionRevisionEvent.findFirst({ where: { userId, constitutionId: constitution.id, id: input.cursor }, select: { id: true } }))
    throw new Error('Constitution event cursor not found for authenticated user');
  return db.salesConstitutionRevisionEvent.findMany({ where: { userId, constitutionId: constitution.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: Math.min(100, Math.max(1, input.take ?? 50)),
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
}
export async function createConstitutionRule(input: { userId: string; actorId?: string } & ConstitutionRuleInput, db: PrismaClient = prisma) {
  const { userId, actorId } = authorizeConstitutionMutation(input.userId, input.actorId), data = validateConstitutionRule(input);
  return identityTransaction(db, async tx => {
    const constitution = await root(tx, userId);
    const rule = await tx.salesConstitutionRule.create({ data: { ...data, constraint: data.constraint as Prisma.InputJsonValue,
      userId, constitutionId: constitution.id, source: Source.USER_ENTERED } });
    const revision = rule.enabled ? (await tx.salesConstitution.update({ where: { userId }, data: { revision: { increment: 1 } } })).revision : constitution.revision;
    await writeAudit(tx, { userId, actorId, constitutionId: constitution.id, constitutionRevision: revision,
      ruleId: rule.id, changeType: ChangeType.CREATE, after: rule });
    return rule;
  });
}
export async function updateConstitutionRule(input: { userId: string; actorId?: string; id: string } & ConstitutionRuleInput, db: PrismaClient = prisma) {
  const { userId, actorId } = authorizeConstitutionMutation(input.userId, input.actorId), data = validateConstitutionRule(input);
  return identityTransaction(db, async tx => {
    const old = await tx.salesConstitutionRule.findFirst({ where: { userId, id: input.id, archivedAt: null } });
    if (!old || old.source !== Source.USER_ENTERED) throw new Error('User-owned Constitution rule not found');
    const changed = Object.entries(data).some(([key, value]) => JSON.stringify(canonical(value)) !== JSON.stringify(canonical(old[key as keyof typeof old])));
    if (!changed) return old;
    const rule = await tx.salesConstitutionRule.update({ where: { id: old.id }, data: { ...data,
      constraint: data.constraint as Prisma.InputJsonValue, revision: { increment: 1 } } });
    const constitution = await root(tx, userId);
    const revision = old.enabled || rule.enabled ?
      (await tx.salesConstitution.update({ where: { userId }, data: { revision: { increment: 1 } } })).revision : constitution.revision;
    await writeAudit(tx, { userId, actorId, constitutionId: constitution.id, constitutionRevision: revision,
      ruleId: rule.id, changeType: old.enabled !== rule.enabled ? rule.enabled ? ChangeType.ENABLE : ChangeType.DISABLE : ChangeType.EDIT,
      before: old, after: rule });
    return rule;
  });
}
export async function archiveConstitutionRule(input: { userId: string; actorId?: string; id: string }, db: PrismaClient = prisma) {
  const { userId, actorId } = authorizeConstitutionMutation(input.userId, input.actorId);
  return identityTransaction(db, async tx => {
    const old = await tx.salesConstitutionRule.findFirst({ where: { userId, id: input.id } });
    if (!old || old.source !== Source.USER_ENTERED) throw new Error('User-owned Constitution rule not found');
    if (old.archivedAt) return false;
    const rule = await tx.salesConstitutionRule.update({ where: { id: old.id }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
    const constitution = await root(tx, userId);
    const revision = old.enabled ? (await tx.salesConstitution.update({ where: { userId }, data: { revision: { increment: 1 } } })).revision : constitution.revision;
    await writeAudit(tx, { userId, actorId, constitutionId: constitution.id, constitutionRevision: revision,
      ruleId: old.id, changeType: ChangeType.ARCHIVE, before: old, after: rule });
    return true;
  });
}

function validatedAction(input: ConstitutionAction): ConstitutionAction {
  if (!plain(input)) throw new TypeError('Action is required');
  const allowed = ['actionType', 'proposedDiscountPercent', 'proposedContractMonths', 'proposedClaim', 'topic', 'unsubscribeConfirmed', 'scope'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new TypeError('Unknown action field');
  const actionType = enumValues(input.actionType, ActionType, 'action type');
  if (input.proposedDiscountPercent != null) positive(input.proposedDiscountPercent, 'discount percent', 100);
  if (input.proposedContractMonths != null && (!Number.isInteger(input.proposedContractMonths) || input.proposedContractMonths < 1 || input.proposedContractMonths > 1200)) throw new TypeError('Invalid contract months');
  if (input.proposedClaim != null && (typeof input.proposedClaim !== 'string' || input.proposedClaim.length > 2000)) throw new TypeError('Invalid proposed claim');
  if (input.topic != null) enumValues(input.topic, Category, 'topic');
  if (input.unsubscribeConfirmed != null && typeof input.unsubscribeConfirmed !== 'boolean') throw new TypeError('Invalid unsubscribe status');
  if (input.scope != null) enumValues(input.scope, Scope, 'scope');
  return { actionType, proposedDiscountPercent: input.proposedDiscountPercent ?? null,
    proposedContractMonths: input.proposedContractMonths ?? null, proposedClaim: input.proposedClaim ?? null,
    topic: input.topic ?? null, unsubscribeConfirmed: input.unsubscribeConfirmed ?? null, scope: input.scope ?? null };
}
type Match = 'MATCH' | 'PASS' | 'UNRESOLVED';
const effectRank: Record<Effect, number> = {
  [Effect.BLOCK]: 0, [Effect.REQUIRE_APPROVAL]: 1, [Effect.REQUIRE_HUMAN]: 2, [Effect.REQUIRE_SAFE_RESPONSE]: 3,
};
const severityRank: Record<Severity, number> = {
  [Severity.CRITICAL]: 0, [Severity.HIGH]: 1, [Severity.MEDIUM]: 2, [Severity.LOW]: 3,
};
function precedence(a: SalesConstitutionRule, b: SalesConstitutionRule) {
  return effectRank[a.effect] - effectRank[b.effect] || severityRank[a.severity] - severityRank[b.severity] ||
    b.priority - a.priority || a.id.localeCompare(b.id);
}
function constraintField(constraint: ConstitutionConstraint) {
  return constraint.kind === 'DISCOUNT_PERCENT' ? 'proposedDiscountPercent' :
    constraint.kind === 'MIN_CONTRACT_MONTHS' ? 'proposedContractMonths' :
    constraint.kind === 'PROHIBITED_CLAIM' ? 'proposedClaim' :
    constraint.kind === 'TOPIC' ? 'topic' : constraint.kind === 'UNSUBSCRIBE' ? 'unsubscribeConfirmed' : 'manualReview';
}
function constraintDescription(constraint: ConstitutionConstraint) {
  return constraint.kind === 'DISCOUNT_PERCENT' ? `discount ${constraint.comparison} ${constraint.threshold}%` :
    constraint.kind === 'MIN_CONTRACT_MONTHS' ? `contract shorter than ${constraint.minimum} months` :
    constraint.kind === 'PROHIBITED_CLAIM' ? `claim contains one of ${constraint.terms.length} prohibited phrases` :
    constraint.kind === 'TOPIC' ? `topic is ${constraint.topic}` :
    constraint.kind === 'UNSUBSCRIBE' ? 'confirmed unsubscribe is true' : 'manual interpretation required';
}
function matches(constraint: ConstitutionConstraint, action: ConstitutionAction): Match {
  switch (constraint.kind) {
    case 'DISCOUNT_PERCENT':
      if (action.proposedDiscountPercent == null) return 'UNRESOLVED';
      return (constraint.comparison === 'GT' ? action.proposedDiscountPercent > constraint.threshold : action.proposedDiscountPercent >= constraint.threshold) ? 'MATCH' : 'PASS';
    case 'MIN_CONTRACT_MONTHS':
      if (action.proposedContractMonths == null) return 'UNRESOLVED';
      return action.proposedContractMonths < constraint.minimum ? 'MATCH' : 'PASS';
    case 'PROHIBITED_CLAIM':
      if (!action.proposedClaim?.trim()) return 'UNRESOLVED';
      return constraint.terms.some(term => action.proposedClaim!.toLocaleLowerCase().includes(term.toLocaleLowerCase())) ? 'MATCH' : 'PASS';
    case 'TOPIC': return action.topic == null ? 'UNRESOLVED' : action.topic === constraint.topic ? 'MATCH' : 'PASS';
    case 'UNSUBSCRIBE': return action.unsubscribeConfirmed == null ? 'UNRESOLVED' : action.unsubscribeConfirmed ? 'MATCH' : 'PASS';
    case 'CUSTOM_MANUAL': return 'UNRESOLVED';
  }
}
export async function evaluateSalesConstitution(input: { userId: string; action: ConstitutionAction }, db: PrismaClient = prisma) {
  const userId = own(input.userId), action = validatedAction(input.action);
  // Evaluation is read-only, including when a tenant has not initialized a Constitution.
  if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new Error('Constitution not found for authenticated user');
  const constitution = await db.salesConstitution.findUnique({ where: { userId } });
  const matchedRules: SalesConstitutionRule[] = [], blockingRules: SalesConstitutionRule[] = [];
  const approvalRequirements: SalesConstitutionRule[] = [], humanReviewRequirements: SalesConstitutionRule[] = [];
  const safeResponseRequirements: SalesConstitutionRule[] = [], unresolvedRules: SalesConstitutionRule[] = [];
  const trace: { ruleId: string; ruleName: string; category: Category; scope: Scope; severity: Severity;
    priority: number; effect: Effect; machineEvaluable: boolean; matchResult: Match | 'OUT_OF_SCOPE';
    conditions: { field: string; expected: string; observed: string; result: Match }[];
    finalEffectiveResult: string; precedenceReason: string | null }[] = [];
  if (!constitution) return { authority: CONSTITUTION_AUTHORITY, authorityOrder: POLICY_AUTHORITY_ORDER,
    revision: 0, configurationMissing: true, allowed: false, decision: 'REQUIRES_REVIEW' as const,
    effectiveEffect: null, winningRule: null, winnerReason: 'No Constitution is initialized for this tenant.',
    unresolvedPotentiallyOverrides: true, trace, matchedRules, blockingRules, approvalRequirements,
    humanReviewRequirements, safeResponseRequirements, unresolvedRules };
  let cursor: string | undefined;
  // Exhaust all applicable rules. Context retrieval is bounded; enforcement is not.
  for (;;) {
    const page = await db.salesConstitutionRule.findMany({ where: { userId, constitutionId: constitution.id,
      enabled: true, archivedAt: null, actionTypes: { has: action.actionType } }, orderBy: { id: 'asc' }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const rule of page) {
      const scopeResult: Match = rule.scope === Scope.GLOBAL ? 'MATCH' : action.scope == null ? 'UNRESOLVED' :
        rule.scope === action.scope ? 'MATCH' : 'PASS';
      const conditions: { field: string; expected: string; observed: string; result: Match }[] = [
        { field: 'scope', expected: rule.scope, observed: action.scope ?? 'UNKNOWN', result: scopeResult },
        { field: 'actionType', expected: rule.actionTypes.join(', '), observed: action.actionType, result: 'MATCH' },
      ];
      let result: Match | 'OUT_OF_SCOPE' = scopeResult === 'PASS' ? 'OUT_OF_SCOPE' : scopeResult;
      let machineEvaluable = false;
      if (scopeResult === 'MATCH') {
        // Persisted JSON is validated on write; fail closed if an old or corrupt row is malformed.
        try {
          const constraint = validateConstitutionConstraint(rule.constraint);
          machineEvaluable = constraint.kind !== 'CUSTOM_MANUAL';
          result = matches(constraint, action);
          const value = action[constraintField(constraint) as keyof ConstitutionAction];
          conditions.push({ field: constraintField(constraint), expected: constraintDescription(constraint),
            observed: value == null ? 'UNKNOWN' : typeof value === 'string' ? value.slice(0, 120) : String(value), result });
        } catch {
          result = 'UNRESOLVED';
          conditions.push({ field: 'constraint', expected: 'valid typed constraint', observed: 'INVALID', result: 'UNRESOLVED' });
        }
      }
      trace.push({ ruleId: rule.id, ruleName: rule.name.slice(0, 120), category: rule.category, scope: rule.scope,
        severity: rule.severity, priority: rule.priority, effect: rule.effect, machineEvaluable,
        matchResult: result, conditions, finalEffectiveResult: result === 'MATCH' ? 'MATCHED' : result,
        precedenceReason: null });
      if (result === 'UNRESOLVED') unresolvedRules.push(rule);
      if (result !== 'MATCH') continue;
      matchedRules.push(rule);
      if (rule.effect === Effect.BLOCK) blockingRules.push(rule);
      else if (rule.effect === Effect.REQUIRE_APPROVAL) approvalRequirements.push(rule);
      else if (rule.effect === Effect.REQUIRE_HUMAN) humanReviewRequirements.push(rule);
      else safeResponseRequirements.push(rule);
    }
    if (page.length < 200) break;
    cursor = page[page.length - 1].id;
  }
  const allowed = !blockingRules.length && !approvalRequirements.length && !humanReviewRequirements.length &&
    !safeResponseRequirements.length && !unresolvedRules.length;
  const winner = [...matchedRules].sort(precedence)[0] ?? null;
  const winnerReason = winner ? `Constitution ${winner.effect} takes precedence by effect restrictiveness, then ${winner.severity} severity, priority ${winner.priority}, then stable rule ID.` :
    unresolvedRules.length ? 'Relevant rules are unresolved; missing facts or manual review may change permission.' :
      'No configured rule matched this structured action.';
  // Any unresolved rule can add a safeguard while permission remains non-BLOCKED.
  const unresolvedPotentiallyOverrides = unresolvedRules.length > 0 && winner?.effect !== Effect.BLOCK;
  for (const item of trace) if (item.matchResult === 'MATCH') {
    item.finalEffectiveResult = winner?.id === item.ruleId ? 'WINNING_RULE' : 'MATCHED_SUBORDINATE';
    item.precedenceReason = winner?.id === item.ruleId ? winnerReason : `Rule ${winner?.id} has higher constitutional precedence.`;
  }
  return { authority: CONSTITUTION_AUTHORITY, authorityOrder: POLICY_AUTHORITY_ORDER,
    revision: constitution.revision, configurationMissing: false, allowed,
    decision: blockingRules.length ? 'BLOCKED' as const : allowed ? 'ALLOWED' as const : 'REQUIRES_REVIEW' as const,
    effectiveEffect: winner?.effect ?? null,
    winningRule: winner ? { id: winner.id, name: winner.name, effect: winner.effect, severity: winner.severity,
      scope: winner.scope, priority: winner.priority } : null,
    winnerReason, unresolvedPotentiallyOverrides, trace,
    matchedRules, blockingRules, approvalRequirements, humanReviewRequirements, safeResponseRequirements, unresolvedRules };
}

function overlapKeys(constraint: ConstitutionConstraint): string[] {
  switch (constraint.kind) {
    case 'DISCOUNT_PERCENT': return [`discount:${constraint.comparison}:${constraint.threshold}`];
    case 'MIN_CONTRACT_MONTHS': return [`contract-min:${constraint.minimum}`];
    case 'PROHIBITED_CLAIM': return constraint.terms.map(v => `claim:${clean(v).toLowerCase()}`);
    case 'TOPIC': return [`topic:${constraint.topic}`];
    case 'UNSUBSCRIBE': return ['unsubscribe:confirmed'];
    case 'CUSTOM_MANUAL': return []; // Unknown conditions cannot prove a conflict.
  }
}
function incompatible(a: Effect, b: Effect) {
  if (a === b) return false;
  if (a === Effect.BLOCK || b === Effect.BLOCK) return true;
  return (a === Effect.REQUIRE_SAFE_RESPONSE && (b === Effect.REQUIRE_APPROVAL || b === Effect.REQUIRE_HUMAN)) ||
    (b === Effect.REQUIRE_SAFE_RESPONSE && (a === Effect.REQUIRE_APPROVAL || a === Effect.REQUIRE_HUMAN));
}
export async function detectConstitutionConflicts(input: { userId: string; constitutionId?: string }, db: PrismaClient = prisma) {
  const userId = own(input.userId);
  if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new Error('Constitution not found for authenticated user');
  const constitution = await db.salesConstitution.findUnique({ where: { userId } });
  if (input.constitutionId && input.constitutionId !== constitution?.id) throw new Error('Constitution not found for authenticated user');
  if (!constitution) return { revision: 0, conflicts: [] };
  const buckets = new Map<string, SalesConstitutionRule[]>();
  let cursor: string | undefined;
  for (;;) {
    const page = await db.salesConstitutionRule.findMany({ where: { userId, constitutionId: constitution.id,
      enabled: true, archivedAt: null }, orderBy: { id: 'asc' }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const rule of page) {
      let keys: string[];
      try { keys = overlapKeys(validateConstitutionConstraint(rule.constraint)); } catch { continue; }
      for (const key of keys) {
        const bucket = buckets.get(key) ?? [];
        bucket.push(rule);
        buckets.set(key, bucket);
      }
    }
    if (page.length < 200) break;
    cursor = page[page.length - 1].id;
  }
  const seen = new Set<string>();
  const conflicts: { ruleIds: [string, string]; rules: { id: string; name: string; effect: Effect;
    severity: Severity; priority: number; scope: Scope }[]; overlapReason: string;
    winningRuleId: string; winningEffect: Effect; explanation: string }[] = [];
  for (const [condition, rules] of buckets) for (let i = 0; i < rules.length; i++) for (let j = i + 1; j < rules.length; j++) {
    const a = rules[i], b = rules[j], pair = [a.id, b.id].sort() as [string, string];
    if (seen.has(pair.join('|')) || !incompatible(a.effect, b.effect)) continue;
    if (!(a.scope === Scope.GLOBAL || b.scope === Scope.GLOBAL || a.scope === b.scope)) continue;
    const actions = a.actionTypes.filter(v => b.actionTypes.includes(v));
    if (!actions.length) continue;
    seen.add(pair.join('|'));
    const winner = precedence(a, b) <= 0 ? a : b;
    conflicts.push({ ruleIds: pair,
      rules: [a, b].sort((x, y) => x.id.localeCompare(y.id)).map(r => ({ id: r.id, name: r.name,
        effect: r.effect, severity: r.severity, priority: r.priority, scope: r.scope })),
      overlapReason: `Scopes ${a.scope}/${b.scope} and action ${actions.join(', ')} overlap on ${condition.slice(0, 160)}.`,
      winningRuleId: winner.id, winningEffect: winner.effect,
      explanation: `${winner.name} wins by restrictive effect, then severity, priority, and stable rule ID.` });
  }
  conflicts.sort((a, b) => a.ruleIds.join('|').localeCompare(b.ruleIds.join('|')));
  return { revision: constitution.revision, conflicts };
}

function render(rule: SalesConstitutionRule) {
  const constraint = validateConstitutionConstraint(rule.constraint);
  const summary = constraint.kind === 'DISCOUNT_PERCENT' ? `Discount ${constraint.comparison} ${constraint.threshold}%` :
    constraint.kind === 'MIN_CONTRACT_MONTHS' ? `Contract shorter than ${constraint.minimum} months` :
    constraint.kind === 'PROHIBITED_CLAIM' ? `Prohibited claim phrases: ${constraint.terms.join(', ').slice(0, 240)}` :
    constraint.kind === 'TOPIC' ? `Topic ${constraint.topic}` : constraint.kind === 'UNSUBSCRIBE' ? 'Confirmed unsubscribe' :
    'Manual review required; not machine-evaluable';
  return `${rule.category} | ${rule.effect} | severity ${rule.severity} | scope ${rule.scope} | priority ${rule.priority} | ${rule.name.slice(0, 120)} | ${summary} | ${rule.description.slice(0, 300)} | source ${rule.source} | rule revision ${rule.revision}`;
}
export async function getSalesConstitutionContext(input: { userId: string; purpose?: ConstitutionPurpose; categories?: Category[];
  maxRules?: number; maxCharacters?: number }, db: PrismaClient = prisma) {
  const userId = own(input.userId), constitution = await getOrCreateSalesConstitution(userId, db);
  if (input.purpose && !purposeCategories[input.purpose]) throw new TypeError('Invalid Constitution purpose');
  if (input.categories && (!Array.isArray(input.categories) || input.categories.some(c => !Object.values(Category).includes(c)))) throw new TypeError('Invalid category');
  const explicit = [...new Set(input.categories ?? [])], relevant = input.purpose ? [...purposeCategories[input.purpose], Category.CUSTOM] : explicit.length ? [Category.CUSTOM] : [];
  const maxRules = Math.min(10, Math.max(1, input.maxRules ?? 6)), maxCharacters = Math.min(5000, Math.max(1, input.maxCharacters ?? 3000));
  const common = { userId, constitutionId: constitution.id, enabled: true, archivedAt: null };
  const orderBy = [{ priority: 'desc' as const }, { id: 'asc' as const }];
  // Reserve capacity both for explicit categories and for hard BLOCK effects.
  const groups = explicit.length ? [explicit, relevant.filter(c => !explicit.includes(c))] : [relevant];
  const candidates: SalesConstitutionRule[] = [];
  for (const group of groups) {
    if (explicit.length && !group.length) continue;
    const scope = { ...common, ...(group.length ? { category: { in: group } } : {}) };
    candidates.push(...await db.salesConstitutionRule.findMany({ where: { ...scope, effect: Effect.BLOCK }, orderBy, take: explicit.length ? 25 : 50 }));
    candidates.push(...await db.salesConstitutionRule.findMany({ where: { ...scope, effect: { not: Effect.BLOCK } }, orderBy, take: explicit.length ? 25 : 50 }));
  }
  candidates.sort((a, b) => (explicit.includes(a.category) ? 0 : relevant.includes(a.category) ? 1 : 2) -
    (explicit.includes(b.category) ? 0 : relevant.includes(b.category) ? 1 : 2) || effectRank[a.effect] - effectRank[b.effect] ||
    severityRank[a.severity] - severityRank[b.severity] || b.priority - a.priority || a.id.localeCompare(b.id));
  const rules: { id: string; category: Category; effect: Effect; severity: Severity; scope: Scope;
    priority: number; source: Source; revision: number; text: string; machineEvaluable: boolean }[] = [];
  let used = 0;
  for (const rule of candidates) {
    if (rules.length >= maxRules) break;
    let text: string;
    try { text = render(rule).slice(0, 700); } catch { text = `${rule.category} | ${rule.effect} | Invalid constraint; manual review required`; }
    if (used + text.length + 1 > maxCharacters) continue;
    rules.push({ id: rule.id, category: rule.category, effect: rule.effect, severity: rule.severity,
      scope: rule.scope, priority: rule.priority, source: rule.source,
      revision: rule.revision, text, machineEvaluable: (rule.constraint as { kind?: string }).kind !== 'CUSTOM_MANUAL' });
    used += text.length + 1;
  }
  return { revision: constitution.revision, rules, contextText: rules.map(r => r.text).join('\n') };
}
