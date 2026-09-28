import { ICPQualificationPolicy, LeadSourceType, Prisma, ProspectQualificationStatus, QualificationOverride, QualificationReasonCode, type ICPProfile, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeWebsiteDomain } from './normalization';
import { normalizeCountry, parseCompanySize } from './metadata';
import { ProspectIntelligenceNotFound } from './intelligence';
import { MEMORY_EVENT, recordProspectMemoryEvent } from './memory';
import { identityTransaction } from './identity';

export type QualificationContext = {
  websiteUrl: string | null;
  incidentDetails: string[];
  jobTitle?: string | null;
  industry?: string | null;
  country?: string | null;
  location?: string | null;
  companySizeMin?: number | null;
  companySizeMax?: number | null;
  sourceType?: LeadSourceType;
};
export type QualificationDecision = {
  status: ProspectQualificationStatus;
  reasonCode: QualificationReasonCode;
  matchedCriteria: string[];
  failedCriteria: string[];
  missingCriteria: string[];
  qualificationReason: string;
};

const LIST_FIELDS = [
  'targetTitles', 'targetSeniorities', 'targetIndustries', 'targetGeographies',
  'excludedTitles', 'excludedIndustries', 'excludedDomains', 'requiredKeywords', 'excludedKeywords',
] as const;
type ListField = (typeof LIST_FIELDS)[number];
const POLICY_VERSION = 1;
export type ICPProfileInput = Partial<Pick<ICPProfile, ListField | 'name' | 'isActive' | 'companySizeMin' | 'companySizeMax' | 'qualificationPolicy'>>;

const normalize = (value: string) => value.normalize('NFC').toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
const normalizeTitle = (value: string) => normalize(value).replace(/\bvice president(?: of)?\b/g, 'vp').replace(/\bchief revenue officer\b/g, 'cro');
const equals = (a: string, b: string, title = false) => (title ? normalizeTitle(a) : normalize(a)) === (title ? normalizeTitle(b) : normalize(b));
const containsPhrase = (text: string, phrase: string) => {
  const haystack = ` ${normalize(text)} `;
  const needle = ` ${normalize(phrase)} `;
  return needle.trim().length > 0 && haystack.includes(needle);
};

/** Only explicitly labeled stored lead context is treated as a factual attribute. Campaign targetGroup is not a person's actual title. */
function fact(details: string[], label: string): string | null {
  const values = details.flatMap(text => [...text.matchAll(new RegExp(`(?:^|\\n)\\s*(?:${label})\\s*:\\s*([^\\r\\n;]+)`, 'gi'))].map(match => match[1].trim()))
    .filter(Boolean);
  const unique = [...new Set(values.map(normalize))];
  return unique.length === 1 ? values[0] : null;
}

export function evaluateICP(profile: ICPProfile, context: QualificationContext): QualificationDecision {
  const matchedCriteria: string[] = [];
  const failedCriteria: string[] = [];
  const missingCriteria: string[] = [];
  const result = (status: ProspectQualificationStatus, reasonCode: QualificationReasonCode, reason: string): QualificationDecision => ({ status, reasonCode, matchedCriteria, failedCriteria, missingCriteria, qualificationReason: reason });
  if (!profile.isActive) return result(ProspectQualificationStatus.NEEDS_REVIEW, QualificationReasonCode.INACTIVE, 'ICP profile is inactive.');
  const domain = normalizeWebsiteDomain(context.websiteUrl);
  const title = context.jobTitle || fact(context.incidentDetails, 'title');
  const industry = context.industry || fact(context.incidentDetails, 'industry');
  const country = context.country || fact(context.incidentDetails, 'country');
  const location = context.location || fact(context.incidentDetails, 'geography|location');
  const seniority = fact(context.incidentDetails, 'seniority');
  const size = context.companySizeMin != null || context.companySizeMax != null
    ? { companySizeMin: context.companySizeMin ?? null, companySizeMax: context.companySizeMax ?? null }
    : parseCompanySize(fact(context.incidentDetails, 'company size|headcount|employees'));
  const geographyMatches = (value: string) => [country, location].some(known => known && equals(normalizeCountry(known) || known, normalizeCountry(value) || value));
  // Free-form notes can mention a term in a negation or a hypothetical. Only explicit keyword labels prove a keyword rule.
  const keywordText = fact(context.incidentDetails, 'keywords?') || '';
  const reject = (criterion: string, reason: string) => { failedCriteria.push(criterion); return result(ProspectQualificationStatus.REJECTED, QualificationReasonCode.EXCLUDED, reason); };

  if (domain && profile.excludedDomains.some(value => {
    const excluded = normalizeWebsiteDomain(value);
    return excluded && (domain === excluded || domain.endsWith(`.${excluded}`));
  })) return reject('excludedDomain', `Company domain ${domain} is in your excluded-domain list.`);
  if (title && profile.excludedTitles.some(value => equals(title, value, true))) return reject('excludedTitle', `Known title ${title} is in your excluded-title list.`);
  if (industry && profile.excludedIndustries.some(value => equals(industry, value))) return reject('excludedIndustry', `Known industry ${industry} is in your excluded-industry list.`);
  if (profile.excludedKeywords.some(value => containsPhrase(keywordText, value))) return reject('excludedKeyword', 'An explicitly supplied keyword is in your excluded-keyword list.');

  let strongMismatches = 0;
  let ambiguous = false;
  const mismatch = (name: string, actual: string, targets: string[], strong = false) => {
    failedCriteria.push(name);
    if (strong) strongMismatches++;
    const label = ({ targetTitle: 'Title', targetIndustry: 'Industry', targetGeography: 'Geography', targetSeniority: 'Seniority', companySize: 'Company size' } as Record<string, string>)[name] || name;
    return `${label}: known ${actual}; target ${targets.slice(0, 5).join(', ')}${targets.length > 5 ? ', …' : ''}`;
  };
  const mismatchReasons: string[] = [];

  const criterion = (name: string, configured: boolean, actual: string | null, allowed: string[], titleMatch = false) => {
    if (!configured) return;
    if (!actual) missingCriteria.push(name);
    else if (allowed.some(value => equals(actual, value, titleMatch))) matchedCriteria.push(name);
    else mismatchReasons.push(mismatch(name, actual, allowed, name === 'targetIndustry'));
  };
  criterion('targetTitle', profile.targetTitles.length > 0, title, profile.targetTitles, true);
  criterion('targetSeniority', profile.targetSeniorities.length > 0, seniority, profile.targetSeniorities);
  criterion('targetIndustry', profile.targetIndustries.length > 0, industry, profile.targetIndustries);
  if (profile.targetGeographies.length) {
    if (profile.targetGeographies.some(geographyMatches)) matchedCriteria.push('targetGeography');
    else if (country) mismatchReasons.push(mismatch('targetGeography', country, profile.targetGeographies, true));
    else missingCriteria.push('targetGeography');
  }
  if (profile.companySizeMin !== null || profile.companySizeMax !== null) {
    if (!size) missingCriteria.push('companySize');
    else if ((profile.companySizeMin === null || size.companySizeMin !== null && size.companySizeMin >= profile.companySizeMin) &&
      (profile.companySizeMax === null || size.companySizeMax !== null && size.companySizeMax <= profile.companySizeMax)) matchedCriteria.push('companySize');
    else if (size.companySizeMax !== null && profile.companySizeMin !== null && size.companySizeMax < profile.companySizeMin ||
      size.companySizeMin !== null && profile.companySizeMax !== null && size.companySizeMin > profile.companySizeMax) {
      mismatchReasons.push(mismatch('companySize', `${size.companySizeMin ?? '?'}–${size.companySizeMax ?? '+'}`, [`${profile.companySizeMin ?? '0'}–${profile.companySizeMax ?? '+'}`], true));
    } else { missingCriteria.push('companySize'); ambiguous = true; } // Overlap proves neither fit nor non-fit.
  }
  for (const keyword of profile.requiredKeywords) {
    if (containsPhrase(keywordText, keyword)) matchedCriteria.push(`requiredKeyword:${keyword}`);
    else missingCriteria.push(`requiredKeyword:${keyword}`); // Absence in incomplete notes cannot prove a negative.
  }
  const configured = LIST_FIELDS.some(field => profile[field].length > 0) || profile.companySizeMin !== null || profile.companySizeMax !== null;
  if (!configured) return result(ProspectQualificationStatus.NEEDS_REVIEW, QualificationReasonCode.NO_RULES, 'No meaningful ICP rules are configured.');
  if (missingCriteria.length) return result(ProspectQualificationStatus.NEEDS_REVIEW, ambiguous ? QualificationReasonCode.AMBIGUOUS : QualificationReasonCode.MISSING_DATA,
    `${ambiguous ? 'Company-size range overlaps the target boundary. ' : ''}More information needed: ${missingCriteria.map(value => ({ targetTitle: 'title', targetIndustry: 'industry', targetGeography: 'geography', targetSeniority: 'seniority', companySize: 'company size' } as Record<string, string>)[value] || value).join(', ')}.${mismatchReasons.length ? ` Known ICP conflicts: ${mismatchReasons.join('; ')}.` : ''}`);
  if (failedCriteria.length) {
    const policy = profile.qualificationPolicy || ICPQualificationPolicy.CONSERVATIVE;
    const source = context.sourceType || LeadSourceType.UNKNOWN;
    const balancedLimit = source === LeadSourceType.USER_CURATED ? 3 : 2;
    const status = policy === ICPQualificationPolicy.STRICT || policy === ICPQualificationPolicy.BALANCED && strongMismatches >= balancedLimit
      ? ProspectQualificationStatus.REJECTED : ProspectQualificationStatus.NEEDS_REVIEW;
    return result(status, QualificationReasonCode.TARGET_MISMATCH, `ICP conflict: ${mismatchReasons.join('; ')}. ${status === ProspectQualificationStatus.NEEDS_REVIEW ? 'Review this customer-selected prospect before research.' : 'Rejected under the selected ICP policy.'}`);
  }
  if (!matchedCriteria.length) return result(ProspectQualificationStatus.NEEDS_REVIEW, QualificationReasonCode.MISSING_DATA, 'More information is needed to establish an ICP match.');
  return result(ProspectQualificationStatus.QUALIFIED, QualificationReasonCode.NONE, 'Known facts satisfy the configured ICP criteria.');
}

export function validateICPProfile(input: ICPProfileInput): ICPProfileInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('ICP profile object required');
  const clean: ICPProfileInput = {};
  for (const field of LIST_FIELDS) {
    if (input[field] === undefined) continue;
    if (!Array.isArray(input[field]) || input[field].length > 100 || input[field].some(value => typeof value !== 'string' || value.length > 120)) throw new TypeError(`Invalid ${field}`);
    clean[field] = [...new Set(input[field].map(value => value.trim()).filter(Boolean))];
  }
  if (input.excludedDomains !== undefined && clean.excludedDomains?.some(value => !normalizeWebsiteDomain(value))) throw new TypeError('Invalid excluded domain');
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new TypeError('Invalid ICP name');
    clean.name = input.name.trim();
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== 'boolean') throw new TypeError('Invalid active state');
    clean.isActive = input.isActive;
  }
  if (input.qualificationPolicy !== undefined) {
    if (!Object.values(ICPQualificationPolicy).includes(input.qualificationPolicy)) throw new TypeError('Invalid qualification policy');
    clean.qualificationPolicy = input.qualificationPolicy;
  }
  for (const field of ['companySizeMin', 'companySizeMax'] as const) {
    const value = input[field];
    if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0 || value > 100_000_000)) throw new TypeError(`Invalid ${field}`);
    if (value !== undefined) clean[field] = value;
  }
  if (clean.companySizeMin !== undefined && clean.companySizeMax !== undefined && clean.companySizeMin !== null && clean.companySizeMax !== null && clean.companySizeMin > clean.companySizeMax) throw new TypeError('Company size range is inverted');
  return clean;
}

function sourceType(leads: { list: { userId: string; sourceType: LeadSourceType } | null }[], userId: string): LeadSourceType {
  const known = leads.map(lead => lead.list?.userId === userId ? lead.list.sourceType : LeadSourceType.UNKNOWN);
  if (known.includes(LeadSourceType.USER_CURATED)) return LeadSourceType.USER_CURATED;
  if (!known.length || known.includes(LeadSourceType.UNKNOWN)) return LeadSourceType.UNKNOWN;
  if (known.every(value => value === LeadSourceType.FRAMELEADS_QUALIFIED)) return LeadSourceType.FRAMELEADS_QUALIFIED;
  return LeadSourceType.BROAD_POOL;
}

async function persistAutomaticQualification(db: PrismaClient, scope: { userId: string; prospectId: string }, profile: ICPProfile, decision: QualificationDecision) {
  const work = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.prospectQualification.findUnique({ where: { userId_prospectId: scope } });
    if (existing?.override !== undefined && existing.override !== QualificationOverride.AUTO) return existing;
    const data = { ...decision, icpProfileId: profile.id, profileUpdatedAt: profile.updatedAt, policyVersion: POLICY_VERSION, evaluatedAt: new Date() };
    const current = existing
      ? await (async () => {
          await tx.prospectQualification.updateMany({ where: { ...scope, override: QualificationOverride.AUTO }, data });
          return tx.prospectQualification.findUnique({ where: { userId_prospectId: scope } });
        })()
      : await tx.prospectQualification.create({ data: { ...scope, ...data } });
    if (!current) throw new Error('Qualification was concurrently removed');
    if (existing?.status !== current.status) await recordProspectMemoryEvent({ ...scope, eventType: MEMORY_EVENT.QUALIFICATION_CHANGED,
      sourceType: 'QUALIFICATION', sourceId: `${current.id}:${current.status}:${current.evaluatedAt?.toISOString() ?? data.evaluatedAt.toISOString()}`,
      description: `ICP qualification: ${current.status}. ${current.qualificationReason}` }, tx as unknown as PrismaClient);
    return current;
  };
  return '$transaction' in db ? identityTransaction(db, work) : work(db as unknown as Prisma.TransactionClient);
}

export async function setQualificationOverride(
  input: { userId: string; prospectId: string; override: QualificationOverride },
  db: PrismaClient = prisma,
) {
  if (!input.userId?.trim() || !input.prospectId?.trim() || !Object.values(QualificationOverride).includes(input.override)) throw new TypeError('Valid tenant, Prospect and override required');
  const scope = { userId: input.userId.trim(), prospectId: input.prospectId.trim() };
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } }, select: { id: true } });
  if (!prospect) throw new ProspectIntelligenceNotFound();
  if (input.override === QualificationOverride.AUTO) {
    return identityTransaction(db, async tx => {
      const previous = await tx.prospectQualification.findUnique({ where: { userId_prospectId: scope } });
      await tx.prospectQualification.updateMany({ where: scope, data: { override: QualificationOverride.AUTO, overriddenAt: null } });
      const result = await qualifyProspect(scope, tx as unknown as PrismaClient);
      if (previous && previous.override !== QualificationOverride.AUTO) await recordProspectMemoryEvent({ ...scope,
        eventType: MEMORY_EVENT.QUALIFICATION_OVERRIDE, sourceType: 'QUALIFICATION',
        sourceId: `${previous.id}:AUTO:${previous.overriddenAt?.toISOString() ?? 'legacy'}`,
        description: 'Human qualification override cleared; automatic qualification restored.', importance: 3 }, tx as unknown as PrismaClient);
      return result;
    });
  }
  return identityTransaction(db, async tx => {
    const profile = await tx.iCPProfile.upsert({ where: { userId: scope.userId }, create: { userId: scope.userId }, update: {} });
    const qualified = input.override === QualificationOverride.USER_QUALIFIED;
    const data = {
      status: qualified ? ProspectQualificationStatus.QUALIFIED : ProspectQualificationStatus.REJECTED,
      reasonCode: QualificationReasonCode.USER_OVERRIDE,
      qualificationReason: qualified ? 'User chose to keep and qualify this prospect.' : 'User chose to exclude this prospect.',
      override: input.override, overriddenAt: new Date(), policyVersion: POLICY_VERSION,
    };
    const previous = await tx.prospectQualification.findUnique({ where: { userId_prospectId: scope } });
    const updated = await tx.prospectQualification.upsert({
      where: { userId_prospectId: scope },
      create: { ...scope, icpProfileId: profile.id, profileUpdatedAt: profile.updatedAt, ...data },
      update: data,
    });
    if (previous?.override !== updated.override) await recordProspectMemoryEvent({ ...scope, eventType: MEMORY_EVENT.QUALIFICATION_OVERRIDE,
      sourceType: 'QUALIFICATION', sourceId: `${updated.id}:${updated.override}:${updated.overriddenAt?.toISOString() ?? 'auto'}`,
      description: `Human qualification override: ${updated.status}.`, importance: 3 }, tx as unknown as PrismaClient);
    return updated;
  });
}

export async function saveICPProfile(db: PrismaClient, userId: string, input: ICPProfileInput) {
  if (!userId?.trim()) throw new TypeError('Authenticated userId required');
  const data = validateICPProfile(input);
  const previous = await db.iCPProfile.findUnique({ where: { userId } });
  const min = data.companySizeMin === undefined ? previous?.companySizeMin ?? null : data.companySizeMin;
  const max = data.companySizeMax === undefined ? previous?.companySizeMax ?? null : data.companySizeMax;
  if (min !== null && max !== null && min > max) throw new TypeError('Company size range is inverted');
  return db.iCPProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function qualifyProspect(
  input: { userId: string; prospectId: string; icpProfileId?: string },
  db: PrismaClient = prisma,
) {
  if (!input.userId?.trim() || !input.prospectId?.trim()) throw new TypeError('Authenticated userId and prospectId required');
  const scope = { userId: input.userId.trim(), prospectId: input.prospectId.trim() };
  const prospect = await db.prospect.findUnique({ where: { userId_id: { userId: scope.userId, id: scope.prospectId } }, select: { id: true, updatedAt: true, websiteUrl: true, jobTitle: true, industry: true, country: true, location: true, companySizeMin: true, companySizeMax: true } });
  if (!prospect) throw new ProspectIntelligenceNotFound();
  let profile = await db.iCPProfile.findUnique({ where: { userId: scope.userId } });
  if (input.icpProfileId && profile?.id !== input.icpProfileId) throw new ProspectIntelligenceNotFound();
  if (!profile) profile = await db.iCPProfile.upsert({ where: { userId: scope.userId }, create: { userId: scope.userId }, update: {} });
  const existing = await db.prospectQualification.findUnique({ where: { userId_prospectId: scope } });
  if (existing?.override !== undefined && existing.override !== QualificationOverride.AUTO) return existing;
  const leads = await db.generatedLead.findMany({ where: { userId: scope.userId, prospectId: scope.prospectId }, orderBy: { createdAt: 'desc' }, take: 10, select: { incidentDetails: true, createdAt: true, list: { select: { userId: true, sourceType: true } } } });
  const source = sourceType(leads, scope.userId);
  if (source === LeadSourceType.FRAMELEADS_QUALIFIED && existing?.status === ProspectQualificationStatus.QUALIFIED && existing.policyVersion === POLICY_VERSION && existing.profileUpdatedAt >= profile.updatedAt && existing.evaluatedAt &&
    prospect.updatedAt <= existing.evaluatedAt && (!leads[0] || leads[0].createdAt <= existing.evaluatedAt)) return existing;
  const decision = evaluateICP(profile, { ...prospect, sourceType: source, incidentDetails: leads.map(lead => lead.incidentDetails?.slice(0, 2000)).filter((text): text is string => Boolean(text)) });
  return persistAutomaticQualification(db, scope, profile, decision);
}

/** Keyset pagination; omission selects unassessed or profile-stale records for this tenant. */
export async function qualifyProspectsBatch(
  input: { userId: string; prospectIds?: string[]; pageSize?: number; cursor?: string; maxPages?: number },
  db: PrismaClient = prisma,
) {
  if (!input.userId?.trim()) throw new TypeError('Authenticated userId required');
  const pageSize = Math.min(Math.max(input.pageSize ?? 100, 1), 250);
  const maxPages = input.maxPages === undefined ? Infinity : Math.min(Math.max(input.maxPages, 1), 100);
  const profile = await db.iCPProfile.upsert({ where: { userId: input.userId }, create: { userId: input.userId }, update: {} });
  const counts = { processed: 0, qualified: 0, rejected: 0, needsReview: 0 };
  let cursor: string | undefined = input.cursor;
  let pages = 0;
  do {
    const page = await db.prospect.findMany({
      where: { userId: input.userId, ...(input.prospectIds ? { id: { in: input.prospectIds } } : {
        OR: [{ qualification: null }, { qualification: { override: QualificationOverride.AUTO, OR: [{ profileUpdatedAt: { lt: profile.updatedAt } }, { policyVersion: { lt: POLICY_VERSION } }] } }],
      }) },
      orderBy: { id: 'asc' }, take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, websiteUrl: true, jobTitle: true, industry: true, country: true, location: true, companySizeMin: true, companySizeMax: true, generatedLeads: { orderBy: { createdAt: 'desc' }, take: 10, select: { incidentDetails: true, list: { select: { userId: true, sourceType: true } } } } },
    });
    if (!page.length) { cursor = undefined; break; }
    for (const prospect of page) {
      const decision = evaluateICP(profile, { ...prospect, sourceType: sourceType(prospect.generatedLeads, input.userId), incidentDetails: prospect.generatedLeads.map(lead => lead.incidentDetails?.slice(0, 2000)).filter((text): text is string => Boolean(text)) });
      const result = await persistAutomaticQualification(db, { userId: input.userId, prospectId: prospect.id }, profile, decision);
      counts.processed++;
      if (result.status === 'QUALIFIED') counts.qualified++;
      else if (result.status === 'REJECTED') counts.rejected++;
      else counts.needsReview++;
    }
    cursor = page[page.length - 1].id;
    pages++;
    if (page.length < pageSize) { cursor = undefined; break; }
    if (pages >= maxPages) break;
  } while (true);
  return { ...counts, nextCursor: cursor ?? null };
}
