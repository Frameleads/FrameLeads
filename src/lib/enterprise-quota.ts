import type { PrismaClient } from '@prisma/client';
import { monthlyLeadQuotaForTier } from './entitlements';

/** Allocate against the existing counter under a tenant row lock, before provider work.
 * Generation attempts retain the existing charging semantics, including failed attempts.
 * Never lower usage: accounts over the revised cap simply receive zero slots.
 */
export async function reserveEnterpriseProspects(db: PrismaClient, userId: string, requested: number): Promise<number> {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error('Invalid prospect count');
  if (!requested) return 0;
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ leadsProcessed: number }>>`
      SELECT "leadsProcessed" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (!rows[0]) throw new Error('Quota account not found');
    const allocated = Math.min(requested, Math.max(0, monthlyLeadQuotaForTier('ENTERPRISE') - rows[0].leadsProcessed));
    if (allocated) await tx.user.update({ where: { id: userId }, data: { leadsProcessed: { increment: allocated } } });
    return allocated;
  }, { isolationLevel: 'ReadCommitted' });
}
