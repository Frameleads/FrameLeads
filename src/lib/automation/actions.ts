import { createHash } from 'node:crypto';
import { AutomationExecutionState as State, AutomationMode as Mode, DecisionHumanAction as Action,
  DecisionExecutionStatus as AttemptStatus, DecisionRouteQueue, Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { MEMORY_EVENT, recordProspectMemoryEvent, recordProspectMemoryEventInTransaction } from '../prospects/memory';
import { materializeMessageInTransaction } from '../decision/conversation';
import { sendNativeEmail } from '../outbound/native-mail';
import { evaluateAutomationMode, resolveAutomationMode } from './resolve';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type Sender = typeof sendNativeEmail;
export type HumanActionInput = { userId: string; decisionId: string; action: 'APPROVE' | 'EDIT_AND_SEND' | 'REJECT' | 'ESCALATE';
  requestKey: string; editedReply?: string; reason?: string; queue?: DecisionRouteQueue };

function validateHumanAction(input: HumanActionInput) {
  if (!input.userId || !input.decisionId || !([Action.APPROVE, Action.EDIT_AND_SEND, Action.REJECT, Action.ESCALATE] as string[]).includes(input.action))
    throw new TypeError('Invalid action');
  if (!/^[\w:-]{8,128}$/.test(input.requestKey || '')) throw new TypeError('Idempotency key required');
  if (input.reason != null && (typeof input.reason !== 'string' || input.reason.length > 500)) throw new TypeError('Invalid reason');
  if (input.action === Action.EDIT_AND_SEND && (typeof input.editedReply !== 'string' || !input.editedReply.trim() || input.editedReply.length > 4000))
    throw new TypeError('Edited reply must be 1–4000 characters');
  if (input.queue && !Object.values(DecisionRouteQueue).includes(input.queue)) throw new TypeError('Invalid queue');
}

async function rememberAction(userId: string, prospectId: string, eventId: string, action: Action, db: PrismaClient) {
  const eventType = action === Action.REJECT ? MEMORY_EVENT.HUMAN_REJECTED :
    action === Action.ESCALATE ? MEMORY_EVENT.DECISION_ESCALATED : MEMORY_EVENT.HUMAN_APPROVED;
  await recordProspectMemoryEvent({ userId, prospectId, eventType, sourceType: 'DECISION_ACTION', sourceId: eventId,
    description: action === Action.REJECT ? 'Human rejected the proposed reply.' :
      action === Action.ESCALATE ? 'Decision escalated for human handling.' : 'Human approved a governed reply.' }, db);
}

/** One claim per Decision. Claimed/uncertain SMTP attempts are never retried automatically. */
async function executeReply(input: { userId: string; decisionId: string; actorUserId: string | null;
  action: Action; requestKey: string; reply: string }, db: PrismaClient, sender: Sender) {
  const first = await evaluateAutomationMode({ userId: input.userId, decisionId: input.decisionId, proposedReply: input.reply }, db);
  if (first.execution) return { state: first.state, attempt: first.execution, reused: true };
  if (first.state === State.BLOCKED || first.state === State.HELD || first.state === State.ESCALATED ||
    first.state === State.REJECTED || first.state === State.FAILED_UNCERTAIN) {
    await resolveAutomationMode({ userId: input.userId, decisionId: input.decisionId, proposedReply: input.reply }, db);
    return { state: first.state, reasons: first.reasons, attempt: null, reused: false };
  }
  if (input.action === Action.AUTOPILOT_SEND && (first.resolvedMode !== Mode.AUTOPILOT || first.state !== State.READY))
    return { state: first.state, reasons: first.reasons, attempt: null, reused: false };
  if (!first.integrationAvailable || !first.source.generatedLead?.id || !first.source.generatedLead.email)
    return { state: State.HELD, reasons: ['OUTBOUND_INTEGRATION_UNAVAILABLE'], attempt: null, reused: false };
  // Recheck immediately before the irreversible claim. Every branch reads current tenant controls.
  const current = await evaluateAutomationMode({ userId: input.userId, decisionId: input.decisionId, proposedReply: input.reply }, db);
  if (([State.BLOCKED, State.HELD, State.ESCALATED, State.REJECTED, State.FAILED_UNCERTAIN] as State[]).includes(current.state) ||
    (input.action === Action.AUTOPILOT_SEND && current.resolvedMode !== Mode.AUTOPILOT))
    return { state: current.state, reasons: current.reasons, attempt: null, reused: false };
  const lead = current.source.generatedLead;
  if (!current.integrationAvailable || !lead?.id || !lead.email)
    return { state: State.HELD, reasons: ['OUTBOUND_INTEGRATION_UNAVAILABLE'], attempt: null, reused: false };
  const content = input.reply.trim();
  const idempotencyKey = hash(`${input.userId}:${input.decisionId}:reply-send:v1`);
  let claim;
  try {
    claim = await db.$transaction(async tx => {
      const existing = await tx.decisionExecutionAttempt.findUnique({ where: { userId_decisionId: {
        userId: input.userId, decisionId: input.decisionId } } });
      if (existing) return { attempt: existing, created: false };
      if (input.action === Action.AUTOPILOT_SEND) {
        const sent = await tx.decisionExecutionAttempt.count({ where: { userId: input.userId,
          mode: Mode.AUTOPILOT, status: AttemptStatus.SENT, startedAt: { gte: new Date(Date.now() - 86_400_000) } } });
        if (sent >= current.policy.maxAutoSendsPerDay) throw new Error('AUTOPILOT_DAILY_LIMIT');
      }
      const created = await tx.decisionExecutionAttempt.create({ data: { userId: input.userId,
        decisionId: input.decisionId, idempotencyKey, mode: input.action === Action.AUTOPILOT_SEND ? Mode.AUTOPILOT : Mode.HUMAN_APPROVAL,
        actorUserId: input.actorUserId, contentFingerprint: hash(content), sentContent: content,
        provider: 'NATIVE_SMTP', decisionConstitutionRevision: current.decisionConstitutionRevision,
        executionConstitutionRevision: current.currentConstitutionRevision } });
      await tx.decisionActionEvent.create({ data: { userId: input.userId, decisionId: input.decisionId,
        actorUserId: input.actorUserId, action: input.action,
        idempotencyKey: hash(`${input.userId}:${input.decisionId}:${input.requestKey}`),
        originalDraft: current.decision.suggestedReply, editedDraft: input.action === Action.EDIT_AND_SEND ? content : null,
        resultingState: State.EXECUTING, executionAttemptId: created.id } });
      return { attempt: created, created: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    const existing = await db.decisionExecutionAttempt.findUnique({ where: { userId_decisionId: {
      userId: input.userId, decisionId: input.decisionId } } });
    if (!existing) throw error;
    return { state: existing.status === AttemptStatus.SENT ? State.EXECUTED :
      existing.status === AttemptStatus.FAILED_UNCERTAIN ? State.FAILED_UNCERTAIN : State.EXECUTING,
      attempt: existing, reused: true };
  }
  const { attempt } = claim;
  // A different request may have won before this transaction began. Never send from a reused claim.
  if (!claim.created)
    return { state: attempt.status === AttemptStatus.SENT ? State.EXECUTED : State.EXECUTING, attempt, reused: true };
  const event = await db.decisionActionEvent.findFirst({ where: { userId: input.userId, decisionId: input.decisionId,
    executionAttemptId: attempt.id }, select: { id: true } });
  // Memory is secondary to the claimed send. A memory write failure must not strand the attempt.
  if (event && input.actorUserId) {
    try { await rememberAction(input.userId, current.decision.prospectId, event.id, input.action, db); }
    catch { console.error('[AUTOMATION] Approval memory event could not be recorded'); }
  }
  try {
    const sent = await sender({ userId: input.userId, leadId: lead.id,
      to: lead.email, subject: 'Re: Your message', text: content }, db);
    await db.$transaction(async tx => {
      const inbox = await tx.sendingInbox.findFirst({ where: { userId: input.userId,
        emailAddress: { equals: (await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { imapEmail: true } })).imapEmail || '', mode: 'insensitive' } } }) ||
        await tx.sendingInbox.create({ data: { userId: input.userId,
          emailAddress: (await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { imapEmail: true } })).imapEmail! } });
      const log = await tx.outboundLog.create({ data: { inboxId: inbox.id, leadId: lead.id,
        status: 'sent', channel: 'email' } });
      await materializeMessageInTransaction(tx, { userId: input.userId, prospectId: current.decision.prospectId,
        sourceType: 'OUTBOUND_LOG', sourceId: log.id, direction: 'OUTBOUND', body: content, occurredAt: log.sentAt,
        providerId: sent.providerMessageId });
      await tx.decisionExecutionAttempt.update({ where: { id: attempt.id }, data: { status: AttemptStatus.SENT,
        providerMessageId: sent.providerMessageId, completedAt: new Date() } });
      await recordProspectMemoryEventInTransaction(tx, { userId: input.userId, prospectId: current.decision.prospectId,
        eventType: input.action === Action.AUTOPILOT_SEND ? MEMORY_EVENT.AUTOMATED_SENT : MEMORY_EVENT.HUMAN_EDIT_SENT,
        sourceType: 'DECISION_EXECUTION', sourceId: attempt.id, description: 'Governed reply sent.' });
    });
    await resolveAutomationMode({ userId: input.userId, decisionId: input.decisionId }, db);
    return { state: State.EXECUTED, attempt: await db.decisionExecutionAttempt.findUnique({ where: { id: attempt.id } }), reused: false };
  } catch {
    await db.decisionExecutionAttempt.updateMany({ where: { id: attempt.id, status: AttemptStatus.CLAIMED },
      data: { status: AttemptStatus.FAILED_UNCERTAIN, failureClass: 'PROVIDER_OR_COMMIT_UNCERTAIN', completedAt: new Date() } });
    await resolveAutomationMode({ userId: input.userId, decisionId: input.decisionId }, db);
    return { state: State.FAILED_UNCERTAIN, reasons: ['SEND_OUTCOME_UNCERTAIN_NO_AUTOMATIC_RETRY'], attempt, reused: false };
  }
}

export async function actOnDecision(input: HumanActionInput, deps: { db?: PrismaClient; sender?: Sender } = {}) {
  validateHumanAction(input);
  const db = deps.db ?? prisma;
  const key = hash(`${input.userId}:${input.decisionId}:${input.requestKey}`);
  const previous = await db.decisionActionEvent.findUnique({ where: { idempotencyKey: key } });
  if (previous) return { state: previous.resultingState, event: previous, reused: true };
  const current = await resolveAutomationMode({ userId: input.userId, decisionId: input.decisionId,
    ...(input.action === Action.EDIT_AND_SEND ? { proposedReply: input.editedReply } : {}) }, db);
  if (input.action === Action.REJECT || input.action === Action.ESCALATE) {
    if (current.execution) return { state: current.state, reasons: ['EXECUTION_ALREADY_CLAIMED'], event: null, reused: false };
    const state = input.action === Action.REJECT ? State.REJECTED : State.ESCALATED;
    let event;
    try { event = await db.decisionActionEvent.create({ data: { userId: input.userId, decisionId: input.decisionId,
      actorUserId: input.userId, action: input.action, idempotencyKey: key,
      reason: input.reason?.trim().slice(0, 500) || null, originalDraft: current.decision.suggestedReply,
      resultingState: state } }); }
    catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const existing = await db.decisionActionEvent.findUnique({ where: { idempotencyKey: key } });
      if (!existing) throw error;
      return { state: existing.resultingState, event: existing, reused: true };
    }
    if (state === State.ESCALATED) await db.decisionAssignment.upsert({ where: { userId_decisionId: {
      userId: input.userId, decisionId: input.decisionId } }, create: { userId: input.userId,
      decisionId: input.decisionId, queue: input.queue ?? DecisionRouteQueue.HUMAN_REVIEW,
      reason: input.reason?.trim().slice(0, 360) || 'Human requested escalation.' },
      update: { queue: input.queue ?? DecisionRouteQueue.HUMAN_REVIEW, status: 'OPEN', resolvedAt: null,
        reason: input.reason?.trim().slice(0, 360) || 'Human requested escalation.' } });
    await rememberAction(input.userId, current.decision.prospectId, event.id, input.action, db);
    await resolveAutomationMode({ userId: input.userId, decisionId: input.decisionId }, db);
    return { state, event, reused: false };
  }
  const reply = input.action === Action.EDIT_AND_SEND ? input.editedReply!.trim() : current.decision.suggestedReply?.trim();
  if (!reply) return { state: State.HELD, reasons: ['MISSING_SAFE_REPLY'], event: null, reused: false };
  return executeReply({ userId: input.userId, decisionId: input.decisionId, actorUserId: input.userId,
    action: input.action as Action, requestKey: input.requestKey, reply }, db, deps.sender ?? sendNativeEmail);
}

export async function runAutopilot(input: { userId: string; decisionId: string }, deps: { db?: PrismaClient; sender?: Sender } = {}) {
  const db = deps.db ?? prisma;
  const current = await resolveAutomationMode(input, db);
  if (current.resolvedMode !== Mode.AUTOPILOT || current.state !== State.READY || !current.decision.suggestedReply)
    return { state: current.state, reasons: current.reasons, attempt: null, reused: false };
  return executeReply({ ...input, actorUserId: null, action: Action.AUTOPILOT_SEND,
    requestKey: `autopilot:${input.decisionId}`, reply: current.decision.suggestedReply }, db, deps.sender ?? sendNativeEmail);
}
