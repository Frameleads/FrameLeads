import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { identityTransaction } from './prospects/identity';
import { buildFallbackIdentityKey } from './prospects/normalization';

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

/** Release only a reservation proven to have failed before any provider usage.
 * Any request with persisted usage or a finalized Decision stays consumed. */
export async function releaseUnstartedMicroPilotDecision(userId: string, prospectId: string, db: PrismaClient = prisma) {
  return identityTransaction(db, async tx => {
    const claim = await tx.microPilotDecisionClaim.findUnique({ where: { userId_prospectId: { userId, prospectId } } });
    if (!claim) return false;
    const [decision, usage] = await Promise.all([
      tx.decision.findFirst({ where: { userId, prospectId }, select: { id: true, status: true, source: true, trace: { select: { id: true } } } }),
      tx.aIUsageEvent.findFirst({ where: { userId, prospectId, feature: 'INBOX_TRIAGE', operation: 'TRIAGE_ANALYSIS' }, select: { id: true } }),
    ]);
    const safePreProviderFailure = decision && (decision.status === 'PENDING' && !decision.trace || decision.source === 'UNAVAILABLE');
    if (usage || decision && !safePreProviderFailure) return false;
    if (decision) await tx.decision.delete({ where: { id: decision.id, userId } });
    const changed = await tx.user.updateMany({ where: { id: userId, microPilotDecisionsUsed: { gt: 0 } },
      data: { microPilotDecisionsUsed: { decrement: 1 } } });
    if (!changed.count) return false;
    await tx.microPilotDecisionClaim.delete({ where: { userId_prospectId: { userId, prospectId } } });
    return true;
  });
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

/** A research attempt with no provider usage and no committed result may be retried. */
export async function releaseUnstartedMicroPilotResearch(userId: string, prospectId: string, db: PrismaClient = prisma) {
  return identityTransaction(db, async tx => {
    const [claim, usage, intelligence] = await Promise.all([
      tx.microPilotResearchClaim.findUnique({ where: { userId_prospectId: { userId, prospectId } } }),
      tx.aIUsageEvent.findFirst({ where: { userId, prospectId, feature: 'SCOUT_RESEARCH' }, select: { id: true } }),
      tx.prospectIntelligence.findUnique({ where: { userId_prospectId: { userId, prospectId } }, select: { researchStatus: true, researchedAt: true } }),
    ]);
    if (!claim || usage || intelligence?.researchStatus === 'READY' || intelligence?.researchedAt) return false;
    const changed = await tx.user.updateMany({ where: { id: userId, microPilotResearchUsed: { gt: 0 } },
      data: { microPilotResearchUsed: { decrement: 1 } } });
    if (!changed.count) return false;
    await tx.microPilotResearchClaim.delete({ where: { userId_prospectId: { userId, prospectId } } });
    return true;
  });
}

export function microPilotOutboundIdentityKey(input: { firstName?: unknown; first_name?: unknown; lastName?: unknown; last_name?: unknown; email?: unknown;
  linkedin?: unknown; linkedInUrl?: unknown; linkedin_url?: unknown; company_name?: unknown; companyName?: unknown;
  website_url?: unknown; websiteUrl?: unknown }) {
  const linkedIn = [input.linkedin, input.linkedInUrl, input.linkedin_url].find(value => typeof value === 'string' && value.trim());
  if (typeof linkedIn === 'string') return `linkedin:${linkedIn.trim().toLowerCase()}`;
  const email = input.email;
  if (typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return `email:${email.trim().toLowerCase()}`;
  const fallback = buildFallbackIdentityKey({ firstName: typeof (input.firstName ?? input.first_name) === 'string' ? String(input.firstName ?? input.first_name) : null,
    lastName: typeof (input.lastName ?? input.last_name) === 'string' ? String(input.lastName ?? input.last_name) : null,
    companyName: typeof (input.company_name ?? input.companyName) === 'string' ? String(input.company_name ?? input.companyName) : null,
    websiteUrl: typeof (input.website_url ?? input.websiteUrl) === 'string' ? String(input.website_url ?? input.websiteUrl) : null });
  return fallback ? `fallback:${fallback}` : null;
}

export async function reserveMicroPilotOutbound(userId: string, identityKeys: string[], db: PrismaClient = prisma) {
  const distinct = [...new Set(identityKeys.filter(Boolean))];
  if (!distinct.length) return [];
  try {
    return await identityTransaction(db, async tx => {
      for (const identityKey of distinct) {
        await tx.microPilotOutboundClaim.create({ data: { userId, identityKey } });
        const reserved = await tx.user.updateMany({ where: { id: userId, tier: 'MICRO_PILOT', microPilotOutboundUsed: { lt: 25 } },
          data: { microPilotOutboundUsed: { increment: 1 } } });
        if (!reserved.count) throw new MicroPilotLimitError('OUTBOUND_EXHAUSTED');
      }
      return distinct;
    });
  } catch (error) {
    if (error instanceof MicroPilotLimitError) throw error;
    if (isUniqueConflict(error)) throw new MicroPilotLimitError('PROSPECT_ALREADY_USED');
    throw error;
  }
}

export async function releaseUnstartedMicroPilotOutbound(userId: string, identityKeys: string[], db: PrismaClient = prisma) {
  const distinct = [...new Set(identityKeys.filter(Boolean))];
  if (!distinct.length) return 0;
  return identityTransaction(db, async tx => {
    let released = 0;
    for (const identityKey of distinct) {
      const claim = await tx.microPilotOutboundClaim.findUnique({ where: { userId_identityKey: { userId, identityKey } } });
      if (!claim || claim.status !== 'RESERVED') continue;
      const changed = await tx.user.updateMany({ where: { id: userId, microPilotOutboundUsed: { gt: 0 } },
        data: { microPilotOutboundUsed: { decrement: 1 } } });
      if (!changed.count) continue;
      await tx.microPilotOutboundClaim.delete({ where: { userId_identityKey: { userId, identityKey } } });
      released++;
    }
    return released;
  });
}

export async function completeMicroPilotOutbound(userId: string, identityKeys: string[], db: PrismaClient = prisma) {
  const distinct = [...new Set(identityKeys.filter(Boolean))];
  if (!distinct.length) return 0;
  const result = await db.microPilotOutboundClaim.updateMany({ where: { userId, identityKey: { in: distinct }, status: 'RESERVED' },
    data: { status: 'COMPLETED' } });
  return result.count;
}
