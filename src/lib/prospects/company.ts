import { Prisma, type Company, type PrismaClient, type Prospect } from '@prisma/client';
import { createHash } from 'node:crypto';
import { cleanText, normalizeCompanyName, normalizeWebsiteDomain } from './normalization';
import type { IdentityInput } from './normalization';
import { cleanFactualText } from './metadata';

export type CompanyInput = Pick<IdentityInput, 'userId' | 'companyName' | 'websiteUrl' | 'industry' | 'companySizeMin' | 'companySizeMax'>;

/** Domain is authoritative; a name alone matches only one unambiguous candidate. */
export async function resolveCompanyInTransaction(tx: Prisma.TransactionClient, input: CompanyInput): Promise<Company | null> {
  const domain = normalizeWebsiteDomain(input.websiteUrl);
  const name = normalizeCompanyName(input.companyName);
  if (!domain && !name) return null;
  let company = domain ? await tx.company.findUnique({ where: { userId_normalizedDomain: { userId: input.userId, normalizedDomain: domain } } }) : null;
  if (!company && name) {
    const candidates = await tx.company.findMany({ where: { userId: input.userId, normalizedName: name }, take: 3 });
    const compatible = candidates.filter(row => !domain || !row.normalizedDomain || row.normalizedDomain === domain);
    if (candidates.length === 1 && compatible.length === 1) company = compatible[0];
  }
  if (!company) return tx.company.create({ data: {
    userId: input.userId, name: cleanText(input.companyName), normalizedName: name,
    websiteUrl: cleanText(input.websiteUrl), normalizedDomain: domain,
    industry: cleanFactualText(input.industry),
    companySizeMin: input.companySizeMin ?? null, companySizeMax: input.companySizeMax ?? null,
  } });
  const incoming = {
    name: cleanText(input.companyName), normalizedName: name,
    websiteUrl: cleanText(input.websiteUrl), normalizedDomain: domain,
    industry: cleanFactualText(input.industry),
    companySizeMin: input.companySizeMin ?? null, companySizeMax: input.companySizeMax ?? null,
  };
  const data: Record<string, string | number> = {};
  const conflicts: string[] = [];
  for (const key of ['name', 'normalizedName', 'websiteUrl', 'normalizedDomain', 'industry'] as const) {
    const value = incoming[key];
    if (!value) continue;
    if (!company[key]) data[key] = value;
    else if (company[key] !== value && key !== 'websiteUrl') conflicts.push(key);
  }
  if (company.companySizeMin == null && company.companySizeMax == null) {
    if (incoming.companySizeMin != null) data.companySizeMin = incoming.companySizeMin;
    if (incoming.companySizeMax != null) data.companySizeMax = incoming.companySizeMax;
  } else if ((incoming.companySizeMin != null || incoming.companySizeMax != null) &&
    (incoming.companySizeMin !== company.companySizeMin || incoming.companySizeMax !== company.companySizeMax)) conflicts.push('companySize');
  if (conflicts.length) console.warn('[COMPANY_METADATA_CONFLICT]', { userId: input.userId, companyId: company.id, fields: conflicts });
  return Object.keys(data).length ? tx.company.update({ where: { userId_id: { userId: input.userId, id: company.id } }, data }) : company;
}

export async function attachCompanyToProspect(db: PrismaClient, prospect: Prospect): Promise<Company | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const current = await tx.prospect.findUnique({ where: { userId_id: { userId: prospect.userId, id: prospect.id } } });
        if (!current) return null;
        if (current.companyId) return tx.company.findUnique({ where: { userId_id: { userId: prospect.userId, id: current.companyId } } });
        const company = await resolveCompanyInTransaction(tx, current);
        if (!company) return null;
        await tx.prospect.updateMany({ where: { id: prospect.id, userId: prospect.userId, companyId: null }, data: { companyId: company.id } });
        return company;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code) || attempt === 3) throw error;
    }
  }
  throw new Error('Company transaction retry exhausted');
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
