import {
  AIFeature, AIOperation, AIProvider, AIUsageStatus, Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '../prisma';

/** Null means the provider did not report the metric; zero means it reported zero. */
export type AIUsageTokens = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
};

export type AIUsageInput = {
  userId: string;
  feature: AIFeature;
  operation: AIOperation;
  provider: AIProvider;
  model: string;
  usage?: AIUsageTokens | null;
  prospectId?: string | null;
  companyKey?: string | null;
  requestId?: string | null;
  attempt?: number;
  status: AIUsageStatus;
  latencyMs: number;
};

function token(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('AI token counts must be nonnegative safe integers');
  return value;
}

/** Pricing is deliberately unset until a verified, versioned price source is maintained. */
export function estimateAICost(_input: Pick<AIUsageInput, 'provider' | 'model' | 'usage'>): bigint | null {
  return null;
}

export async function recordAIUsage(input: AIUsageInput, db: PrismaClient = prisma) {
  if (!input.userId?.trim() || !input.model?.trim()) throw new TypeError('AI usage requires a tenant and model');
  if (!Number.isSafeInteger(input.latencyMs) || input.latencyMs < 0) throw new TypeError('Invalid AI latency');
  if (!Number.isSafeInteger(input.attempt ?? 1) || (input.attempt ?? 1) < 1) throw new TypeError('Invalid AI attempt');
  const usage = input.usage;
  return db.aIUsageEvent.create({ data: {
    userId: input.userId,
    prospectId: input.prospectId ?? null,
    feature: input.feature,
    operation: input.operation,
    provider: input.provider,
    model: input.model,
    inputTokens: token(usage?.inputTokens),
    outputTokens: token(usage?.outputTokens),
    totalTokens: token(usage?.totalTokens),
    cachedInputTokens: token(usage?.cachedInputTokens),
    reasoningTokens: token(usage?.reasoningTokens),
    requestId: input.requestId ?? null,
    attempt: input.attempt ?? 1,
    companyKey: input.companyKey ?? null,
    status: input.status,
    latencyMs: input.latencyMs,
    estimatedCostUsdMicros: estimateAICost(input),
  } });
}

export type AIUsageRange = { userId: string; from?: Date; to?: Date };

export async function getTenantAIUsage(range: AIUsageRange, db: PrismaClient = prisma) {
  if (!range.userId?.trim()) throw new TypeError('Tenant is required');
  if (range.from && range.to && range.from > range.to) throw new TypeError('Invalid AI usage date range');
  const where: Prisma.AIUsageEventWhereInput = {
    userId: range.userId,
    createdAt: { gte: range.from, lt: range.to },
  };
  const sums = {
    inputTokens: true, outputTokens: true, totalTokens: true,
    cachedInputTokens: true, reasoningTokens: true, estimatedCostUsdMicros: true,
  } as const;
  const [total, byFeature, byModel, byOperation, scout] = await Promise.all([
    db.aIUsageEvent.aggregate({ where, _count: { _all: true, totalTokens: true }, _sum: sums }),
    db.aIUsageEvent.groupBy({ by: ['feature'], where, _count: { _all: true }, _sum: sums }),
    db.aIUsageEvent.groupBy({ by: ['model'], where, _count: { _all: true }, _sum: sums }),
    db.aIUsageEvent.groupBy({ by: ['operation'], where, _count: { _all: true, totalTokens: true }, _sum: sums }),
    db.aIUsageEvent.aggregate({ where: { ...where, feature: AIFeature.SCOUT_RESEARCH }, _count: { _all: true, totalTokens: true }, _sum: sums }),
  ]);
  return {
    calls: total._count._all,
    knownTokenCalls: total._count.totalTokens,
    totals: total._sum,
    byFeature: byFeature.map(row => ({ feature: row.feature, calls: row._count._all, totals: row._sum })),
    byModel: byModel.map(row => ({ model: row.model, calls: row._count._all, totals: row._sum })),
    byOperation: byOperation.map(row => ({ operation: row.operation, calls: row._count._all,
      totals: row._sum, averageKnownTokens: row._count.totalTokens && row._sum.totalTokens != null
        ? row._sum.totalTokens / row._count.totalTokens : null })),
    scout: {
      researchCalls: scout._count._all,
      knownTokenCalls: scout._count.totalTokens,
      averageTokensPerResearch: scout._count.totalTokens && scout._sum.totalTokens != null
        ? scout._sum.totalTokens / scout._count.totalTokens : null,
      estimatedCostUsdMicros: scout._sum.estimatedCostUsdMicros,
    },
  };
}
