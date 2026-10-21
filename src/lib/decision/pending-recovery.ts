import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';

export const STALLED_DECISION_AFTER_MS = 10 * 60 * 1000;
export const UNCERTAIN_ANALYSIS_REASON = 'ANALYSIS_OUTCOME_UNCERTAIN';

/** Close a stale reservation for human review without retrying or changing its trace/usage evidence. */
export async function markStalledDecisionForReview(input: {
  userId: string; decisionId: string; now?: Date;
}, db: PrismaClient = prisma) {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALLED_DECISION_AFTER_MS);
  const decision = await db.decision.findFirst({
    where: { id: input.decisionId, userId: input.userId },
    select: { id: true, status: true, createdAt: true, updatedAt: true,
      reviewReasons: true, trace: { select: { id: true } } },
  });
  if (!decision) return { status: 'NOT_FOUND' as const };
  if (decision.status !== 'PENDING' || decision.trace) return { status: 'NOT_PENDING' as const };
  if (decision.createdAt > staleBefore) return { status: 'TOO_RECENT' as const };

  const updated = await db.decision.updateMany({
    where: { id: decision.id, userId: input.userId, status: 'PENDING',
      createdAt: { lte: staleBefore }, updatedAt: decision.updatedAt, trace: { is: null } },
    data: { status: 'NEEDS_REVIEW', requiresReview: true,
      reviewReasons: [...new Set([UNCERTAIN_ANALYSIS_REASON, ...decision.reviewReasons])].slice(0, 8),
      recommendedNextAction: 'REVIEW_MANUALLY',
      explanation: 'The analysis reservation exceeded the stale timeout. Provider completion is uncertain; verify provider request state before any re-analysis.' },
  });
  return updated.count === 1 ? { status: 'MARKED_UNCERTAIN' as const } : { status: 'CHANGED_CONCURRENTLY' as const };
}
