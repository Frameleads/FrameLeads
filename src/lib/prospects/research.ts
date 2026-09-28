import {
  Prisma,
  AIOperation,
  ProspectFitTier,
  ProspectIntelligenceEditor,
  ProspectResearchStatus,
  ProspectValueBand,
  type PrismaClient,
  type ProspectIntelligence,
} from '@prisma/client';
import { prisma } from '../prisma';
import { recordAIUsage } from '../ai/usage';
import { ProspectIntelligenceNotFound, validateEvidence, validateIntelligencePatch, type EvidenceInput, type IntelligencePatch } from './intelligence';
import { collectProspectEvidence, isGroundedClaim, type ResearchEvidence } from './research-evidence';
import { geminiResearchProvider, ICP_SYSTEM_PROMPT, type ResearchProvider } from './research-provider';
import { analyzeScoutWithUsage, AIUsageRecordingError } from './research-call';
import { attachCompanyToProspect } from './company';
import { getOrResearchCompany } from './company-research';
import { qualifyProspect } from './qualification';

export class InvalidResearchOutput extends Error {
  constructor(message: string) { super(`Invalid ICP research output: ${message}`); }
}

type Scope = { userId: string; prospectId: string };
type Input = Scope & { forceRefresh?: boolean; refreshCompany?: boolean; overrideQualification?: boolean };
type Result = {
  status: ProspectResearchStatus;
  intelligence: ProspectIntelligence;
  evidenceCount: number;
  warnings: string[];
  reused: boolean;
};
type GateResult = {
  status: 'NOT_ELIGIBLE' | 'QUALIFICATION_REQUIRED';
  intelligence: null;
  evidenceCount: 0;
  warnings: string[];
  reused: false;
};

type SupportedClaim = { claim: string; evidenceIds: string[] };
type ParsedAssessment = {
  patch: IntelligencePatch;
  evidence: EvidenceInput[];
  warnings: string[];
  sufficient: boolean;
};

const DIMENSIONS = ['targetRelevance', 'companyAlignment', 'evidenceOfNeed', 'timingStrength', 'riskPenalty'] as const;
const LEASE_MS = 5 * 60_000;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidResearchOutput(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, optional = false): string | null {
  if (value === null && optional) return null;
  if (typeof value !== 'string') throw new InvalidResearchOutput(`${label} must be a string${optional ? ' or null' : ''}`);
  const result = value.trim();
  if (!result || result.length > 500) throw new InvalidResearchOutput(`${label} must be concise and nonblank`);
  return result;
}

function array(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new InvalidResearchOutput(`${label} must be an array of at most ${limit}`);
  return value;
}

function ids(value: unknown, label: string): string[] {
  return array(value, label, 5).map((item, index) => string(item, `${label}[${index}]`) as string);
}

function points(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 25) throw new InvalidResearchOutput(`${label} must be an integer from 0 to 25`);
  return value;
}

function confidence(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw new InvalidResearchOutput('confidenceScore must be 0-100 or null');
  return value;
}

function tier(score: number): ProspectFitTier {
  if (score >= 75) return ProspectFitTier.STRONG;
  if (score >= 50) return ProspectFitTier.MODERATE;
  return ProspectFitTier.WEAK;
}

/** Reject malformed shapes; discard unsupported claims and fields that cite them. */
export function validateResearchOutput(raw: unknown, sources: ResearchEvidence[]): ParsedAssessment {
  const output = object(raw, 'output');
  const evidenceById = new Map(sources.map(item => [item.evidenceId, item]));
  const warnings: string[] = [];
  const claims: SupportedClaim[] = [];
  for (const [index, candidate] of array(output.supportedClaims, 'supportedClaims', 12).entries()) {
    const row = object(candidate, `supportedClaims[${index}]`);
    const claim = string(row.claim, `supportedClaims[${index}].claim`) as string;
    const evidenceIds = ids(row.evidenceIds, `supportedClaims[${index}].evidenceIds`);
    const groundedIds = evidenceIds.filter(id => evidenceById.has(id) && isGroundedClaim(claim, evidenceById.get(id)!.content));
    if (!groundedIds.length) {
      warnings.push('unsupported_claim_discarded');
      continue;
    }
    if (groundedIds.length !== evidenceIds.length) warnings.push('unsupported_citation_discarded');
    claims.push({ claim, evidenceIds: groundedIds });
  }
  const supportedIds = new Set(claims.flatMap(claim => claim.evidenceIds));
  const citations = (value: unknown, label: string, requireTiming = false): string[] | null => {
    const cited = ids(value, label);
    if (!cited.length || cited.some(id => !supportedIds.has(id)) || requireTiming && cited.some(id => !evidenceById.get(id)?.timingEligible)) {
      warnings.push(`${label}_unsupported`);
      return null;
    }
    return cited;
  };

  const rubric = object(output.rubric, 'rubric');
  const weighted: Record<(typeof DIMENSIONS)[number], number> = {
    targetRelevance: 0, companyAlignment: 0, evidenceOfNeed: 0, timingStrength: 0, riskPenalty: 0,
  };
  for (const dimension of DIMENSIONS) {
    const value = object(rubric[dimension], `rubric.${dimension}`);
    const proposed = points(value.points, `rubric.${dimension}.points`);
    const cited = ids(value.evidenceIds, `rubric.${dimension}.evidenceIds`);
    if (!proposed) continue;
    const valid = cited.length > 0 && cited.every(id => supportedIds.has(id)) &&
      (dimension !== 'timingStrength' || cited.every(id => evidenceById.get(id)?.timingEligible));
    if (valid) weighted[dimension] = proposed;
    else warnings.push(`rubric.${dimension}_unsupported`);
  }
  const hasSubstantiveClaim = claims.some(claim => claim.evidenceIds.some(id => evidenceById.get(id)?.substantive));
  // Formula: four 0-25 positive dimensions minus a 0-25 evidenced risk penalty, floored at zero.
  const fitScore = hasSubstantiveClaim
    ? Math.max(0, weighted.targetRelevance + weighted.companyAlignment + weighted.evidenceOfNeed + weighted.timingStrength - weighted.riskPenalty)
    : null;

  const modelWhyFit = string(output.whyFit, 'whyFit', true);
  const whyFitCitations = ids(output.whyFitEvidenceIds, 'whyFitEvidenceIds');
  const whyFit = modelWhyFit && citations(whyFitCitations, 'whyFitEvidenceIds') ? modelWhyFit : null;
  const modelWhyNow = string(output.whyNow, 'whyNow', true);
  const whyNowCitations = ids(output.whyNowEvidenceIds, 'whyNowEvidenceIds');
  const whyNow = modelWhyNow && citations(whyNowCitations, 'whyNowEvidenceIds', true) ? modelWhyNow : null;
  const triggers: string[] = [];
  for (const [index, candidate] of array(output.triggers, 'triggers', 8).entries()) {
    const row = object(candidate, `triggers[${index}]`);
    const text = string(row.text, `triggers[${index}].text`) as string;
    const cited = citations(row.evidenceIds, `triggers[${index}].evidenceIds`, true);
    if (cited && claims.some(claim => cited.some(id => claim.evidenceIds.includes(id)) && isGroundedClaim(text, claim.claim))) triggers.push(text);
    else warnings.push('unsupported_trigger_discarded');
  }
  const risks: string[] = [];
  for (const [index, candidate] of array(output.risks, 'risks', 8).entries()) {
    const row = object(candidate, `risks[${index}]`);
    const text = string(row.text, `risks[${index}].text`) as string;
    if (row.kind !== 'FACTUAL' && row.kind !== 'ANALYTICAL') throw new InvalidResearchOutput(`risks[${index}].kind is invalid`);
    const cited = citations(row.evidenceIds, `risks[${index}].evidenceIds`);
    if (!cited) continue;
    if (row.kind === 'FACTUAL' && !claims.some(claim => cited.some(id => claim.evidenceIds.includes(id)) && isGroundedClaim(text, claim.claim))) {
      warnings.push('unsupported_factual_risk_discarded');
      continue;
    }
    risks.push(`${row.kind === 'FACTUAL' ? 'FACT' : 'ANALYSIS'}: ${text}`);
  }

  const rawBand = output.potentialValueBand;
  if (rawBand !== null && !Object.values(ProspectValueBand).includes(rawBand as ProspectValueBand)) throw new InvalidResearchOutput('potentialValueBand is invalid');
  const suppliedValueIds = ids(output.valueEvidenceIds, 'valueEvidenceIds');
  const valueCitations = rawBand ? citations(suppliedValueIds, 'valueEvidenceIds') : null;
  if (!('estimatedValueAmount' in output) || !('estimatedValueCurrency' in output)) throw new InvalidResearchOutput('exact value fields must be present as null');
  const potentialValueBand = valueCitations?.some(id => evidenceById.get(id)?.substantive) ? rawBand as ProspectValueBand : null;
  if (output.estimatedValueAmount !== null || output.estimatedValueCurrency !== null) {
    warnings.push('unsupported_exact_value_discarded');
  }
  const confidenceScore = confidence(output.confidenceScore);
  const patch: IntelligencePatch = {
    fitScore, fitTier: fitScore === null ? null : tier(fitScore),
    potentialValueBand,
    estimatedValueAmount: null, estimatedValueCurrency: null,
    whyFit, whyNow, triggers, risks, confidenceScore,
    lastEditedBy: ProspectIntelligenceEditor.SYSTEM,
  };
  // Run Phase 1B's domain validation before touching persistence.
  validateIntelligencePatch(patch);
  const persisted: EvidenceInput[] = [];
  const seen = new Set<string>();
  for (const supported of claims) {
    for (const id of supported.evidenceIds) {
      const source = evidenceById.get(id)!;
      if (!isGroundedClaim(supported.claim, source.content)) continue;
      if (source.persistedUserEvidenceId && supported.claim.toLowerCase() === source.content.toLowerCase()) continue;
      const key = `${id}\0${supported.claim.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const evidence: EvidenceInput = {
        evidenceType: source.evidenceType,
        sourceTitle: source.sourceTitle,
        sourceUrl: source.sourceUrl,
        claim: supported.claim,
        confidenceScore,
        isUserProvided: false,
        capturedAt: new Date(source.capturedAt),
      };
      validateEvidence(evidence);
      persisted.push(evidence);
    }
  }
  const sufficient = Boolean(hasSubstantiveClaim && confidenceScore !== null && confidenceScore >= 60 && whyFit && fitScore !== null);
  return { patch, evidence: persisted, warnings, sufficient };
}

async function currentResult(db: PrismaClient, scope: Scope, warnings: string[], reused = false): Promise<Result> {
  const intelligence = await db.prospectIntelligence.findUnique({ where: { userId_prospectId: scope } });
  if (!intelligence) throw new ProspectIntelligenceNotFound();
  const evidenceCount = await db.prospectEvidence.count({ where: { userId: scope.userId, prospectIntelligenceId: intelligence.id } });
  return { status: intelligence.researchStatus, intelligence, evidenceCount, warnings, reused };
}

async function acquireLease(db: PrismaClient, scope: Scope, existing: ProspectIntelligence | null): Promise<ProspectIntelligence | null> {
  const stale = new Date(Date.now() - LEASE_MS);
  if (existing) {
    const changed = await db.prospectIntelligence.updateMany({
      where: { id: existing.id, ...scope, OR: [
        { researchStatus: { not: ProspectResearchStatus.RESEARCHING } },
        { updatedAt: { lt: stale } },
      ] },
      data: { researchStatus: ProspectResearchStatus.RESEARCHING },
    });
    if (!changed.count) return null;
    return db.prospectIntelligence.findUnique({ where: { userId_prospectId: scope } });
  }
  try {
    return await db.prospectIntelligence.create({ data: { ...scope, researchStatus: ProspectResearchStatus.RESEARCHING } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

export async function researchProspectICP(
  input: Input,
  dependencies: { db?: PrismaClient; provider?: ResearchProvider; qualify?: typeof qualifyProspect;
    recordUsage?: typeof recordAIUsage; attachCompany?: typeof attachCompanyToProspect;
    researchCompany?: typeof getOrResearchCompany } = {},
): Promise<Result | GateResult> {
  const db = dependencies.db || prisma;
  const provider = dependencies.provider || geminiResearchProvider;
  if (!input.userId?.trim() || !input.prospectId?.trim()) throw new TypeError('Authenticated userId and prospectId are required');
  const scope = { userId: input.userId.trim(), prospectId: input.prospectId.trim() };
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } } });
  if (!prospect) throw new ProspectIntelligenceNotFound();
  const existing = await db.prospectIntelligence.findUnique({ where: { userId_prospectId: scope } });
  if (existing?.researchStatus === ProspectResearchStatus.READY && !input.forceRefresh) return currentResult(db, scope, [], true);
  if (existing?.researchStatus === ProspectResearchStatus.RESEARCHING && existing.updatedAt > new Date(Date.now() - LEASE_MS)) {
    return currentResult(db, scope, ['research_already_in_progress'], true);
  }
  if (input.overrideQualification) {
    console.warn('[SCOUT_QUALIFICATION_OVERRIDE]', { userId: scope.userId, prospectId: scope.prospectId });
  } else {
    const qualification = await (dependencies.qualify || qualifyProspect)(scope, db);
    if (qualification.status !== 'QUALIFIED') return {
      status: qualification.status === 'REJECTED' ? 'NOT_ELIGIBLE' : 'QUALIFICATION_REQUIRED',
      intelligence: null, evidenceCount: 0,
      warnings: [qualification.qualificationReason], reused: false,
    };
  }
  const lease = await acquireLease(db, scope, existing);
  if (!lease) return currentResult(db, scope, ['research_already_in_progress'], true);

  try {
    const sources = await collectProspectEvidence(db, prospect, lease.id);
    const profile = await db.iCPProfile.findUnique({ where: { userId: scope.userId } });
    const company = profile ? await (dependencies.attachCompany || attachCompanyToProspect)(db, prospect) : null;
    let shared: Awaited<ReturnType<typeof getOrResearchCompany>> = null;
    if (company && profile) {
      try {
        shared = await (dependencies.researchCompany || getOrResearchCompany)({ db, company, profile, provider,
          recordUsage: dependencies.recordUsage, refreshCompany: input.refreshCompany, validate: validateResearchOutput,
        });
      } catch (error) {
        // A failed shared analysis must not make otherwise eligible prospect research lower quality.
        // Keep the lease contention path closed to avoid a stampede of full company calls.
        if (error instanceof AIUsageRecordingError || error instanceof Error &&
          (error.message.includes('still in progress') || error.message.includes('another request'))) throw error;
        console.warn('[SCOUT_COMPANY_CACHE_FALLBACK]', { userId: scope.userId, companyId: company.id, error });
      }
    }
    const personSources = sources.filter(source => source.evidenceId.startsWith('user:') || source.evidenceId.startsWith('lead:'));
    const hasPersonContext = personSources.some(source => source.substantive);
    const titleMatches = Boolean(!input.overrideQualification && profile?.targetTitles.length && prospect.jobTitle &&
      profile.targetTitles.some(title => title.toLowerCase().replace(/\s+/g, ' ').trim() === prospect.jobTitle!.toLowerCase().replace(/\s+/g, ' ').trim()));
    if (shared && !hasPersonContext && titleMatches) {
      const { intelligence: companyIntel } = shared;
      const whyFit = `${companyIntel.whyCompanyFits} Known role ${prospect.jobTitle} matches the configured ICP title.`;
      const changed = await db.$transaction(async tx => {
        const updated = await tx.prospectIntelligence.updateMany({
        where: { id: lease.id, ...scope, researchStatus: ProspectResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
        data: validateIntelligencePatch({
          fitScore: companyIntel.fitScore, fitTier: companyIntel.fitTier,
          potentialValueBand: companyIntel.valueBand, estimatedValueAmount: null, estimatedValueCurrency: null,
          whyFit, whyNow: companyIntel.whyCompanyNow, triggers: companyIntel.triggers, risks: companyIntel.risks,
          confidenceScore: companyIntel.confidenceScore, lastEditedBy: ProspectIntelligenceEditor.SYSTEM,
          researchStatus: ProspectResearchStatus.READY, researchResultCommitted: true,
        }),
        });
        if (updated.count) await tx.prospectEvidence.deleteMany({ where: { userId: scope.userId, prospectIntelligenceId: lease.id, isUserProvided: false } });
        return updated;
      });
      if (!changed.count) return currentResult(db, scope, ['research_lease_lost'], true);
      return currentResult(db, scope, shared.reused ? ['company_intelligence_reused'] : ['company_intelligence_updated']);
    }
    if (!shared && !sources.some(source => source.substantive)) {
      await db.prospectIntelligence.updateMany({
        where: { id: lease.id, ...scope, researchStatus: ProspectResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
        data: { researchStatus: ProspectResearchStatus.NEEDS_REVIEW },
      });
      return currentResult(db, scope, ['insufficient_evidence']);
    }
    const companyFacts: ResearchEvidence[] = shared ? (await db.companyEvidence.findMany({
      where: { userId: scope.userId, companyId: company!.id }, take: 8,
    })).map(row => ({ evidenceId: `companyfact:${row.id}`, evidenceType: row.evidenceType,
      sourceTitle: row.sourceTitle, sourceUrl: row.sourceUrl, content: row.claim,
      capturedAt: row.capturedAt.toISOString(), timingEligible: false, substantive: true,
    })) : [];
    const analysisSources = shared ? [...companyFacts, ...personSources].slice(0, 12) : sources;
    const systemInstruction = shared
      ? `${ICP_SYSTEM_PROMPT}\nA validated company assessment is available as ANALYSIS, not factual evidence: ${shared.intelligence.whyCompanyFits}. Assess this person's fit using the compact cited company facts and person-specific evidence. Do not infer person facts from company facts.`
      : ICP_SYSTEM_PROMPT;
    const modelOutput = await analyzeScoutWithUsage({ db, provider,
      request: { systemInstruction, evidence: analysisSources },
      ...scope, companyKey: company?.normalizedDomain || undefined,
      operation: shared ? AIOperation.SCOUT_PROSPECT_DELTA : AIOperation.ICP_ANALYSIS,
      recordUsage: dependencies.recordUsage,
    });
    const assessment = validateResearchOutput(modelOutput, analysisSources);
    const status = assessment.sufficient ? ProspectResearchStatus.READY : ProspectResearchStatus.NEEDS_REVIEW;
    const committed = await db.$transaction(async tx => {
      const changed = await tx.prospectIntelligence.updateMany({
        where: { id: lease.id, ...scope, researchStatus: ProspectResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
        data: validateIntelligencePatch({ ...assessment.patch, researchStatus: status, researchResultCommitted: true }),
      });
      if (!changed.count) return false;
      await tx.prospectEvidence.deleteMany({ where: { userId: scope.userId, prospectIntelligenceId: lease.id, isUserProvided: false } });
      const personEvidence = shared ? assessment.evidence.filter(row => row.sourceTitle !== 'Stored company fact') : assessment.evidence;
      if (personEvidence.length) await tx.prospectEvidence.createMany({
        data: personEvidence.map(row => ({ ...validateEvidence(row), userId: scope.userId, prospectIntelligenceId: lease.id })),
      });
      return true;
    });
    if (!committed) return currentResult(db, scope, ['research_lease_lost'], true);
    return currentResult(db, scope, assessment.warnings);
  } catch (error) {
    console.error('[SCOUT] Prospect research failed:', { userId: scope.userId, prospectId: scope.prospectId, error });
    const warnings = [error instanceof InvalidResearchOutput || error instanceof SyntaxError ? 'invalid_model_output' : 'research_failed'];
    await db.prospectIntelligence.updateMany({
      where: { id: lease.id, ...scope, researchStatus: ProspectResearchStatus.RESEARCHING, updatedAt: lease.updatedAt },
      data: { researchStatus: ProspectResearchStatus.FAILED },
    });
    return currentResult(db, scope, warnings);
  }
}
