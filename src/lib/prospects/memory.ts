import { type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from './identity';

export const MEMORY_EVENT = {
  BASELINE: 'BASELINE', LEAD_LINKED: 'LEAD_LINKED', QUALIFICATION_CHANGED: 'QUALIFICATION_CHANGED',
  QUALIFICATION_OVERRIDE: 'QUALIFICATION_OVERRIDE', RESEARCH_COMPLETED: 'RESEARCH_COMPLETED',
  SANDBOX_HANDOFF: 'SANDBOX_HANDOFF', OUTBOUND_SENT: 'OUTBOUND_SENT', INBOUND_RECEIVED: 'INBOUND_RECEIVED',
  HUMAN_APPROVED: 'HUMAN_APPROVED', HUMAN_EDIT_SENT: 'HUMAN_EDIT_SENT', HUMAN_REJECTED: 'HUMAN_REJECTED',
  DECISION_ESCALATED: 'DECISION_ESCALATED', AUTOMATED_SENT: 'AUTOMATED_SENT',
  BUSINESS_OUTCOME: 'BUSINESS_OUTCOME',
} as const;
export type MemoryEventType = typeof MEMORY_EVENT[keyof typeof MEMORY_EVENT];
export type MemoryPurpose = 'SCOUT' | 'OUTREACH' | 'INBOX' | 'GENERAL';
type Scope = { userId: string; prospectId: string };
type EventInput = Scope & { eventType: MemoryEventType; sourceType: string; sourceId: string; description: string; importance?: number; occurredAt?: Date };

const MAX_DESCRIPTION = 360;
const SUMMARY_EVENTS = 8;
function compact(value: string, max: number): string { return value.replace(/\s+/g, ' ').trim().slice(0, max); }

/** Requires an existing transaction. Unique source identity makes retries harmless. */
export async function recordProspectMemoryEventInTransaction(tx: Prisma.TransactionClient, input: EventInput): Promise<boolean> {
  if (!input.userId || !input.prospectId || !input.sourceType || !input.sourceId || !input.description) throw new TypeError('Memory event requires tenant, prospect, source and description');
  const scope = { userId: input.userId, prospectId: input.prospectId };
  const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: input.prospectId } }, select: { id: true } });
  if (!prospect) throw new Error('Prospect not found for authenticated user');
  await tx.prospectMemoryState.upsert({ where: { userId_prospectId: scope }, create: { ...scope }, update: {} });
  const inserted = await tx.prospectMemoryEvent.createMany({ data: [{ ...scope, eventType: input.eventType, sourceType: input.sourceType,
    sourceId: input.sourceId, description: compact(input.description, MAX_DESCRIPTION), importance: Math.min(3, Math.max(1, input.importance ?? 1)),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}) }], skipDuplicates: true });
  if (!inserted.count) return false;
  const recent = await tx.prospectMemoryEvent.findMany({ where: scope, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: SUMMARY_EVENTS, select: { description: true } });
  const latest = await tx.prospectMemoryEvent.findFirst({ where: scope, orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } });
  await tx.prospectMemoryState.update({ where: { userId_prospectId: scope }, data: {
    eventCount: { increment: 1 }, lastEventAt: latest?.occurredAt,
    rollingSummary: recent.reverse().map(row => compact(row.description, 140)).join(' • ').slice(0, 1200),
  } });
  return true;
}

export function recordProspectMemoryEvent(input: EventInput, db: PrismaClient = prisma): Promise<boolean> {
  // Domain callers inside a larger transaction must keep the event in that transaction.
  if (!('$transaction' in db)) return recordProspectMemoryEventInTransaction(db as unknown as Prisma.TransactionClient, input);
  return identityTransaction(db, tx => recordProspectMemoryEventInTransaction(tx, input));
}

/** Lazily seed a bounded historical baseline; never invents missing activity. */
export async function ensureProspectMemory(input: Scope, db: PrismaClient = prisma) {
  return identityTransaction(db, async tx => {
    const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: input.prospectId } },
      select: { id: true, firstName: true, lastName: true, companyName: true, createdAt: true } });
    if (!prospect) throw new Error('Prospect not found for authenticated user');
    const initialized = await tx.prospectMemoryEvent.findFirst({ where: { ...input, eventType: MEMORY_EVENT.BASELINE,
      sourceType: 'PROSPECT', sourceId: prospect.id }, select: { id: true } });
    if (initialized) return;
    await recordProspectMemoryEventInTransaction(tx, { ...input, eventType: MEMORY_EVENT.BASELINE, sourceType: 'PROSPECT', sourceId: prospect.id,
      description: `Prospect record created: ${compact([prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || 'Unnamed prospect', 90)}${prospect.companyName ? ` at ${compact(prospect.companyName, 90)}` : ''}.`,
      occurredAt: prospect.createdAt });
    const [leads, inbounds, outbounds] = await Promise.all([
      tx.generatedLead.findMany({ where: input, select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      tx.inboundSignal.findMany({ where: input, select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      tx.outboundLog.findMany({ where: { lead: { userId: input.userId, prospectId: input.prospectId }, status: 'sent' }, select: { id: true, sentAt: true }, orderBy: { sentAt: 'desc' }, take: 20 }),
    ]);
    for (const lead of leads) await recordProspectMemoryEventInTransaction(tx, { ...input, eventType: MEMORY_EVENT.LEAD_LINKED,
      sourceType: 'GENERATED_LEAD', sourceId: lead.id, description: 'Lead linked to prospect.', occurredAt: lead.createdAt });
    for (const inbound of inbounds) await recordProspectMemoryEventInTransaction(tx, { ...input, eventType: MEMORY_EVENT.INBOUND_RECEIVED,
      sourceType: 'INBOUND_SIGNAL', sourceId: inbound.id, description: 'Inbound reply received.', occurredAt: inbound.createdAt, importance: 3 });
    for (const outbound of outbounds) await recordProspectMemoryEventInTransaction(tx, { ...input, eventType: MEMORY_EVENT.OUTBOUND_SENT,
      sourceType: 'OUTBOUND_LOG', sourceId: outbound.id, description: 'Outbound message sent.', occurredAt: outbound.sentAt, importance: 2 });
  });
}

const relevant: Record<MemoryPurpose, MemoryEventType[]> = {
  SCOUT: [MEMORY_EVENT.QUALIFICATION_CHANGED, MEMORY_EVENT.QUALIFICATION_OVERRIDE, MEMORY_EVENT.RESEARCH_COMPLETED, MEMORY_EVENT.INBOUND_RECEIVED],
  OUTREACH: [MEMORY_EVENT.QUALIFICATION_OVERRIDE, MEMORY_EVENT.RESEARCH_COMPLETED, MEMORY_EVENT.OUTBOUND_SENT, MEMORY_EVENT.INBOUND_RECEIVED, MEMORY_EVENT.SANDBOX_HANDOFF],
  INBOX: [MEMORY_EVENT.INBOUND_RECEIVED, MEMORY_EVENT.OUTBOUND_SENT, MEMORY_EVENT.HUMAN_APPROVED,
    MEMORY_EVENT.HUMAN_EDIT_SENT, MEMORY_EVENT.HUMAN_REJECTED, MEMORY_EVENT.DECISION_ESCALATED,
    MEMORY_EVENT.AUTOMATED_SENT, MEMORY_EVENT.BUSINESS_OUTCOME,
    MEMORY_EVENT.QUALIFICATION_OVERRIDE, MEMORY_EVENT.RESEARCH_COMPLETED],
  GENERAL: Object.values(MEMORY_EVENT),
};

export async function getProspectMemoryContext(input: Scope & { purpose?: MemoryPurpose; maxEvents?: number; since?: Date; eventTypes?: MemoryEventType[] }, db: PrismaClient = prisma) {
  await ensureProspectMemory(input, db);
  const scope = { userId: input.userId, prospectId: input.prospectId };
  const maxEvents = Math.min(20, Math.max(1, input.maxEvents ?? 8));
  const types = input.eventTypes?.length ? input.eventTypes : relevant[input.purpose ?? 'GENERAL'];
  const where = { ...scope, eventType: { in: types }, ...(input.since ? { occurredAt: { gte: input.since } } : {}) };
  const [state, recent, important] = await Promise.all([
    db.prospectMemoryState.findUnique({ where: { userId_prospectId: scope }, select: { rollingSummary: true, eventCount: true, lastEventAt: true } }),
    db.prospectMemoryEvent.findMany({ where, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: maxEvents,
      select: { id: true, eventType: true, description: true, occurredAt: true, importance: true } }),
    db.prospectMemoryEvent.findMany({ where: { ...where, importance: { gte: 3 } }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: Math.min(4, maxEvents),
      select: { id: true, eventType: true, description: true, occurredAt: true, importance: true } }),
  ]);
  const combined = [...important, ...recent].filter((row, index, all) => all.findIndex(other => other.id === row.id) === index)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, maxEvents);
  return { prospectId: input.prospectId, rollingSummary: state?.rollingSummary ?? '', eventCount: state?.eventCount ?? 0,
    lastEventAt: state?.lastEventAt ?? null, events: combined, contextText: compact(combined.map(row => `${row.eventType}: ${row.description}`).join('\n'), 3000) };
}
