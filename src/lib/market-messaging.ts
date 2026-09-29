import type { MarketMessagingProfile, PrismaClient } from '@prisma/client';
import { normalizeCountry } from './prospects/metadata';
import { prisma } from './prisma';
import { MARKET_OPTIONS } from './market-messaging-shared';
export { MARKET_OPTIONS } from './market-messaging-shared';

export type MarketPreferences = { formality: string; directness: string; warmth: string; openerStyle: string;
  ctaStyle: string; lengthStyle: string; salutationStyle: string; languageGuidance?: string | null;
  additionalGuidance?: string | null };
export type ResolvedMarketProfile = MarketPreferences & { source: 'EXPLICIT_OVERRIDE' | 'CUSTOM_COUNTRY' | 'BUILT_IN_COUNTRY' | 'GLOBAL_FALLBACK';
  profileKey: string; profileId: string | null; profileName: string; detectedCountry: string | null; summary: string };

type Builtin = MarketPreferences & { key: string; name: string; countries: string[]; summary: string };
const neutral = { formality: 'MEDIUM', directness: 'MEDIUM', warmth: 'MEDIUM', openerStyle: 'CONTEXT_FIRST',
  ctaStyle: 'PERMISSION_BASED', lengthStyle: 'SHORT', salutationStyle: 'FIRST_NAME', languageGuidance: null,
  additionalGuidance: null };
export const BUILT_IN_MARKET_PROFILES: readonly Builtin[] = [
  { key: 'GLOBAL', name: 'Global / Neutral', countries: [], ...neutral, summary: 'Balanced, concise and professional.' },
  { key: 'US', name: 'United States', countries: ['United States'], ...neutral, directness: 'HIGH', warmth: 'MEDIUM', openerStyle: 'TRIGGER_FIRST', ctaStyle: 'DIRECT', summary: 'Concise and conversational-professional.' },
  { key: 'CANADA', name: 'Canada', countries: ['Canada'], ...neutral, warmth: 'HIGH', summary: 'Warm, clear and professional.' },
  { key: 'UK', name: 'United Kingdom', countries: ['United Kingdom'], ...neutral, directness: 'MEDIUM', warmth: 'LOW', ctaStyle: 'EXPLORATORY', summary: 'Concise and understated.' },
  { key: 'DACH', name: 'DACH', countries: ['Germany','Austria','Switzerland'], ...neutral, formality: 'HIGH', directness: 'MEDIUM', openerStyle: 'CONTEXT_FIRST', ctaStyle: 'EXPLORATORY', summary: 'Professional, precise and contextual.' },
  { key: 'FRANCE', name: 'France', countries: ['France'], ...neutral, formality: 'HIGH', openerStyle: 'CONTEXT_FIRST', summary: 'Professional, clear and contextual.' },
  { key: 'NORDICS', name: 'Nordics', countries: ['Denmark','Finland','Iceland','Norway','Sweden'], ...neutral, directness: 'HIGH', warmth: 'LOW', openerStyle: 'TRIGGER_FIRST', summary: 'Concise and low-hype.' },
  { key: 'GCC', name: 'GCC / UAE', countries: ['Bahrain','Kuwait','Oman','Qatar','Saudi Arabia','United Arab Emirates'], ...neutral, formality: 'HIGH', warmth: 'HIGH', openerStyle: 'RELATIONSHIP_FIRST', ctaStyle: 'EXPLORATORY', summary: 'Respectful and relationship-aware.' },
  { key: 'JAPAN', name: 'Japan', countries: ['Japan'], ...neutral, formality: 'HIGH', directness: 'LOW', openerStyle: 'INTRODUCTION_FIRST', ctaStyle: 'PERMISSION_BASED', salutationStyle: 'MINIMAL', summary: 'Formal, contextual and low-pressure.' },
  { key: 'SINGAPORE', name: 'Singapore', countries: ['Singapore'], ...neutral, formality: 'HIGH', openerStyle: 'CONTEXT_FIRST', summary: 'Clear and professionally contextual.' },
  { key: 'ANZ', name: 'Australia / New Zealand', countries: ['Australia','New Zealand'], ...neutral, directness: 'HIGH', warmth: 'HIGH', openerStyle: 'TRIGGER_FIRST', summary: 'Direct and conversational.' },
  { key: 'BRAZIL', name: 'Brazil', countries: ['Brazil'], ...neutral, warmth: 'HIGH', openerStyle: 'RELATIONSHIP_FIRST', ctaStyle: 'EXPLORATORY', lengthStyle: 'CONTEXTUAL', summary: 'Warm and relationship-aware.' },
  { key: 'MEXICO', name: 'Mexico', countries: ['Mexico'], ...neutral, warmth: 'HIGH', formality: 'HIGH', openerStyle: 'RELATIONSHIP_FIRST', ctaStyle: 'EXPLORATORY', lengthStyle: 'CONTEXTUAL', summary: 'Warm, respectful and contextual.' },
];

const clean = (value: unknown, max: number, label: string): string => {
  if (typeof value !== 'string' || value.trim().length > max || !value.trim()) throw new TypeError(`Invalid ${label}`);
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
};
const countryComparisonKey = (value: unknown): string | null => typeof value === 'string'
  ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') || null : null;
function normalizeMarketCountry(value: unknown): string | null {
  const normalized = normalizeCountry(value);
  if (!normalized) return null;
  const code = normalized.toLowerCase();
  const aliases: Record<string, string> = { de: 'Germany', at: 'Austria', ch: 'Switzerland', fr: 'France', dk: 'Denmark', fi: 'Finland', is: 'Iceland', no: 'Norway', se: 'Sweden', bh: 'Bahrain', kw: 'Kuwait', om: 'Oman', qa: 'Qatar', sa: 'Saudi Arabia', jp: 'Japan', sg: 'Singapore', au: 'Australia', nz: 'New Zealand', br: 'Brazil', mx: 'Mexico', ca: 'Canada' };
  const aliased = aliases[code] ?? normalized;
  const canonicalBuiltIn = BUILT_IN_MARKET_PROFILES.flatMap(profile => profile.countries)
    .find(country => countryComparisonKey(country) === countryComparisonKey(aliased));
  return canonicalBuiltIn ?? aliased;
}
export function normalizeMarketCountries(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 30) throw new TypeError('Select up to 30 countries.');
  const countries = value.map(item => normalizeMarketCountry(item));
  if (countries.some(country => !country)) throw new TypeError('Each country must be a non-empty country name.');
  return [...new Set(countries as string[])];
}
export function validateMarketProfileInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Profile data is required.');
  const raw = value as Record<string, unknown>;
  const allowed = ['name','countries',...Object.keys(MARKET_OPTIONS),'languageGuidance','additionalGuidance','enabled'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new TypeError('Unknown profile field.');
  const result: any = { name: clean(raw.name, 80, 'profile name'), countries: normalizeMarketCountries(raw.countries) };
  const legalClaim = /\b(?:gdpr|casl|lgpd|compliant|compliance|consent|legal(?:ly)? allowed|cold email allowed|legitimate interest)\b/i;
  if (legalClaim.test(result.name)) throw new TypeError('Market profiles cannot state legal permission or compliance.');
  for (const key of Object.keys(MARKET_OPTIONS) as (keyof typeof MARKET_OPTIONS)[]) {
    if (!(MARKET_OPTIONS[key] as readonly unknown[]).includes(raw[key])) throw new TypeError(`Invalid ${key}.`);
    result[key] = raw[key];
  }
  for (const key of ['languageGuidance','additionalGuidance'] as const) {
    const max = key === 'languageGuidance' ? 120 : 500;
    if (raw[key] != null && (typeof raw[key] !== 'string' || (raw[key] as string).length > max)) throw new TypeError(`Invalid ${key}.`);
    result[key] = raw[key] == null ? null : clean(raw[key], max, key);
    if (result[key] && legalClaim.test(result[key]))
      throw new TypeError('Market profiles are communication preferences and cannot state legal permission or compliance.');
  }
  if (raw.enabled != null && typeof raw.enabled !== 'boolean') throw new TypeError('Invalid enabled value.');
  if (raw.enabled != null) result.enabled = raw.enabled;
  if (!result.countries.length) throw new TypeError('Assign at least one country.');
  return result as { name: string; countries: string[]; enabled?: boolean } & MarketPreferences;
}
export async function saveMarketProfile(input: { userId: string; id?: string; data: unknown }, db: PrismaClient = prisma) {
  const userId = clean(input.userId, 128, 'tenant');
  const data = validateMarketProfileInput(input.data);
  return db.$transaction(async tx => {
    const existing = input.id ? await tx.marketMessagingProfile.findFirst({ where: { id: input.id, userId } }) : null;
    if (input.id && !existing) throw new Error('Market profile not found.');
    const enabled = data.enabled ?? existing?.enabled ?? true;
    if (enabled) {
      const others = await tx.marketMessagingProfile.findMany({ where: { userId, enabled: true, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true, name: true, countries: true } });
      const incomingKeys = new Set(data.countries.map(countryComparisonKey));
      const overlaps = others.flatMap(profile => profile.countries.filter(country => incomingKeys.has(countryComparisonKey(country))).map(country => `${country} (${profile.name})`));
      if (overlaps.length) throw new Error(`Enabled market profile country overlap: ${overlaps.join(', ')}.`);
    }
    return existing ? tx.marketMessagingProfile.update({ where: { id: existing.id }, data }) :
      tx.marketMessagingProfile.create({ data: { ...data, userId, enabled } });
  }, { isolationLevel: 'Serializable' });
}
export async function listMarketProfiles(userId: string, db: PrismaClient = prisma) {
  return db.marketMessagingProfile.findMany({ where: { userId }, orderBy: [{ enabled: 'desc' }, { name: 'asc' }] });
}
export async function deleteMarketProfile(userId: string, id: string, db: PrismaClient = prisma) {
  const result = await db.marketMessagingProfile.deleteMany({ where: { userId, id } });
  return result.count > 0;
}

const fromRecord = (record: MarketMessagingProfile, country: string | null, source: ResolvedMarketProfile['source']): ResolvedMarketProfile => ({
  source, profileKey: record.id, profileId: record.id, profileName: record.name, detectedCountry: country,
  summary: `${record.formality.toLowerCase()} and ${record.lengthStyle.toLowerCase().replace('_',' ')}.`,
  formality: record.formality, directness: record.directness, warmth: record.warmth, openerStyle: record.openerStyle,
  ctaStyle: record.ctaStyle, lengthStyle: record.lengthStyle, salutationStyle: record.salutationStyle,
  languageGuidance: record.languageGuidance, additionalGuidance: record.additionalGuidance,
});
export async function resolveMarketProfile(input: { userId: string; country?: unknown; override?: string | null;
  profiles?: MarketMessagingProfile[] }, db: PrismaClient = prisma): Promise<ResolvedMarketProfile> {
  const country = normalizeMarketCountry(input.country);
  if (input.override != null && (typeof input.override !== 'string' || input.override.length > 100)) throw new TypeError('Invalid market profile override.');
  const override = input.override?.trim() || null;
  const profiles = input.profiles ?? await db.marketMessagingProfile.findMany({ where: { userId: input.userId } });
  if (override) {
    const builtin = BUILT_IN_MARKET_PROFILES.find(profile => profile.key === override);
    if (builtin) return { ...builtin, source: 'EXPLICIT_OVERRIDE', profileKey: builtin.key, profileId: null, profileName: builtin.name, detectedCountry: country };
    const custom = profiles.find(profile => profile.id === override && profile.enabled);
    if (!custom) throw new Error('Selected market profile is unavailable.');
    return fromRecord(custom, country, 'EXPLICIT_OVERRIDE');
  }
  if (country) {
    const countryKey = countryComparisonKey(country);
    const custom = profiles.find(profile => profile.enabled && profile.countries.some(value => countryComparisonKey(value) === countryKey));
    if (custom) return fromRecord(custom, country, 'CUSTOM_COUNTRY');
    const builtin = BUILT_IN_MARKET_PROFILES.find(profile => profile.countries.some(value => countryComparisonKey(value) === countryKey));
    if (builtin) return { ...builtin, source: 'BUILT_IN_COUNTRY', profileKey: builtin.key, profileId: null, profileName: builtin.name, detectedCountry: country };
  }
  const global = BUILT_IN_MARKET_PROFILES[0];
  return { ...global, source: 'GLOBAL_FALLBACK', profileKey: 'GLOBAL', profileId: null, profileName: global.name, detectedCountry: country };
}

export function marketPromptText(profile: ResolvedMarketProfile) {
  return [
    `Profile: ${profile.profileName}. This is an editable communication-style starting point, not a claim about every person in this market.`,
    `Formality ${profile.formality}; directness ${profile.directness}; warmth ${profile.warmth}; opener ${profile.openerStyle}; CTA phrasing ${profile.ctaStyle}; email length ${profile.lengthStyle}; salutation ${profile.salutationStyle}.`,
    profile.languageGuidance ? `Language guidance: ${profile.languageGuidance}` : '',
    profile.additionalGuidance ? `Additional presentation guidance: ${profile.additionalGuidance}` : '',
    'Change phrasing and email structure only. Preserve the playbook objective, all trusted facts, and all Constitution restrictions. Never infer language or use an honorific unless trusted title data supports it.',
  ].filter(Boolean).join('\n').slice(0, 900);
}

export function buildMarketAwareGenerationPrompt(input: { brain: string; playbook: string; constitution: string;
  profile: ResolvedMarketProfile; prospect: Record<string, unknown>; preferredCtaStyle: string;
  seed: string; wordLimit: number }) {
  const cap = (value: string, max: number) => value.slice(0, max);
  return `Generate outreach using the required JSON contract.

SALES CONSTITUTION (highest authority; hard governance):
${cap(input.constitution || 'No relevant Constitution context supplied. Never invent permission or legal status.', 550)}

FRAMELEADS BRAIN CONTEXT (verification-labelled company knowledge and communication identity):
${cap(input.brain || 'No Brain context supplied.', 650)}
Only entries labelled VERIFIED may substantiate company/product factual claims. Non-VERIFIED entries must not be promoted into factual claims. Brain communication preferences are subordinate to the Revenue Playbook sales strategy and CTA objective; the Sales Constitution remains above both.

REVENUE PLAYBOOK (authoritative sales objective, offer and CTA purpose; preserve its chosen objective):
${cap(input.playbook || 'No Playbook rule supplied. Preserve the requested CTA objective below.', 550)}

MARKET PROFILE (email presentation only; not legal guidance or factual evidence):
${marketPromptText(input.profile)}

TRUSTED PROSPECT INPUT (may be incomplete; do not infer missing facts):
${JSON.stringify(input.prospect).slice(0, 900)}

CTA AUTHORITY: Sales Constitution > verified factual knowledge > Revenue Playbook sales strategy and CTA objective > Brain communication preferences > Market presentation profile > AI wording. The Playbook CTA objective takes precedence over conflicting Brain or market preferences. Treat the requested CTA guidance below as user/request guidance or as a fallback only when it does not conflict with the Playbook objective.
Requested CTA objective/style (guidance/fallback): ${cap(input.preferredCtaStyle, 120)}
Unique variation seed: ${cap(input.seed, 80)}
EMAIL ONLY: Adapt formality, warmth, directness, opening, salutation, length, structure and phrasing to the profile. Do not change the Playbook sales objective or invent facts. Email structure may use a profile-appropriate number of paragraphs. A person's job title is not an honorific; use first name or a neutral salutation unless trusted input explicitly provides a form of address.
LINKEDIN / COLD CALL / WHATSAPP: Retain each channel's existing channel-specific structure and CTA objective/style behavior; do not apply market-profile tone, language, salutation, or structural adaptations. Preserve the concise LinkedIn note, cold-call permission check, and WhatsApp permission request for the diagnostic link.
WORD LIMIT: Each channel body MUST be under ${input.wordLimit} words. This is a hard constraint.`;
}
