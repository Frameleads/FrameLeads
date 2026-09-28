import {
  Prisma,
  ProspectEvidenceType,
  ProspectFitTier,
  ProspectIntelligenceEditor,
  ProspectResearchStatus,
  ProspectValueBand,
  type PrismaClient,
} from '@prisma/client';

export class ProspectIntelligenceNotFound extends Error {
  constructor() { super('Prospect or intelligence record not found for this user.'); }
}

type Scope = { userId: string; prospectId: string };
export type IntelligencePatch = {
  fitScore?: number | null;
  fitTier?: ProspectFitTier | null;
  potentialValueBand?: ProspectValueBand | null;
  estimatedValueAmount?: Prisma.Decimal.Value | null;
  estimatedValueCurrency?: string | null;
  whyFit?: string | null;
  whyNow?: string | null;
  triggers?: string[];
  risks?: string[];
  confidenceScore?: number | null;
  researchStatus?: ProspectResearchStatus;
  lastEditedBy?: ProspectIntelligenceEditor;
  /** Explicit acknowledgement that a research result was committed; sets researchedAt to server time. */
  researchResultCommitted?: boolean;
};
export type EvidenceInput = {
  evidenceType: ProspectEvidenceType;
  sourceTitle: string;
  sourceUrl?: string | null;
  claim: string;
  confidenceScore?: number | null;
  isUserProvided?: boolean;
  capturedAt?: Date;
};

function requiredId(value: string, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`);
  return value.trim();
}

function score(value: number | null | undefined, label: string): number | null | undefined {
  if (value == null) return value;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${label} must be an integer from 0 to 100 or null`);
  }
  return value;
}

function enumValue<T extends string>(value: T | null | undefined, allowed: readonly string[], label: string): T | null | undefined {
  if (value != null && !allowed.includes(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

function text(value: string | null | undefined, label: string, required = false): string | null | undefined {
  if (value == null) {
    if (required) throw new TypeError(`${label} is required`);
    return value;
  }
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new TypeError(`${label} cannot be blank`);
  return trimmed || null;
}

function phrases(values: string[] | undefined, label: string): string[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new TypeError(`${label} must be a string array`);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') throw new TypeError(`${label} must contain strings`);
    const clean = item.trim();
    const key = clean.toLocaleLowerCase('en-US');
    if (clean && !seen.has(key)) { result.push(clean); seen.add(key); }
  }
  return result;
}

function amount(value: Prisma.Decimal.Value | null | undefined): Prisma.Decimal | null | undefined {
  if (value == null) return value;
  let parsed: Prisma.Decimal;
  try { parsed = new Prisma.Decimal(value); }
  catch { throw new RangeError('estimatedValueAmount must be a finite, non-negative amount'); }
  if (!parsed.isFinite() || parsed.isNegative() || parsed.decimalPlaces() > 2 || parsed.greaterThan('9999999999999999.99')) {
    throw new RangeError('estimatedValueAmount must be non-negative and fit Decimal(18,2)');
  }
  return parsed;
}

function currency(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  if (typeof value !== 'string') throw new TypeError('estimatedValueCurrency must be a currency code');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new TypeError('estimatedValueCurrency must be a three-letter currency code');
  return code;
}

export function validateIntelligencePatch(patch: IntelligencePatch): Prisma.ProspectIntelligenceUncheckedUpdateInput {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('Intelligence patch is required');
  if (patch.researchResultCommitted && patch.researchStatus !== ProspectResearchStatus.READY && patch.researchStatus !== ProspectResearchStatus.NEEDS_REVIEW) {
    throw new TypeError('Committed research requires READY or NEEDS_REVIEW status');
  }
  const data = {
    fitScore: score(patch.fitScore, 'fitScore'),
    fitTier: enumValue(patch.fitTier, Object.values(ProspectFitTier), 'fitTier'),
    potentialValueBand: enumValue(patch.potentialValueBand, Object.values(ProspectValueBand), 'potentialValueBand'),
    estimatedValueAmount: amount(patch.estimatedValueAmount),
    estimatedValueCurrency: currency(patch.estimatedValueCurrency),
    whyFit: text(patch.whyFit, 'whyFit'),
    whyNow: text(patch.whyNow, 'whyNow'),
    triggers: phrases(patch.triggers, 'triggers'),
    risks: phrases(patch.risks, 'risks'),
    confidenceScore: score(patch.confidenceScore, 'confidenceScore'),
    researchStatus: enumValue(patch.researchStatus, Object.values(ProspectResearchStatus), 'researchStatus'),
    lastEditedBy: enumValue(patch.lastEditedBy, Object.values(ProspectIntelligenceEditor), 'lastEditedBy'),
    researchedAt: patch.researchResultCommitted ? new Date() : undefined,
  };
  if ('researchStatus' in patch && !data.researchStatus) throw new TypeError('researchStatus cannot be null');
  if ('lastEditedBy' in patch && !data.lastEditedBy) throw new TypeError('lastEditedBy cannot be null');
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Prisma.ProspectIntelligenceUncheckedUpdateInput;
}

export function validateEvidence(input: EvidenceInput): Omit<Prisma.ProspectEvidenceCreateManyInput, 'userId' | 'prospectIntelligenceId'> {
  if (!input || typeof input !== 'object') throw new TypeError('Evidence is required');
  if (input.isUserProvided !== undefined && typeof input.isUserProvided !== 'boolean') throw new TypeError('isUserProvided must be boolean');
  if (input.capturedAt !== undefined && (!(input.capturedAt instanceof Date) || !Number.isFinite(input.capturedAt.getTime()))) {
    throw new TypeError('capturedAt must be a valid Date');
  }
  const sourceTitle = text(input.sourceTitle, 'sourceTitle', true)!;
  const claim = text(input.claim, 'claim', true)!;
  const sourceUrl = text(input.sourceUrl, 'sourceUrl');
  if (sourceUrl) {
    let url: URL;
    try { url = new URL(sourceUrl); } catch { throw new TypeError('sourceUrl must be a valid HTTP(S) URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new TypeError('sourceUrl must be a valid HTTP(S) URL');
    }
  }
  const evidenceType = enumValue(input.evidenceType, Object.values(ProspectEvidenceType), 'evidenceType');
  if (!evidenceType) throw new TypeError('evidenceType is required');
  return {
    evidenceType,
    sourceTitle, sourceUrl, claim,
    confidenceScore: score(input.confidenceScore, 'evidence confidenceScore'),
    isUserProvided: input.isUserProvided ?? false,
    capturedAt: input.capturedAt,
  };
}

async function requireProspect(tx: Prisma.TransactionClient, scope: Scope) {
  const prospect = await tx.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } } });
  if (!prospect) throw new ProspectIntelligenceNotFound();
}

async function requireIntelligence(tx: Prisma.TransactionClient, scope: Scope) {
  const intelligence = await tx.prospectIntelligence.findUnique({ where: { userId_prospectId: scope } });
  if (!intelligence) throw new ProspectIntelligenceNotFound();
  return intelligence;
}

export async function getProspectIntelligence(db: PrismaClient, scope: Scope) {
  scope = { userId: requiredId(scope.userId, 'userId'), prospectId: requiredId(scope.prospectId, 'prospectId') };
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } } });
  if (!prospect) throw new ProspectIntelligenceNotFound();
  return db.prospectIntelligence.findUnique({
    where: { userId_prospectId: scope },
    include: { evidence: { orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }] } },
  });
}

export async function upsertProspectIntelligence(db: PrismaClient, scope: Scope, patch: IntelligencePatch) {
  scope = { userId: requiredId(scope.userId, 'userId'), prospectId: requiredId(scope.prospectId, 'prospectId') };
  const data = validateIntelligencePatch(patch);
  return db.$transaction(async tx => {
    await requireProspect(tx, scope);
    return tx.prospectIntelligence.upsert({
      where: { userId_prospectId: scope },
      create: { ...scope, ...data } as Prisma.ProspectIntelligenceUncheckedCreateInput,
      update: data,
    });
  });
}

export async function addProspectEvidence(db: PrismaClient, scope: Scope, input: EvidenceInput) {
  scope = { userId: requiredId(scope.userId, 'userId'), prospectId: requiredId(scope.prospectId, 'prospectId') };
  const data = validateEvidence(input);
  return db.$transaction(async tx => {
    const intelligence = await requireIntelligence(tx, scope);
    return tx.prospectEvidence.create({ data: { ...data, userId: scope.userId, prospectIntelligenceId: intelligence.id } });
  });
}

export async function replaceProspectEvidence(db: PrismaClient, scope: Scope, inputs: EvidenceInput[]) {
  scope = { userId: requiredId(scope.userId, 'userId'), prospectId: requiredId(scope.prospectId, 'prospectId') };
  if (!Array.isArray(inputs)) throw new TypeError('Evidence replacement must be an array');
  const data = inputs.map(validateEvidence);
  return db.$transaction(async tx => {
    const intelligence = await requireIntelligence(tx, scope);
    await tx.prospectEvidence.deleteMany({ where: { userId: scope.userId, prospectIntelligenceId: intelligence.id } });
    if (data.length) await tx.prospectEvidence.createMany({
      data: data.map(evidence => ({ ...evidence, userId: scope.userId, prospectIntelligenceId: intelligence.id })),
    });
    return tx.prospectEvidence.findMany({ where: { userId: scope.userId, prospectIntelligenceId: intelligence.id }, orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }] });
  });
}
