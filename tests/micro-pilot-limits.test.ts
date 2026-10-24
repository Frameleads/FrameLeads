import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MicroPilotLimitError, reserveMicroPilotDecision, reserveMicroPilotOutbound, reserveMicroPilotResearch } from '../src/lib/micro-pilot-limits';
import type { PrismaClient } from '@prisma/client';

function fixture() {
  const state = { tier: 'MICRO_PILOT', microPilotDecisionsUsed: 0, microPilotResearchUsed: 0, microPilotOutboundUsed: 0 };
  const decisionClaims: string[] = [], researchClaims: string[] = [];
  let queue = Promise.resolve();
  const tx: any = {
    microPilotDecisionClaim: { create: async ({ data }: any) => {
      if (decisionClaims.includes(data.prospectId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      decisionClaims.push(data.prospectId); return data;
    } },
    microPilotResearchClaim: { create: async ({ data }: any) => {
      if (researchClaims.includes(data.prospectId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
      researchClaims.push(data.prospectId); return data;
    } },
    user: { updateMany: async ({ where, data }: any) => {
      const field = Object.keys(data)[0], condition = where[field];
      const allowed = state.tier === where.tier && (condition.lt !== undefined ? state[field as keyof typeof state] < condition.lt :
        condition.lte !== undefined ? state[field as keyof typeof state] <= condition.lte : false);
      if (!allowed) return { count: 0 };
      const counter = field as 'microPilotDecisionsUsed' | 'microPilotResearchUsed' | 'microPilotOutboundUsed';
      state[counter] += data[field].increment;
      return { count: 1 };
    } },
  };
  const db: any = {
    ...tx,
    $transaction: (work: (client: any) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const before = { ...state }, beforeDecision = [...decisionClaims], beforeResearch = [...researchClaims];
        try { return await work(tx); }
        catch (error) { Object.assign(state, before); decisionClaims.splice(0, decisionClaims.length, ...beforeDecision);
          researchClaims.splice(0, researchClaims.length, ...beforeResearch); throw error; }
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
  };
  return { db: db as PrismaClient, state, decisionClaims, researchClaims };
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
  await reserveMicroPilotOutbound('tenant', 25, f.db);
  await assert.rejects(reserveMicroPilotOutbound('tenant', 1, f.db),
    error => error instanceof MicroPilotLimitError && error.limit === 'OUTBOUND_EXHAUSTED');
  assert.equal(f.state.microPilotOutboundUsed, 25);
});

test('concurrent decision reservations cannot exceed the three-use allowance', async () => {
  const f = fixture();
  const results = await Promise.allSettled(['p1', 'p2', 'p3', 'p4'].map(id => reserveMicroPilotDecision('tenant', id, f.db)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 3);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason instanceof MicroPilotLimitError).length, 1);
  assert.equal(f.state.microPilotDecisionsUsed, 3);
});
