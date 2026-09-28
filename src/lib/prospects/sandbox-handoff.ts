import { ProspectResearchStatus, QualificationOverride, ProspectQualificationStatus, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { identityTransaction } from './identity';
import { qualifyProspect } from './qualification';
import { MEMORY_EVENT, recordProspectMemoryEventInTransaction } from './memory';

export type SandboxHandoffFailure = 'NOT_FOUND' | 'QUALIFICATION_REQUIRED' | 'RESEARCH_REQUIRED';

export class SandboxHandoffError extends Error {
  constructor(public readonly reason: SandboxHandoffFailure) {
    super(reason === 'NOT_FOUND' ? 'Prospect not found.' : reason === 'QUALIFICATION_REQUIRED'
      ? 'Qualify this prospect before sending it to Sandbox.' : 'Complete Scout research before sending this prospect to Sandbox.');
  }
}

/** The transaction is serializable so simultaneous handoffs cannot create unbounded duplicate execution leads. */
export async function sendProspectToSandbox(
  input: { userId: string; prospectId: string }, db: PrismaClient = prisma,
  dependencies: { qualify?: typeof qualifyProspect } = {},
) {
  if (!input.userId?.trim() || !input.prospectId?.trim()) throw new TypeError('Authenticated userId and prospectId are required');
  const scope = { userId: input.userId.trim(), prospectId: input.prospectId.trim() };
  return identityTransaction(db, async tx => {
    const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } } });
    if (!prospect) throw new SandboxHandoffError('NOT_FOUND');

    // Recheck current deterministic policy inside the transaction. A human exclusion always wins.
    const qualification = await (dependencies.qualify || qualifyProspect)(scope, tx as unknown as PrismaClient);
    if (qualification.override === QualificationOverride.USER_EXCLUDED ||
      qualification.status !== ProspectQualificationStatus.QUALIFIED) throw new SandboxHandoffError('QUALIFICATION_REQUIRED');

    const intelligence = await tx.prospectIntelligence.findUnique({ where: { userId_prospectId: scope }, select: { researchStatus: true } });
    if (intelligence?.researchStatus !== ProspectResearchStatus.READY) throw new SandboxHandoffError('RESEARCH_REQUIRED');

    const existing = await tx.generatedLead.findFirst({
      where: { userId: scope.userId, prospectId: scope.prospectId }, orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const lead = existing || await tx.generatedLead.create({ data: {
      userId: scope.userId, prospectId: scope.prospectId,
      firstName: prospect.firstName || '', lastName: prospect.lastName || '',
      companyName: prospect.companyName || '', websiteUrl: prospect.websiteUrl,
      linkedInUrl: prospect.linkedInUrl, email: prospect.email,
      emailDraft: '', linkedInDraft: '',
    }, select: { id: true } });

    await recordProspectMemoryEventInTransaction(tx, { ...scope, eventType: MEMORY_EVENT.SANDBOX_HANDOFF,
      sourceType: 'GENERATED_LEAD', sourceId: lead.id, description: 'Prospect sent to Sandbox.', importance: 2 });

    return {
      prospectId: prospect.id, leadId: lead.id, reusedLead: Boolean(existing),
      destination: `/dashboard/sandbox?lead=${encodeURIComponent(lead.id)}`,
    };
  });
}
