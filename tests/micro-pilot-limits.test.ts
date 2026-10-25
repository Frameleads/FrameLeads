import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicroPilotLimitError, releaseUnstartedMicroPilotDecision, releaseUnstartedMicroPilotOutbound, releaseUnstartedMicroPilotResearch, reserveMicroPilotDecision, reserveMicroPilotOutbound, reserveMicroPilotResearch } from '../src/lib/micro-pilot-limits';
import type { PrismaClient } from '@prisma/client';

function fixture() {
  const state = { tier: 'MICRO_PILOT', microPilotDecisionsUsed: 0, microPilotResearchUsed: 0, microPilotOutboundUsed: 0 };
  const decisionClaims: string[] = [], researchClaims: string[] = [], outboundClaims: string[] = [];
  const decisions: any[] = [], usageEvents: any[] = [];
  let queue = Promise.resolve();
  const tx: any = {
    microPilotResearchClaim: { create: async ({ data }: any) => {
      if (researchClaims.includes(data.prospectId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      researchClaims.push(data.prospectId); return data;
    }, findUnique: async ({ where }: any) => researchClaims.includes(where.userId_prospectId.prospectId) ? { id: 'r', ...where.userId_prospectId } : null,
      delete: async ({ where }: any) => { const i = researchClaims.indexOf(where.userId_prospectId.prospectId); if (i >= 0) researchClaims.splice(i, 1); return {}; } },
    microPilotOutboundClaim: { create: async ({ data }: any) => {
      if (outboundClaims.includes(data.identityKey)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      outboundClaims.push(data.identityKey); return data;
    }, findUnique: async ({ where }: any) => outboundClaims.includes(where.userId_identityKey.identityKey) ? { id: 'o', status: 'RESERVED', ...where.userId_identityKey } : null,
      delete: async ({ where }: any) => { const i = outboundClaims.indexOf(where.userId_identityKey.identityKey); if (i >= 0) outboundClaims.splice(i, 1); return {}; } },
    decision: { findFirst: async () => decisions[0] ?? null, delete: async ({ where }: any) => { const i = decisions.findIndex(d => d.id === where.id); if (i >= 0) decisions.splice(i, 1); return {}; } },
    aIUsageEvent: { findFirst: async () => usageEvents[0] ?? null },
    prospectIntelligence: { findUnique: async () => null },
    microPilotDecisionClaim: { findUnique: async ({ where }: any) => decisionClaims.includes(where.userId_prospectId.prospectId) ? { id: 'd', ...where.userId_prospectId } : null,
      delete: async ({ where }: any) => { const i = decisionClaims.indexOf(where.userId_prospectId.prospectId); if (i >= 0) decisionClaims.splice(i, 1); return {}; },
      create: async ({ data }: any) => {
        if (decisionClaims.includes(data.prospectId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        decisionClaims.push(data.prospectId); return data;
      } },
    user: { updateMany: async ({ where, data }: any) => {
      const field = Object.keys(data)[0], condition = where[field];
      const allowed = (!where.tier || state.tier === where.tier) && (condition.lt !== undefined ? state[field as keyof typeof state] < condition.lt :
        condition.lte !== undefined ? state[field as keyof typeof state] <= condition.lte :
        condition.gt !== undefined ? state[field as keyof typeof state] > condition.gt : false);
      if (!allowed) return { count: 0 };
      const counter = field as 'microPilotDecisionsUsed' | 'microPilotResearchUsed' | 'microPilotOutboundUsed';
      state[counter] += data[field].increment ?? data[field].decrement * -1;
      return { count: 1 };
    } },
    $queryRaw: async () => [],
  };
  const db: any = {
    ...tx,
    $transaction: (work: (client: any) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const before = { ...state }, beforeDecision = [...decisionClaims], beforeResearch = [...researchClaims], beforeOutbound = [...outboundClaims];
        try { return await work(tx); }
        catch (error) { Object.assign(state, before); decisionClaims.splice(0, decisionClaims.length, ...beforeDecision);
          researchClaims.splice(0, researchClaims.length, ...beforeResearch); outboundClaims.splice(0, outboundClaims.length, ...beforeOutbound); throw error; }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db: db as PrismaClient, state, decisionClaims, researchClaims, outboundClaims, decisions, usageEvents };
}

test('Micro-Pilot allows exactly three tenant decision reservations and blocks the fourth before analysis', async () => {
  const f = fixture();
  await reserveMicroPilotDecision('tenant', 'prospect-1', f.db);
  await reserveMicroPilotDecision('tenant', 'prospect-2', f.db);
  await reserveMicroPilotDecision('tenant', 'prospect-3', f.db);
  await assert.rejects(reserveMicroPilotDecision('tenant', 'prospect-4', f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'DECISIONS_EXHAUSTED');
  assert.equal(f.state.microPilotDecisionsUsed, 3);
  assert.deepEqual(f.decisionClaims, ['prospect-1', 'prospect-2', 'prospect-3']);
});

test('decision allowance rejects a second initial analysis for the same prospect without consuming another use', async () => {
  const f = fixture();
  await reserveMicroPilotDecision('tenant', 'prospect-1', f.db);
  await assert.rejects(reserveMicroPilotDecision('tenant', 'prospect-1', f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'PROSPECT_ALREADY_USED');
  assert.equal(f.state.microPilotDecisionsUsed, 1);
});

test('Scout research is capped at three distinct prospects and one operation per prospect', async () => {
  const f = fixture();
  await reserveMicroPilotResearch('tenant', 'prospect-1', f.db);
  await reserveMicroPilotResearch('tenant', 'prospect-2', f.db);
  await reserveMicroPilotResearch('tenant', 'prospect-3', f.db);
  await assert.rejects(reserveMicroPilotResearch('tenant', 'prospect-4', f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'RESEARCH_EXHAUSTED');
  await assert.rejects(reserveMicroPilotResearch('tenant', 'prospect-1', f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'RESEARCH_ALREADY_USED');
  assert.equal(f.state.microPilotResearchUsed, 3);
});

test('the 25-prospect allowance is atomic and a full allowance consumes no more slots', async () => {
  const f = fixture();
  await reserveMicroPilotOutbound('tenant', Array.from({ length: 25 }, (_, i) => `email:p${i}@example.com`), f.db);
  await assert.rejects(reserveMicroPilotOutbound('tenant', ['email:p25@example.com'], f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'OUTBOUND_EXHAUSTED');
  assert.equal(f.state.microPilotOutboundUsed, 25);
});

test('outbound reservations are identity-idempotent and pre-provider failures release their slots', async () => {
  const f = fixture();
  await reserveMicroPilotOutbound('tenant', ['email:one@example.com'], f.db);
  await assert.rejects(reserveMicroPilotOutbound('tenant', ['email:one@example.com'], f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'PROSPECT_ALREADY_USED');
  assert.equal(await releaseUnstartedMicroPilotOutbound('tenant', ['email:one@example.com'], f.db), 1);
  assert.equal(f.state.microPilotOutboundUsed, 0);
  assert.equal(f.outboundClaims.length, 0);
});

test('a confirmed decision setup failure releases allowance; an uncertain provider attempt remains charged', async () => {
  const f = fixture();
  await reserveMicroPilotDecision('tenant', 'p1', f.db);
  f.decisions.push({ id: 'pending', status: 'PENDING', trace: null, source: 'UNAVAILABLE' });
  assert.equal(await releaseUnstartedMicroPilotDecision('tenant', 'p1', f.db), true);
  assert.equal(f.state.microPilotDecisionsUsed, 0);
  assert.equal(f.decisions.length, 0);
  await reserveMicroPilotDecision('tenant', 'p1', f.db);
  f.usageEvents.push({ id: 'usage' });
  assert.equal(await releaseUnstartedMicroPilotDecision('tenant', 'p1', f.db), false);
  assert.equal(f.state.microPilotDecisionsUsed, 1);
});

test('a failed Scout operation with provider usage cannot release its research allowance', async () => {
  const f = fixture();
  await reserveMicroPilotResearch('tenant', 'p1', f.db);
  f.usageEvents.push({ id: 'usage' });
  assert.equal(await releaseUnstartedMicroPilotResearch('tenant', 'p1', f.db), false);
  assert.equal(f.state.microPilotResearchUsed, 1);
});

test('concurrent decision reservations cannot exceed the three-use allowance', async () => {
  const f = fixture();
  const results = await Promise.allSettled(['p1', 'p2', 'p3', 'p4'].map(id => reserveMicroPilotDecision('tenant', id, f.db)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof MicroPilotLimitError).length, 1);
  assert.equal(f.state.microPilotDecisionsUsed, 3);
});
