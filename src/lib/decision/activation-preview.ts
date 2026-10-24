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
export async function reserveTriageDecision(db: PrismaClient, data: Prisma.DecisionUncheckedCreateInput, preview: boolean, microPilotReserved = false) {
  const user = await db.user.findUnique({ where: { id: data.userId }, select: { tier: true, microPilotDecisionsUsed: true } });
  if (!user) throw new Error('TENANT_NOT_FOUND');
  if (user.tier !== 'MICRO_PILOT') {
    if (!['CORE', 'ENTERPRISE'].includes(user.tier)) throw new Error('DECISION_ENGINE_LOCKED');
    return db.decision.create({ data });
  }
  if (microPilotReserved && !preview) {
    return db.$transaction(async tx => {
      const locked = await tx.$queryRaw<{ tier: string; microPilotDecisionsUsed: number }[]>`SELECT "tier", "microPilotDecisionsUsed" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
      if (locked[0]?.tier !== 'MICRO_PILOT') throw new Error('PREVIEW_TIER_CHANGED');
      const claim = await tx.microPilotDecisionClaim.findUnique({ where: { userId_prospectId: { userId: data.userId, prospectId: data.prospectId! } } });
      if (!claim) throw new Error('MICRO_PILOT_DECISION_RESERVATION_REQUIRED');
      const existing = await tx.decision.findFirst({ where: { userId: data.userId, prospectId: data.prospectId }, select: { id: true } });
      if (existing) throw new Error('ACTIVATION_PREVIEW_EXHAUSTED');
      return tx.decision.create({ data: { ...data, shadowMode: true } });
    }, { isolationLevel: 'ReadCommitted' });
  }
  if (!preview || data.supersedesDecisionId) throw new Error('DECISION_ENGINE_LOCKED');
  return db.$transaction(async tx => {
    const locked = await tx.$queryRaw<{ tier: string; microPilotDecisionsUsed: number }[]>`SELECT "tier", "microPilotDecisionsUsed" FROM "User" WHERE "id" = ${data.userId} FOR UPDATE`;
    if (locked[0]?.tier !== 'MICRO_PILOT') throw new Error('PREVIEW_TIER_CHANGED');
    if (locked[0].microPilotDecisionsUsed >= 3) throw new Error('MICRO_PILOT_DECISION_LIMIT_REACHED');
    const existing = await tx.decision.findFirst({ where: { userId: data.userId, prospectId: data.prospectId }, select: { id: true } });
    if (existing) throw new Error('ACTIVATION_PREVIEW_EXHAUSTED');
    await tx.microPilotDecisionClaim.create({ data: { userId: data.userId, prospectId: data.prospectId! } });
    await tx.user.update({ where: { id: data.userId }, data: { microPilotDecisionsUsed: { increment: 1 } } });
    return tx.decision.create({ data: { ...data, shadowMode: true } });
  }, { isolationLevel: 'ReadCommitted' });
}
