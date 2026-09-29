import { RevenueRiskStatus, type PrismaClient, type TriageIntent } from '@prisma/client';
import { prisma } from './prisma';
import type { ConstitutionFacts } from './sales-constitution';

type Input = { qualificationStatus?: string | null; fitTier?: string | null;
  primaryIntent?: TriageIntent | null; secondaryIntents?: readonly TriageIntent[] | null;
  confidence?: number | null; jobTitle?: string | null; industry?: string | null;
  country?: string | null; companySizeMin?: number | null; companySizeMax?: number | null;
  riskBand?: string | null };
type AccountSource = { industry?: string | null; companySizeMin?: number | null; companySizeMax?: number | null };
/** Keep Decision-time and execution-time account precedence identical. A size range never mixes sources. */
export function selectConstitutionAccountFacts(prospect: AccountSource, company?: AccountSource | null) {
  const companyHasSize = company?.companySizeMin != null || company?.companySizeMax != null;
  return { industry: (company?.industry?.trim() || prospect.industry?.trim() || null)?.slice(0, 120) ?? null,
    companySizeMin: companyHasSize ? company?.companySizeMin ?? null : prospect.companySizeMin ?? null,
    companySizeMax: companyHasSize ? company?.companySizeMax ?? null : prospect.companySizeMax ?? null };
}
/** Both production and simulation use this canonical, bounded fact vocabulary. Null means unknown. */
export function buildSalesConstitutionFacts(input: Input): ConstitutionFacts {
  return { QUALIFICATION_STATUS: input.qualificationStatus ?? null, FIT_TIER: input.fitTier ?? null,
    PRIMARY_INTENT: input.primaryIntent ?? null, SECONDARY_INTENT: input.secondaryIntents ? [...input.secondaryIntents] : null,
    CONFIDENCE: input.confidence ?? null, JOB_TITLE: input.jobTitle?.trim() || null,
    INDUSTRY: input.industry?.trim() || null, COUNTRY: input.country?.trim() || null,
    COMPANY_SIZE: input.companySizeMin == null && input.companySizeMax == null ? null :
      { min: input.companySizeMin ?? null, max: input.companySizeMax ?? null }, RISK_BAND: input.riskBand ?? null };
}

/** Read only tenant-owned current records. Risk is deliberately unknown until a persisted applicable assessment exists. */
export async function loadSalesConstitutionFacts(input: { userId: string; prospectId: string; decisionId?: string;
  primaryIntent?: TriageIntent | null; secondaryIntents?: readonly TriageIntent[] | null;
  confidence?: number | null; riskBandOverride?: string | null }, db: PrismaClient = prisma): Promise<ConstitutionFacts> {
  const { userId, prospectId } = input;
  const [prospect, qualification, intelligence, risk] = await Promise.all([
    db.prospect.findUnique({ where: { userId_id: { userId, id: prospectId } },
      select: { jobTitle: true, industry: true, country: true, companySizeMin: true, companySizeMax: true,
        company: { select: { industry: true, companySizeMin: true, companySizeMax: true } } } }),
    db.prospectQualification.findUnique({ where: { userId_prospectId: { userId, prospectId } }, select: { status: true } }),
    db.prospectIntelligence.findUnique({ where: { userId_prospectId: { userId, prospectId } }, select: { fitTier: true } }),
    input.decisionId ? db.decisionRevenueRisk.findFirst({ where: { userId, decisionId: input.decisionId,
      decision: { prospectId },
      status: RevenueRiskStatus.APPLICABLE }, orderBy: { evaluatedAt: 'desc' }, select: { band: true } }) : Promise.resolve(null),
  ]);
  if (!prospect) throw new Error('Prospect not found for authenticated tenant');
  const account = selectConstitutionAccountFacts(prospect, prospect.company);
  return buildSalesConstitutionFacts({ qualificationStatus: qualification?.status, fitTier: intelligence?.fitTier,
    primaryIntent: input.primaryIntent, secondaryIntents: input.secondaryIntents, confidence: input.confidence,
    jobTitle: prospect.jobTitle, industry: account.industry, country: prospect.country,
    companySizeMin: account.companySizeMin, companySizeMax: account.companySizeMax,
    riskBand: input.riskBandOverride ?? risk?.band });
}
