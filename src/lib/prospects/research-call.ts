import { randomUUID } from 'node:crypto';
import { AIFeature, AIOperation, AIProvider, AIUsageStatus, type PrismaClient } from '@prisma/client';
import { recordAIUsage, type AIUsageTokens } from '../ai/usage';
import { SCOUT_RESEARCH_MODEL, type ResearchProvider, type ResearchRequest } from './research-provider';

export class AIUsageRecordingError extends Error {
  constructor(cause: unknown) { super('AI usage recording failed', { cause }); }
}

export async function analyzeScoutWithUsage(input: {
  db: PrismaClient;
  provider: ResearchProvider;
  request: ResearchRequest;
  userId: string;
  prospectId?: string;
  companyKey?: string;
  operation: AIOperation;
  recordUsage?: typeof recordAIUsage;
}): Promise<unknown> {
  const requestId = randomUUID();
  let attempted = false;
  let responded = false;
  let usage: AIUsageTokens | null = null;
  let startedAt = 0;
  let output: unknown;
  let failure: unknown;
  try {
    output = await input.provider.analyze(input.request, {
      onRequestStart() { attempted = true; startedAt = performance.now(); },
      onResponse(reported) { responded = true; usage = reported; },
    });
    // Older injected providers in tests do not implement the optional observer.
    if (!attempted) { attempted = true; startedAt = performance.now(); }
  } catch (error) { failure = error; }
  if (attempted) {
    try {
      await (input.recordUsage || recordAIUsage)({
        userId: input.userId, prospectId: input.prospectId, companyKey: input.companyKey,
        feature: AIFeature.SCOUT_RESEARCH, operation: input.operation,
        provider: AIProvider.GEMINI, model: SCOUT_RESEARCH_MODEL,
        requestId, attempt: 1,
        status: failure && !responded ? AIUsageStatus.FAILED : AIUsageStatus.SUCCESS,
        usage, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      }, input.db);
    } catch (error) { throw new AIUsageRecordingError(error); }
  }
  if (failure) throw failure;
  return output;
}
