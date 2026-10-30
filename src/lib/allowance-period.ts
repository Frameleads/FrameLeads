import type { FrameLeadsTier } from './entitlements';

export type VerifiedAllowancePeriod = {
  tier: 'CORE' | 'ENTERPRISE'; membershipId: string; companyId: string; subjectId: string;
  planId: string; billingDays: number; start: number; end: number; verifiedAt: number;
};
export class AllowanceError extends Error {
  constructor(public code: string, public status = 409) { super(code); this.name = 'AllowanceError'; }
}
export function recurringTier(tier: FrameLeadsTier | string): tier is 'CORE' | 'ENTERPRISE' {
  return tier === 'CORE' || tier === 'ENTERPRISE';
}
