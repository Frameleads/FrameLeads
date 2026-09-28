import { RevenueScenario as Scenario, RevenueDirection as Direction, RevenuePlaybookSource as Source,
  ProspectQualificationStatus as Qualification, type Prisma, type PrismaClient, type RevenuePlaybookRule } from '@prisma/client';
import { prisma } from './prisma';
import { identityTransaction } from './prospects/identity';

export type PlaybookPurpose = 'outbound' | 'reply_decision' | 'objection_handling' | 'pricing' | 'integration' |
  'follow_up' | 'meeting' | 'qualification' | 'sandbox';
const purposeScenarios: Record<PlaybookPurpose, Scenario[]> = {
  outbound: [Scenario.GENERAL, Scenario.POSITIVE_INTENT, Scenario.MEETING, Scenario.PROOF],
  reply_decision: [Scenario.PRICING, Scenario.INTEGRATION, Scenario.SECURITY, Scenario.TIMING, Scenario.OBJECTION, Scenario.POSITIVE_INTENT],
  objection_handling: [Scenario.OBJECTION, Scenario.BUDGET, Scenario.FEATURE_GAP, Scenario.COMPETITOR, Scenario.TIMING],
  pricing: [Scenario.PRICING, Scenario.DISCOUNT, Scenario.BUDGET, Scenario.PROCUREMENT],
  integration: [Scenario.INTEGRATION, Scenario.IMPLEMENTATION, Scenario.FEATURE_GAP],
  follow_up: [Scenario.SILENCE_FOLLOWUP, Scenario.NOT_NOW, Scenario.TIMING],
  meeting: [Scenario.MEETING, Scenario.DEMO, Scenario.POSITIVE_INTENT],
  qualification: [Scenario.AUTHORITY, Scenario.STAKEHOLDER, Scenario.BUDGET, Scenario.TIMING],
  sandbox: [Scenario.GENERAL, Scenario.PROOF, Scenario.MEETING, Scenario.POSITIVE_INTENT],
};
export type PlaybookRuleInput = {
  name: string; scenario: Scenario; customScenario?: string | null; objective: string; guidance: string; nextAction: string;
  responsePrinciples?: string[]; ctaGuidance?: string | null; qualificationCondition?: Qualification | null;
  direction?: Direction | null; priority?: number; enabled?: boolean;
};
function owner(userId: string) { if (!userId?.trim()) throw new TypeError('Authenticated userId required'); return userId.trim(); }
function clean(value: string) { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); }
function field(value: unknown, name: string, max: number, required = true): string | null {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > max) throw new TypeError(`${name} is invalid or too long`);
  const result = clean(value);
  if (required && !result) throw new TypeError(`${name} is required`);
  return result || null;
}
export function validatePlaybookRule(input: PlaybookRuleInput) {
  if (!Object.values(Scenario).includes(input.scenario)) throw new TypeError('Invalid scenario');
  const customScenario = field(input.customScenario, 'Custom scenario', 100, false);
  if (input.scenario === Scenario.CUSTOM && !customScenario) throw new TypeError('Custom scenario is required');
  if (input.scenario !== Scenario.CUSTOM && customScenario) throw new TypeError('Custom scenario is only valid for CUSTOM');
  if (input.direction != null && !Object.values(Direction).includes(input.direction)) throw new TypeError('Invalid direction');
  if (input.qualificationCondition != null && !Object.values(Qualification).includes(input.qualificationCondition)) throw new TypeError('Invalid qualification condition');
  const priority = input.priority ?? 1;
  if (!Number.isInteger(priority) || priority < 1 || priority > 3) throw new TypeError('Priority must be 1–3');
  if (input.enabled != null && typeof input.enabled !== 'boolean') throw new TypeError('Enabled must be boolean');
  const principles = input.responsePrinciples ?? [];
  if (!Array.isArray(principles) || principles.length > 6 || principles.some(v => typeof v !== 'string' || v.length > 160 || !clean(v)))
    throw new TypeError('Response principles must be up to six short phrases');
  return { name: field(input.name, 'Name', 120)!, scenario: input.scenario, customScenario,
    objective: field(input.objective, 'Objective', 1000)!, guidance: field(input.guidance, 'Guidance', 3000)!,
    nextAction: field(input.nextAction, 'Next action', 1000)!, responsePrinciples: principles.map(clean),
    ctaGuidance: field(input.ctaGuidance, 'CTA guidance', 500, false),
    qualificationCondition: input.qualificationCondition ?? null, direction: input.direction ?? null,
    priority, enabled: input.enabled ?? true };
}

async function root(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error('Playbook not found for authenticated user');
  return tx.revenuePlaybook.upsert({ where: { userId }, create: { userId }, update: {} });
}
export function getOrCreateRevenuePlaybook(userId: string, db: PrismaClient = prisma) {
  return identityTransaction(db, tx => root(tx, owner(userId)));
}
export async function getPlaybookRevision(userId: string, db: PrismaClient = prisma) {
  const playbook = await getOrCreateRevenuePlaybook(userId, db);
  return playbook.revision;
}
export async function listPlaybookRules(input: { userId: string; take?: number; cursor?: string; includeArchived?: boolean }, db: PrismaClient = prisma) {
  const userId = owner(input.userId);
  await getOrCreateRevenuePlaybook(userId, db);
  if (input.cursor && !await db.revenuePlaybookRule.findFirst({ where: { userId, id: input.cursor }, select: { id: true } }))
    throw new Error('Playbook cursor not found for authenticated user');
  return db.revenuePlaybookRule.findMany({ where: { userId, ...(input.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ scenario: 'asc' }, { priority: 'desc' }, { id: 'asc' }], take: Math.min(100, Math.max(1, input.take ?? 50)),
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
}
export async function createPlaybookRule(input: { userId: string } & PlaybookRuleInput, db: PrismaClient = prisma) {
  const userId = owner(input.userId), data = validatePlaybookRule(input);
  return identityTransaction(db, async tx => {
    const playbook = await root(tx, userId);
    const rule = await tx.revenuePlaybookRule.create({ data: { userId, playbookId: playbook.id, ...data, source: Source.USER_ENTERED } });
    if (rule.enabled) await tx.revenuePlaybook.update({ where: { userId }, data: { revision: { increment: 1 } } });
    return rule;
  });
}
export async function updatePlaybookRule(input: { userId: string; id: string } & PlaybookRuleInput, db: PrismaClient = prisma) {
  const userId = owner(input.userId), data = validatePlaybookRule(input);
  return identityTransaction(db, async tx => {
    const old = await tx.revenuePlaybookRule.findFirst({ where: { userId, id: input.id, archivedAt: null } });
    if (!old || old.source !== Source.USER_ENTERED) throw new Error('User-owned playbook rule not found');
    const keys = Object.keys(data) as (keyof typeof data)[];
    const changed = keys.some(key => Array.isArray(data[key]) ? JSON.stringify(data[key]) !== JSON.stringify(old[key]) : data[key] !== old[key]);
    if (!changed) return old;
    const wasEnabled = old.enabled;
    const rule = await tx.revenuePlaybookRule.update({ where: { id: old.id }, data: { ...data, revision: { increment: 1 } } });
    if (wasEnabled || rule.enabled) await tx.revenuePlaybook.update({ where: { userId }, data: { revision: { increment: 1 } } });
    return rule;
  });
}
export async function archivePlaybookRule(input: { userId: string; id: string }, db: PrismaClient = prisma) {
  const userId = owner(input.userId);
  return identityTransaction(db, async tx => {
    const old = await tx.revenuePlaybookRule.findFirst({ where: { userId, id: input.id } });
    if (!old || old.source !== Source.USER_ENTERED) throw new Error('User-owned playbook rule not found');
    if (old.archivedAt) return false;
    await tx.revenuePlaybookRule.update({ where: { id: old.id }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
    if (old.enabled) await tx.revenuePlaybook.update({ where: { userId }, data: { revision: { increment: 1 } } });
    return true;
  });
}

function render(rule: RevenuePlaybookRule) {
  const label = rule.scenario === Scenario.CUSTOM ? `CUSTOM (${rule.customScenario})` : rule.scenario;
  return `Scenario: ${label}; Source: ${rule.source}; Objective: ${rule.objective.slice(0, 250)}; Guidance: ${rule.guidance.slice(0, 650)}; Preferred next action: ${rule.nextAction.slice(0, 250)}${rule.responsePrinciples.length ? `; Response principles: ${rule.responsePrinciples.join(', ').slice(0, 180)}` : ''}${rule.ctaGuidance ? `; CTA: ${rule.ctaGuidance.slice(0, 120)}` : ''}; Priority: ${rule.priority}.`;
}
export async function getPlaybookContext(input: { userId: string; purpose?: PlaybookPurpose; scenarios?: Scenario[];
  qualificationStatus?: Qualification; direction?: Direction; maxRules?: number; maxCharacters?: number }, db: PrismaClient = prisma) {
  const userId = owner(input.userId);
  const playbook = await getOrCreateRevenuePlaybook(userId, db);
  if (input.purpose && !purposeScenarios[input.purpose]) throw new TypeError('Invalid Playbook purpose');
  if (input.scenarios?.some(s => !Object.values(Scenario).includes(s))) throw new TypeError('Invalid scenario');
  if (input.qualificationStatus && !Object.values(Qualification).includes(input.qualificationStatus)) throw new TypeError('Invalid qualification status');
  if (input.direction && !Object.values(Direction).includes(input.direction)) throw new TypeError('Invalid direction');
  const explicit = input.scenarios ?? [], relevant = input.purpose ? purposeScenarios[input.purpose] : [];
  const scenarios = [...new Set([...explicit, ...relevant, Scenario.GENERAL])];
  const maxRules = Math.min(10, Math.max(1, input.maxRules ?? 6)), maxCharacters = Math.min(5000, Math.max(1, input.maxCharacters ?? 3000));
  const common = { userId, playbookId: playbook.id, enabled: true, archivedAt: null,
    AND: [input.qualificationStatus ? { OR: [{ qualificationCondition: null }, { qualificationCondition: input.qualificationStatus }] } : { qualificationCondition: null },
      input.direction ? { OR: [{ direction: null }, { direction: input.direction }] } : { direction: null }] };
  const orderBy = [{ priority: 'desc' as const }, { updatedAt: 'desc' as const }];
  // Reserve capacity for explicitly detected scenarios before broad purpose defaults.
  const candidates = explicit.length ? [
    ...await db.revenuePlaybookRule.findMany({ where: { ...common, scenario: { in: explicit } }, orderBy, take: 50 }),
    ...await db.revenuePlaybookRule.findMany({ where: { ...common, scenario: { in: scenarios.filter(s => !explicit.includes(s)) } }, orderBy, take: 50 }),
  ] : await db.revenuePlaybookRule.findMany({ where: { ...common, scenario: { in: scenarios } }, orderBy, take: 100 });
  candidates.sort((a, b) => {
    const rank = (r: RevenuePlaybookRule) => explicit.includes(r.scenario) ? 0 : relevant.includes(r.scenario) ? 1 : 2;
    return rank(a) - rank(b) || b.priority - a.priority ||
      Number(Boolean(b.qualificationCondition || b.direction || b.customScenario)) - Number(Boolean(a.qualificationCondition || a.direction || a.customScenario)) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id);
  });
  const selected: { id: string; scenario: Scenario; priority: number; source: Source; text: string }[] = [];
  let used = 0;
  for (const rule of candidates) {
    if (selected.length >= maxRules) break;
    const text = render(rule);
    if (used + text.length + 1 > maxCharacters) continue;
    selected.push({ id: rule.id, scenario: rule.scenario, priority: rule.priority, source: rule.source, text });
    used += text.length + 1;
  }
  return { revision: playbook.revision, rules: selected, contextText: selected.map(r => r.text).join('\n').slice(0, maxCharacters) };
}
