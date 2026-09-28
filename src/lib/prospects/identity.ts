import { Prisma, type PrismaClient, type Prospect } from '@prisma/client';
import { buildFallbackIdentityKey, cleanText, normalizeEmail, normalizeLinkedInUrl, type IdentityInput } from './normalization';
import { cleanFactualText, normalizeCountry } from './metadata';
import { resolveCompanyInTransaction } from './company';

async function linkCompany(tx: Prisma.TransactionClient, prospect: Prospect): Promise<void> {
  if (prospect.companyId) {
    const linked = await tx.company.findUnique({ where: { userId_id: { userId: prospect.userId, id: prospect.companyId } } });
    if (linked) await resolveCompanyInTransaction(tx, {
      userId: prospect.userId, companyName: linked.name, websiteUrl: linked.websiteUrl,
      industry: prospect.industry, companySizeMin: prospect.companySizeMin, companySizeMax: prospect.companySizeMax,
    });
    return;
  }
  const company = await resolveCompanyInTransaction(tx, prospect);
  if (company) await tx.prospect.update({ where: { userId_id: { userId: prospect.userId, id: prospect.id } }, data: { companyId: company.id } });
}

export type Resolution =
  | { status: 'created' | 'resolved'; prospectId: string }
  | { status: 'insufficient_identity'; prospectId: null }
  | { status: 'conflict'; prospectId: null; reason: string; candidateIds: string[] };

export class ProspectIdentityConflict extends Error {
  constructor(public readonly resolution: Resolution) {
    super('Prospect identity conflict; existing identities were preserved.');
  }
}

/** Retry the WHOLE transaction, never a statement in an aborted transaction. No external effects in work. */
export async function identityTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code) || attempt === 3) throw error;
    }
  }
  throw new Error('Prospect transaction retry exhausted');
}

/** Internal transaction primitive. Call only inside identityTransaction (including backfills). */
export async function resolveProspectInTransaction(tx: Prisma.TransactionClient, input: IdentityInput): Promise<Resolution> {
  if (!input.userId?.trim()) throw new Error('Prospect requires a server-resolved userId');
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedLinkedInUrl = normalizeLinkedInUrl(input.linkedInUrl);
  const fallbackIdentityKey = buildFallbackIdentityKey(input);
  if (!normalizedEmail && !normalizedLinkedInUrl && !fallbackIdentityKey) return { status: 'insufficient_identity', prospectId: null };
  const emailMatch = normalizedEmail ? await tx.prospect.findUnique({ where: { userId_normalizedEmail: { userId: input.userId, normalizedEmail } } }) : null;
  const linkedInMatch = normalizedLinkedInUrl ? await tx.prospect.findUnique({ where: { userId_normalizedLinkedInUrl: { userId: input.userId, normalizedLinkedInUrl } } }) : null;
  const conflict = (reason: string, candidates: Prospect[]): Resolution => ({ status: 'conflict', prospectId: null, reason, candidateIds: candidates.map(p => p.id) });
  const incompatible = (p: Prospect) => Boolean(
    normalizedEmail && p.normalizedEmail && normalizedEmail !== p.normalizedEmail ||
    normalizedLinkedInUrl && p.normalizedLinkedInUrl && normalizedLinkedInUrl !== p.normalizedLinkedInUrl
  );
  if (emailMatch && linkedInMatch && emailMatch.id !== linkedInMatch.id) return conflict('email_linkedin_disagree', [emailMatch, linkedInMatch]);
  let match = emailMatch || linkedInMatch;
  if (match && incompatible(match)) return conflict('strong_identifier_mismatch', [match]);
  if (!match && fallbackIdentityKey) {
    const candidates = await tx.prospect.findMany({ where: { userId: input.userId, fallbackIdentityKey }, take: 3 });
    if (candidates.length > 1) return conflict('ambiguous_fallback', candidates);
    // Distinct strong identifiers are distinct candidates, even for identical names.
    if (candidates.length === 1 && !incompatible(candidates[0])) match = candidates[0];
  }
  const fields = {
    firstName: cleanText(input.firstName), lastName: cleanText(input.lastName),
    email: normalizedEmail ? cleanText(input.email) : null, normalizedEmail,
    linkedInUrl: normalizedLinkedInUrl ? cleanText(input.linkedInUrl) : null, normalizedLinkedInUrl,
    companyName: cleanText(input.companyName), websiteUrl: cleanText(input.websiteUrl), fallbackIdentityKey,
  };
  const metadata = {
    jobTitle: cleanFactualText(input.jobTitle), industry: cleanFactualText(input.industry),
    country: normalizeCountry(input.country), location: cleanFactualText(input.location),
    companySizeMin: input.companySizeMin ?? null, companySizeMax: input.companySizeMax ?? null,
  };
  for (const bound of [metadata.companySizeMin, metadata.companySizeMax]) {
    if (bound !== null && (!Number.isInteger(bound) || bound < 0 || bound > 100_000_000)) throw new TypeError('Invalid supplied company-size bound');
  }
  if (metadata.companySizeMin !== null && metadata.companySizeMax !== null && metadata.companySizeMin > metadata.companySizeMax) throw new TypeError('Invalid supplied company-size range');
  if (match) {
    // Derive a new fallback only from the fields actually retained after enrichment.
    fields.fallbackIdentityKey = buildFallbackIdentityKey({
      firstName: match.firstName || fields.firstName,
      lastName: match.lastName || fields.lastName,
      companyName: match.companyName || fields.companyName,
      websiteUrl: match.websiteUrl || fields.websiteUrl,
    });
    const data: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value && !match[key as keyof Prospect]) data[key] = value;
    }
    const conflicts: string[] = [];
    for (const key of ['jobTitle', 'industry', 'country', 'location'] as const) {
      const incoming = metadata[key];
      if (!incoming) continue;
      const old = match[key];
      if (!old) data[key] = incoming;
      else if (old.trim().toLowerCase() !== incoming.toLowerCase()) conflicts.push(key);
    }
    const hasIncomingSize = metadata.companySizeMin != null || metadata.companySizeMax != null;
    const hasExistingSize = match.companySizeMin != null || match.companySizeMax != null;
    if (hasIncomingSize && !hasExistingSize) {
      if (metadata.companySizeMin !== null) data.companySizeMin = metadata.companySizeMin;
      if (metadata.companySizeMax !== null) data.companySizeMax = metadata.companySizeMax;
    } else if (hasIncomingSize && hasExistingSize && (metadata.companySizeMin !== match.companySizeMin || metadata.companySizeMax !== match.companySizeMax)) conflicts.push('companySize');
    if (conflicts.length) console.warn('[PROSPECT_METADATA_CONFLICT]', { userId: input.userId, prospectId: match.id, fields: conflicts });
    const resolved = Object.keys(data).length ? await tx.prospect.update({ where: { userId_id: { userId: input.userId, id: match.id } }, data }) : match;
    await linkCompany(tx, resolved);
    return { status: 'resolved', prospectId: match.id };
  }
  const prospect = await tx.prospect.create({ data: { userId: input.userId, ...fields, ...metadata } });
  await linkCompany(tx, prospect);
  return { status: 'created', prospectId: prospect.id };
}

export function resolveOrCreateProspect(db: PrismaClient, input: IdentityInput): Promise<Resolution> {
  return identityTransaction(db, tx => resolveProspectInTransaction(tx, input));
}

export function attachableProspectId(result: Resolution, userId: string): string | null {
  if (result.status === 'conflict') {
    // No raw PII. Keep the source event with a null relationship for later reconciliation.
    console.warn('[PROSPECT_IDENTITY_CONFLICT]', { userId, reason: result.reason, candidateIds: result.candidateIds });
  }
  return result.prospectId;
}
