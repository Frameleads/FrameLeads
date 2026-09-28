import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIFeature, AIOperation, AIProvider, AIUsageStatus, type PrismaClient } from '@prisma/client';
import { estimateAICost, getTenantAIUsage, recordAIUsage } from '../src/lib/ai/usage';
import { geminiUsageTokens } from '../src/lib/prospects/research-provider';

const base = {
  userId: 'tenant-a', feature: AIFeature.SCOUT_RESEARCH, operation: AIOperation.ICP_ANALYSIS,
  provider: AIProvider.GEMINI, model: 'gemini-2.5-flash', status: AIUsageStatus.SUCCESS,
  latencyMs: 42, prospectId: 'prospect-a', requestId: 'request-a',
};

test('Gemini SDK metadata maps actual reported tokens; absent metrics remain null', async () => {
  const writes: any[] = [];
  const db = { aIUsageEvent: { create: async ({ data }: any) => { writes.push(data); return data; } } } as unknown as PrismaClient;
  const usage = geminiUsageTokens({ promptTokenCount: 120, candidatesTokenCount: 33, totalTokenCount: 153, cachedContentTokenCount: 70 });
  await recordAIUsage({ ...base, usage }, db);
  assert.deepEqual(writes[0], {
    ...base, attempt: 1, companyKey: null, estimatedCostUsdMicros: null,
    inputTokens: 120, outputTokens: 33, totalTokens: 153,
    cachedInputTokens: 70, reasoningTokens: null,
  });
  await recordAIUsage({ ...base, usage: geminiUsageTokens({ promptTokenCount: 0 }) }, db);
  assert.equal(writes[1].inputTokens, 0);
  assert.equal(writes[1].outputTokens, null);
  assert.equal(writes[1].totalTokens, null);
  assert.equal(writes[1].cachedInputTokens, null);
  assert.equal(writes[1].reasoningTokens, null);
  assert.equal(geminiUsageTokens(undefined), null);
  assert.equal(estimateAICost(base), null);
});

test('failure ledger is metadata-only and rejects invalid counters', async () => {
  const writes: any[] = [];
  const db = { aIUsageEvent: { create: async ({ data }: any) => { writes.push(data); return data; } } } as unknown as PrismaClient;
  await recordAIUsage({ ...base, status: AIUsageStatus.FAILED, usage: null }, db);
  assert.equal(writes[0].status, 'FAILED');
  assert.equal(writes[0].totalTokens, null);
  assert.equal(JSON.stringify(writes[0]).includes('prompt'), false);
  await assert.rejects(recordAIUsage({ ...base, usage: { inputTokens: -1 } }, db), /nonnegative/);
  assert.equal(writes.length, 1);
});

test('cross-tenant prospect association is rejected by the composite database constraint', async () => {
  const db = { aIUsageEvent: { create: async ({ data }: any) => {
    if (data.userId === 'tenant-a' && data.prospectId === 'tenant-b-prospect') throw new Error('foreign key constraint');
    return data;
  } } } as unknown as PrismaClient;
  await assert.rejects(recordAIUsage({ ...base, prospectId: 'tenant-b-prospect' }, db), /foreign key/);
});

test('tenant aggregation uses filtered database aggregates and separates feature/model', async () => {
  const calls: any[] = [];
  const sum = (totalTokens: number | null, cost: bigint | null = null) => ({
    inputTokens: totalTokens, outputTokens: totalTokens, totalTokens,
    cachedInputTokens: null, reasoningTokens: null, estimatedCostUsdMicros: cost,
  });
  const db = { aIUsageEvent: {
    aggregate: async (args: any) => {
      calls.push(['aggregate', args]);
      return args.where.feature === 'SCOUT_RESEARCH'
        ? { _count: { _all: 2, totalTokens: 1 }, _sum: sum(120) }
        : { _count: { _all: 3, totalTokens: 2 }, _sum: sum(180) };
    },
    groupBy: async (args: any) => {
      calls.push(['groupBy', args]);
      return args.by[0] === 'feature'
        ? [
          { feature: AIFeature.SCOUT_RESEARCH, _count: { _all: 2 }, _sum: sum(120) },
          { feature: AIFeature.OUTBOUND_GENERATION, _count: { _all: 1 }, _sum: sum(60) },
        ]
        : args.by[0] === 'operation'
          ? [{ operation: AIOperation.ICP_ANALYSIS, _count: { _all: 3, totalTokens: 2 }, _sum: sum(180) }]
          : [{ model: 'gemini-2.5-flash', _count: { _all: 3 }, _sum: sum(180) }];
    },
  } } as unknown as PrismaClient;
  const report = await getTenantAIUsage({ userId: 'tenant-a', from: new Date('2026-09-01'), to: new Date('2026-10-01') }, db);
  assert.equal(report.calls, 3);
  assert.equal(report.totals.totalTokens, 180);
  assert.equal(report.byFeature[0].calls, 2);
  assert.equal(report.byFeature[1].feature, AIFeature.OUTBOUND_GENERATION);
  assert.equal(report.scout.researchCalls, 2);
  assert.equal(report.scout.averageTokensPerResearch, 120);
  assert.equal(report.scout.estimatedCostUsdMicros, null);
  assert.equal(report.byOperation[0].averageKnownTokens, 90);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(([, query]) => query.where.userId === 'tenant-a'));
});
