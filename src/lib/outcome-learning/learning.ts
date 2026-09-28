import { createHash } from 'node:crypto';
import { DecisionOutcomeType, LearningSuggestionStatus, LearningSuggestionType,
  type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from '../prospects/identity';

export const LEARNING_LIMITS = Object.freeze({ windowDays: 90, maxOutcomeRows: 1000,
  minEligibleOutcomes: 10, minComparedGroup: 5, minRateGapPoints: 20 });
const POSITIVE = new Set<DecisionOutcomeType>(['MEETING_BOOKED', 'OPPORTUNITY_ADVANCED', 'WON']);
const DAY = 86_400_000;
type SampleRow = { id: string; decisionId: string; revision: number; outcomeType: DecisionOutcomeType;
  occurredAt: Date; decision: { responseSLA: { status: string; startedAt: Date; breachedAt: Date | null } | null } };

/** Associations only: current effective human outcomes with an observable, terminal SLA comparison. */
export function deriveSLAObservation(rows: SampleRow[], now: Date, truncated = false) {
  const dateFrom = new Date(now.getTime() - LEARNING_LIMITS.windowDays * DAY);
  const latest = new Map<string, SampleRow>();
  for (const row of rows) if (!latest.has(row.decisionId) || row.revision > latest.get(row.decisionId)!.revision)
    latest.set(row.decisionId, row);
  // OTHER is an explicitly unknown business outcome, not a negative result.
  const effective = [...latest.values()].filter(row => row.occurredAt >= dateFrom && row.occurredAt <= now &&
    row.outcomeType !== DecisionOutcomeType.OTHER);
  const groups = { breached: [] as SampleRow[], noRecordedBreach: [] as SampleRow[] };
  for (const row of effective) {
    const sla = row.decision.responseSLA;
    if (!sla || row.occurredAt < sla.startedAt || !['RESOLVED', 'BREACHED'].includes(sla.status) ||
      (sla.status === 'BREACHED' && !sla.breachedAt)) continue;
    if (sla.breachedAt && sla.breachedAt > row.occurredAt) continue;
    (sla.breachedAt ? groups.breached : groups.noRecordedBreach).push(row);
  }
  const observedCount = groups.breached.length, comparisonCount = groups.noRecordedBreach.length;
  const observedSuccessCount = groups.breached.filter(row => POSITIVE.has(row.outcomeType)).length;
  const comparisonSuccessCount = groups.noRecordedBreach.filter(row => POSITIVE.has(row.outcomeType)).length;
  const comparable = observedCount >= LEARNING_LIMITS.minComparedGroup &&
    comparisonCount >= LEARNING_LIMITS.minComparedGroup;
  const observedRate = comparable ? Math.round(observedSuccessCount * 100 / observedCount) : null;
  const comparisonRate = comparable ? Math.round(comparisonSuccessCount * 100 / comparisonCount) : null;
  const eligibleCount = effective.length;
  const sufficient = !truncated && eligibleCount >= LEARNING_LIMITS.minEligibleOutcomes &&
    comparable;
  const material = sufficient && Math.abs(observedRate! - comparisonRate!) >= LEARNING_LIMITS.minRateGapPoints;
  return { dateFrom, dateTo: now, eligibleCount, truncated, observedCount, observedSuccessCount,
    comparisonCount, comparisonSuccessCount, observedRate, comparisonRate,
    sufficient, material, comparedKeys: [
      ...groups.breached.map(row => `BREACHED:${row.id}:${row.revision}`),
      ...groups.noRecordedBreach.map(row => `NO_RECORDED_BREACH:${row.id}:${row.revision}`)].sort() };
}

async function loadSample(userId: string, db: PrismaClient, now: Date) {
  if (!userId || !Number.isFinite(now.getTime())) throw new TypeError('Valid tenant and time required');
  const rows = await db.decisionOutcome.findMany({ where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LEARNING_LIMITS.maxOutcomeRows + 1,
    select: { id: true, decisionId: true, revision: true, outcomeType: true, occurredAt: true,
      decision: { select: { responseSLA: { select: { status: true, startedAt: true, breachedAt: true } } } } } });
  return deriveSLAObservation(rows.slice(0, LEARNING_LIMITS.maxOutcomeRows), now,
    rows.length > LEARNING_LIMITS.maxOutcomeRows);
}

export async function getOutcomeLearningDashboard(userId: string, db: PrismaClient = prisma, now = new Date()) {
  const [coverage, suggestions] = await Promise.all([loadSample(userId, db, now),
    db.learningSuggestion.findMany({ where: { userId, status: LearningSuggestionStatus.OPEN },
      orderBy: { createdAt: 'desc' }, take: 20 })]);
  const { comparedKeys: _comparedKeys, ...summary } = coverage;
  return { coverage: summary, suggestions };
}

/** Explicit refresh only. No AI and no policy writes. One bounded observation type in V1. */
export async function refreshOutcomeLearnings(userId: string, db: PrismaClient = prisma, now = new Date()) {
  const sample = await loadSample(userId, db, now);
  if (!sample.material) {
    await db.learningSuggestion.updateMany({ where: { userId,
      suggestionType: LearningSuggestionType.SLA_REVIEW, dimension: 'SLA_BREACH', status: LearningSuggestionStatus.OPEN },
      data: { status: LearningSuggestionStatus.ARCHIVED } });
    return { created: false, suggestion: null,
      reason: sample.truncated ? 'BOUNDED_SAMPLE_LIMIT' : sample.sufficient ? 'NO_MATERIAL_OBSERVATION' : 'INSUFFICIENT_EVIDENCE' };
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ userId, type: 'SLA_REVIEW', dimension: 'SLA_BREACH',
    outcomes: sample.comparedKeys })).digest('hex');
  const evidence = { dimension: 'SLA_BREACH', observedGroup: 'RECORDED_BREACH',
    comparisonGroup: 'NO_RECORDED_BREACH', positiveTypes: [...POSITIVE],
    observed: { positive: sample.observedSuccessCount, total: sample.observedCount, ratePercent: sample.observedRate },
    comparison: { positive: sample.comparisonSuccessCount, total: sample.comparisonCount,
      ratePercent: sample.comparisonRate },
    caveat: 'Observed association only. Outcomes are human-recorded; selection and other factors may differ. This is not causal evidence or a significance test.' };
  const direction = sample.observedRate! < sample.comparisonRate! ? 'lower' : 'higher';
  const explanation = `Among ${sample.observedCount + sample.comparisonCount} eligible recorded outcomes, cases with a recorded SLA breach had ${sample.observedSuccessCount}/${sample.observedCount} positive outcomes (${sample.observedRate}%) versus ${sample.comparisonSuccessCount}/${sample.comparisonCount} (${sample.comparisonRate}%) without a recorded breach. The breached group had a ${direction} observed rate. This is an association, not evidence that response timing caused the difference.`;
  return identityTransaction(db, async tx => {
    const existing = await tx.learningSuggestion.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
    if (existing) return { created: false, suggestion: existing, reason: 'ALREADY_RECORDED' };
    const open = await tx.learningSuggestion.findFirst({ where: { userId,
      suggestionType: LearningSuggestionType.SLA_REVIEW, dimension: 'SLA_BREACH', status: LearningSuggestionStatus.OPEN } });
    const data = { fingerprint, title: 'Review response timing process', explanation,
      evidenceSnapshot: evidence as Prisma.InputJsonValue,
      sampleSize: sample.observedCount + sample.comparisonCount,
      observedCount: sample.observedCount, observedSuccessCount: sample.observedSuccessCount,
      comparisonCount: sample.comparisonCount, comparisonSuccessCount: sample.comparisonSuccessCount,
      observedRate: sample.observedRate!, comparisonRate: sample.comparisonRate!,
      dateFrom: sample.dateFrom, dateTo: sample.dateTo, targetSubsystem: 'RESPONSE_SLA_PROCESS' };
    if (open) {
      const suggestion = await tx.learningSuggestion.update({ where: { id: open.id }, data });
      return { created: false, suggestion, reason: 'OPEN_SUGGESTION_REFRESHED' };
    }
    const suggestion = await tx.learningSuggestion.create({ data: { userId,
      suggestionType: LearningSuggestionType.SLA_REVIEW, dimension: 'SLA_BREACH', ...data } });
    return { created: true, suggestion, reason: 'OBSERVATION_RECORDED' };
  });
}

export async function reviewLearningSuggestion(input: { userId: string; suggestionId: string;
  status: 'ACCEPTED_FOR_REVIEW' | 'REJECTED'; note?: string | null }, db: PrismaClient = prisma) {
  if (!input.userId || !input.suggestionId || input.suggestionId.length > 100 ||
    !['ACCEPTED_FOR_REVIEW', 'REJECTED'].includes(input.status) ||
    (input.note != null && (typeof input.note !== 'string' || input.note.length > 500)))
    throw new TypeError('Invalid suggestion review');
  const changed = await db.learningSuggestion.updateMany({ where: { id: input.suggestionId,
    userId: input.userId, status: LearningSuggestionStatus.OPEN },
    data: { status: input.status, reviewedAt: new Date(), reviewedById: input.userId,
      reviewNote: input.note?.trim() || null } });
  if (!changed.count) throw new Error('Open suggestion not found for tenant');
  return db.learningSuggestion.findUniqueOrThrow({ where: { id: input.suggestionId } });
}
