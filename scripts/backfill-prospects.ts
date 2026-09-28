import { PrismaClient } from '@prisma/client';
import { identityTransaction, type Resolution } from '../src/lib/prospects/identity';
import { inboundProspectInTransaction, leadProspectInTransaction } from '../src/lib/prospects/persistence';

const db = new PrismaClient();
const userId = process.env.PROSPECT_BACKFILL_USER_ID;
const summary = { leadsScanned: 0, leadsAttached: 0, signalsScanned: 0, signalsAttached: 0, created: 0, resolved: 0, conflicts: 0, insufficient: 0, invalidOwner: 0 };

function report(result: Resolution, kind: string, id: string, owner: string) {
  if (result.status === 'conflict') {
    summary.conflicts++;
    console.warn(JSON.stringify({ event: 'identity_conflict', kind, id, userId: owner, reason: result.reason, candidateIds: result.candidateIds }));
  } else if (result.status === 'insufficient_identity') summary.insufficient++;
  else summary[result.status]++;
}

async function main() {
  // Explicit opt-in prevents accidental execution by install/build hooks or casual invocation.
  if (!process.argv.includes('--apply')) throw new Error('Review the target DATABASE_URL, then pass --apply. This script writes data.');
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL explicitly; this script does not load .env files.');
  const owners = new Set((await db.user.findMany({ where: userId ? { id: userId } : {}, select: { id: true } })).map(u => u.id));
  if (userId && !owners.has(userId)) throw new Error('PROSPECT_BACKFILL_USER_ID is not a User id');
  let cursor: string | undefined;
  for (;;) {
    const batch = await db.generatedLead.findMany({
      where: { ...(userId ? { userId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, userId: true },
    });
    if (!batch.length) break;
    for (const row of batch) {
      summary.leadsScanned++;
      if (!owners.has(row.userId)) {
        summary.invalidOwner++;
        console.warn(JSON.stringify({ event: 'invalid_owner', kind: 'GeneratedLead', id: row.id }));
        continue;
      }
      const outcome = await identityTransaction(db, async tx => {
        const lead = await tx.generatedLead.findFirst({ where: { id: row.id, userId: row.userId } });
        if (!lead) return null;
        const result = await leadProspectInTransaction(tx, lead);
        if (!result.prospectId) return { result, attached: 0, signals: 0 };
        const attached = lead.prospectId ? 0 : (await tx.generatedLead.updateMany({ where: { id: lead.id, userId: lead.userId, prospectId: null }, data: { prospectId: result.prospectId } })).count;
        const signals = await tx.inboundSignal.updateMany({
          where: { generatedLeadId: lead.id, userId: lead.userId, prospectId: null },
          data: { prospectId: result.prospectId },
        });
        return { result, attached, signals: signals.count };
      });
      if (outcome) {
        report(outcome.result, 'GeneratedLead', row.id, row.userId);
        summary.leadsAttached += outcome.attached;
        summary.signalsAttached += outcome.signals;
      }
    }
    cursor = batch[batch.length - 1].id;
    console.log(JSON.stringify({ event: 'lead_batch', ...summary }));
  }
  cursor = undefined;
  for (;;) {
    const batch: { id: string; userId: string | null }[] = await db.inboundSignal.findMany({
      where: { prospectId: null, ...(userId ? { userId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, userId: true },
    });
    if (!batch.length) break;
    for (const row of batch) {
      summary.signalsScanned++;
      const owner = row.userId;
      if (!owner || !owners.has(owner)) {
        summary.invalidOwner++;
        console.warn(JSON.stringify({ event: 'invalid_owner', kind: 'InboundSignal', id: row.id }));
        continue;
      }
      const outcome = await identityTransaction(db, async tx => {
        const signal = await tx.inboundSignal.findFirst({ where: { id: row.id, userId: owner, prospectId: null } });
        if (!signal) return null;
        if (signal.generatedLeadId && !await tx.generatedLead.findFirst({ where: { id: signal.generatedLeadId, userId: owner }, select: { id: true } })) {
          return { result: { status: 'conflict', prospectId: null, reason: 'linked_lead_tenant_mismatch', candidateIds: [] } as Resolution, attached: 0 };
        }
        const result = await inboundProspectInTransaction(tx, { ...signal, userId: owner });
        const attached = result.prospectId ? (await tx.inboundSignal.updateMany({ where: { id: signal.id, userId: owner, prospectId: null }, data: { prospectId: result.prospectId } })).count : 0;
        return { result, attached };
      });
      if (outcome) {
        report(outcome.result, 'InboundSignal', row.id, owner);
        summary.signalsAttached += outcome.attached;
      }
    }
    cursor = batch[batch.length - 1].id;
  }
}

main().catch(error => { console.error('Prospect backfill failed:', error); process.exitCode = 1; })
  .finally(async () => { console.log(JSON.stringify({ event: 'backfill_summary', ...summary })); await db.$disconnect(); });
