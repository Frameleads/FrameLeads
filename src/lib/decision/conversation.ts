import { ConversationDirection as Direction, ConversationSourceType as Source,
  type InboundSignal, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from '../prospects/identity';

type Scope = { userId: string; prospectId: string };
type MessageSource = Scope & { sourceType: Source; sourceId: string; direction: Direction;
  body?: string | null; providerId?: string | null; occurredAt: Date };
const boundedBody = (body: string | null | undefined) => body == null ? null : body.slice(0, 12_000);

/** The source record remains canonical; this bounded projection is idempotent by tenant/source ID. */
export async function materializeMessageInTransaction(tx: Prisma.TransactionClient, input: MessageSource) {
  if (!input.userId || !input.prospectId || !input.sourceId) throw new TypeError('Message requires tenant, prospect and source');
  const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: input.prospectId } }, select: { id: true } });
  if (!prospect) throw new Error('Prospect not found for authenticated tenant');
  const conversation = await tx.conversation.upsert({ where: { userId_prospectId: { userId: input.userId, prospectId: input.prospectId } },
    create: { userId: input.userId, prospectId: input.prospectId, lastMessageAt: input.occurredAt }, update: {} });
  await tx.conversationMessage.createMany({ data: [{ userId: input.userId, conversationId: conversation.id,
    prospectId: input.prospectId, direction: input.direction, sourceType: input.sourceType, sourceId: input.sourceId,
    providerId: input.providerId ?? null, body: boundedBody(input.body), occurredAt: input.occurredAt }], skipDuplicates: true });
  if (!conversation.lastMessageAt || conversation.lastMessageAt < input.occurredAt)
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: input.occurredAt } });
  return tx.conversationMessage.findUniqueOrThrow({ where: { userId_sourceType_sourceId: {
    userId: input.userId, sourceType: input.sourceType, sourceId: input.sourceId } } });
}

export function isReplySignal(signal: Pick<InboundSignal, 'sourceType' | 'signalType'>) {
  return signal.sourceType !== 'SIGNAL_TRIGGERED' && signal.signalType !== 'BOUNCE';
}
export function materializeInboundSignalInTransaction(tx: Prisma.TransactionClient,
  signal: Pick<InboundSignal, 'id' | 'userId' | 'prospectId' | 'rawEmail' | 'sourceMessageId' | 'createdAt' | 'sourceType' | 'signalType'>) {
  if (!signal.userId || !signal.prospectId || !isReplySignal(signal)) return Promise.resolve(null);
  return materializeMessageInTransaction(tx, { userId: signal.userId, prospectId: signal.prospectId,
    sourceType: Source.INBOUND_SIGNAL, sourceId: signal.id, direction: Direction.INBOUND,
    body: signal.rawEmail, providerId: signal.sourceMessageId, occurredAt: signal.createdAt });
}

/** Bounded lazy projection; no mass backfill or provider calls. */
export async function getOrMaterializeConversation(input: Scope, db: PrismaClient = prisma) {
  if (!input.userId || !input.prospectId) throw new TypeError('Tenant and prospect required');
  return identityTransaction(db, async tx => {
    const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: input.prospectId } }, select: { id: true } });
    if (!prospect) throw new Error('Prospect not found for authenticated tenant');
    const [inbounds, outbounds] = await Promise.all([
      tx.inboundSignal.findMany({ where: { userId: input.userId, prospectId: input.prospectId },
        orderBy: { createdAt: 'desc' }, take: 30,
        select: { id: true, userId: true, prospectId: true, rawEmail: true, sourceMessageId: true,
          createdAt: true, sourceType: true, signalType: true } }),
      tx.outboundLog.findMany({ where: { lead: { userId: input.userId, prospectId: input.prospectId }, status: 'sent' },
        orderBy: { sentAt: 'desc' }, take: 20, select: { id: true, sentAt: true } }),
    ]);
    for (const inbound of inbounds.reverse()) await materializeInboundSignalInTransaction(tx, inbound);
    for (const outbound of outbounds.reverse()) await materializeMessageInTransaction(tx, { ...input,
      sourceType: Source.OUTBOUND_LOG, sourceId: outbound.id, direction: Direction.OUTBOUND,
      // OutboundLog stores send metadata but not the actual sent body; never substitute a draft as fact.
      body: null, occurredAt: outbound.sentAt });
    return tx.conversation.upsert({ where: { userId_prospectId: input }, create: { ...input }, update: {} });
  });
}

export async function getInboundConversationMessage(input: { userId: string; signalId: string }, db: PrismaClient = prisma) {
  const signal = await db.inboundSignal.findFirst({ where: { id: input.signalId, userId: input.userId },
    select: { id: true, userId: true, prospectId: true, rawEmail: true, sourceMessageId: true,
      createdAt: true, sourceType: true, signalType: true } });
  if (!signal) throw new Error('Inbound signal not found for authenticated tenant');
  if (!signal.prospectId || !isReplySignal(signal)) return { signal, conversation: null, message: null };
  const conversation = await getOrMaterializeConversation({ userId: input.userId, prospectId: signal.prospectId }, db);
  let message = await db.conversationMessage.findUnique({ where: { userId_sourceType_sourceId: {
    userId: input.userId, sourceType: Source.INBOUND_SIGNAL, sourceId: signal.id } } });
  // The requested reply may be older than the bounded lazy history window.
  if (!message) message = await identityTransaction(db, tx => materializeInboundSignalInTransaction(tx, signal)) as typeof message;
  return { signal, conversation, message };
}
