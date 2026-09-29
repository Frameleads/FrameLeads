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

export function normalizeFrameLeadsTier(value: unknown): FrameLeadsTier {
  return value === 'MICRO_PILOT' || value === 'CORE' || value === 'ENTERPRISE' || value === 'INACTIVE'
    ? value : 'INACTIVE';
}

export function requiredTierForFeature(feature: FeatureKey): 'MICRO_PILOT' | 'CORE' | 'ENTERPRISE' {
  if (ENTERPRISE_FEATURES.has(feature)) return 'ENTERPRISE';
  if (CORE_FEATURES.has(feature)) return 'CORE';
  return 'MICRO_PILOT';
}

export function hasFeatureAccess(tierValue: unknown, feature: FeatureKey): boolean {
  const tier = normalizeFrameLeadsTier(tierValue);
  if (tier === 'INACTIVE') return false;
  if (tier === 'ENTERPRISE') return true;
  if (ENTERPRISE_FEATURES.has(feature)) return false;
  if (CORE_FEATURES.has(feature)) return tier === 'CORE';
  return tier === 'MICRO_PILOT' || tier === 'CORE';
}

export function monthlyLeadQuotaForTier(tierValue: unknown): number {
  const tier = normalizeFrameLeadsTier(tierValue);
  return tier === 'ENTERPRISE' ? 20_000 : tier === 'CORE' ? 500 : tier === 'MICRO_PILOT' ? 25 : 0;
}
