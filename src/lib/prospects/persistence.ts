import { Prisma, type PrismaClient } from '@prisma/client';
import { attachableProspectId, identityTransaction, ProspectIdentityConflict, resolveProspectInTransaction, type Resolution } from './identity';
import { type IdentityInput } from './normalization';
import type { ProspectMetadata } from './metadata';

type LeadData = Omit<Prisma.GeneratedLeadUncheckedCreateInput, 'prospectId'>;
type SignalData = Omit<Prisma.InboundSignalCreateManyInput, 'prospectId'> & { userId: string };
type InboundIdentity = Omit<IdentityInput, 'userId'>;

export async function leadProspectInTransaction(tx: Prisma.TransactionClient, lead: LeadData & { prospectId?: string | null }): Promise<Resolution> {
  if (lead.prospectId) {
    const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: lead.userId, id: lead.prospectId } } });
    if (!prospect) throw new Error('Lead has an invalid tenant/prospect relationship');
    return { status: 'resolved', prospectId: prospect.id };
  }
  return resolveProspectInTransaction(tx, lead);
}

export async function saveGeneratedLead(db: PrismaClient, data: LeadData, existingId?: string, metadata: Partial<ProspectMetadata> = {}) {
  return identityTransaction(db, async tx => {
    const existing = existingId ? await tx.generatedLead.findFirst({ where: { id: existingId, userId: data.userId } }) : null;
    if (existingId && !existing) throw new Error('Lead not found for authenticated user');
    const resolution = await resolveProspectInTransaction(tx, { ...data, ...metadata });
    const prospectId = attachableProspectId(resolution, data.userId);
    // Never reassign an established campaign record to a different person during regeneration.
    if (existing?.prospectId && (resolution.status === 'conflict' || prospectId && existing.prospectId !== prospectId)) {
      throw new ProspectIdentityConflict(resolution.status === 'conflict' ? resolution : {
        status: 'conflict', prospectId: null, reason: 'existing_lead_identity_mismatch',
        candidateIds: [existing.prospectId, ...(prospectId ? [prospectId] : [])],
      });
    }
    const linkedData = { ...data, prospectId: prospectId || existing?.prospectId || null };
    return existing
      ? tx.generatedLead.update({ where: { id: existing.id, userId: data.userId }, data: { ...linkedData, createdAt: new Date() } })
      : tx.generatedLead.create({ data: linkedData });
  });
}

/** A skipped duplicate import may still supply new factual metadata for its established Prospect. */
export async function enrichExistingLeadProspect(db: PrismaClient, userId: string, leadId: string, metadata: Partial<ProspectMetadata>) {
  return identityTransaction(db, async tx => {
    const lead = await tx.generatedLead.findFirst({ where: { id: leadId, userId } });
    if (!lead) throw new Error('Lead not found for authenticated user');
    const resolution = await resolveProspectInTransaction(tx, { ...lead, ...metadata });
    const prospectId = attachableProspectId(resolution, userId);
    if (lead.prospectId && prospectId && lead.prospectId !== prospectId) throw new ProspectIdentityConflict({
      status: 'conflict', prospectId: null, reason: 'existing_lead_identity_mismatch', candidateIds: [lead.prospectId, prospectId],
    });
    if (prospectId && !lead.prospectId) await tx.generatedLead.update({ where: { id: lead.id, userId }, data: { prospectId } });
    return resolution;
  });
}

/** Source context is prose, not a company identity. Only explicit hints may supply fallback data. */
export async function inboundProspectInTransaction(tx: Prisma.TransactionClient, data: SignalData, identity: InboundIdentity = {}): Promise<Resolution> {
  if (data.generatedLeadId) {
    const lead = await tx.generatedLead.findFirst({ where: { id: data.generatedLeadId, userId: data.userId } });
    if (!lead) throw new Error('Inbound GeneratedLead is not owned by authenticated user');
    let result = await leadProspectInTransaction(tx, lead);
    if (result.status === 'insufficient_identity') {
      result = await resolveProspectInTransaction(tx, {
        ...identity, ...lead, userId: data.userId,
        email: data.prospectEmail || identity.email || lead.email,
        linkedInUrl: identity.linkedInUrl || lead.linkedInUrl,
      });
    }
    if (result.prospectId && !lead.prospectId) await tx.generatedLead.update({ where: { id: lead.id, userId: data.userId }, data: { prospectId: result.prospectId } });
    return result;
  }
  return resolveProspectInTransaction(tx, { ...identity, userId: data.userId, email: data.prospectEmail || identity.email });
}

export function createInboundSignal(db: PrismaClient, args: { data: SignalData }, identity?: InboundIdentity) {
  return identityTransaction(db, async tx => {
    const result = await inboundProspectInTransaction(tx, args.data, identity);
    return tx.inboundSignal.create({ data: { ...args.data, prospectId: attachableProspectId(result, args.data.userId) } });
  });
}

export function createInboundSignals(db: PrismaClient, data: SignalData[]) {
  return identityTransaction(db, async tx => {
    const linked: Prisma.InboundSignalCreateManyInput[] = [];
    for (const signal of data) {
      const result = await inboundProspectInTransaction(tx, signal);
      linked.push({ ...signal, prospectId: attachableProspectId(result, signal.userId) });
    }
    return tx.inboundSignal.createManyAndReturn({ data: linked, skipDuplicates: true, select: { id: true } });
  });
}

export function identityFromFullName(name: string, companyName?: string | null): InboundIdentity {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts.shift(), lastName: parts.join(' ') || null, companyName };
}
