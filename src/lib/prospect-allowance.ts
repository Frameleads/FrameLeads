import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { monthlyLeadQuotaForTier } from './entitlements';
import { AllowanceError, type VerifiedAllowancePeriod } from './allowance-period';

type Tx = Prisma.TransactionClient;
export type AllowanceSnapshot = { tier: string; limit: number; used: number; remaining: number;
  periodStart: string; periodEnd: string; state: 'active' | 'frozen' };
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
export function allowanceMode() {
  const mode = process.env.PROSPECT_ALLOWANCE_MODE || 'disabled';
  if (!['disabled', 'active', 'freeze'].includes(mode)) throw new AllowanceError('ALLOWANCE_CONFIGURATION_INVALID', 503);
  return mode;
}
export function allowanceRequestHash(value: unknown): string {
  function canonical(v: any): any {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
    return v;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

async function locked(db: PrismaClient, userId: string, fn: (tx: Tx, user: { whopId: string; tier: string; leadsProcessed: number }, now: number) => Promise<any>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ whopId: string; tier: string; leadsProcessed: number }>>`
        SELECT "whopId", "tier", "leadsProcessed" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      if (!users[0]) throw new AllowanceError('ALLOWANCE_ACCOUNT_NOT_FOUND', 401);
      // statement_timestamp is taken after waiting for the tenant lock.
      const clocks = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      return fn(tx, users[0], clocks[0].now.getTime());
    }, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 15000 }); }
    catch (e) {
      if (attempt === 2 || !['P2034', 'P2002'].includes((e as { code?: string }).code || '')) throw e;
    }
  }
  throw new AllowanceError('ALLOWANCE_TRANSACTION_FAILED', 503);
}

async function currentPeriod(tx: Tx, userId: string, user: { whopId: string; tier: string; leadsProcessed: number },
  proof: VerifiedAllowancePeriod, now: number) {
  const cursor = await tx.prospectAllowanceCursor.findUnique({ where: { userId } });
  if (!cursor) throw new AllowanceError('ALLOWANCE_NOT_ENROLLED', 503);
  const mode = allowanceMode();
  if (mode === 'disabled') throw new AllowanceError('ALLOWANCE_ENROLLED_BUT_DISABLED', 503);
  if (!proof || ![proof.start, proof.end, proof.verifiedAt, proof.billingDays].every(Number.isSafeInteger) ||
      !['CORE', 'ENTERPRISE'].includes(proof.tier) || proof.subjectId !== user.whopId || proof.tier !== user.tier ||
      proof.companyId !== cursor.approvedCompanyId || proof.membershipId !== cursor.approvedMembershipId ||
      proof.planId !== cursor.approvedPlanId || proof.billingDays !== cursor.approvedBillingDays ||
      proof.start > now || proof.end <= now || proof.start >= proof.end || proof.verifiedAt > now + 1000 ||
      now - proof.verifiedAt > 30000) throw new AllowanceError('ALLOWANCE_PERIOD_VERIFICATION_REQUIRED', 503);
  let period = cursor.currentPeriodId ? await tx.prospectAllowancePeriod.findUnique({
    where: { userId_id: { userId, id: cursor.currentPeriodId } } }) : null;
  if (period && (period.membershipId !== proof.membershipId || period.companyId !== proof.companyId))
    throw new AllowanceError('ALLOWANCE_TRANSFER_REVIEW_REQUIRED', 503);
  if (!period || period.periodStart.getTime() !== proof.start || period.periodEnd.getTime() !== proof.end) {
    if (mode === 'freeze') throw new AllowanceError('ALLOWANCE_RENEWAL_FROZEN', 503);
    if (period && proof.start < period.periodEnd.getTime()) throw new AllowanceError('ALLOWANCE_PERIOD_CHANGE_REVIEW_REQUIRED', 503);
    if (!period && cursor.approvedLegacyUsage !== user.leadsProcessed)
      throw new AllowanceError('ALLOWANCE_CUTOVER_USAGE_CHANGED', 503);
    if (period) await tx.prospectAllowancePeriod.update({ where: { id: period.id }, data: { closedAt: new Date(now) } });
    period = await tx.prospectAllowancePeriod.create({ data: {
      id: randomUUID(), userId, membershipId: proof.membershipId, companyId: proof.companyId, planId: proof.planId,
      periodStart: new Date(proof.start), periodEnd: new Date(proof.end), used: period ? 0 : user.leadsProcessed,
      legacySeed: period ? 0 : user.leadsProcessed, verifiedAt: new Date(proof.verifiedAt),
    } });
    await tx.prospectAllowanceCursor.update({ where: { userId }, data: { currentPeriodId: period.id } });
  }
  return period;
}
function snapshot(period: { used: number; periodStart: Date; periodEnd: Date }, tier: string): AllowanceSnapshot {
  const limit = monthlyLeadQuotaForTier(tier);
  return { tier, limit, used: period.used, remaining: Math.max(0, limit - period.used),
    periodStart: period.periodStart.toISOString(), periodEnd: period.periodEnd.toISOString(),
    state: allowanceMode() === 'freeze' ? 'frozen' : 'active' };
}
export function readProspectAllowance(db: PrismaClient, userId: string, proof: VerifiedAllowancePeriod): Promise<AllowanceSnapshot> {
  return locked(db, userId, async (tx, user, now) => snapshot(await currentPeriod(tx, userId, user, proof, now), proof.tier));
}
export async function beginAllowanceOperation(db: PrismaClient, userId: string, proof: VerifiedAllowancePeriod,
  operationId: string, requestHash: string) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId) || !/^[a-f0-9]{64}$/.test(requestHash))
    throw new AllowanceError('VALID_IDEMPOTENCY_KEY_REQUIRED', 400);
  return locked(db, userId, async (tx, user, now) => {
    await currentPeriod(tx, userId, user, proof, now);
    const previous = await tx.prospectAllowanceOperation.findUnique({ where: { userId_operationId: { userId, operationId } } });
    if (previous) {
      if (previous.requestHash !== requestHash) throw new AllowanceError('IDEMPOTENCY_PAYLOAD_CONFLICT');
      if (previous.status === 'PROCESSING') throw new AllowanceError('ALLOWANCE_OPERATION_IN_PROGRESS');
      return { replay: true, response: previous.response, statusCode: previous.statusCode! };
    }
    await tx.prospectAllowanceOperation.create({ data: { userId, operationId, requestHash } });
    return { replay: false, response: null, statusCode: 0 };
  });
}
export function allocateProspectAllowance(db: PrismaClient, userId: string, proof: VerifiedAllowancePeriod,
  operationId: string, requested: number): Promise<number> {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new AllowanceError('INVALID_PROSPECT_COUNT', 400);
  return locked(db, userId, async (tx, user, now) => {
    const period = await currentPeriod(tx, userId, user, proof, now);
    const operation = await tx.prospectAllowanceOperation.findUnique({ where: { userId_operationId: { userId, operationId } } });
    if (!operation || operation.status !== 'PROCESSING') throw new AllowanceError('ALLOWANCE_OPERATION_NOT_RESERVED');
    if (operation.allocated !== null) return operation.allocated;
    const allocated = Math.min(requested, Math.max(0, monthlyLeadQuotaForTier(proof.tier) - period.used));
    await tx.prospectAllowancePeriod.update({ where: { id: period.id }, data: { used: { increment: allocated } } });
    await tx.user.update({ where: { id: userId }, data: { leadsProcessed: { increment: allocated } } });
    await tx.prospectAllowanceOperation.update({ where: { userId_operationId: { userId, operationId } }, data: { allocated, periodId: period.id } });
    return allocated;
  });
}
export async function finishAllowanceOperation(db: PrismaClient, userId: string, operationId: string,
  response: unknown, statusCode: number) {
  const result = await db.prospectAllowanceOperation.updateMany({ where: { userId, operationId, status: 'PROCESSING' },
    data: { response: asJson(response), statusCode, status: statusCode < 400 ? 'COMPLETED' : 'FAILED' } });
  if (result.count !== 1) throw new AllowanceError('ALLOWANCE_OPERATION_FINALIZATION_FAILED', 503);
}

/** Future subscriptions can opt in only under a reviewed plan policy and UTC cutover. */
export function enrollNewAllowanceTenant(db: PrismaClient, userId: string, proof: VerifiedAllowancePeriod,
  after: number, reviewReference: string): Promise<void> {
  return locked(db, userId, async (tx, user, now) => {
    const existing = await tx.prospectAllowanceCursor.findUnique({ where: { userId } });
    if (existing) return;
    const account = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true } });
    if (allowanceMode() !== 'active' || !Number.isFinite(after) || account.createdAt.getTime() < after || user.leadsProcessed !== 0 ||
        proof.subjectId !== user.whopId || proof.tier !== user.tier || !reviewReference ||
        proof.start > now || proof.end <= now || now - proof.verifiedAt > 30000)
      throw new AllowanceError('ALLOWANCE_NEW_ACCOUNT_REVIEW_REQUIRED', 503);
    await tx.prospectAllowanceCursor.create({ data: { userId, approvedMembershipId: proof.membershipId,
      approvedCompanyId: proof.companyId, approvedPlanId: proof.planId, approvedBillingDays: proof.billingDays,
      approvedLegacyUsage: 0, reviewReference } });
  });
}
