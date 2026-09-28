import { ResponseSLAStatus as Status, type PrismaClient, type ResponseSLAInstance } from '@prisma/client';
import { prisma } from '../prisma';
import { calculateResponseDeadline, responseSLAApplicability } from './deadline';
import { getResponseSLAPolicy } from './policy';

const BATCH_SIZE = 100;
type RiskSnapshot = { decisionId: string; status: string; score: number | null;
  band: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null; confidence: 'LOW' | 'MEDIUM' | 'HIGH' };

async function evaluateLoadedSLA(sla: ResponseSLAInstance, policy: { breachEscalationEnabled: boolean },
  now: Date, db: PrismaClient) {
  if (sla.status !== Status.ACTIVE || now < sla.dueAt) return sla;
  return db.$transaction(async tx => {
    const changed = await tx.responseSLAInstance.updateMany({ where: { id: sla.id, userId: sla.userId,
      status: Status.ACTIVE, dueAt: { lte: now } }, data: { status: Status.BREACHED, breachedAt: now,
      escalationLevel: policy.breachEscalationEnabled ? 1 : 0,
      escalationReason: policy.breachEscalationEnabled ? 'SLA_BREACH' : null, lastEvaluatedAt: now } });
    if (!changed.count) return tx.responseSLAInstance.findUniqueOrThrow({ where: { id: sla.id } });
    if (!policy.breachEscalationEnabled) return tx.responseSLAInstance.findUniqueOrThrow({ where: { id: sla.id } });
    const assignment = await tx.decisionAssignment.upsert({ where: { userId_decisionId: {
      userId: sla.userId, decisionId: sla.decisionId } }, create: { userId: sla.userId,
      decisionId: sla.decisionId, queue: 'HUMAN_REVIEW', reason: 'Response SLA breached.' },
      update: { status: 'OPEN', resolvedAt: null } });
    // Preserve the original specialized queue and reason on an existing assignment.
    return tx.responseSLAInstance.update({ where: { id: sla.id }, data: { assignmentId: assignment.id } });
  });
}

export async function evaluateResponseSLA(input: { userId: string; slaId: string; now?: Date }, db: PrismaClient = prisma) {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid evaluation time');
  const sla = await db.responseSLAInstance.findFirst({ where: { id: input.slaId, userId: input.userId } });
  if (!sla) throw new Error('Response SLA not found for tenant');
  if (sla.status === Status.RESOLVED || sla.status === Status.CANCELLED) return sla;
  return syncResponseSLAForDecision({ userId: input.userId, decisionId: sla.decisionId, now }, db);
}

/** Lazy creation + reconciliation from persisted Decision/Automation facts. Reads are batched per tenant. */
export async function syncResponseSLAsBatch(input: { userId: string; decisionIds: string[];
  risks?: RiskSnapshot[]; now?: Date }, db: PrismaClient = prisma) {
  if (!input.userId) throw new TypeError('Authenticated tenant required');
  const ids = [...new Set(input.decisionIds)];
  if (ids.some(id => !id || id.length > 100)) throw new TypeError('Invalid Decision ID');
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid evaluation time');
  const policy = await getResponseSLAPolicy(input.userId, db);
  const result = new Map<string, ResponseSLAInstance | null>();
  for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
    const chunk = ids.slice(offset, offset + BATCH_SIZE);
    const decisions = await db.decision.findMany({ where: { userId: input.userId, id: { in: chunk } },
      select: { id: true, prospectId: true, primaryIntent: true, status: true, updatedAt: true } });
    if (decisions.length !== chunk.length) throw new Error('Decision not found for tenant');
    const prospectIds = [...new Set(decisions.map(row => row.prospectId))];
    const [existing, risks, latestResolutions, firstHuman, attempts, rejected, suppressions, assignments] = await Promise.all([
      db.responseSLAInstance.findMany({ where: { userId: input.userId, decisionId: { in: chunk } } }),
      input.risks ? Promise.resolve(input.risks.filter(row => chunk.includes(row.decisionId))) :
        db.decisionRevenueRisk.findMany({ where: { userId: input.userId, decisionId: { in: chunk } },
          select: { decisionId: true, status: true, score: true, band: true, confidence: true } }),
      db.decisionAutomationResolution.findMany({ where: { userId: input.userId, decisionId: { in: chunk } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], distinct: ['decisionId'],
        select: { decisionId: true, state: true, resolvedMode: true, createdAt: true } }),
      db.decisionAutomationResolution.groupBy({ by: ['decisionId'], where: { userId: input.userId,
        decisionId: { in: chunk }, resolvedMode: { in: ['HUMAN_APPROVAL', 'MANDATORY_ESCALATION'] },
        state: { in: ['PENDING_APPROVAL', 'ESCALATED', 'REANALYSIS_REQUIRED'] } },
        _min: { createdAt: true } }),
      db.decisionExecutionAttempt.findMany({ where: { userId: input.userId, decisionId: { in: chunk } },
        select: { decisionId: true, status: true, completedAt: true } }),
      db.decisionActionEvent.groupBy({ by: ['decisionId'], where: { userId: input.userId,
        decisionId: { in: chunk }, action: 'REJECT' }, _min: { createdAt: true } }),
      db.inboundSignal.findMany({ where: { userId: input.userId, prospectId: { in: prospectIds },
        sourceType: 'PROVIDER_CONFIRMED', signalType: 'UNSUBSCRIBE_CONFIRMED' }, select: { prospectId: true } }),
      db.decisionAssignment.findMany({ where: { userId: input.userId, decisionId: { in: chunk } },
        select: { id: true, decisionId: true } }),
    ]);
    const byId = <T extends { decisionId: string }>(rows: T[]) => new Map(rows.map(row => [row.decisionId, row]));
    const existingById = byId(existing), riskById = byId(risks), firstHumanById = byId(firstHuman),
      attemptById = byId(attempts), rejectionById = byId(rejected), assignmentById = byId(assignments);
    const latestById = new Map<string, (typeof latestResolutions)[number]>();
    for (const resolution of latestResolutions) if (!latestById.has(resolution.decisionId)) latestById.set(resolution.decisionId, resolution);
    const suppressed = new Set(suppressions.map(row => row.prospectId));
    for (const decision of decisions) {
      let sla = existingById.get(decision.id) ?? null;
      const risk = riskById.get(decision.id);
      const resolution = latestById.get(decision.id);
      const attempt = attemptById.get(decision.id);
      const rejection = rejectionById.get(decision.id);
      const isSuppressed = suppressed.has(decision.prospectId);
      const applicability = responseSLAApplicability({ decisionStatus: decision.status,
        primaryIntent: decision.primaryIntent, riskStatus: risk?.status ?? null,
        automationState: resolution?.state ?? null, automationMode: resolution?.resolvedMode ?? null,
        executionStatus: attempt?.status ?? null, confirmedSuppression: isSuppressed });
      const terminalReason = attempt?.status === 'SENT' ? 'GOVERNED_SEND_COMPLETED' :
        rejection?._min.createdAt ? 'HUMAN_REJECTED' : null;
      const cancelledReason = terminalReason ? null : !policy.enabled ? 'SLA_POLICY_DISABLED' :
        isSuppressed ? 'CONFIRMED_SUPPRESSION' : risk?.status === 'NOT_APPLICABLE' ? 'NON_REVENUE_DECISION' :
          decision.primaryIntent && ['SPAM', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'WRONG_PERSON', 'NOT_INTERESTED'].includes(decision.primaryIntent) ?
            'NON_REVENUE_DECISION' : !applicability.applies && !terminalReason ? 'NO_HUMAN_RESPONSE_REQUIRED' : null;
      if (sla?.status === Status.RESOLVED || sla?.status === Status.CANCELLED) { result.set(decision.id, sla); continue; }
      if (sla && terminalReason) {
        sla = await db.responseSLAInstance.update({ where: { id: sla.id }, data: { status: Status.RESOLVED,
          resolvedAt: attempt?.status === 'SENT' ? attempt.completedAt ?? now : rejection?._min.createdAt ?? now,
          resolutionReason: terminalReason, lastEvaluatedAt: now } });
        result.set(decision.id, sla); continue;
      }
      if (sla && cancelledReason) {
        sla = await db.responseSLAInstance.update({ where: { id: sla.id }, data: { status: Status.CANCELLED,
          cancelledAt: now, resolutionReason: cancelledReason, lastEvaluatedAt: now } });
        result.set(decision.id, sla); continue;
      }
      if (!sla && policy.enabled && !cancelledReason && (applicability.applies || terminalReason)) {
        const starts = [firstHumanById.get(decision.id)?._min.createdAt,
          decision.status === 'NEEDS_REVIEW' ? decision.updatedAt : null,
          attempt?.status === 'FAILED_UNCERTAIN' ? attempt.completedAt : null]
          .filter((time): time is Date => time instanceof Date);
        const startedAt = starts.length ? new Date(Math.min(...starts.map(time => time.getTime()))) : null;
        if (startedAt) {
          const riskBand = risk?.status === 'APPLICABLE' ? risk.band : null;
          sla = await db.responseSLAInstance.upsert({ where: { userId_decisionId: {
            userId: input.userId, decisionId: decision.id } }, create: { userId: input.userId,
            decisionId: decision.id, prospectId: decision.prospectId, status: Status.ACTIVE,
            startedAt, dueAt: calculateResponseDeadline({ startedAt, riskBand: riskBand ?? null, policy }),
            riskScoreAtStart: risk?.status === 'APPLICABLE' ? risk.score : null,
            riskBandAtStart: riskBand ?? null,
            riskConfidenceAtStart: risk?.status === 'APPLICABLE' ? risk.confidence : null,
            policyRevision: policy.revision, assignmentId: assignmentById.get(decision.id)?.id ?? null,
            lastEvaluatedAt: now }, update: {} });
        }
      }
      if (sla && terminalReason) {
        sla = await db.responseSLAInstance.update({ where: { id: sla.id }, data: { status: Status.RESOLVED,
          resolvedAt: attempt?.status === 'SENT' ? attempt.completedAt ?? now : rejection?._min.createdAt ?? now,
          resolutionReason: terminalReason, lastEvaluatedAt: now } });
      } else if (sla) sla = await evaluateLoadedSLA(sla, policy, now, db);
      result.set(decision.id, sla);
    }
  }
  return ids.map(id => result.get(id) ?? null);
}

export async function syncResponseSLAForDecision(input: { userId: string; decisionId: string; now?: Date },
  db: PrismaClient = prisma) {
  const [sla] = await syncResponseSLAsBatch({ userId: input.userId, decisionIds: [input.decisionId], now: input.now }, db);
  return sla;
}
