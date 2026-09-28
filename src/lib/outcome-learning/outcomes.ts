import { DecisionOutcomeSource, DecisionOutcomeType, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from '../prospects/identity';
import { MEMORY_EVENT, recordProspectMemoryEventInTransaction } from '../prospects/memory';

export type OutcomeInput = { userId: string; decisionId: string; outcomeType: DecisionOutcomeType;
  occurredAt: Date; note?: string | null; idempotencyKey: string };

export function validateOutcomeInput(value: unknown): Omit<OutcomeInput, 'userId'> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Outcome input required');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['decisionId', 'outcomeType', 'occurredAt', 'note', 'idempotencyKey'].includes(key)) ||
    typeof row.decisionId !== 'string' || !row.decisionId.trim() || row.decisionId.length > 100 ||
    !Object.values(DecisionOutcomeType).includes(row.outcomeType as DecisionOutcomeType) ||
    typeof row.idempotencyKey !== 'string' || !/^[\w:-]{8,128}$/.test(row.idempotencyKey) ||
    (row.note != null && (typeof row.note !== 'string' || row.note.length > 500)))
    throw new TypeError('Invalid business outcome');
  const occurredAt = row.occurredAt instanceof Date ? row.occurredAt :
    typeof row.occurredAt === 'string' ? new Date(row.occurredAt) : new Date(NaN);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60_000)
    throw new TypeError('Valid outcome time required');
  return { decisionId: row.decisionId.trim(), outcomeType: row.outcomeType as DecisionOutcomeType,
    occurredAt, note: (row.note as string | undefined)?.trim() || null, idempotencyKey: row.idempotencyKey };
}

/** Append-only correction history; Memory and outcome commit in the same serializable transaction. */
export async function recordDecisionOutcome(input: OutcomeInput, db: PrismaClient = prisma) {
  if (!input.userId) throw new TypeError('Authenticated tenant required');
  const validated = validateOutcomeInput({ decisionId: input.decisionId, outcomeType: input.outcomeType,
    occurredAt: input.occurredAt, note: input.note, idempotencyKey: input.idempotencyKey });
  return identityTransaction(db, async tx => {
    const decision = await tx.decision.findFirst({ where: { id: validated.decisionId, userId: input.userId },
      select: { id: true, prospectId: true, createdAt: true, status: true } });
    if (!decision) throw new Error('Decision not found for tenant');
    if (decision.status === 'PENDING') throw new TypeError('Outcome requires a completed Decision');
    if (validated.occurredAt < decision.createdAt) throw new TypeError('Outcome cannot precede its Decision');
    const priorKey = await tx.decisionOutcome.findUnique({ where: { userId_idempotencyKey: {
      userId: input.userId, idempotencyKey: validated.idempotencyKey } } });
    if (priorKey) {
      if (priorKey.decisionId !== decision.id) throw new TypeError('Outcome request key belongs to another Decision');
      if (priorKey.outcomeType !== validated.outcomeType || priorKey.occurredAt.getTime() !== validated.occurredAt.getTime() ||
        priorKey.note !== validated.note) throw new TypeError('Outcome request key was reused with different facts');
      return { outcome: priorKey, reused: true };
    }
    const latest = await tx.decisionOutcome.findFirst({ where: { userId: input.userId, decisionId: decision.id },
      orderBy: { revision: 'desc' }, select: { revision: true } });
    const outcome = await tx.decisionOutcome.create({ data: { userId: input.userId,
      decisionId: decision.id, prospectId: decision.prospectId, revision: (latest?.revision ?? 0) + 1,
      outcomeType: validated.outcomeType, source: DecisionOutcomeSource.HUMAN_RECORDED,
      note: validated.note, occurredAt: validated.occurredAt, idempotencyKey: validated.idempotencyKey,
      recordedById: input.userId } });
    await recordProspectMemoryEventInTransaction(tx, { userId: input.userId, prospectId: decision.prospectId,
      eventType: MEMORY_EVENT.BUSINESS_OUTCOME, sourceType: 'DECISION_OUTCOME', sourceId: outcome.id,
      description: `${latest ? 'Human updated' : 'Human recorded'} business outcome: ${outcome.outcomeType.replaceAll('_', ' ')}.`,
      importance: 3, occurredAt: validated.occurredAt });
    return { outcome, reused: false };
  });
}

export async function getDecisionOutcomes(input: { userId: string; decisionId: string }, db: PrismaClient = prisma) {
  if (!input.userId || !input.decisionId) throw new TypeError('Tenant and Decision required');
  const decision = await db.decision.findFirst({ where: { id: input.decisionId, userId: input.userId }, select: { id: true } });
  if (!decision) throw new Error('Decision not found for tenant');
  const rows = await db.decisionOutcome.findMany({ where: { userId: input.userId, decisionId: input.decisionId },
    orderBy: { revision: 'desc' }, take: 25 });
  return { current: rows[0] ?? null, history: rows, truncated: rows.length === 25 };
}
