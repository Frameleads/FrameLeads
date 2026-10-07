import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { identityTransaction, resolveProspectInTransaction } from '../prospects/identity';
import { MEMORY_EVENT, recordProspectMemoryEventInTransaction } from '../prospects/memory';
import { materializeInboundSignalInTransaction } from './conversation';

const RECEIPT = 'MICRO_PILOT_ACTIVATION_PREVIEW_RECEIPT';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function controlledEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 254 || !emailPattern.test(value)) throw new Error('INVALID_PROSPECT_EMAIL');
  return value.trim().toLowerCase();
}
async function lockPreviewUser(tx: any, userId: string) {
  const users = await tx.$queryRaw`SELECT "tier", "email", "monthlyQuota", "leadsProcessed" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = users[0];
  if (user?.tier !== 'MICRO_PILOT') throw new Error('MICRO_PILOT_REQUIRED');
  if (await tx.decision.findFirst({ where: { userId }, select: { id: true } })) throw new Error('ACTIVATION_PREVIEW_EXHAUSTED');
  return user;
}

/** A customer-supplied real controlled contact is saved through canonical identity, with no draft/model work. */
export function importPreviewProspect(userId: string, suppliedEmail: unknown, db = prisma) {
  const email = controlledEmail(suppliedEmail);
  return identityTransaction(db, async tx => {
    const user = await lockPreviewUser(tx, userId);
    if (email === user.email.trim().toLowerCase()) throw new Error('DISTINCT_CONTROLLED_MAILBOX_REQUIRED');
    const resolution = await resolveProspectInTransaction(tx, { userId, email });
    if (!resolution.prospectId) throw new Error('PROSPECT_IDENTITY_CONFLICT');
    const existing = await tx.generatedLead.findFirst({ where: { userId, prospectId: resolution.prospectId }, select: { id: true, prospectId: true } });
    if (existing) return existing;
    if (user.leadsProcessed >= Math.min(25, user.monthlyQuota)) throw new Error('MICRO_PILOT_QUOTA_EXHAUSTED');
    const lead = await tx.generatedLead.create({ data: { userId, prospectId: resolution.prospectId, email,
      firstName: '', lastName: '', companyName: '', emailDraft: '', linkedInDraft: '' }, select: { id: true, prospectId: true } });
    await tx.user.update({ where: { id: userId }, data: { leadsProcessed: { increment: 1 } } });
    await recordProspectMemoryEventInTransaction(tx, { userId, prospectId: resolution.prospectId,
      eventType: MEMORY_EVENT.LEAD_LINKED, sourceType: 'GENERATED_LEAD', sourceId: lead.id, description: 'Controlled activation prospect imported without draft generation.' });
    return lead;
  });
}

export type ProviderReply = { messageId: string; inReplyTo: string; from: string; to: string[]; text: string; receivedAt: Date };
export function validatePreviewReceipt(reply: ProviderReply, mailbox: string, prospect: string, since: Date) {
  if (!/^<[^<>\s]{1,180}>$/.test(reply.messageId) || !/^<[^<>\s]{1,180}>$/.test(reply.inReplyTo) ||
    reply.from.trim().toLowerCase() !== prospect || !reply.to.map(x => x.trim().toLowerCase()).includes(mailbox) ||
    !reply.text.trim() || reply.text.length > 12000 || !Number.isFinite(reply.receivedAt.getTime()) ||
    reply.receivedAt < since || reply.receivedAt.getTime() > Date.now() + 300000)
    throw new Error('REAL_WORKFLOW_REPLY_REQUIRED');
}

/** Provider read finishes before the tenant mutex. Simultaneous captures persist at most one preview reply. */
export function persistPreviewReceipt(userId: string, leadId: string, mailbox: string, reply: ProviderReply, db = prisma) {
  const sourceMessageId = 'imap:' + createHash('sha256').update(mailbox + '\0' + reply.messageId).digest('hex');
  return identityTransaction(db, async tx => {
    await lockPreviewUser(tx, userId);
    const lead = await tx.generatedLead.findFirst({ where: { id: leadId, userId }, select: { id: true, prospectId: true, email: true } });
    if (!lead?.prospectId || lead.email?.trim().toLowerCase() !== reply.from) throw new Error('CONTROLLED_WORKFLOW_PROSPECT_REQUIRED');
    const replay = await tx.inboundSignal.findFirst({ where: { userId, sourceMessageId }, select: { id: true } });
    if (replay) return replay;
    if (await tx.inboundSignal.findFirst({ where: { userId, signalAnalysis: RECEIPT }, select: { id: true } }))
      throw new Error('PREVIEW_REPLY_ALREADY_CAPTURED');
    const signal = await tx.inboundSignal.create({ data: { userId, prospectId: lead.prospectId, generatedLeadId: lead.id,
      sourceType: 'IMAP_NATIVE', signalType: 'EMAIL_REPLY', sourceMessageId, prospectEmail: lead.email,
      prospectName: '', prospectContext: 'Controlled Micro-Pilot reply', pipelineValue: 0, dealStage: 'Inbound Reply',
      rawEmail: reply.text, intentRisk: 'Unknown', intentType: 'UNASSESSED', aiDraft: '', status: 'PENDING',
      signalAnalysis: RECEIPT, createdAt: reply.receivedAt } });
    await recordProspectMemoryEventInTransaction(tx, { userId, prospectId: lead.prospectId,
      eventType: MEMORY_EVENT.INBOUND_RECEIVED, sourceType: 'INBOUND_SIGNAL', sourceId: signal.id,
      description: 'Real controlled reply verified from provider inbox and sent-message evidence.', occurredAt: reply.receivedAt });
    await materializeInboundSignalInTransaction(tx, signal);
    return { id: signal.id };
  });
}
