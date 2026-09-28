import type { PrismaClient } from '@prisma/client';
import { getProspectIntelligence } from './prospects/intelligence';

export async function resolveScoutUser(db: PrismaClient, session?: string, email?: string) {
  if (!session?.trim() || !email?.trim()) return null;
  return db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
}

export async function listScoutProspects(db: PrismaClient, userId: string) {
  if (!userId?.trim()) throw new TypeError('Authenticated userId is required');
  const prospects = await db.prospect.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, firstName: true, lastName: true, companyName: true,
      qualification: { select: { status: true, reasonCode: true, override: true, policyVersion: true, qualificationReason: true } },
      intelligence: { select: {
        fitScore: true, fitTier: true, potentialValueBand: true,
        whyNow: true, researchStatus: true,
      } },
    },
  });
  return prospects.map(prospect => ({
    id: prospect.id,
    name: [prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || 'Unnamed prospect',
    companyName: prospect.companyName || 'Company unknown',
    fitScore: prospect.intelligence?.fitScore ?? null,
    fitTier: prospect.intelligence?.fitTier ?? null,
    potentialValueBand: prospect.intelligence?.potentialValueBand ?? null,
    whyNow: prospect.intelligence?.whyNow ?? null,
    researchStatus: prospect.intelligence?.researchStatus ?? 'NOT_RESEARCHED',
    qualificationStatus: prospect.qualification?.status ?? 'UNASSESSED',
    qualificationReasonCode: prospect.qualification?.reasonCode ?? 'NONE',
    qualificationOverride: prospect.qualification?.override ?? 'AUTO',
    qualificationPolicyVersion: prospect.qualification?.policyVersion ?? 1,
    qualificationReason: prospect.qualification?.qualificationReason ?? null,
  }));
}

export type ScoutProspectRow = Awaited<ReturnType<typeof listScoutProspects>>[number];

export async function getScoutProspect(db: PrismaClient, userId: string, prospectId: string) {
  if (!userId?.trim() || !prospectId?.trim()) throw new TypeError('Authenticated userId and prospectId are required');
  const prospect = await db.prospect.findFirst({
    where: { id: prospectId, userId },
    select: { id: true, companyId: true, firstName: true, lastName: true, companyName: true, websiteUrl: true, email: true, jobTitle: true, industry: true, country: true, location: true, companySizeMin: true, companySizeMax: true, qualification: { select: { status: true, reasonCode: true, override: true, overriddenAt: true, policyVersion: true, qualificationReason: true, matchedCriteria: true, failedCriteria: true, missingCriteria: true } } },
  });
  if (!prospect) return null;
  const intelligence = await getProspectIntelligence(db, { userId, prospectId });
  const companyEvidence = prospect.companyId && intelligence ? await db.companyEvidence.findMany({
    where: { userId, companyId: prospect.companyId }, take: 8,
  }) : [];
  return {
    id: prospect.id,
    name: [prospect.firstName, prospect.lastName].filter(Boolean).join(' ') || 'Unnamed prospect',
    companyName: prospect.companyName || 'Company unknown',
    websiteUrl: prospect.websiteUrl,
    email: prospect.email,
    jobTitle: prospect.jobTitle,
    industry: prospect.industry,
    country: prospect.country,
    location: prospect.location,
    companySizeMin: prospect.companySizeMin,
    companySizeMax: prospect.companySizeMax,
    qualification: prospect.qualification ? { ...prospect.qualification, overriddenAt: prospect.qualification.overriddenAt?.toISOString() ?? null } : null,
    intelligence: intelligence ? {
      fitScore: intelligence.fitScore,
      fitTier: intelligence.fitTier,
      confidenceScore: intelligence.confidenceScore,
      potentialValueBand: intelligence.potentialValueBand,
      estimatedValueAmount: intelligence.estimatedValueAmount?.toString() ?? null,
      estimatedValueCurrency: intelligence.estimatedValueCurrency,
      whyFit: intelligence.whyFit,
      whyNow: intelligence.whyNow,
      triggers: intelligence.triggers,
      risks: intelligence.risks,
      researchStatus: intelligence.researchStatus,
      researchedAt: intelligence.researchedAt?.toISOString() ?? null,
      evidence: [...intelligence.evidence.map(row => ({
        id: row.id, claim: row.claim, sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl, evidenceType: row.evidenceType,
        confidenceScore: row.confidenceScore, isUserProvided: row.isUserProvided,
      })), ...companyEvidence.map(row => ({
        id: row.id, claim: row.claim, sourceTitle: row.sourceTitle,
        sourceUrl: row.sourceUrl, evidenceType: row.evidenceType,
        confidenceScore: null, isUserProvided: false,
      }))],
    } : null,
  };
}

export type ScoutProspectDetail = NonNullable<Awaited<ReturnType<typeof getScoutProspect>>>;

export async function runScoutResearch<T>(
  userId: string,
  prospectId: string,
  forceRefresh: boolean,
  research: (input: { userId: string; prospectId: string; forceRefresh: boolean; overrideQualification: boolean }) => Promise<T>,
  overrideQualification = false,
): Promise<T> {
  if (!userId?.trim() || !prospectId?.trim()) throw new TypeError('Authenticated userId and prospectId are required');
  return research({ userId, prospectId, forceRefresh, overrideQualification });
}
