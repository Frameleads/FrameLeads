import type { Prisma, PrismaClient } from '@prisma/client';

export function realPreviewReply(signal: { userId: string | null; prospectId: string | null; sourceType: string; signalType: string | null; sourceMessageId: string | null; rawEmail: string | null }, userId: string) {
  return signal.userId === userId && Boolean(signal.prospectId && signal.rawEmail?.trim() &&
    signal.signalType === 'EMAIL_REPLY' && ['WEBHOOK', 'IMAP_NATIVE'].includes(signal.sourceType) &&
    signal.sourceMessageId && !/^(demo|sample|test|fixture|synthetic)[_:-]/i.test(signal.sourceMessageId));
}

/** Reserve the canonical PENDING Decision before analysis. Never hold the lock during a model call.
 * Existing User row is the durable tenant mutex; no new schema or frontend allowance is needed.
 * A failed attempt stays reserved for operator review rather than silently granting another call.
 */
export async function reserveTriageDecision(db: PrismaClient, data: Prisma.DecisionUncheckedCreateInput, preview: boolean) {
  const user = await db.user.findUnique({ where: { id: data.userId }, select: { tier: true } });
  if (!user) throw new Error('TENANT_NOT_FOUND');
  if (user.tier !== 'MICRO_PILOT') {
    if (!['CORE', 'ENTERPRISE'].includes(user.tier)) throw new Error('DECISION_ENGINE_LOCKED');
    return db.decision.create({ data });
  }
  if (!preview || data.supersedesDecisionId) throw new Error('DECISION_ENGINE_LOCKED');
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ tier: string }[]>`SELECT "tier" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    if (locked[0]?.tier !== 'MICRO_PILOT') throw new Error('PREVIEW_TIER_CHANGED');
    // Includes PENDING and failed attempts. A second signal/context can never reserve another Decision.
    if (await tx.decision.findFirst({ where: { userId: data.userId }, select: { id: true } }))
      throw new Error('ACTIVATION_PREVIEW_EXHAUSTED');
    return tx.decision.create({ data: { ...data, shadowMode: true } });
  }, { isolationLevel: 'ReadCommitted' });
}
