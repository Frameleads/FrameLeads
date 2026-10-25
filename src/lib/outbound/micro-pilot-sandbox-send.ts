import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from '../prospects/identity';
import { microPilotOutboundIdentityKey } from '../micro-pilot-limits';
import { evaluateSalesConstitution } from '../sales-constitution';
import { sendNativeEmail, type NativeMailInput } from './native-mail';

const DAILY_SEND_LIMIT_PER_INBOX = 30;
const MAX_BODY_LENGTH = 200_000;
export type MicroPilotSendFailure = 'LEAD_NOT_ELIGIBLE' | 'RECIPIENT_MISMATCH' | 'SUPPRESSED' |
  'GOVERNANCE_REVIEW_REQUIRED' | 'ALREADY_SENT' | 'DAILY_LIMIT_REACHED' | 'NOT_MICRO_PILOT';
export class MicroPilotSandboxSendError extends Error {
  constructor(readonly reason: MicroPilotSendFailure) { super(reason); this.name = 'MicroPilotSandboxSendError'; }
}
export type MicroPilotSandboxSender = (input: NativeMailInput, db: PrismaClient) => Promise<{ provider: string; providerMessageId: string | null }>;

function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function verifySafety(userId: string, prospectId: string, db: PrismaClient, evaluate: typeof evaluateSalesConstitution) {
  const [hold, unsubscribe, unsubscribeDecision, constitution] = await Promise.all([
    db.prospectHold.findUnique({ where: { userId_prospectId: { userId, prospectId } }, select: { active: true } }),
    db.inboundSignal.findFirst({ where: { userId, prospectId, sourceType: 'PROVIDER_CONFIRMED', signalType: 'UNSUBSCRIBE_CONFIRMED' }, select: { id: true } }),
    db.decision.findFirst({ where: { userId, prospectId, primaryIntent: 'UNSUBSCRIBE' }, select: { id: true } }),
    evaluate({ userId, action: { actionType: 'OUTREACH', scope: 'OUTBOUND', unsubscribeConfirmed: false,
      contextRef: { prospectId } } }, db),
  ]);
  if (hold?.active || unsubscribe || unsubscribeDecision) throw new MicroPilotSandboxSendError('SUPPRESSED');
  if (constitution.configurationMissing || constitution.blockingRules.length || constitution.unresolvedRules.length ||
    constitution.humanReviewRequirements.length || constitution.safeResponseRequirements.length)
    throw new MicroPilotSandboxSendError('GOVERNANCE_REVIEW_REQUIRED');
}

/** Reserve and execute exactly one explicit human-approved Sandbox send per counted Micro-Pilot prospect. */
export async function sendMicroPilotSandboxEmail(input: {
  userId: string; leadId: string; to: string; subject: string; text: string; html: string; confirmed: boolean;
}, dependencies: { db?: PrismaClient; sender?: MicroPilotSandboxSender; now?: () => Date;
  evaluate?: typeof evaluateSalesConstitution;
  recordMemory?: (input: Record<string, unknown>, db: PrismaClient) => Promise<unknown> } = {}) {
  const db = dependencies.db ?? prisma, sender = dependencies.sender ?? sendNativeEmail, now = dependencies.now ?? (() => new Date());
  const evaluate = dependencies.evaluate ?? evaluateSalesConstitution;
  if (!input.confirmed) throw new TypeError('Explicit send confirmation required');
  const to = input.to.trim().toLowerCase(), subject = input.subject.trim(), text = input.text.trim();
  if (!input.userId.trim() || !input.leadId.trim() || !/^\S+@\S+\.\S+$/.test(to) || !subject || subject.length > 500 ||
    !text || text.length > MAX_BODY_LENGTH || input.html.length > MAX_BODY_LENGTH) throw new TypeError('Invalid native email');

  const [account, lead] = await Promise.all([
    db.user.findUnique({ where: { id: input.userId }, select: { tier: true, imapEmail: true } }),
    db.generatedLead.findFirst({ where: { id: input.leadId, userId: input.userId }, select: {
      id: true, userId: true, prospectId: true, email: true, linkedInUrl: true, firstName: true, lastName: true,
      companyName: true, websiteUrl: true,
    } }),
  ]);
  if (account?.tier !== 'MICRO_PILOT') throw new MicroPilotSandboxSendError('NOT_MICRO_PILOT');
  if (!lead?.email || !lead.prospectId) throw new MicroPilotSandboxSendError('LEAD_NOT_ELIGIBLE');
  const prospectId = lead.prospectId;
  const leadEmail = lead.email.trim().toLowerCase();
  if (leadEmail !== to) throw new MicroPilotSandboxSendError('RECIPIENT_MISMATCH');
  const identityKey = microPilotOutboundIdentityKey(lead);
  if (!identityKey) throw new MicroPilotSandboxSendError('LEAD_NOT_ELIGIBLE');
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: input.userId, id: prospectId } },
    select: { id: true, linkedInUrl: true, email: true, firstName: true, lastName: true, companyName: true, websiteUrl: true } });
  if (!prospect) throw new MicroPilotSandboxSendError('LEAD_NOT_ELIGIBLE');
  const canonicalIdentity = microPilotOutboundIdentityKey(prospect);
  if (!canonicalIdentity) throw new MicroPilotSandboxSendError('LEAD_NOT_ELIGIBLE');
  const outboundClaimKeys = [...new Set([identityKey, canonicalIdentity])];
  const outboundClaims = await Promise.all(outboundClaimKeys.map(key =>
    db.microPilotOutboundClaim.findUnique({ where: { userId_identityKey: { userId: input.userId, identityKey: key } }, select: { status: true } })));
  const chargedKey = outboundClaimKeys.find((key, index) => outboundClaims[index]?.status === 'COMPLETED');
  if (!chargedKey) throw new MicroPilotSandboxSendError('LEAD_NOT_ELIGIBLE');

  await verifySafety(input.userId, prospectId, db, evaluate);
  const today = utcDayStart(now());
  try {
    await identityTransaction(db, async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
      const existing = await tx.microPilotNativeSendClaim.findUnique({ where: { userId_prospectId: { userId: input.userId, prospectId } } });
      if (existing) throw new MicroPilotSandboxSendError('ALREADY_SENT');
      await verifySafety(input.userId, prospectId, tx as unknown as PrismaClient, evaluate);
      const [sentToday, pendingToday] = await Promise.all([
        tx.outboundLog.count({ where: { inbox: { userId: input.userId }, status: 'sent', sentAt: { gte: today } } }),
        tx.microPilotNativeSendClaim.count({ where: { userId: input.userId, status: { in: ['RESERVED', 'UNCERTAIN'] }, createdAt: { gte: today } } }),
      ]);
      if (sentToday + pendingToday >= DAILY_SEND_LIMIT_PER_INBOX) throw new MicroPilotSandboxSendError('DAILY_LIMIT_REACHED');
      await tx.microPilotNativeSendClaim.create({ data: { userId: input.userId, leadId: lead.id, prospectId,
        identityKey: chargedKey, recipient: leadEmail } });
    });
  } catch (error) {
    if (error instanceof MicroPilotSandboxSendError) throw error;
    if ((error as { code?: string }).code === 'P2002') throw new MicroPilotSandboxSendError('ALREADY_SENT');
    throw error;
  }

  let dispatchStarted = false;
  const claimWhere = { userId_prospectId: { userId: input.userId, prospectId } };
  try {
    await verifySafety(input.userId, prospectId, db, evaluate);
    const result = await sender({ userId: input.userId, leadId: lead.id, to: leadEmail, subject, text, html: input.html,
      onDispatchStart: () => { dispatchStarted = true; } }, db);
    const log = await identityTransaction(db, async tx => {
      const sendingInbox = await tx.sendingInbox.findFirst({ where: { userId: input.userId,
        emailAddress: { equals: account.imapEmail || '', mode: 'insensitive' } } }) ||
        await tx.sendingInbox.create({ data: { userId: input.userId, emailAddress: account.imapEmail! } });
      const log = await tx.outboundLog.create({ data: { inboxId: sendingInbox.id, leadId: lead.id, channel: 'email', status: 'sent' } });
      await tx.microPilotNativeSendClaim.update({ where: claimWhere, data: { status: 'SENT', sentAt: new Date() } });
      return log;
    });
    try {
      if (lead.prospectId) {
        const memoryEvent = { userId: input.userId, prospectId: lead.prospectId,
          eventType: 'OUTBOUND_SENT', sourceType: 'OUTBOUND_LOG', sourceId: log.id,
          description: 'Human-approved Sandbox message sent.', importance: 2, occurredAt: log.sentAt };
        if (dependencies.recordMemory) await dependencies.recordMemory(memoryEvent, db);
        else {
          const { MEMORY_EVENT, recordProspectMemoryEvent } = await import('../prospects/memory');
          await recordProspectMemoryEvent({ ...memoryEvent, eventType: MEMORY_EVENT.OUTBOUND_SENT } as Parameters<typeof recordProspectMemoryEvent>[0], db);
        }
      }
    } catch { console.error('[MICRO_PILOT_OUTBOUND] Memory event could not be recorded'); }
    return { success: true, providerMessageId: result.providerMessageId };
  } catch (error) {
    if (dispatchStarted) await db.microPilotNativeSendClaim.update({ where: claimWhere, data: { status: 'UNCERTAIN' } }).catch(() => undefined);
    else await db.microPilotNativeSendClaim.delete({ where: claimWhere }).catch(() => undefined);
    throw error;
  }
}
