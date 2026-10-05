export type IntentSignalDecision = {
  status?: unknown;
  primaryIntent?: unknown;
  secondaryIntents?: unknown;
  intentSignals?: unknown;
  requiresReview?: unknown;
  reviewReasons?: unknown;
  trace?: { policyResult?: unknown; intentOutput?: unknown } | null;
};

export type DeriveIntentSignalsInput = {
  decision?: IntentSignalDecision | null;
  triageSignals?: unknown;
  intentRisk?: unknown;
  reply?: string | null;
};

type PolicySnapshot = {
  decision?: unknown;
  effectiveEffect?: unknown;
  matchedRuleIds?: unknown;
};

const INTENT_LABELS: Record<string, string> = {
  PRICING: 'Pricing Inquiry',
  PRICING_INQUIRY: 'Pricing Inquiry',
  ASKED_FOR_PRICING: 'Pricing Inquiry',
  NEGOTIATION: 'Negotiation',
  NEGOTIATING: 'Negotiation',
  MEETING_REQUEST: 'Meeting Request',
  MEETING_REQUESTED: 'Meeting Request',
  TIMING_OBJECTION: 'Timing Objection',
  COMPETITOR_OBJECTION: 'Competitor Mentioned',
  COMPETITOR_MENTIONED: 'Competitor Mentioned',
  SECURITY: 'Security Review',
  PROCUREMENT: 'Procurement Review',
  LEGAL: 'Legal Review',
  COMPLIANCE: 'Compliance Review',
  REFERRAL: 'Referred to Colleague',
  POSITIVE_INTEREST: 'Positive Interest',
  FEATURE_QUESTION: 'Feature Question',
  FEATURE_GAP: 'Feature Gap',
  INTEGRATION_QUESTION: 'Integration Question',
  BUDGET_OBJECTION: 'Budget Objection',
  TRUST_OBJECTION: 'Trust Objection',
  REQUESTING_RESOURCES: 'Requesting Resources',
  OOTO_BOUNCED: 'Out of Office / Bounced',
  'MEETING REQUESTED': 'Meeting Request',
  'PRICING INQUIRY': 'Pricing Inquiry',
  'ASKED FOR PRICING': 'Pricing Inquiry',
  'COMPETITOR MENTIONED': 'Competitor Mentioned',
  'REFERRED TO COLLEAGUE': 'Referred to Colleague',
  'REQUESTING RESOURCES': 'Requesting Resources',
  'OOTO / BOUNCED': 'Out of Office / Bounced',
};

function formatSignal(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  const key = clean.toUpperCase().replace(/[ -]+/g, '_');
  const direct = INTENT_LABELS[key] ?? INTENT_LABELS[clean.toUpperCase()];
  if (direct) return direct;
  return clean.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase());
}

function asStrings(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values.filter((item): item is string => typeof item === 'string');
}

function hasMatchedApprovalRule(decision: IntentSignalDecision): boolean {
  const policy = Array.isArray(decision.trace?.policyResult)
    ? decision.trace.policyResult as PolicySnapshot[]
    : [];
  const approvalReason = asStrings(decision.reviewReasons).includes('APPROVAL_REQUIRED');
  return policy.some(item => {
    const matchedRule = Array.isArray(item.matchedRuleIds) && item.matchedRuleIds.length > 0;
    const approvalEffect = item.effectiveEffect === 'REQUIRE_APPROVAL' || item.decision === 'REQUIRE_APPROVAL';
    const policyReview = item.decision === 'REQUIRES_REVIEW';
    return matchedRule && (approvalEffect || (approvalReason && policyReview));
  });
}

/** Derive concise, deduplicated Why Now chips from stored triage and decision evidence. */
export function deriveIntentSignals(input: DeriveIntentSignalsInput): string[] {
  const decision = input.decision ?? {};
  const ordered: string[] = [];
  const add = (value: unknown) => {
    const label = formatSignal(value);
    if (label) ordered.push(label);
  };

  // The primary and secondary classifications come from the persisted decision.
  add(decision.primaryIntent);
  asStrings(decision.secondaryIntents).forEach(add);
  if (Array.isArray(decision.intentSignals)) {
    for (const item of decision.intentSignals) {
      if (item && typeof item === 'object' && 'intent' in item) add(item.intent);
    }
  }
  if (decision.trace?.intentOutput && typeof decision.trace.intentOutput === 'object') {
    const output = decision.trace.intentOutput as { primaryIntent?: unknown; intents?: unknown };
    add(output.primaryIntent);
    if (Array.isArray(output.intents)) {
      for (const item of output.intents) {
        if (item && typeof item === 'object' && 'intent' in item) add(item.intent);
      }
    }
  }

  // A percentage becomes an exception signal only when stored policy evidence shows
  // that a matching rule required approval; the reply alone does not imply an exception.
  const discount = input.reply?.match(/\b(\d+(?:\.\d+)?)%\s+discount\b/i);
  if (discount && hasMatchedApprovalRule(decision)) ordered.push(`${discount[1]}% Discount Exception`);

  // The existing triage classifier emits a bounded set of observable reply labels.
  asStrings(input.triageSignals ?? input.intentRisk).forEach(add);

  const seen = new Set<string>();
  return ordered.filter(label => {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
}
