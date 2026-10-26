import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

class LimitError extends Error { constructor(limit) { super(limit); this.limit = limit; } }
function fixture() {
  const state = { used: 0, claims: new Set(), decisions: [], providerCalls: 0, mode: 'success', successfulUsage: false };
  const modules = {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status ?? 200 }) } },
    '@/lib/decision/triage': { triageInboundSignal: async (input, deps) => {
      assert.equal(input.microPilotReserved, true);
      if (state.mode === 'pre-provider-failure') throw new Error('Context could not be assembled');
      deps.onProviderRequestStart();
      state.providerCalls++;
      if (state.mode === 'uncertain-provider-failure') throw new Error('Provider response was lost');
      const decision = { id: `decision-${state.decisions.length + 1}`, prospectId: input.signalId.replace('signal-', 'prospect-'), source: 'GEMINI', supersedesDecisionId: input.retryOfDecisionId ?? null };
      state.decisions.push(decision);
      return { status: 'READY', decision };
    } },
    '@/lib/decision/rollout': { canManuallyAnalyze: () => true },
    '@/lib/automation/actions': { runAutopilot: async () => { throw new Error('must stay locked'); } },
    '@/lib/response-sla/service': { syncResponseSLAForDecision: async () => ({}) },
    '@/lib/revenue-risk/service': { assessRevenueAtRisk: async () => ({}) },
    '@/lib/auth-guard': {
      featureAccessErrorForTier: () => ({ body: { error: 'locked' }, status: 403 }),
      getAuthenticatedEntitlementUser: async () => ({ id: 'tenant', tier: 'MICRO_PILOT' }),
    },
    '@/lib/entitlements': { hasFeatureAccess: () => false },
    '@/lib/prisma': { prisma: {
      user: { findUnique: async () => ({ tier: 'MICRO_PILOT', microPilotDecisionsUsed: state.used }) },
      aIUsageEvent: { findFirst: async () => state.successfulUsage ? { id: 'used' } : null },
      inboundSignal: { findFirst: async ({ where }) => ({ id: where.id, prospectId: where.id.replace('signal-', 'prospect-'), generatedLeadId: 'lead' }) },
      decision: { findFirst: async ({ where }) =>
        where.id ? state.decisions.find(row => row.id === where.id) ?? null :
        where.supersedesDecisionId ? state.decisions.find(row => row.supersedesDecisionId === where.supersedesDecisionId) ?? null :
        state.decisions.find(row => row.prospectId === where.prospectId &&
          (!where.id?.not || row.id !== where.id.not)) ?? null },
    } },
    '@/lib/decision/pending-recovery': { UNCERTAIN_ANALYSIS_REASON: 'ANALYSIS_OUTCOME_UNCERTAIN' },
    '@/lib/micro-pilot-limits': {
      MicroPilotLimitError: LimitError,
      reserveMicroPilotDecision: async (_userId, prospectId) => {
        if (state.claims.has(prospectId)) throw new LimitError('PROSPECT_ALREADY_USED');
        if (state.used >= 3) throw new LimitError('DECISIONS_EXHAUSTED');
        state.claims.add(prospectId); state.used++;
      },
      releaseUnstartedMicroPilotDecision: async (_userId, prospectId) => {
        state.claims.delete(prospectId); state.used = Math.max(0, state.used - 1); return true;
      },
    },
  };
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(new URL('../src/app/api/decisions/triage/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { exports, require: name => {
    if (name in modules) return modules[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, Request, URL, console, process, Promise, Set, Map, Date });
  return { route: exports, state };
}
const post = signalId => new Request('https://app.example/api/decisions/triage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signalId }) });

test('first through third decisions succeed; fourth is blocked before another provider call', async () => {
  const f = fixture();
  for (const signalId of ['signal-1', 'signal-2', 'signal-3']) assert.equal((await f.route.POST(post(signalId))).status, 200);
  const fourth = await f.route.POST(post('signal-4'));
  assert.equal(fourth.status, 403);
  assert.equal(f.state.used, 3);
  assert.equal(f.state.providerCalls, 3);
  assert.equal(f.state.decisions.length, 3);
});

test('confirmed pre-provider failure releases allowance and permits a safe retry', async () => {
  const f = fixture();
  f.state.mode = 'pre-provider-failure';
  assert.equal((await f.route.POST(post('signal-1'))).status, 500);
  assert.equal(f.state.used, 0);
  f.state.mode = 'success';
  assert.equal((await f.route.POST(post('signal-1'))).status, 200);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.used, 1);
});

test('uncertain provider failure stays reserved and repeated requests cannot retry or duplicate charge', async () => {
  const f = fixture();
  f.state.mode = 'uncertain-provider-failure';
  assert.equal((await f.route.POST(post('signal-1'))).status, 500);
  f.state.mode = 'success';
  assert.equal((await f.route.POST(post('signal-1'))).status, 403);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.used, 1);
});

test('successful repeat and same-prospect signal are blocked without an extra provider call', async () => {
  const f = fixture();
  assert.equal((await f.route.POST(post('signal-1'))).status, 200);
  assert.equal((await f.route.POST(post('signal-1'))).status, 403);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.used, 1);
});

test('very old interrupted Micro-Pilot decision can be recovered once with existing prospect slot', async () => {
  const f = fixture();
  f.state.used = 1;
  f.state.claims.add('prospect-1');
  f.state.decisions.push({ id: 'old-pending', prospectId: 'prospect-1',
    status: 'NEEDS_REVIEW', source: 'UNAVAILABLE', createdAt: new Date('2026-10-07'),
    reviewReasons: ['ANALYSIS_OUTCOME_UNCERTAIN'], trace: null });
  const recovered = () => new Request('https://app.example/api/decisions/triage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signalId: 'signal-1', retryOfDecisionId: 'old-pending',
      confirmProviderRequestEnded: true }),
  });
  const first = await f.route.POST(recovered());
  assert.equal(first.status, 200);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.used, 1, 'prior trial slot remains claimed, no new charge');
  const second = await f.route.POST(recovered());
  assert.equal(second.status, 409, 'repeat recovery cannot call provider again');
  assert.equal(f.state.providerCalls, 1);
});

test('interrupted analysis recovery requires explicit confirmation and no successful provider usage', async () => {
  const f = fixture();
  f.state.used = 1;
  f.state.decisions.push({ id: 'old-pending', prospectId: 'prospect-1',
    status: 'NEEDS_REVIEW', source: 'UNAVAILABLE', createdAt: new Date('2026-10-07'),
    reviewReasons: ['ANALYSIS_OUTCOME_UNCERTAIN'], trace: null });
  const send = confirm => new Request('https://app.example/api/decisions/triage', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signalId: 'signal-1', retryOfDecisionId: 'old-pending',
      confirmProviderRequestEnded: confirm }),
  });
  assert.equal((await f.route.POST(send(false))).status, 409);
  f.state.successfulUsage = true;
  assert.equal((await f.route.POST(send(true))).status, 409);
  assert.equal(f.state.providerCalls, 0);
});
