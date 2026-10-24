import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { identityTransaction } from './prospects/identity';

export type MicroPilotLimit = 'DECISIONS_EXHAUSTED' | 'PROSPECT_ALREADY_USED' | 'RESEARCH_EXHAUSTED' | 'RESEARCH_ALREADY_USED' | 'OUTBOUND_EXHAUSTED';
export class MicroPilotLimitError extends Error {
  constructor(readonly limit: MicroPilotLimit) { super(limit); this.name = 'MicroPilotLimitError'; }
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' ||
    !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002';
}

export async function reserveMicroPilotDecision(userId: string, prospectId: string, db: PrismaClient = prisma) {
  try {
    await identityTransaction(db, async tx => {
      await tx.microPilotDecisionClaim.create({ data: { userId, prospectId } });
      const reserved = await tx.user.updateMany({ where: { id: userId, tier: 'MICRO_PILOT', microPilotDecisionsUsed: { lt: 3 } },
        data: { microPilotDecisionsUsed: { increment: 1 } } });
      if (!reserved.count) throw new MicroPilotLimitError('DECISIONS_EXHAUSTED');
    });
  } catch (error) {
    if (error instanceof MicroPilotLimitError) throw error;
    if (isUniqueConflict(error)) throw new MicroPilotLimitError('PROSPECT_ALREADY_USED');
    throw error;
  }
}

export async function reserveMicroPilotResearch(userId: string, prospectId: string, db: PrismaClient = prisma) {
  try {
    await identityTransaction(db, async tx => {
      await tx.microPilotResearchClaim.create({ data: { userId, prospectId } });
      const reserved = await tx.user.updateMany({ where: { id: userId, tier: 'MICRO_PILOT', microPilotResearchUsed: { lt: 3 } },
        data: { microPilotResearchUsed: { increment: 1 } } });
      if (!reserved.count) throw new MicroPilotLimitError('RESEARCH_EXHAUSTED');
    });
  } catch (error) {
    if (error instanceof MicroPilotLimitError) throw error;
    if (isUniqueConflict(error)) throw new MicroPilotLimitError('RESEARCH_ALREADY_USED');
    throw error;
  }
}

export async function reserveMicroPilotOutbound(userId: string, count: number, db: PrismaClient = prisma) {
  if (!Number.isInteger(count) || count < 1) return;
  const reserved = await db.user.updateMany({
    where: { id: userId, tier: 'MICRO_PILOT', microPilotOutboundUsed: { lte: 25 - count } },
    data: { microPilotOutboundUsed: { increment: count } },
  });
  if (!reserved.count) throw new MicroPilotLimitError('OUTBOUND_EXHAUSTED');
}
