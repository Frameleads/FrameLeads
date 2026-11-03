// Real PostgreSQL integration. Refuses every non-loopback/non-test database.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: file,
}).outputText, file);
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const url = new URL(process.env.ALLOWANCE_TEST_DATABASE_URL || 'postgresql://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/frameleads_allowance_test'))
  throw new Error('A dedicated local ALLOWANCE_TEST_DATABASE_URL is required; inherited DATABASE_URL is never used');
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const { allowanceRequestHash, readProspectAllowance, beginAllowanceOperation, allocateProspectAllowance, finishAllowanceOperation } = require('../src/lib/prospect-allowance.ts');
const { selectAllowancePeriod } = require('../src/lib/whop-memberships.ts');
process.env.PROSPECT_ALLOWANCE_MODE = 'active';
after(() => db.$disconnect());
async function fixture(tier = 'ENTERPRISE', used = 0) {
  const id = 'fixture-' + randomUUID();
  const user = await db.user.create({ data: { id, whopId: id, email: id + '@example.invalid', tier, leadsProcessed: used, monthlyQuota: tier === 'CORE' ? 500 : 10000 } });
  const proof = { tier, subjectId: user.whopId, companyId: 'company-fixture', membershipId: 'membership-fixture', planId: 'plan-fixture', billingDays: 30,
    start: Date.now() - 60000, end: Date.now() + 600000, verifiedAt: Date.now() };
  await db.prospectAllowanceCursor.create({ data: { userId: id, approvedCompanyId: proof.companyId, approvedMembershipId: proof.membershipId,
    approvedPlanId: proof.planId, approvedBillingDays: 30, approvedLegacyUsage: used, reviewReference: 'local-fixture-only' } });
  return { id, proof };
}
const hash = allowanceRequestHash({ leads: ['fixture'] });
async function claim(f, operationId = randomUUID()) {
  await beginAllowanceOperation(db, f.id, f.proof, operationId, hash); return operationId;
}
for (const [tier, cap] of [['CORE', 500], ['ENTERPRISE', 10000]]) {
  test(`real Postgres: ${tier} 20 competing requests cannot overspend final slot`, async () => {
    const f = await fixture(tier, cap - 1);
    const ops = await Promise.all(Array.from({ length: 20 }, () => claim(f)));
    const allocated = await Promise.all(ops.map(id => allocateProspectAllowance(db, f.id, f.proof, id, 1)));
    assert.equal(allocated.reduce((a, b) => a + b), 1);
    assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, cap);
    assert.equal((await db.user.findUnique({ where: { id: f.id } })).leadsProcessed, cap);
    assert.equal(await allocateProspectAllowance(db, f.id, f.proof, ops[0], 1), allocated[0]);
  });
}
test('real Postgres: simultaneous rollover creates one period and preserves old and lifetime usage', async () => {
  const f = await fixture('ENTERPRISE', 15000);
  const old = await db.prospectAllowancePeriod.create({ data: { userId: f.id, membershipId: f.proof.membershipId, companyId: f.proof.companyId,
    planId: f.proof.planId, periodStart: new Date(f.proof.start - 600000), periodEnd: new Date(f.proof.start), used: 15000, legacySeed: 15000, verifiedAt: new Date() } });
  await db.prospectAllowanceCursor.update({ where: { userId: f.id }, data: { currentPeriodId: old.id } });
  const results = await Promise.all(Array.from({ length: 12 }, () => readProspectAllowance(db, f.id, f.proof)));
  assert.ok(results.every(x => x.used === 0 && x.remaining === 10000));
  assert.equal(await db.prospectAllowancePeriod.count({ where: { userId: f.id } }), 2);
  const archived = await db.prospectAllowancePeriod.findUnique({ where: { id: old.id } });
  assert.equal(archived.used, 15000); assert.ok(archived.closedAt);
  const op = await claim(f); assert.equal(await allocateProspectAllowance(db, f.id, f.proof, op, 1), 1);
  assert.equal((await db.user.findUnique({ where: { id: f.id } })).leadsProcessed, 15001);
});
test('real Postgres: over-cap initial consumption remains visible and blocked', async () => {
  const f = await fixture('ENTERPRISE', 15000), op = await claim(f);
  assert.equal(await allocateProspectAllowance(db, f.id, f.proof, op, 1), 0);
  const s = await readProspectAllowance(db, f.id, f.proof); assert.equal(s.used, 15000); assert.equal(s.remaining, 0);
});
test('real Postgres: duplicate keys replay results and changed payloads conflict', async () => {
  const f = await fixture(), op = await claim(f);
  await assert.rejects(beginAllowanceOperation(db, f.id, f.proof, op, hash), /OPERATION_IN_PROGRESS/);
  await allocateProspectAllowance(db, f.id, f.proof, op, 2);
  await finishAllowanceOperation(db, f.id, op, { success: true, leads: ['stored-result'] }, 200);
  const replay = await beginAllowanceOperation(db, f.id, f.proof, op, hash);
  assert.equal(replay.replay, true); assert.deepEqual(replay.response, { success: true, leads: ['stored-result'] });
  await assert.rejects(beginAllowanceOperation(db, f.id, f.proof, op, allowanceRequestHash({ other: true })), /PAYLOAD_CONFLICT/);
  assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, 2);
});
test('real Postgres: completed retries across renewal do not charge the new period', async () => {
  const f = await fixture(), op = await claim(f);
  await allocateProspectAllowance(db, f.id, f.proof, op, 1);
  await finishAllowanceOperation(db, f.id, op, { success: true }, 200);
  const cursor = await db.prospectAllowanceCursor.findUnique({ where: { userId: f.id } });
  // Advance the fixture's provider boundary without mutating production time.
  const boundary = Date.now() - 1000;
  await db.prospectAllowancePeriod.update({ where: { id: cursor.currentPeriodId }, data: { periodEnd: new Date(boundary) } });
  f.proof = { ...f.proof, start: boundary, end: Date.now() + 600000, verifiedAt: Date.now() };
  assert.equal((await beginAllowanceOperation(db, f.id, f.proof, op, hash)).replay, true);
  assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, 0);
});
test('real Postgres: failed transaction rolls back the period allocation and lifetime increment', async () => {
  const f = await fixture(), op = await claim(f);
  const failing = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
    if (key === 'user') return { update: async () => { throw new Error('INJECTED_LOCAL_FAILURE'); } };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } })), options) };
  await assert.rejects(allocateProspectAllowance(failing, f.id, f.proof, op, 3), /INJECTED_LOCAL_FAILURE/);
  assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, 0);
  assert.equal((await db.user.findUnique({ where: { id: f.id } })).leadsProcessed, 0);
});
test('real Postgres: freeze blocks rollover and disabled cannot fall back for enrolled tenants', async () => {
  const f = await fixture(); await readProspectAllowance(db, f.id, f.proof);
  process.env.PROSPECT_ALLOWANCE_MODE = 'freeze';
  assert.equal((await readProspectAllowance(db, f.id, f.proof)).state, 'frozen');
  await assert.rejects(readProspectAllowance(db, f.id, { ...f.proof, start: f.proof.start + 1 }), /RENEWAL_FROZEN/);
  process.env.PROSPECT_ALLOWANCE_MODE = 'disabled';
  await assert.rejects(readProspectAllowance(db, f.id, f.proof), /ENROLLED_BUT_DISABLED/);
  process.env.PROSPECT_ALLOWANCE_MODE = 'active';
});
test('real Postgres: stale, expired, mismatched periods and changed cutover usage fail closed', async () => {
  const f = await fixture();
  for (const patch of [{ verifiedAt: Date.now() - 60000 }, { end: Date.now() - 1 }, { subjectId: 'other' }, { membershipId: 'other' }, { billingDays: 365 }])
    await assert.rejects(readProspectAllowance(db, f.id, { ...f.proof, ...patch }), /VERIFICATION_REQUIRED/);
  await db.user.update({ where: { id: f.id }, data: { leadsProcessed: 1 } });
  await assert.rejects(readProspectAllowance(db, f.id, f.proof), /CUTOVER_USAGE_CHANGED/);
});
test('real Postgres: composite foreign keys prevent cross-tenant cursor and receipt references', async () => {
  const a = await fixture(), b = await fixture(); await readProspectAllowance(db, a.id, a.proof);
  const cursor = await db.prospectAllowanceCursor.findUnique({ where: { userId: a.id } });
  await assert.rejects(db.prospectAllowanceCursor.update({ where: { userId: b.id }, data: { currentPeriodId: cursor.currentPeriodId } }), /Foreign key constraint/);
  await assert.rejects(db.prospectAllowanceOperation.create({ data: { userId: b.id, operationId: randomUUID(), requestHash: hash, periodId: cursor.currentPeriodId } }), /Foreign key constraint/);
});
test('provider adapter selects one exact membership and refuses missing/ambiguous/nonmonthly periods', () => {
  const now = Date.now();
  const m = { id: 'membership', status: 'active', user_id: 'buyer', company_id: 'company', renewal_period_start: now - 60000,
    renewal_period_end: now + 30 * 86400000, plan: { id: 'plan_jdy5Z44fMKMAz', billing_period: 30 } };
  assert.equal(selectAllowancePeriod([m], 'ENTERPRISE', 'buyer', 'company', now).membershipId, 'membership');
  for (const memberships of [[m, { ...m, id: 'duplicate' }], [{ ...m, renewal_period_start: null }], [{ ...m, plan: { ...m.plan, billing_period: 365 } }], [{ ...m, status: 'trialing' }]])
    assert.equal(selectAllowancePeriod(memberships, 'ENTERPRISE', 'buyer', 'company', now), undefined);
});
test('real Postgres: same-period tier changes carry usage rather than award another bucket', async () => {
  const f = await fixture('ENTERPRISE', 700); await readProspectAllowance(db, f.id, f.proof);
  await db.user.update({ where: { id: f.id }, data: { tier: 'CORE', monthlyQuota: 500 } });
  f.proof = { ...f.proof, tier: 'CORE' };
  const state = await readProspectAllowance(db, f.id, f.proof); assert.equal(state.used, 700); assert.equal(state.remaining, 0);
  assert.equal(await db.prospectAllowancePeriod.count({ where: { userId: f.id } }), 1);
});
test('real Postgres: a retryable transaction conflict retries before any provider work', async () => {
  const f = await fixture(); let calls = 0;
  const retrying = { $transaction: (fn, options) => { calls++; if (calls === 1) return Promise.reject({ code: 'P2034' }); return db.$transaction(fn, options); } };
  const s = await readProspectAllowance(retrying, f.id, f.proof);
  assert.equal(calls, 2); assert.equal(s.used, 0);
});
test('real Postgres: negative usage, invalid periods and orphan operations are rejected by constraints', async () => {
  const f = await fixture(); await readProspectAllowance(db, f.id, f.proof);
  const cursor = await db.prospectAllowanceCursor.findUnique({ where: { userId: f.id } });
  await assert.rejects(db.prospectAllowancePeriod.update({ where: { id: cursor.currentPeriodId }, data: { used: -1 } }));
  await assert.rejects(db.prospectAllowancePeriod.update({ where: { id: cursor.currentPeriodId }, data: { periodEnd: new Date(f.proof.start) } }));
  await assert.rejects(db.prospectAllowanceOperation.create({ data: { userId: 'missing-account', operationId: randomUUID(), requestHash: hash } }));
});
test('actual generate handler + real Postgres: replay never calls the provider twice; unauthenticated requests fail', async () => {
  const Module = require('node:module');
  const original = Module._load;
  const f = await fixture('CORE', 499);
  let authenticated = true, providerCalls = 0;
  const actualAllocator = require('../src/lib/prospect-allowance.ts');
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/customer-session': { verifiedCustomerUser: async () => authenticated ? { id: f.id } : null },
    '@/lib/prisma': { prisma: db },
    '@/lib/auth-guard': { getUserEntitlementTier: async () => 'CORE' },
    '@/lib/entitlements': require('../src/lib/entitlements.ts'),
    '@/lib/allowance-period': require('../src/lib/allowance-period.ts'),
    '@/lib/prospect-allowance': actualAllocator,
    '@/lib/allowance-context': { getAllowanceContext: async () => ({ proof: f.proof, snapshot: await readProspectAllowance(db, f.id, f.proof) }) },
    '@/lib/enterprise-quota': { reserveEnterpriseProspects: () => { throw new Error('Recurring operation must use shared allocator'); } },
    '@/lib/prospects/persistence': { saveGeneratedLead: async () => ({ id: 'generated-fixture' }), enrichExistingLeadProspect: async () => {} },
    '@/lib/prospects/metadata': { extractProspectMetadata: () => ({}) },
    '@/lib/brain': { getBrainContext: async () => ({ contextText: '' }) },
    '@/lib/revenue-playbook': { getPlaybookContext: async () => ({ contextText: '' }) },
    '@/lib/sales-constitution': { getSalesConstitutionContext: async () => ({ contextText: '' }) },
    '@/lib/market-messaging': { BUILT_IN_MARKET_PROFILES: [], listMarketProfiles: async () => [], resolveMarketProfile: async () => ({}), buildMarketAwareGenerationPrompt: () => 'fixture' },
    '@/lib/micro-pilot-limits': { microPilotOutboundIdentityKey: () => 'fixture', MicroPilotLimitError: class extends Error {} },
    '@/lib/outbound-copy': { normalizeOutboundCopy: value => value },
    '@/lib/word-count-gate': { MAX_RETRIES: 0, OUTBOUND_WORD_LIMIT: 75, validateGeneratedChannels: () => ({ allPassed: true }) },
    '@anthropic-ai/sdk': class { messages = { create: async () => { providerCalls++; return { content: [{ text: JSON.stringify({ email: { subject: 'fixture', paragraphs: ['Fixture body'] }, linkedin: 'Fixture body', coldCall: 'Fixture body', whatsapp: 'Fixture body' }) }] }; } }; },
  };
  let POST;
  try { Module._load = function (name, ...args) { return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args); }; POST = require('../src/app/api/generate/route.ts').POST; }
  finally { Module._load = original; }
  const previousKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'fixture-no-real-network';
  const operationId = randomUUID();
  const payload = { leads: [{ first_name: 'Fixture', company_name: 'Fixture', email: 'fixture@example.invalid' }] };
  const request = (body = payload) => new Request('https://fixture.invalid/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': operationId }, body: JSON.stringify(body) });
  try {
    const response = await POST(request()); assert.equal(response.status, 200); const stored = await response.json();
    const replay = await POST(request()); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), stored);
    assert.equal(providerCalls, 1); assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, 500);
    const conflict = await POST(request({ ...payload, preferredCtaStyle: 'changed' })); assert.equal(conflict.status, 409); assert.equal(providerCalls, 1);
    authenticated = false; const rejected = await POST(request()); assert.equal(rejected.status, 401); assert.equal(providerCalls, 1);
  } finally { if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previousKey; }
});
test('enrollment tool against real Postgres: dry-run is inert, approval required, apply is idempotent', async () => {
  const { spawnSync } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const id = 'fixture-' + randomUUID();
  await db.user.create({ data: { id, whopId: id, email: id + '@example.invalid', tier: 'CORE', monthlyQuota: 500, leadsProcessed: 7 } });
  const file = '/tmp/allowance-manifest-' + randomUUID() + '.json';
  const raw = JSON.stringify({ reviewReference: 'local-only-review', accounts: [{ userId: id, expectedLegacyUsage: 7,
    proof: { tier: 'CORE', subjectId: id, companyId: 'company-fixture', membershipId: 'membership-fixture', planId: 'plan-fixture', billingDays: 30 } }] });
  fs.writeFileSync(file, raw, { mode: 0o600 });
  const env = { ...process.env, DATABASE_URL: url.toString() };
  const run = (args, extra = {}) => spawnSync(process.execPath, ['scripts/enroll-prospect-allowances.cjs', file, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
  try {
    assert.equal(run([]).status, 0); assert.equal(await db.prospectAllowanceCursor.count({ where: { userId: id } }), 0);
    assert.notEqual(run(['--apply'], { ALLOWANCE_APPROVED_MANIFEST_SHA256: '' }).status, 0);
    const approved = { ALLOWANCE_APPROVED_MANIFEST_SHA256: createHash('sha256').update(raw).digest('hex') };
    assert.equal(run(['--apply'], approved).status, 0); assert.equal(run(['--apply'], approved).status, 0);
    assert.equal(await db.prospectAllowanceCursor.count({ where: { userId: id } }), 1);
    assert.equal((await db.user.findUnique({ where: { id } })).leadsProcessed, 7);
  } finally { fs.unlinkSync(file); }
});
test('provider adapter reads interval only for the reviewed plan and checks its identity', async () => {
  const { verifyWhopSubscription } = require('../src/lib/whop-memberships.ts');
  const previousCompany = process.env.WHOP_COMPANY_ID; process.env.WHOP_COMPANY_ID = 'company-fixture';
  const now = Date.now(); let planReads = 0;
  const membership = { id: 'membership-fixture', status: 'active', user_id: 'buyer-fixture', company_id: 'company-fixture',
    renewal_period_start: now - 60000, renewal_period_end: now + 30 * 86400000, plan: { id: 'plan_jdy5Z44fMKMAz' } };
  const request = async url => {
    if (String(url).includes('/plans/')) { planReads++; return Response.json({ id: 'plan_jdy5Z44fMKMAz', billing_period: 30 }); }
    return Response.json({ data: [membership], page_info: { has_next_page: false } });
  };
  try {
    const result = await verifyWhopSubscription('fixture-not-real', 'buyer-fixture', request, { planId: 'plan_jdy5Z44fMKMAz' });
    assert.equal(result.allowancePeriod.billingDays, 30); assert.equal(planReads, 1);
    const unreviewed = await verifyWhopSubscription('fixture-not-real', 'buyer-fixture', request, { planId: 'plan_other' });
    assert.equal(unreviewed.allowancePeriod, undefined); assert.equal(planReads, 1);
    await assert.rejects(verifyWhopSubscription('fixture-not-real', 'buyer-fixture', async url => String(url).includes('/plans/')
      ? Response.json({ id: 'plan_wrong', billing_period: 30 }) : request(url), { planId: 'plan_jdy5Z44fMKMAz' }), /identity mismatch/);
  } finally { if (previousCompany === undefined) delete process.env.WHOP_COMPANY_ID; else process.env.WHOP_COMPANY_ID = previousCompany; }
});
test('authenticated usage handler uses only the verified tenant and returns 503 on unverifiable renewal', async () => {
  const Module = require('node:module'), original = Module._load;
  const f = await fixture('CORE', 123); let principal = null, verificationUnavailable = false;
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/customer-session': { verifiedCustomerUser: async () => principal },
    '@/lib/auth-guard': { getUserEntitlementTier: async id => { assert.equal(id, f.id); return 'CORE'; } },
    '@/lib/prisma': { prisma: db },
    '@/lib/allowance-context': { getAuthenticatedUsage: async id => {
      assert.equal(id, f.id); if (verificationUnavailable) throw new Error('fixture-unavailable');
      return readProspectAllowance(db, id, f.proof);
    } },
  };
  let GET;
  try { Module._load = function(name, ...args) { return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args); }; GET = require('../src/app/api/usage/route.ts').GET; }
  finally { Module._load = original; }
  assert.equal((await GET()).status, 401);
  principal = { id: f.id };
  const response = await GET(); assert.equal(response.status, 200);
  const snapshot = await response.json(); assert.equal(snapshot.used, 123); assert.equal(snapshot.remaining, 377); assert.equal(snapshot.limit, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  verificationUnavailable = true; const unavailable = await GET(); assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).used, undefined);
});
test('real Postgres: reviewed future zero-usage accounts enroll once under contention', async () => {
  const { enrollNewAllowanceTenant } = require('../src/lib/prospect-allowance.ts');
  const f = await fixture();
  // This is isolated fixture cleanup before testing the absent-cursor branch.
  await db.prospectAllowanceCursor.delete({ where: { userId: f.id } });
  await Promise.all(Array.from({ length: 10 }, () => enrollNewAllowanceTenant(db, f.id, f.proof, Date.now() - 60000, 'reviewed-local-plan')));
  assert.equal(await db.prospectAllowanceCursor.count({ where: { userId: f.id } }), 1);
  assert.equal((await readProspectAllowance(db, f.id, f.proof)).used, 0);
});
test('real Postgres: future enrollment cannot forgive existing consumption or enroll pre-cutover accounts', async () => {
  const { enrollNewAllowanceTenant } = require('../src/lib/prospect-allowance.ts');
  for (const used of [0, 1]) {
    const f = await fixture('CORE', used); await db.prospectAllowanceCursor.delete({ where: { userId: f.id } });
    await assert.rejects(enrollNewAllowanceTenant(db, f.id, f.proof, used ? Date.now() - 60000 : Date.now() + 60000, 'reviewed-local-plan'), /NEW_ACCOUNT_REVIEW_REQUIRED/);
    assert.equal(await db.prospectAllowanceCursor.count({ where: { userId: f.id } }), 0);
  }
});
test('context wiring: reviewed future policy enrolls, freeze blocks new enrollment, and outage preserves browsing snapshot', async () => {
  const Module = require('node:module'), original = Module._load;
  const f = await fixture('CORE'); await db.prospectAllowanceCursor.delete({ where: { userId: f.id } });
  let unavailable = false;
  const saved = { after: process.env.PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER, reviews: process.env.PROSPECT_ALLOWANCE_PLAN_REVIEWS };
  process.env.PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER = new Date(Date.now() - 60000).toISOString();
  process.env.PROSPECT_ALLOWANCE_PLAN_REVIEWS = JSON.stringify([{ planId: f.proof.planId, companyId: f.proof.companyId, billingDays: 30, reviewReference: 'local-context-review' }]);
  let context;
  try {
    Module._load = function(name, parent, ...args) {
      if (parent?.filename.endsWith('/src/lib/allowance-context.ts')) {
        if (name === 'next/headers') return { cookies: async () => ({ get: () => ({ value: 'fixture-not-real' }) }) };
        if (name === './prisma') return { prisma: db };
        if (name === './whop-memberships') return { verifyWhopSubscription: async () => {
          if (unavailable) throw new Error('local-provider-outage'); return { tier: 'CORE', monthlyQuota: 500, allowancePeriod: f.proof };
        } };
      }
      return original.call(this, name, parent, ...args);
    };
    context = require('../src/lib/allowance-context.ts');
  } finally { Module._load = original; }
  try {
    process.env.PROSPECT_ALLOWANCE_MODE = 'freeze';
    await assert.rejects(context.getAllowanceContext(f.id, 'CORE'), /RENEWAL_FROZEN/);
    assert.equal(await db.prospectAllowanceCursor.count({ where: { userId: f.id } }), 0);
    process.env.PROSPECT_ALLOWANCE_MODE = 'active';
    assert.equal((await context.getAllowanceContext(f.id, 'CORE')).snapshot.used, 0);
    unavailable = true;
    const snapshot = await context.getDisplayedUsage(f.id, 'CORE', { leadsProcessed: 9999, microPilotOutboundUsed: 0 });
    assert.equal(snapshot.used, 0); // last ledger count, never the lifetime counter
    assert.equal(snapshot.state, 'verification-required'); assert.equal(snapshot.remaining, 0);
  } finally {
    process.env.PROSPECT_ALLOWANCE_MODE = 'active';
    if (saved.after === undefined) delete process.env.PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER; else process.env.PROSPECT_ALLOWANCE_NEW_ACCOUNTS_AFTER = saved.after;
    if (saved.reviews === undefined) delete process.env.PROSPECT_ALLOWANCE_PLAN_REVIEWS; else process.env.PROSPECT_ALLOWANCE_PLAN_REVIEWS = saved.reviews;
  }
});
