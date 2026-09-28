import { AIOperation, AIProvider, CompanyResearchStatus, Prisma, ProspectEvidenceType,
  type Company, type CompanyIntelligence, type ICPProfile, type PrismaClient } from '@prisma/client';
import { recordAIUsage } from '../ai/usage';
import { fingerprint } from './company';
import { ICP_SYSTEM_PROMPT, SCOUT_RESEARCH_MODEL, type ResearchProvider } from './research-provider';
import { analyzeScoutWithUsage } from './research-call';
import type { ResearchEvidence } from './research-evidence';
import type { validateResearchOutput } from './research';

const LEASE_MS = 5 * 60_000;

export function companySources(company: Company): ResearchEvidence[] {
  const at = company.updatedAt.toISOString();
  const source = (key: string, content: string, substantive: boolean): ResearchEvidence => ({
    evidenceId: `company:${company.id}:${key}`, evidenceType: ProspectEvidenceType.INTERNAL,
    sourceTitle: 'Stored company fact', sourceUrl: null, content, capturedAt: at,
    timingEligible: false, substantive,
  });
  const result: ResearchEvidence[] = [];
  if (company.name) result.push(source('name', `Company name: ${company.name}.`, false));
  if (company.normalizedDomain) result.push(source('domain', `Company domain: ${company.normalizedDomain}.`, false));
  if (company.industry) result.push(source('industry', `Company industry: ${company.industry}.`, true));
  if (company.companySizeMin != null || company.companySizeMax != null) result.push(source('size',
    `Supplied company size range: ${company.companySizeMin ?? '?'} to ${company.companySizeMax ?? 'or more'} employees.`, true));
  return result;
}

export function companyInputFingerprint(company: Company): string {
  return fingerprint([company.normalizedDomain, company.normalizedName, company.industry,
    company.companySizeMin, company.companySizeMax]);
}

export function icpInputFingerprint(profile: ICPProfile): string {
  return fingerprint([profile.id, profile.qualificationPolicy, profile.isActive,
    profile.targetTitles, profile.targetSeniorities, profile.targetIndustries, profile.targetGeographies,
    profile.excludedTitles, profile.excludedIndustries, profile.excludedDomains,
    profile.companySizeMin, profile.companySizeMax, profile.requiredKeywords, profile.excludedKeywords]);
}

export type CompanyResearchResult = { intelligence: CompanyIntelligence; sources: ResearchEvidence[]; reused: boolean };

export async function getOrResearchCompany(input: {
  db: PrismaClient; company: Company; profile: ICPProfile; provider: ResearchProvider;
  recordUsage?: typeof recordAIUsage; refreshCompany?: boolean;
  validate: typeof validateResearchOutput;
}): Promise<CompanyResearchResult | null> {
  const { db, company, profile } = input;
  if (!company.userId || profile.userId !== company.userId) throw new Error('Company and ICP profile must belong to the same tenant');
  const sources = companySources(company);
  if (!sources.some(source => source.substantive)) return null;
  const scope = { userId: company.userId, companyId: company.id };
  const inputFingerprint = companyInputFingerprint(company);
  const icpFingerprint = icpInputFingerprint(profile);
  const matching = (row: CompanyIntelligence | null) => row && row.inputFingerprint === inputFingerprint &&
    row.icpFingerprint === icpFingerprint && row.icpProfileId === profile.id;
  const ready = (row: CompanyIntelligence | null) => matching(row) && row?.status === CompanyResearchStatus.READY && row.whyCompanyFits && row.fitScore != null;
  const lookup = () => db.companyIntelligence.findUnique({ where: { userId_companyId: scope } });
  let row = await lookup();
  if (!input.refreshCompany && ready(row)) return { intelligence: row!, sources, reused: true };
  if (!input.refreshCompany && matching(row) && row?.status === CompanyResearchStatus.NEEDS_REVIEW) return null;

  // Conditional DB lease ensures only one worker performs the expensive shared call.
  let lease: CompanyIntelligence | null = null;
  if (row) {
    const changed = await db.companyIntelligence.updateMany({
      where: { id: row.id, ...scope, OR: [
        { status: { not: CompanyResearchStatus.RESEARCHING } },
        { updatedAt: { lt: new Date(Date.now() - LEASE_MS) } },
      ] },
      data: { status: CompanyResearchStatus.RESEARCHING, inputFingerprint, icpFingerprint, icpProfileId: profile.id },
    });
    if (changed.count) lease = await lookup();
  } else {
    try {
      lease = await db.companyIntelligence.create({ data: {
        ...scope, status: CompanyResearchStatus.RESEARCHING, inputFingerprint, icpFingerprint, icpProfileId: profile.id,
      } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    }
  }
  if (!lease) {
    for (let wait = 0; wait < 20; wait++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      row = await lookup();
      if (ready(row)) return { intelligence: row!, sources, reused: true };
      if (matching(row) && row?.status === CompanyResearchStatus.NEEDS_REVIEW) return null;
      if (row?.status === CompanyResearchStatus.FAILED) throw new Error('Company research failed in another request');
    }
    throw new Error('Company research is still in progress; retry later');
  }

  try {
    const systemInstruction = `${ICP_SYSTEM_PROMPT}\nThis call assesses COMPANY-LEVEL fit only. Never infer any person's role, location, needs, or history. ICP criteria are trusted configuration, not evidence: ${JSON.stringify({
      targetIndustries: profile.targetIndustries, targetGeographies: profile.targetGeographies,
      companySizeMin: profile.companySizeMin, companySizeMax: profile.companySizeMax,
      requiredKeywords: profile.requiredKeywords, excludedIndustries: profile.excludedIndustries,
    })}`;
    const output = await analyzeScoutWithUsage({ db, provider: input.provider, userId: company.userId,
      companyKey: company.normalizedDomain || `company:${company.id}`, operation: AIOperation.SCOUT_COMPANY_ANALYSIS,
      request: { systemInstruction, evidence: sources }, recordUsage: input.recordUsage,
    });
    const assessment = input.validate(output, sources);
    const status = assessment.sufficient ? CompanyResearchStatus.READY : CompanyResearchStatus.NEEDS_REVIEW;
    const changed = await db.$transaction(async tx => {
      const updated = await tx.companyIntelligence.updateMany({
        where: { id: lease.id, ...scope, status: CompanyResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
        data: {
          status, fitScore: assessment.patch.fitScore, fitTier: assessment.patch.fitTier,
          valueBand: assessment.patch.potentialValueBand,
          whyCompanyFits: assessment.patch.whyFit, whyCompanyNow: assessment.patch.whyNow,
          triggers: assessment.patch.triggers || [], risks: assessment.patch.risks || [],
          confidenceScore: assessment.patch.confidenceScore,
          researchedAt: new Date(), provider: AIProvider.GEMINI, model: SCOUT_RESEARCH_MODEL,
        },
      });
      if (!updated.count) return false;
      await tx.companyEvidence.deleteMany({ where: scope });
      await tx.companyEvidence.createMany({ data: sources.filter(source => source.substantive).map(source => ({
        ...scope, evidenceType: source.evidenceType, sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl, claim: source.content, capturedAt: new Date(source.capturedAt),
      })) });
      return true;
    });
    if (!changed) throw new Error('Company research lease was lost');
    const committed = await lookup();
    return committed?.status === CompanyResearchStatus.READY ? { intelligence: committed, sources, reused: false } : null;
  } catch (error) {
    await db.companyIntelligence.updateMany({
      where: { id: lease.id, ...scope, status: CompanyResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
      data: { status: CompanyResearchStatus.FAILED },
    });
    throw error;
  }
}
