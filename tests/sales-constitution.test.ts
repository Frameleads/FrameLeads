import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConstitutionActionType as A, ConstitutionCategory as C, ConstitutionEffect as E,
  ConstitutionSource as S, type PrismaClient } from '@prisma/client';
import { archiveConstitutionRule, createConstitutionRule, detectConstitutionConflicts, evaluateSalesConstitution,
  getConstitutionRevision, getOrCreateSalesConstitution, getSalesConstitutionContext,
  listConstitutionRevisionEvents, listConstitutionRules, updateConstitutionRule,
  validateConstitutionRule, POLICY_AUTHORITY_ORDER } from '../src/lib/sales-constitution';
import { buildSalesConstitutionFacts, loadSalesConstitutionFacts,
  selectConstitutionAccountFacts } from '../src/lib/sales-constitution-facts';
import { parseNumericConditionValue } from '../src/lib/sales-constitution-editor-validation';
import { formatConstitutionCategory, formatConstitutionCondition, formatConstitutionLabel,
  formatConstitutionScope } from '../src/lib/sales-constitution-presentation';

const base = { name: 'Discount approval', category: C.DISCOUNT, effect: E.REQUIRE_APPROVAL,
  description: 'Discounts above twenty percent require approval.',
  constraint: { kind: 'DISCOUNT_PERCENT' as const, threshold: 20, comparison: 'GT' as const }, actionTypes: [A.DISCOUNT] };

test('Constitution rule presentation formats canonical conditions and secondary labels', () => {
  assert.equal(formatConstitutionCondition({ kind: 'DISCOUNT_PERCENT', threshold: 10, comparison: 'GT' }), 'Discount > 10%');
  assert.equal(formatConstitutionCondition({ kind: 'DISCOUNT_PERCENT', threshold: 12.5, comparison: 'GTE' }), 'Discount ≥ 12.5%');
  assert.equal(formatConstitutionCondition({ kind: 'MIN_CONTRACT_MONTHS', minimum: 12 }), 'Contract term below 12 months');
  assert.equal(formatConstitutionCondition({ kind: 'FACT', field: 'FIT_TIER', operator: 'EQ', value: 'STRONG' }), 'Fit Tier is Strong');
  assert.equal(formatConstitutionCondition({ kind: 'ALL', conditions: [
    { kind: 'FACT', field: 'CONFIDENCE', operator: 'GTE', value: 80 },
    { kind: 'FACT', field: 'RISK_BAND', operator: 'NEQ', value: 'HIGH' },
  ] }), 'Confidence ≥ 80 and Risk Band is not High');
  assert.equal(formatConstitutionLabel('REQUIRE_APPROVAL'), 'Require Approval');
  assert.equal(formatConstitutionCategory('DISCOUNT'), 'Pricing Governance');
  assert.equal(formatConstitutionScope('PRICING', 'USER_ENTERED'), 'Pricing · User Entered');
});
function fixture() {
  const roots: any[] = [], rules: any[] = [], events: any[] = [];
  let usage = 0;
  const tx: any = {
    user: { findUnique: async ({ where }: any) => ['a', 'b'].includes(where.id) ? { id: where.id } : null },
    salesConstitution: {
      findUnique: async ({ where }: any) => { const row = roots.find(p => p.userId === where.userId); return row ? { ...row } : null; },
      upsert: async ({ where, create }: any) => { let row = roots.find(p => p.userId === where.userId);
        if (!row) { row = { id: `c-${where.userId}`, revision: 0, name: 'Company Sales Constitution', ...create }; roots.push(row); }
        return { ...row }; },
      update: async ({ where, data }: any) => { const row = roots.find(p => p.userId === where.userId);
        row.revision += data.revision.increment; return { ...row }; },
    },
    salesConstitutionRule: {
      create: async ({ data }: any) => { const row = { id: `r${rules.length + 1}`, revision: 1, archivedAt: null,
        severity: 'MEDIUM', scope: 'GLOBAL',
        sourceKey: null, updatedAt: new Date(), ...data }; rules.push(row); return { ...row }; },
      findFirst: async ({ where }: any) => { const row = rules.find(r => r.userId === where.userId && r.id === where.id &&
        (where.archivedAt === undefined || r.archivedAt === where.archivedAt)); return row ? { ...row } : null; },
      update: async ({ where, data }: any) => { const row = rules.find(r => r.id === where.id);
        if (data.revision) row.revision += data.revision.increment;
        Object.assign(row, { ...data, revision: row.revision, updatedAt: new Date() }); return { ...row }; },
      findMany: async ({ where, orderBy, take, cursor, skip }: any) => {
        let rows = rules.filter(r => r.userId === where.userId &&
          (where.constitutionId === undefined || r.constitutionId === where.constitutionId) &&
          (where.enabled === undefined || r.enabled === where.enabled) &&
          (where.archivedAt === undefined || r.archivedAt === where.archivedAt) &&
          (!where.actionTypes || r.actionTypes.includes(where.actionTypes.has)) &&
          (!where.category || where.category.in.includes(r.category)) &&
          (!where.effect || (typeof where.effect === 'string' ? r.effect === where.effect : r.effect !== where.effect.not)));
        rows = rows.sort((a, b) => Array.isArray(orderBy) ? b.priority - a.priority || a.id.localeCompare(b.id) : a.id.localeCompare(b.id));
        if (cursor) rows = rows.slice(Math.max(0, rows.findIndex(r => r.id === cursor.id) + (skip || 0)));
        return rows.slice(0, take ?? rows.length).map(r => ({ ...r }));
      },
    },
    salesConstitutionRevisionEvent: {
      create: async ({ data }: any) => { const row = { id: `e${events.length + 1}`, createdAt: new Date(), ...data }; events.push(row); return { ...row }; },
      findFirst: async ({ where }: any) => events.find(e => e.userId === where.userId && e.constitutionId === where.constitutionId && e.id === where.id) || null,
      findMany: async ({ where, take, cursor, skip }: any) => {
        let rows = events.filter(e => e.userId === where.userId && e.constitutionId === where.constitutionId).reverse();
        if (cursor) rows = rows.slice(Math.max(0, rows.findIndex(e => e.id === cursor.id) + (skip || 0)));
        return rows.slice(0, take).map(e => ({ ...e }));
      },
    },
    aIUsageEvent: { create: async () => { usage++; throw new Error('No AI usage allowed'); } },
  };
  return { db: { ...tx, $transaction: async (work: any) => work(tx) } as PrismaClient, roots, rules, events, usage: () => usage };
}

const contextual = (constraint: any, effect: E = E.REQUIRE_APPROVAL) => ({ userId: 'a',
  name: 'Context boundary', category: C.CUSTOM, effect,
  description: 'Contextual decision requires review.', constraint, actionTypes: [A.TOPIC_RESPONSE] });
const fact = (field: string, operator: string, value: string | number) => ({ kind: 'FACT', field, operator, value });
async function contextResult(constraint: any, facts: any, effect: E = E.REQUIRE_APPROVAL) {
  const f = fixture();
  await createConstitutionRule(contextual(constraint, effect), f.db);
  const result = await evaluateSalesConstitution({ userId: 'a',
    action: { actionType: A.TOPIC_RESPONSE, facts } }, f.db);
  return { result, fixture: f };
}

test('contextual fit, qualification, intent, confidence, and risk use canonical facts', async () => {
  const facts = buildSalesConstitutionFacts({ qualificationStatus: 'QUALIFIED', fitTier: 'STRONG',
    primaryIntent: 'PRICING_INQUIRY', secondaryIntents: ['LEGAL'], confidence: 75, riskBand: 'HIGH' });
  for (const condition of [fact('FIT_TIER','EQ','STRONG'), fact('QUALIFICATION_STATUS','EQ','QUALIFIED'),
    fact('PRIMARY_INTENT','EQ','PRICING_INQUIRY'), fact('SECONDARY_INTENT','CONTAINS','LEGAL'),
    fact('CONFIDENCE','LT',80), fact('RISK_BAND','EQ','HIGH')]) {
    const { result } = await contextResult(condition, facts);
    assert.equal(result.approvalRequirements.length, 1, condition.field);
    assert.equal(result.trace[0].conditions.at(-1)?.result, 'MATCH');
  }
});

test('prospect attributes and ranges evaluate conservatively', async () => {
  const facts = buildSalesConstitutionFacts({ jobTitle: 'VP Sales', industry: 'B2B SaaS', country: 'US',
    companySizeMin: 201, companySizeMax: 1000 });
  for (const condition of [fact('JOB_TITLE','EQ','vp sales'), fact('INDUSTRY','EQ','B2B SaaS'), fact('COUNTRY','EQ','us')])
    assert.equal((await contextResult(condition, facts)).result.matchedRules.length, 1);
  assert.equal((await contextResult(fact('COMPANY_SIZE','GTE',200), facts)).result.matchedRules.length, 1);
  assert.equal((await contextResult(fact('COMPANY_SIZE','LTE',500), facts)).result.unresolvedRules.length, 1);
  assert.equal((await contextResult(fact('COMPANY_SIZE','LT',100), facts)).result.matchedRules.length, 0);
});

test('missing contextual fact is UNRESOLVED and visible in trace', async () => {
  const { result } = await contextResult(fact('RISK_BAND','EQ','HIGH'), buildSalesConstitutionFacts({}));
  assert.equal(result.unresolvedRules.length, 1);
  assert.equal(result.decision, 'REQUIRES_REVIEW');
  assert.equal(result.trace[0].conditions.at(-1)?.observed, 'UNKNOWN');
});

test('ALL and ANY preserve matched, not matched, and unresolved semantics', async () => {
  const strong = fact('FIT_TIER','EQ','STRONG'), pricing = fact('PRIMARY_INTENT','EQ','PRICING_INQUIRY');
  const all = { kind: 'ALL', conditions: [strong, pricing] }, any = { kind: 'ANY', conditions: [strong, pricing] };
  assert.equal((await contextResult(all, { FIT_TIER: 'STRONG', PRIMARY_INTENT: 'PRICING_INQUIRY' })).result.matchedRules.length, 1);
  assert.equal((await contextResult(all, { FIT_TIER: 'WEAK' })).result.unresolvedRules.length, 0);
  assert.equal((await contextResult(all, { FIT_TIER: 'STRONG' })).result.unresolvedRules.length, 1);
  assert.equal((await contextResult(any, { FIT_TIER: 'STRONG' })).result.matchedRules.length, 1);
  assert.equal((await contextResult(any, { FIT_TIER: 'WEAK' })).result.unresolvedRules.length, 1);
  assert.equal((await contextResult(any, { FIT_TIER: 'WEAK', PRIMARY_INTENT: 'LEGAL' })).result.allowed, true);
  const traced = (await contextResult(all, { FIT_TIER: 'STRONG' })).result.trace[0].conditions;
  assert.deepEqual(traced.slice(-3).map(c => c.field), ['FIT_TIER','PRIMARY_INTENT','ALL']);
});

test('invalid operators, values, depth, and leaf count fail validation', () => {
  for (const constraint of [fact('FIT_TIER','LT','STRONG'), fact('CONFIDENCE','EQ',80),
    fact('PRIMARY_INTENT','EQ','MADE_UP'), { kind: 'ALL', conditions: [] },
    { kind: 'ALL', conditions: Array(7).fill(fact('FIT_TIER','EQ','STRONG')) },
    { kind: 'ALL', conditions: [{ kind: 'ANY', conditions: [{ kind: 'ALL', conditions: [fact('FIT_TIER','EQ','STRONG')] }] }] }])
    assert.throws(() => validateConstitutionRule(contextual(constraint)), TypeError);
});

test('contextual restrictive effects win and conflict claims require proven overlap', async () => {
  const f = fixture();
  const condition = fact('FIT_TIER','EQ','STRONG');
  await createConstitutionRule(contextual(condition, E.REQUIRE_SAFE_RESPONSE), f.db);
  await createConstitutionRule({ ...contextual(condition, E.REQUIRE_APPROVAL), name: 'Approval' }, f.db);
  const result = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE,
    facts: { FIT_TIER: 'STRONG' } } }, f.db);
  assert.equal(result.effectiveEffect, E.REQUIRE_APPROVAL);
  assert.equal((await detectConstitutionConflicts({ userId: 'a' }, f.db)).conflicts.length, 1);
  const compound = { kind: 'ALL', conditions: [condition, fact('PRIMARY_INTENT','EQ','PRICING_INQUIRY')] };
  await createConstitutionRule({ ...contextual(compound, E.BLOCK), name: 'Compound block' }, f.db);
  assert.equal((await detectConstitutionConflicts({ userId: 'a' }, f.db)).conflicts.length, 1);
  assert.equal((await contextResult(condition, { FIT_TIER: 'STRONG' }, E.REQUIRE_HUMAN)).result.humanReviewRequirements.length, 1);
});

test('canonical loader is tenant-scoped and preserves unknown risk', async () => {
  const seen: any[] = [];
  const db: any = {
    prospect: { findUnique: async ({ where }: any) => { seen.push(where); return where.userId_id.userId === 'a' ?
      { jobTitle: 'VP Sales', industry: 'Prospect Services', country: 'US', companySizeMin: 201, companySizeMax: null,
        company: { industry: 'Company SaaS', companySizeMin: 50, companySizeMax: 500 } } : null; } },
    prospectQualification: { findUnique: async ({ where }: any) => { seen.push(where); return { status: 'QUALIFIED' }; } },
    prospectIntelligence: { findUnique: async ({ where }: any) => { seen.push(where); return { fitTier: 'STRONG' }; } },
    decisionRevenueRisk: { findFirst: async ({ where }: any) => { seen.push(where); return null; } },
  };
  const facts = await loadSalesConstitutionFacts({ userId: 'a', prospectId: 'p', decisionId: 'd' }, db);
  assert.equal(facts.RISK_BAND, null);
  const decisionTime = selectConstitutionAccountFacts(
    { industry: 'Prospect Services', companySizeMin: 201, companySizeMax: null },
    { industry: 'Company SaaS', companySizeMin: 50, companySizeMax: 500 });
  assert.equal(decisionTime.industry, facts.INDUSTRY);
  assert.deepEqual({ min: decisionTime.companySizeMin, max: decisionTime.companySizeMax }, facts.COMPANY_SIZE);
  assert.equal(facts.INDUSTRY, 'Company SaaS');
  assert.deepEqual(facts.COMPANY_SIZE, { min: 50, max: 500 });
  assert.deepEqual(selectConstitutionAccountFacts(
    { industry: 'Prospect Services', companySizeMin: 201, companySizeMax: null },
    { industry: ' ', companySizeMin: null, companySizeMax: null }),
    { industry: 'Prospect Services', companySizeMin: 201, companySizeMax: null });
  assert.ok(seen.every(where => where.userId_id?.userId === 'a' || where.userId_prospectId?.userId === 'a' || where.userId === 'a'));
  await assert.rejects(loadSalesConstitutionFacts({ userId: 'b', prospectId: 'p' }, db), /not found/);
});

test('blank numeric condition is rejected while zero remains valid', () => {
  for (const value of ['', '  ', 'NaN', 'Infinity']) assert.throws(() => parseNumericConditionValue(value), /numeric condition/);
  assert.equal(parseNumericConditionValue('0'), 0);
  assert.equal(parseNumericConditionValue('80'), 80);
});

test('one tenant root; reads, mutation and evaluation cannot cross tenants', async () => {
  const f = fixture();
  await getOrCreateSalesConstitution('a', f.db); await getOrCreateSalesConstitution('a', f.db);
  assert.equal(f.roots.length, 1);
  const rule = await createConstitutionRule({ userId: 'a', ...base }, f.db);
  assert.equal((await listConstitutionRules({ userId: 'b' }, f.db)).length, 0);
  await assert.rejects(listConstitutionRules({ userId: 'b', cursor: rule.id }, f.db), /cursor not found/);
  await assert.rejects(updateConstitutionRule({ userId: 'b', id: rule.id, ...base }, f.db), /not found/);
  await assert.rejects(archiveConstitutionRule({ userId: 'b', id: rule.id }, f.db), /not found/);
  assert.equal((await evaluateSalesConstitution({ userId: 'b', action: { actionType: A.DISCOUNT, proposedDiscountPercent: 25 } }, f.db)).matchedRules.length, 0);
  assert.equal((await getSalesConstitutionContext({ userId: 'b', categories: [C.DISCOUNT] }, f.db)).rules.length, 0);
  await assert.rejects(getOrCreateSalesConstitution('unknown', f.db), /not found/);
});

test('CRUD, provenance and effective revision changes; no-op and disabled edits do not increment', async () => {
  const f = fixture();
  const r = await createConstitutionRule({ userId: 'a', ...base }, f.db);
  assert.equal(r.source, S.USER_ENTERED); assert.equal(await getConstitutionRevision('a', f.db), 1);
  f.rules[0].constraint = { comparison: 'GT', kind: 'DISCOUNT_PERCENT', threshold: 20 }; // JSONB key order can differ.
  await updateConstitutionRule({ userId: 'a', id: r.id, ...base }, f.db);
  assert.equal(await getConstitutionRevision('a', f.db), 1);
  await updateConstitutionRule({ userId: 'a', id: r.id, ...base, effect: E.BLOCK }, f.db);
  assert.equal(await getConstitutionRevision('a', f.db), 2);
  await updateConstitutionRule({ userId: 'a', id: r.id, ...base, effect: E.BLOCK, enabled: false }, f.db);
  assert.equal(await getConstitutionRevision('a', f.db), 3);
  await updateConstitutionRule({ userId: 'a', id: r.id, ...base, effect: E.BLOCK, enabled: false, priority: 3 }, f.db);
  assert.equal(await getConstitutionRevision('a', f.db), 3);
  await updateConstitutionRule({ userId: 'a', id: r.id, ...base, effect: E.BLOCK, enabled: true, priority: 3 }, f.db);
  assert.equal(await getConstitutionRevision('a', f.db), 4);
  assert.equal(await archiveConstitutionRule({ userId: 'a', id: r.id }, f.db), true);
  assert.equal(await archiveConstitutionRule({ userId: 'a', id: r.id }, f.db), false);
  assert.equal(await getConstitutionRevision('a', f.db), 5);
  assert.equal((await listConstitutionRules({ userId: 'a' }, f.db)).length, 0);
  assert.equal(f.usage(), 0);
});

test('numeric boundaries, missing facts, action scope, and effect semantics', async () => {
  const f = fixture();
  await createConstitutionRule({ userId: 'a', ...base }, f.db);
  const action = (n?: number) => ({ userId: 'a', action: { actionType: A.DISCOUNT, proposedDiscountPercent: n } });
  assert.equal((await evaluateSalesConstitution(action(20), f.db)).allowed, true);
  const above = await evaluateSalesConstitution(action(20.01), f.db);
  assert.equal(above.allowed, false); assert.equal(above.approvalRequirements.length, 1);
  assert.equal((await evaluateSalesConstitution(action(), f.db)).unresolvedRules.length, 1);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.OUTREACH } }, f.db)).allowed, true);
  await createConstitutionRule({ userId: 'a', ...base, name: 'Absolute ceiling', effect: E.BLOCK,
    constraint: { kind: 'DISCOUNT_PERCENT', threshold: 30, comparison: 'GTE' } }, f.db);
  assert.equal((await evaluateSalesConstitution(action(30), f.db)).decision, 'BLOCKED');
  await createConstitutionRule({ userId: 'a', name: 'Legal review', category: C.LEGAL, effect: E.REQUIRE_HUMAN,
    description: 'Legal topics require human review.', constraint: { kind: 'TOPIC', topic: C.LEGAL },
    actionTypes: [A.TOPIC_RESPONSE] }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE, topic: C.LEGAL } }, f.db)).humanReviewRequirements.length, 1);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE, topic: C.SECURITY } }, f.db)).allowed, true);
});

test('prohibited claims, contract terms, unsubscribe and custom manual rules are fail-closed', async () => {
  const f = fixture();
  await createConstitutionRule({ userId: 'a', name: 'Unsupported guarantee', category: C.CLAIM, effect: E.BLOCK,
    description: 'Do not guarantee this result.', constraint: { kind: 'PROHIBITED_CLAIM', terms: ['guaranteed revenue'] }, actionTypes: [A.CLAIM] }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.CLAIM, proposedClaim: 'Guaranteed Revenue' } }, f.db)).blockingRules.length, 1);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.CLAIM } }, f.db)).unresolvedRules.length, 1);
  await createConstitutionRule({ userId: 'a', name: 'Contract floor', category: C.CONTRACT, effect: E.BLOCK,
    description: 'Short contracts prohibited.', constraint: { kind: 'MIN_CONTRACT_MONTHS', minimum: 12 }, actionTypes: [A.CONTRACT] }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.CONTRACT, proposedContractMonths: 6 } }, f.db)).blockingRules.length, 1);
  await createConstitutionRule({ userId: 'a', name: 'Opt-out', category: C.UNSUBSCRIBE, effect: E.BLOCK,
    description: 'No outreach after confirmed unsubscribe.', constraint: { kind: 'UNSUBSCRIBE' }, actionTypes: [A.OUTREACH] }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.OUTREACH, unsubscribeConfirmed: true } }, f.db)).blockingRules.length, 1);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.OUTREACH } }, f.db)).unresolvedRules.length, 1);
  const custom = await createConstitutionRule({ userId: 'a', name: 'Custom boundary', category: C.CUSTOM, effect: E.REQUIRE_HUMAN,
    description: 'A manually reviewed commitment.', constraint: { kind: 'CUSTOM_MANUAL' }, actionTypes: [A.COMMITMENT] }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.COMMITMENT } }, f.db)).unresolvedRules.length, 1);
  const context = await getSalesConstitutionContext({ userId: 'a', purpose: 'reply_decision', maxRules: 10 }, f.db);
  assert.ok(context.rules.some(r => r.id === custom.id && !r.machineEvaluable));
});

test('disabled rules are excluded; bounded context prioritizes explicit BLOCK rules', async () => {
  const f = fixture();
  for (let i = 0; i < 210; i++) await createConstitutionRule({ userId: 'a', name: `Guidance ${i}`,
    category: C.PRICING, effect: E.REQUIRE_SAFE_RESPONSE, description: 'Use a safe response.',
    constraint: { kind: 'TOPIC', topic: C.PRICING }, actionTypes: [A.TOPIC_RESPONSE], priority: 3 }, f.db);
  const block = await createConstitutionRule({ userId: 'a', name: 'Pricing block', category: C.PRICING, effect: E.BLOCK,
    description: 'Do not discuss this pricing topic.', constraint: { kind: 'TOPIC', topic: C.PRICING }, actionTypes: [A.TOPIC_RESPONSE] }, f.db);
  const context = await getSalesConstitutionContext({ userId: 'a', purpose: 'pricing', categories: [C.PRICING], maxRules: 2, maxCharacters: 900 }, f.db);
  assert.equal(context.rules[0].id, block.id);
  assert.ok(context.rules.length <= 2 && context.contextText.length <= 900);
  const evaluated = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE, topic: C.PRICING } }, f.db);
  assert.equal(evaluated.matchedRules.length, 211); assert.equal(evaluated.blockingRules.length, 1);
  await updateConstitutionRule({ userId: 'a', id: block.id, name: 'Pricing block', category: C.PRICING, effect: E.BLOCK,
    description: 'Do not discuss this pricing topic.', constraint: { kind: 'TOPIC', topic: C.PRICING }, actionTypes: [A.TOPIC_RESPONSE], enabled: false }, f.db);
  assert.equal((await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE, topic: C.PRICING } }, f.db)).blockingRules.length, 0);
  assert.ok(!(await getSalesConstitutionContext({ userId: 'a', categories: [C.PRICING], maxRules: 10 }, f.db)).rules.some(r => r.id === block.id));
  await assert.rejects(evaluateSalesConstitution({ userId: 'a', action: { actionType: A.TOPIC_RESPONSE, injected: true } as any }, f.db), /Unknown action field/);
});

test('validation, API ownership, and separation from AI, Brain, Playbook and Memory', () => {
  assert.throws(() => validateConstitutionRule({ ...base, name: 'x'.repeat(121) }), /too long/);
  assert.throws(() => validateConstitutionRule({ ...base, constraint: { kind: 'DISCOUNT_PERCENT', threshold: 101, comparison: 'GT' } }), /threshold/);
  assert.throws(() => validateConstitutionRule({ ...base, constraint: { kind: 'DISCOUNT_PERCENT', threshold: 20, comparison: 'GT', injected: true } as any }), /Unknown constraint/);
  assert.throws(() => validateConstitutionRule({ ...base, actionTypes: [A.CLAIM] }), /requires DISCOUNT action/);
  for (const path of ['src/app/api/constitution/route.ts', 'src/app/api/constitution/rules/route.ts', 'src/app/api/constitution/rules/[id]/route.ts']) {
    const source = readFileSync(join(process.cwd(), path), 'utf8');
    assert.match(source, /resolveScoutUser/); assert.doesNotMatch(source, /body\.userId|body\.source|body\.sourceKey/);
  }
  const domain = readFileSync(join(process.cwd(), 'src/lib/sales-constitution.ts'), 'utf8');
  assert.doesNotMatch(domain, /from ['"].*(?:brain|memory|playbook)|gemini|anthropic|openai|aIUsageEvent/i);
});

test('severity and scope persist; matching scope evaluates, unrelated scope is ignored, unknown scope is unresolved', async () => {
  const f = fixture();
  const rule = await createConstitutionRule({ userId: 'a', ...base, severity: 'HIGH', scope: 'PRICING' }, f.db);
  assert.equal(rule.severity, 'HIGH'); assert.equal(rule.scope, 'PRICING');
  const matching = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25, scope: 'PRICING' } }, f.db);
  assert.equal(matching.approvalRequirements.length, 1);
  assert.equal(matching.trace[0].severity, 'HIGH'); assert.equal(matching.trace[0].scope, 'PRICING');
  assert.equal(matching.trace[0].conditions[0].result, 'MATCH');
  const unrelated = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25, scope: 'OUTBOUND' } }, f.db);
  assert.equal(unrelated.allowed, true); assert.equal(unrelated.trace[0].matchResult, 'OUT_OF_SCOPE');
  const unknown = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25 } }, f.db);
  assert.equal(unknown.allowed, false); assert.equal(unknown.unresolvedRules.length, 1);
  assert.equal(unknown.trace[0].conditions[0].result, 'UNRESOLVED');
  const context = await getSalesConstitutionContext({ userId: 'a', categories: [C.DISCOUNT] }, f.db);
  assert.equal(context.rules[0].severity, 'HIGH'); assert.equal(context.rules[0].scope, 'PRICING');
  assert.throws(() => validateConstitutionRule({ ...base, severity: 'UNKNOWN' as any }), /severity/);
  assert.throws(() => validateConstitutionRule({ ...base, scope: 'UNKNOWN' as any }), /scope/);
});

test('conflicts require proven condition/action/scope overlap; restrictive winner is deterministic', async () => {
  const f = fixture();
  const approval = await createConstitutionRule({ userId: 'a', ...base, name: 'Approval', severity: 'CRITICAL',
    scope: 'PRICING' }, f.db);
  const safe = await createConstitutionRule({ userId: 'a', ...base, name: 'Safe response', effect: E.REQUIRE_SAFE_RESPONSE,
    severity: 'LOW', scope: 'GLOBAL' }, f.db);
  await createConstitutionRule({ userId: 'a', ...base, name: 'Different threshold', effect: E.BLOCK,
    constraint: { kind: 'DISCOUNT_PERCENT', threshold: 30, comparison: 'GT' }, scope: 'PRICING' }, f.db);
  await createConstitutionRule({ userId: 'a', ...base, name: 'Different scope', effect: E.BLOCK,
    scope: 'OUTBOUND' }, f.db);
  const result = await detectConstitutionConflicts({ userId: 'a' }, f.db);
  assert.equal(result.conflicts.length, 2); // GLOBAL safe response overlaps both scoped rules with the same condition.
  const pair = result.conflicts.find(c => c.ruleIds.includes(approval.id) && c.ruleIds.includes(safe.id));
  assert.ok(pair); assert.equal(pair.winningRuleId, approval.id);
  assert.equal(pair.winningEffect, E.REQUIRE_APPROVAL);
  assert.match(pair.overlapReason, /scope|Scopes/); assert.match(pair.explanation, /restrictive effect/);
  assert.ok(!result.conflicts.some(c => c.ruleIds.includes(approval.id) && c.rules.some(r => r.name === 'Different threshold')));
  assert.ok(!result.conflicts.some(c => c.ruleIds.includes(approval.id) && c.rules.some(r => r.name === 'Different scope')));
  assert.equal((await detectConstitutionConflicts({ userId: 'b' }, f.db)).conflicts.length, 0);
  await assert.rejects(detectConstitutionConflicts({ userId: 'b', constitutionId: 'c-a' }, f.db), /not found/);
});

test('BLOCK wins a contradictory approval rule even when its severity and priority are lower', async () => {
  const f = fixture();
  const approval = await createConstitutionRule({ userId: 'a', ...base, severity: 'CRITICAL', priority: 3 }, f.db);
  const block = await createConstitutionRule({ userId: 'a', ...base, name: 'Absolute prohibition', effect: E.BLOCK,
    severity: 'LOW', priority: 1 }, f.db);
  const conflicts = (await detectConstitutionConflicts({ userId: 'a' }, f.db)).conflicts;
  assert.equal(conflicts.length, 1); assert.deepEqual(conflicts[0].ruleIds, [approval.id, block.id].sort());
  assert.equal(conflicts[0].winningRuleId, block.id); assert.equal(conflicts[0].winningEffect, E.BLOCK);
  const evaluated = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25 } }, f.db);
  assert.equal(evaluated.decision, 'BLOCKED'); assert.equal(evaluated.winningRule?.id, block.id);
});

test('explainable trace chooses by effect, severity, priority and stable ID; unresolved uncertainty is visible', async () => {
  const f = fixture();
  const low = await createConstitutionRule({ userId: 'a', ...base, name: 'Low severity', severity: 'LOW', priority: 3 }, f.db);
  const high = await createConstitutionRule({ userId: 'a', ...base, name: 'High severity', severity: 'HIGH', priority: 1 }, f.db);
  const result = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25 } }, f.db);
  assert.equal(result.winningRule?.id, high.id);
  assert.equal(result.revision, 2); assert.equal(result.authority, 'SALES_CONSTITUTION');
  assert.ok(POLICY_AUTHORITY_ORDER.indexOf('SALES_CONSTITUTION') < POLICY_AUTHORITY_ORDER.indexOf('REVENUE_PLAYBOOK'));
  assert.ok(POLICY_AUTHORITY_ORDER.indexOf('SALES_CONSTITUTION') < POLICY_AUTHORITY_ORDER.indexOf('AI_RECOMMENDATION'));
  assert.equal(result.trace.length, 2); assert.equal(result.trace.find(t => t.ruleId === high.id)?.finalEffectiveResult, 'WINNING_RULE');
  assert.equal(result.trace.find(t => t.ruleId === low.id)?.finalEffectiveResult, 'MATCHED_SUBORDINATE');
  assert.match(result.winnerReason, /HIGH severity/);
  assert.equal(result.trace[0].conditions[1].result, 'MATCH');
  assert.equal(result.trace[0].conditions[2].result, 'MATCH');
  const unresolved = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT } }, f.db);
  assert.equal(unresolved.allowed, false); assert.equal(unresolved.trace[0].matchResult, 'UNRESOLVED');
  assert.equal(unresolved.unresolvedPotentiallyOverrides, true);
  assert.ok(unresolved.trace[0].conditions.some(c => c.result === 'UNRESOLVED'));
  // Equal-effect, equal-severity, equal-priority rules choose a stable ID.
  await updateConstitutionRule({ userId: 'a', id: low.id, ...base, name: 'Low severity', severity: 'HIGH' }, f.db);
  const tied = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 25 } }, f.db);
  assert.equal(tied.winningRule?.id, [low.id, high.id].sort()[0]);
});

test('audit history is durable, attributed, tenant-scoped, and omitted for reads/no-op writes', async () => {
  const f = fixture();
  const rule = await createConstitutionRule({ userId: 'a', ...base }, f.db);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].changeType, 'CREATE');
  assert.equal(f.events[0].actorId, 'a'); assert.equal(f.events[0].constitutionRevision, 1);
  assert.equal(f.events[0].beforeState, undefined); assert.equal(f.events[0].afterState.effect, E.REQUIRE_APPROVAL);
  await getConstitutionRevision('a', f.db); await listConstitutionRules({ userId: 'a' }, f.db);
  await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT, proposedDiscountPercent: 25 } }, f.db);
  assert.equal(f.events.length, 1);
  await updateConstitutionRule({ userId: 'a', id: rule.id, ...base }, f.db);
  assert.equal(f.events.length, 1);
  await updateConstitutionRule({ userId: 'a', id: rule.id, ...base, severity: 'CRITICAL', scope: 'PRICING' }, f.db);
  assert.equal(f.events[1].changeType, 'EDIT'); assert.equal(f.events[1].beforeState.severity, 'MEDIUM');
  assert.equal(f.events[1].afterState.scope, 'PRICING'); assert.equal(f.events[1].constitutionRevision, 2);
  await updateConstitutionRule({ userId: 'a', id: rule.id, ...base, severity: 'CRITICAL', scope: 'PRICING', enabled: false }, f.db);
  assert.equal(f.events[2].changeType, 'DISABLE');
  await updateConstitutionRule({ userId: 'a', id: rule.id, ...base, severity: 'CRITICAL', scope: 'PRICING', enabled: true }, f.db);
  assert.equal(f.events[3].changeType, 'ENABLE');
  await archiveConstitutionRule({ userId: 'a', id: rule.id }, f.db);
  assert.equal(f.events[4].changeType, 'ARCHIVE'); assert.equal(f.events[4].constitutionRevision, 5);
  assert.equal((await listConstitutionRevisionEvents({ userId: 'b' }, f.db)).length, 0);
  await assert.rejects(listConstitutionRevisionEvents({ userId: 'b', cursor: f.events[0].id }, f.db), /cursor not found/);
  await assert.rejects(createConstitutionRule({ userId: 'a', actorId: 'b', ...base }, f.db), /not authorized/);
  assert.equal(f.events.length, 5);
});

test('evaluation is read-only and suitable for synthetic dry-run inputs', async () => {
  const f = fixture();
  await createConstitutionRule({ userId: 'a', ...base }, f.db);
  const before = { roots: f.roots.length, rules: f.rules.length, events: f.events.length };
  const result = await evaluateSalesConstitution({ userId: 'a', action: { actionType: A.DISCOUNT,
    proposedDiscountPercent: 22, scope: 'PRICING' } }, f.db);
  assert.equal(result.approvalRequirements.length, 1);
  assert.deepEqual({ roots: f.roots.length, rules: f.rules.length, events: f.events.length }, before);
  assert.equal(f.usage(), 0);
  const empty = fixture();
  const unknown = await evaluateSalesConstitution({ userId: 'b', action: { actionType: A.OUTREACH } }, empty.db);
  assert.equal(unknown.configurationMissing, true); assert.equal(unknown.allowed, false);
  assert.equal(empty.roots.length, 0); assert.equal(empty.events.length, 0);
});
