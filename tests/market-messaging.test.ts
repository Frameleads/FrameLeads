import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILT_IN_MARKET_PROFILES, buildMarketAwareGenerationPrompt, listMarketProfiles,
  resolveMarketProfile, saveMarketProfile, validateMarketProfileInput } from '../src/lib/market-messaging';
import { extractProspectMetadata } from '../src/lib/prospects/metadata';

const custom = (overrides: any = {}) => ({ id: 'custom-a', userId: 'tenant-a', name: 'German custom', countries: ['Germany'],
  formality: 'HIGH', directness: 'MEDIUM', warmth: 'MEDIUM', openerStyle: 'CONTEXT_FIRST', ctaStyle: 'EXPLORATORY',
  lengthStyle: 'CONTEXTUAL', salutationStyle: 'PROFESSIONAL', languageGuidance: null,
  additionalGuidance: null, enabled: true, createdAt: new Date(), updatedAt: new Date(), ...overrides });

test('normalized US, Germany, UAE and unknown country select expected built-in profiles', async () => {
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'US', profiles: [] })).profileKey, 'US');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'Germany', profiles: [] })).profileKey, 'DACH');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'germany', profiles: [] })).profileKey, 'DACH');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'GERMANY', profiles: [] })).profileKey, 'DACH');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'DE', profiles: [] })).profileKey, 'DACH');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'UAE', profiles: [] })).profileKey, 'GCC');
  const unknown = await resolveMarketProfile({ userId: 'a', country: null, profiles: [] });
  assert.equal(unknown.profileKey, 'GLOBAL'); assert.equal(unknown.source, 'GLOBAL_FALLBACK');
});

test('country resolution uses explicit source facts and does not infer from name, email, or domain', async () => {
  const facts = extractProspectMetadata({ first_name: 'Yuki', email: 'person@example.jp', website_url: 'https://example.jp' });
  assert.equal(facts.country, null);
  assert.equal((await resolveMarketProfile({ userId: 'a', country: facts.country, profiles: [] })).profileKey, 'GLOBAL');
  assert.equal((await resolveMarketProfile({ userId: 'a', country: 'UK', profiles: [] })).profileKey, 'UK');
});

test('explicit override wins; tenant custom profile precedes built-in; disabled custom profile is ignored', async () => {
  const profiles = [custom() as any, custom({ id: 'disabled', countries: ['France'], enabled: false }) as any];
  assert.equal((await resolveMarketProfile({ userId: 'tenant-a', country: 'Germany', override: 'US', profiles })).profileKey, 'US');
  const assigned = await resolveMarketProfile({ userId: 'tenant-a', country: 'Germany', profiles });
  assert.equal(assigned.profileId, 'custom-a'); assert.equal(assigned.source, 'CUSTOM_COUNTRY');
  assert.equal((await resolveMarketProfile({ userId: 'tenant-a', country: 'GERMANY', profiles: [custom({ countries: ['germany'] }) as any] })).profileId, 'custom-a');
  assert.equal((await resolveMarketProfile({ userId: 'tenant-a', country: 'France', profiles })).profileKey, 'FRANCE');
  await assert.rejects(resolveMarketProfile({ userId: 'tenant-a', country: 'France', override: 'disabled', profiles }), /unavailable/);
});

test('different lead countries resolve independently while explicit batch override stays consistent', async () => {
  const leads = await Promise.all(['United States','Germany','unknown'].map(country => resolveMarketProfile({ userId: 'a', country, profiles: [] })));
  assert.deepEqual(leads.map(profile => profile.profileKey), ['US','DACH','GLOBAL']);
  const forced = await Promise.all(['United States','Germany'].map(country => resolveMarketProfile({ userId: 'a', country, override: 'GLOBAL', profiles: [] })));
  assert.deepEqual(forced.map(profile => profile.profileKey), ['GLOBAL','GLOBAL']);
  assert.ok(forced.every(profile => profile.source === 'EXPLICIT_OVERRIDE'));
});

test('custom fields are bounded, countries normalized, overlaps rejected, and tenant records scoped', async () => {
  const valid = validateMarketProfileInput({ name: 'DACH Style', countries: ['DE', 'Germany'], formality: 'HIGH', directness: 'MEDIUM',
    warmth: 'MEDIUM', openerStyle: 'CONTEXT_FIRST', ctaStyle: 'EXPLORATORY', lengthStyle: 'CONTEXTUAL', salutationStyle: 'PROFESSIONAL' });
  assert.deepEqual(valid.countries, ['Germany']);
  assert.throws(() => validateMarketProfileInput({ ...valid, name: 'x'.repeat(81) }), /profile name/);
  assert.throws(() => validateMarketProfileInput({ ...valid, additionalGuidance: 'x'.repeat(501) }), /additionalGuidance/);
  assert.throws(() => validateMarketProfileInput({ ...valid, languageGuidance: 'GDPR compliant' }), /legal permission/);
  assert.throws(() => validateMarketProfileInput({ ...valid, additionalGuidance: 'Cold email is legally allowed.' }), /legal permission/);
  const store = [custom()]; let queries: any[] = [];
  const tx: any = { marketMessagingProfile: {
    findFirst: async ({ where }: any) => { queries.push(where); return store.find(row => row.id === where.id && row.userId === where.userId) ?? null; },
    findMany: async ({ where }: any) => { queries.push(where); return store.filter(row => row.userId === where.userId && row.enabled && row.id !== where.id?.not); },
    update: async ({ where, data }: any) => ({ ...store[0], ...data, id: where.id }),
    create: async ({ data }: any) => data,
  } };
  const db: any = { $transaction: async (callback: any) => callback(tx), marketMessagingProfile: tx.marketMessagingProfile };
  await assert.rejects(saveMarketProfile({ userId: 'tenant-a', data: { ...valid, countries: ['Germany'] } }, db), /overlap/);
  await assert.rejects(saveMarketProfile({ userId: 'tenant-a', data: { ...valid, countries: ['germany'] } }, db), /overlap/);
  await assert.rejects(saveMarketProfile({ userId: 'tenant-b', id: 'custom-a', data: valid }, db), /not found/);
  assert.equal((await listMarketProfiles('tenant-b', { marketMessagingProfile: { findMany: async ({ where }: any) => { queries.push(where); return []; } } as any } as any)).length, 0);
  assert.ok(queries.some(where => where.userId === 'tenant-b'));
});

test('generation context preserves governance, facts and sales objective above presentation', () => {
  const profile = BUILT_IN_MARKET_PROFILES.find(row => row.key === 'DACH')!;
  const resolved = { ...profile, profileKey: profile.key, profileId: null, profileName: profile.name, detectedCountry: 'Germany',
    source: 'BUILT_IN_COUNTRY' as const };
  const prompt = buildMarketAwareGenerationPrompt({ constitution: 'BLOCK unsupported claims', brain: 'PRODUCT [VERIFIED] / fact: product fact',
    playbook: 'Objective: book a demo; CTA: choose a meeting', profile: resolved, prospect: { country: 'Germany' },
    preferredCtaStyle: 'Book a demo', seed: 'test', wordLimit: 120 });
  assert.ok(prompt.indexOf('SALES CONSTITUTION') < prompt.indexOf('FRAMELEADS BRAIN CONTEXT'));
  assert.ok(prompt.indexOf('FRAMELEADS BRAIN CONTEXT') < prompt.indexOf('REVENUE PLAYBOOK'));
  assert.ok(prompt.indexOf('REVENUE PLAYBOOK') < prompt.indexOf('MARKET PROFILE'));
  assert.match(prompt, /only entries labelled VERIFIED may substantiate company\/product factual claims/i);
  assert.match(prompt, /Non-VERIFIED entries must not be promoted into factual claims/i);
  assert.match(prompt, /Revenue Playbook sales strategy and CTA objective.*Brain communication preferences/i);
  assert.match(prompt, /Sales Constitution > verified factual knowledge > Revenue Playbook.*Brain communication preferences > Market presentation profile > AI wording/i);
  assert.match(prompt, /preserve its chosen objective/);
  assert.match(prompt, /email structure may use a profile-appropriate number of paragraphs/i);
  assert.match(prompt, /book a demo/);
  assert.doesNotMatch(prompt, /legal permission|GDPR compliant/i);
  assert.match(prompt, /LINKEDIN \/ COLD CALL \/ WHATSAPP: Retain each channel's existing channel-specific structure and CTA objective\/style behavior/i);
  assert.match(prompt, /cold-call permission check, and WhatsApp permission request/i);
});

test('ingestion built-in and custom profile mapping provides display names', () => {
  const source = readFileSync('src/app/dashboard/ingestion/IngestionClient.tsx', 'utf8');
  assert.match(source, /profileKey: profile\.key, profileId: null, profileName: profile\.name/);
  assert.match(source, /profileKey: profile\.id, profileId: profile\.id, profileName: profile\.name/);
});

test('generation prompts bind incident safety, non-email CTA behavior, JSON, word gate and factual safeguards', () => {
  const route = readFileSync('src/app/api/generate/route.ts', 'utf8');
  const prompt = buildMarketAwareGenerationPrompt({ constitution: '', brain: '', playbook: 'CTA objective: request permission to share audit',
    profile: { ...BUILT_IN_MARKET_PROFILES[0], source: 'GLOBAL_FALLBACK', profileKey: 'GLOBAL', profileId: null,
      profileName: BUILT_IN_MARKET_PROFILES[0].name, detectedCountry: null }, prospect: { incident: null },
    preferredCtaStyle: 'Schedule a demo', seed: 'test', wordLimit: 100 });
  assert.match(route, /derived only from the incident field in TRUSTED PROSPECT INPUT/);
  assert.match(prompt, /EMAIL ONLY: Adapt/);
  assert.match(prompt, /LINKEDIN \/ COLD CALL \/ WHATSAPP/);
  assert.match(route, /validateGeneratedChannels\(generated, pipelineContext\)/);
  assert.match(route, /generated\.email\.paragraphs\.join\('\\n\\n'\)/);
  assert.match(route, /Never invent financial values, performance metrics, software\/tool usage, company facts, business events, pains, ROI, or offers/);
  assert.equal((route.match(/anthropic\.messages\.create\(/g) ?? []).length, 1);
  assert.doesNotMatch(route, /INVENT A SPECIFIC NUMERICAL METRIC|\$15k|\$67k|No Fabricated Math/i);
});

test('profiles do not invent honorifics, language, or legal permission', () => {
  const japan = BUILT_IN_MARKET_PROFILES.find(row => row.key === 'JAPAN')!;
  assert.equal(japan.languageGuidance, null);
  assert.equal(japan.salutationStyle, 'MINIMAL');
  assert.ok(BUILT_IN_MARKET_PROFILES.every(profile => !/gdpr|casl|legal to contact|consent exists/i.test(`${profile.summary} ${profile.additionalGuidance ?? ''}`)));
});

test('existing JSON and word gate stay in place; market resolution adds no model call', () => {
  const route = readFileSync('src/app/api/generate/route.ts', 'utf8');
  const market = readFileSync('src/lib/market-messaging.ts', 'utf8');
  assert.match(route, /generated\.email\.paragraphs\.join\('\\n\\n'\)/);
  assert.match(route, /validateGeneratedChannels\(generated, pipelineContext\)/);
  assert.match(route, /marketProfile,/);
  assert.equal((route.match(/anthropic\.messages\.create\(/g) ?? []).length, 1);
  assert.doesNotMatch(market, /anthropic|messages\.create|generateContent|openai/i);
  assert.doesNotMatch(route, /INVENT A SPECIFIC NUMERICAL METRIC|\$15k|\$67k|No Fabricated Math/i);
});
