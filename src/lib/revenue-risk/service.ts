import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { scoreRevenueRisk, type RiskFacts } from './scoring';

const BATCH_SIZE = 100;
const MESSAGE_LIMIT = 5000;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Tenant-scoped, bounded batch assessment; no AI, network call, or per-row history query. */
export async function assessRevenueAtRiskBatch(input: { userId: string; decisionIds: string[]; now?: Date },
  db: PrismaClient = prisma) {
  if (!input.userId) throw new TypeError('Authenticated tenant required');
  const ids = [...new Set(input.decisionIds)];
  if (ids.some(id => !id || id.length > 100)) throw new TypeError('Invalid Decision ID');
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid assessment time');
  const results = new Map<string, Awaited<ReturnType<typeof db.decisionRevenueRisk.findFirst>>>();
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + BATCH_SIZE);
    const decisions = await db.decision.findMany({ where: { userId: input.userId, id: { in: chunk } },
      select: { id: true, userId: true, prospectId: true, conversationId: true, inputMessageId: true,
        primaryIntent: true, status: true, confidenceScore: true, requiresReview: true,
        inputMessage: { select: { occurredAt: true } },
        prospect: { select: { qualification: { select: { id: true, status: true } },
          intelligence: { select: { id: true, fitScore: true, fitTier: true, potentialValueBand: true,
            researchStatus: true, lastEditedBy: true } } } } } });
    if (decisions.length !== chunk.length) throw new Error('Decision not found for tenant');
    const conversationIds = [...new Set(decisions.map(row => row.conversationId))];
    const [messages, resolutions, existing] = await Promise.all([
      db.conversationMessage.findMany({ where: { userId: input.userId, conversationId: { in: conversationIds } },
        select: { id: true, conversationId: true, direction: true, occurredAt: true },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: MESSAGE_LIMIT }),
      db.decisionAutomationResolution.findMany({ where: { userId: input.userId, decisionId: { in: chunk } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: chunk.length * 10,
        select: { id: true, decisionId: true, state: true, resolvedMode: true } }),
      db.decisionRevenueRisk.findMany({ where: { userId: input.userId, decisionId: { in: chunk } } }),
    ]);
    const historyComplete = messages.length < MESSAGE_LIMIT;
    const messagesByConversation = new Map<string, typeof messages>();
    for (const message of messages) {
      const group = messagesByConversation.get(message.conversationId) ?? [];
      group.push(message); messagesByConversation.set(message.conversationId, group);
    }
    const latestResolution = new Map<string, (typeof resolutions)[number]>();
    for (const row of resolutions) if (!latestResolution.has(row.decisionId)) latestResolution.set(row.decisionId, row);
    const existingByDecision = new Map(existing.map(row => [row.decisionId, row]));
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const decision of decisions) {
      const history = messagesByConversation.get(decision.conversationId) ?? [];
      const recent = history.filter(message => message.occurredAt >= new Date(now.getTime() - 30 * 86_400_000));
      const latestOutbound = history.find(message => message.direction === 'OUTBOUND');
      const resolution = latestResolution.get(decision.id);
      const intelligence = decision.prospect.intelligence;
      const usableIntelligence = intelligence?.researchStatus === 'READY' || intelligence?.lastEditedBy === 'USER' ? intelligence : null;
      const qualification = decision.prospect.qualification;
      const facts: RiskFacts = { decisionId: decision.id, prospectId: decision.prospectId,
        primaryIntent: decision.primaryIntent, decisionStatus: decision.status,
        decisionConfidence: decision.confidenceScore, requiresReview: decision.requiresReview,
        qualificationStatus: qualification?.status ?? null, fitScore: usableIntelligence?.fitScore ?? null,
        fitTier: usableIntelligence?.fitTier ?? null, valueBand: usableIntelligence?.potentialValueBand ?? null,
        inboundAt: decision.inputMessage.occurredAt, latestOutboundAt: latestOutbound?.occurredAt ?? null,
        outboundHistoryComplete: historyComplete, recentInboundCount: historyComplete ? recent.filter(row => row.direction === 'INBOUND').length : null,
        recentOutboundCount: historyComplete ? recent.filter(row => row.direction === 'OUTBOUND').length : null,
        automationState: resolution?.state ?? null, automationMode: resolution?.resolvedMode ?? null,
        inputMessageId: decision.inputMessageId, intelligenceId: usableIntelligence?.id ?? null,
        qualificationId: qualification?.id ?? null, automationResolutionId: resolution?.id ?? null,
        recentMessageIds: history.slice(0, 6).map(row => row.id) };
      const assessed = scoreRevenueRisk(facts, now);
      const inputFingerprint = hash(assessed);
      const prior = existingByDecision.get(decision.id);
      if (prior?.inputFingerprint === inputFingerprint) { results.set(decision.id, prior); continue; }
      const data = { status: assessed.status, score: assessed.score, band: assessed.band,
        confidence: assessed.confidence, components: assessed.components as unknown as Prisma.InputJsonValue,
        reasons: assessed.reasons, sourceReferences: assessed.sourceReferences as unknown as Prisma.InputJsonValue,
        scoringVersion: assessed.scoringVersion, inputFingerprint, evaluatedAt: now };
      writes.push(db.decisionRevenueRisk.upsert({ where: { userId_decisionId: { userId: input.userId, decisionId: decision.id } },
        create: { userId: input.userId, decisionId: decision.id, ...data }, update: data }));
    }
    if (writes.length) {
      const saved = await db.$transaction(writes);
      for (const row of saved as { decisionId: string }[]) results.set(row.decisionId, row as Awaited<ReturnType<typeof db.decisionRevenueRisk.findFirst>>);
    }
  }
  return ids.map(id => results.get(id)!);
}

export async function assessRevenueAtRisk(input: { userId: string; decisionId: string; now?: Date },
  db: PrismaClient = prisma) {
  const [assessment] = await assessRevenueAtRiskBatch({ userId: input.userId,
    decisionIds: [input.decisionId], now: input.now }, db);
  return assessment;
}
