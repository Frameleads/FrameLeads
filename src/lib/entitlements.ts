export type FrameLeadsTier = 'MICRO_PILOT' | 'CORE' | 'ENTERPRISE' | 'INACTIVE';

export const FEATURE_KEYS = [
  'BASE_OUTBOUND', 'BUILTIN_MARKET_MESSAGING', 'SCOUT', 'ICP', 'PROSPECT_RESEARCH',
  'PROSPECT_MEMORY', 'BRAIN', 'PLAYBOOK', 'INBOX_TRIAGE', 'DECISION_ENGINE',
  'DECISION_REPLAY', 'OUTCOME_CAPTURE', 'CUSTOM_MARKET_PROFILES', 'GOVERNANCE',
  'CONSTITUTION_MANAGEMENT', 'AUTOMATION', 'REVENUE_RISK', 'RESPONSE_SLA',
  'DECISION_SANDBOX', 'OUTCOME_LEARNING',
] as const;

export type FeatureKey = typeof FEATURE_KEYS[number];
const CORE_FEATURES = new Set<FeatureKey>([
  'SCOUT', 'ICP', 'PROSPECT_RESEARCH', 'PROSPECT_MEMORY', 'BRAIN', 'PLAYBOOK',
  'INBOX_TRIAGE', 'DECISION_ENGINE', 'DECISION_REPLAY', 'OUTCOME_CAPTURE',
]);
const ENTERPRISE_FEATURES = new Set<FeatureKey>([
  'CUSTOM_MARKET_PROFILES', 'GOVERNANCE', 'CONSTITUTION_MANAGEMENT', 'AUTOMATION',
  'REVENUE_RISK', 'RESPONSE_SLA', 'DECISION_SANDBOX', 'OUTCOME_LEARNING',
]);
const MICRO_PILOT_FEATURES = new Set<FeatureKey>([
  'BASE_OUTBOUND', 'BUILTIN_MARKET_MESSAGING', 'SCOUT', 'ICP', 'PROSPECT_RESEARCH',
  'BRAIN', 'PLAYBOOK', 'INBOX_TRIAGE', 'DECISION_REPLAY', 'CONSTITUTION_MANAGEMENT',
]);

export function normalizeFrameLeadsTier(value: unknown): FrameLeadsTier {
  return value === 'MICRO_PILOT' || value === 'CORE' || value === 'ENTERPRISE' || value === 'INACTIVE'
    ? value : 'INACTIVE';
}

export function requiredTierForFeature(feature: FeatureKey): 'MICRO_PILOT' | 'CORE' | 'ENTERPRISE' {
  if (ENTERPRISE_FEATURES.has(feature)) return 'ENTERPRISE';
  if (CORE_FEATURES.has(feature)) return 'CORE';
  return 'MICRO_PILOT';
}

export function corePaywallFeatureForName(name: string): FeatureKey {
  return ({
    'Scout': 'SCOUT', 'ICP Profile': 'ICP', 'FrameLeads Brain': 'BRAIN',
    'Revenue Playbook': 'PLAYBOOK', 'Inbox Triage': 'INBOX_TRIAGE', 'Decision Replay': 'DECISION_REPLAY',
  } as Record<string, FeatureKey>)[name] ?? 'PROSPECT_MEMORY';
}

export function hasFeatureAccess(tierValue: unknown, feature: FeatureKey): boolean {
  const tier = normalizeFrameLeadsTier(tierValue);
  if (tier === 'INACTIVE') return false;
  if (tier === 'ENTERPRISE') return true;
  if (tier === 'MICRO_PILOT') return MICRO_PILOT_FEATURES.has(feature);
  if (ENTERPRISE_FEATURES.has(feature)) return false;
  if (feature === 'INBOX_TRIAGE' || feature === 'DECISION_REPLAY') return tier === 'CORE';
  if (CORE_FEATURES.has(feature)) return tier === 'CORE';
  return tier === 'CORE' && !ENTERPRISE_FEATURES.has(feature);
}

export function monthlyLeadQuotaForTier(tierValue: unknown, enterpriseLegacyQuota = false): number {
  const tier = normalizeFrameLeadsTier(tierValue);
  return tier === 'ENTERPRISE' ? (enterpriseLegacyQuota ? 20_000 : 10_000) : tier === 'CORE' ? 500 : tier === 'MICRO_PILOT' ? 25 : 0;
}
