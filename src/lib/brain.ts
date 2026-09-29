import { randomUUID } from 'node:crypto';
import { BrainKnowledgeCategory as Category, BrainKnowledgeSource as Source, BrainVerification as Trust,
  type BrainKnowledgeEntry, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { identityTransaction } from './prospects/identity';

type Db = PrismaClient | Prisma.TransactionClient;
export type BrainPurpose = 'scout' | 'sandbox' | 'outbound' | 'reply_decision' | 'objection_handling' | 'pricing' | 'qualification' | 'outcome';
const priorities: Record<BrainPurpose, Category[]> = {
  scout: [Category.ICP, Category.POSITIONING, Category.PRODUCT, Category.PROOF],
  sandbox: [Category.OFFER, Category.VALUE_PROPOSITION, Category.ICP, Category.PRODUCT, Category.PROOF],
  outbound: [Category.ICP, Category.VALUE_PROPOSITION, Category.POSITIONING, Category.TONE, Category.CTA, Category.PROOF],
  reply_decision: [Category.PRODUCT, Category.PRICING, Category.INTEGRATION, Category.COMMERCIAL_TERM, Category.POSITIONING, Category.PROOF, Category.OBJECTION_CONTEXT],
  objection_handling: [Category.OBJECTION_CONTEXT, Category.PROOF, Category.PRODUCT, Category.LIMITATION],
  pricing: [Category.PRICING, Category.COMMERCIAL_TERM, Category.LIMITATION],
  qualification: [Category.ICP, Category.OFFER, Category.PRODUCT],
  outcome: [Category.VALUE_PROPOSITION, Category.ICP, Category.POSITIONING, Category.PROOF],
};
const profileFields = [
  ['targetTitles', 'Target titles'], ['targetSeniorities', 'Target seniorities'], ['targetIndustries', 'Target industries'],
  ['targetGeographies', 'Target geographies'], ['excludedTitles', 'Excluded titles'], ['excludedIndustries', 'Excluded industries'],
  ['excludedDomains', 'Excluded domains'], ['requiredKeywords', 'Required keywords'], ['excludedKeywords', 'Excluded keywords'],
] as const;

function clean(value: string, max: number) { return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function tenant(userId: string) { if (!userId?.trim()) throw new TypeError('Authenticated userId required'); return userId.trim(); }

async function root(tx: Db, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new Error('Brain not found for authenticated user');
  return tx.frameLeadsBrain.upsert({ where: { userId }, create: { userId }, update: {} });
}

function summary(entries: Pick<BrainKnowledgeEntry, 'category' | 'key' | 'value' | 'verification' | 'importance'>[]) {
  return entries.filter(e => e.verification !== Trust.CONFLICTED).sort((a, b) => b.importance - a.importance ||
    a.category.localeCompare(b.category) || a.key.localeCompare(b.key)).slice(0, 12)
    .map(e => `${e.category.toLowerCase().replaceAll('_', ' ')} [${e.verification.toLowerCase()}] / ${clean(e.key, 60)}: ${clean(e.value, 150)}`)
    .join('; ').slice(0, 1800);
}

async function updateSnapshot(tx: Prisma.TransactionClient, userId: string, brainId: string) {
  const entries = await tx.brainKnowledgeEntry.findMany({ where: { userId, brainId, archivedAt: null },
    orderBy: [{ importance: 'desc' }, { category: 'asc' }, { key: 'asc' }], take: 100,
    select: { category: true, key: true, value: true, verification: true, importance: true } });
  await tx.frameLeadsBrain.update({ where: { userId }, data: { revision: { increment: 1 },
    compactSummary: summary(entries), lastKnowledgeUpdateAt: new Date() } });
}

export async function getOrCreateFrameLeadsBrain(userId: string, db: PrismaClient = prisma) {
  return identityTransaction(db, tx => root(tx, tenant(userId)));
}

/** Sync only canonical tenant-owned server data. Prospect-company records are not the user's business. */
export async function rebuildBrainFromCanonicalSources(userId: string, db: PrismaClient = prisma) {
  userId = tenant(userId);
  return identityTransaction(db, async tx => {
    const brain = await root(tx, userId);
    const [user, profile] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { rootBrandDomain: true } }),
      tx.iCPProfile.findUnique({ where: { userId } }),
    ]);
    const facts: { category: Category; key: string; value: string; sourceType: Source; sourceKey: string; sourceId: string | null }[] = [];
    if (user?.rootBrandDomain?.trim()) facts.push({ category: Category.COMPANY, key: 'Root brand domain', value: clean(user.rootBrandDomain, 250),
      sourceType: Source.USER_PROFILE, sourceKey: 'rootBrandDomain', sourceId: userId });
    if (profile) {
      for (const [field, label] of profileFields) {
        const values = profile[field].map(value => clean(value, 100)).filter(Boolean);
        if (values.length) facts.push({ category: Category.ICP, key: label, value: values.join(', ').slice(0, 1000),
          sourceType: Source.ICP_PROFILE, sourceKey: field, sourceId: profile.id });
      }
      if (profile.companySizeMin !== null || profile.companySizeMax !== null) facts.push({ category: Category.ICP, key: 'Target company size',
        value: `${profile.companySizeMin ?? 0}–${profile.companySizeMax ?? 'unbounded'} employees`, sourceType: Source.ICP_PROFILE,
        sourceKey: 'companySize', sourceId: profile.id });
    }
    const existing = await tx.brainKnowledgeEntry.findMany({ where: { userId, sourceType: { in: [Source.USER_PROFILE, Source.ICP_PROFILE] } } });
    let changed = false;
    for (const fact of facts) {
      const old = existing.find(e => e.sourceType === fact.sourceType && e.sourceKey === fact.sourceKey);
      if (old && old.value === fact.value && old.archivedAt === null && old.sourceId === fact.sourceId) continue;
      if (old) await tx.brainKnowledgeEntry.update({ where: { id: old.id }, data: { ...fact, archivedAt: null, revision: { increment: 1 } } });
      else await tx.brainKnowledgeEntry.create({ data: { userId, brainId: brain.id, ...fact,
        verification: Trust.VERIFIED, importance: fact.category === Category.ICP ? 2 : 1 } });
      changed = true;
    }
    for (const old of existing) if (!old.archivedAt && !facts.some(f => f.sourceType === old.sourceType && f.sourceKey === old.sourceKey)) {
      await tx.brainKnowledgeEntry.update({ where: { id: old.id }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
      changed = true;
    }
    if (changed) await updateSnapshot(tx, userId, brain.id);
    return { changed, revision: brain.revision + (changed ? 1 : 0) };
  });
}

export async function getBrainKnowledge(input: { userId: string; take?: number; cursor?: string }, db: PrismaClient = prisma) {
  const userId = tenant(input.userId);
  const brain = await db.frameLeadsBrain.findUnique({ where: { userId }, select: { id: true } });
  if (!brain) return [];
  return db.brainKnowledgeEntry.findMany({ where: { userId, archivedAt: null }, orderBy: [{ category: 'asc' }, { key: 'asc' }, { id: 'asc' }],
    take: Math.min(100, Math.max(1, input.take ?? 50)), ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
}

export async function upsertBrainKnowledge(input: { userId: string; id?: string; category: Category; key: string; value: string; importance?: number }, db: PrismaClient = prisma) {
  const userId = tenant(input.userId);
  if (!Object.values(Category).includes(input.category)) throw new TypeError('Invalid knowledge category');
  const key = clean(input.key || '', 100), value = clean(input.value || '', 2000);
  if (!key || !value || input.key.length > 100 || input.value.length > 2000) throw new TypeError('Knowledge key or value is missing or too long');
  const importance = input.importance ?? 1;
  if (!Number.isInteger(importance) || importance < 1 || importance > 3) throw new TypeError('Importance must be 1–3');
  return identityTransaction(db, async tx => {
    const brain = await root(tx, userId);
    const old = input.id ? await tx.brainKnowledgeEntry.findFirst({ where: { id: input.id, userId, archivedAt: null } }) : null;
    if (input.id && (!old || old.sourceType !== Source.USER_ENTERED)) throw new Error('User-owned knowledge entry not found');
    const duplicate = await tx.brainKnowledgeEntry.findFirst({ where: { userId, category: input.category, key, archivedAt: null,
      ...(old ? { id: { not: old.id } } : {}) } });
    if (duplicate) throw new Error('Conflicting knowledge key exists; edit its canonical source or use a distinct key');
    if (old && old.category === input.category && old.key === key && old.value === value && old.importance === importance) return old;
    const entry = old ? await tx.brainKnowledgeEntry.update({ where: { id: old.id }, data: { category: input.category, key, value,
      importance, revision: { increment: 1 } } }) : await tx.brainKnowledgeEntry.create({ data: { userId, brainId: brain.id,
      category: input.category, key, value, importance, sourceType: Source.USER_ENTERED,
      sourceKey: `manual:${randomUUID()}`, verification: Trust.VERIFIED } });
    await updateSnapshot(tx, userId, brain.id);
    return entry;
  });
}

export async function removeBrainKnowledge(input: { userId: string; id: string }, db: PrismaClient = prisma) {
  const userId = tenant(input.userId);
  return identityTransaction(db, async tx => {
    const entry = await tx.brainKnowledgeEntry.findFirst({ where: { id: input.id, userId, archivedAt: null } });
    if (!entry || entry.sourceType !== Source.USER_ENTERED) throw new Error('User-owned knowledge entry not found');
    await tx.brainKnowledgeEntry.update({ where: { id: entry.id }, data: { archivedAt: new Date(), revision: { increment: 1 } } });
    await updateSnapshot(tx, userId, entry.brainId);
  });
}

export async function refreshBrainSummary(userId: string, db: PrismaClient = prisma) {
  // Read-only recomputation: revision changes only when effective knowledge changes via writers.
  const brain = await getOrCreateFrameLeadsBrain(userId, db);
  const entries = await db.brainKnowledgeEntry.findMany({ where: { userId, brainId: brain.id, archivedAt: null },
    orderBy: [{ importance: 'desc' }, { category: 'asc' }, { key: 'asc' }], take: 100 });
  const next = summary(entries);
  if (next !== brain.compactSummary) await db.frameLeadsBrain.update({ where: { userId }, data: { compactSummary: next } });
  return next;
}

export async function getBrainContext(input: { userId: string; purpose?: BrainPurpose; categories?: Category[]; maxEntries?: number; maxCharacters?: number }, db: PrismaClient = prisma) {
  const userId = tenant(input.userId);
  const brain = await getOrCreateFrameLeadsBrain(userId, db);
  const preferred = input.purpose ? priorities[input.purpose] : Object.values(Category);
  if (!preferred) throw new TypeError('Invalid Brain context purpose');
  const categories = input.categories?.length ? input.categories : preferred;
  if (categories.some(c => !Object.values(Category).includes(c))) throw new TypeError('Invalid knowledge category');
  const maxEntries = Math.min(20, Math.max(1, input.maxEntries ?? 8));
  const maxCharacters = Math.min(4000, Math.max(200, input.maxCharacters ?? 2400));
  const candidates = await db.brainKnowledgeEntry.findMany({ where: { userId, brainId: brain.id, archivedAt: null,
    category: { in: categories }, verification: { not: Trust.CONFLICTED } },
    orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }], take: 100 });
  candidates.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) ||
    (a.verification === Trust.VERIFIED ? -1 : 0) - (b.verification === Trust.VERIFIED ? -1 : 0) ||
    b.importance - a.importance || b.updatedAt.getTime() - a.updatedAt.getTime());
  const entries: typeof candidates = [];
  let used = 0;
  for (const item of candidates) {
    if (entries.length >= maxEntries) break;
    const line = `${item.category} [${item.verification}, ${item.sourceType}] / ${item.key}: ${clean(item.value, 600)}`;
    if (used + line.length > maxCharacters) continue;
    entries.push({ ...item, value: clean(item.value, 600) }); used += line.length + 1;
  }
  return { revision: brain.revision, entries, contextText: entries.map(e => `${e.category} [${e.verification}, ${e.sourceType}] / ${e.key}: ${e.value}`).join('\n').slice(0, maxCharacters) };
}
