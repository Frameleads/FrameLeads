// ────────────────────────────────────────────────────────────────────────
// PHASE 2: THERMAL CLASSIFICATION SERVICE
//
// WHY THIS EXISTS:
// Prospects rarely give clean binary answers to Micro-Commitment campaigns.
// "Maybe next week, send info" is not a Yes or No — it's a WARM signal
// that requires triage. Building a separate Yes/No logic tree would create
// a second source of truth and guarantee classification drift over time.
//
// SINGLE SOURCE OF TRUTH:
// ALL inbound replies — including those from Micro-Commitment campaigns —
// are routed through this ThermalClassifier. The classifier produces a
// ThermalScore (COLD, WARM, HOT) that determines Velvet Rope routing:
//
//   HOT  → Fast-track to Inbox Triage (human approval required)
//   WARM → Queue for AI-assisted draft generation, then Inbox Triage
//   COLD → Auto-archive with optional drip re-engagement
//
// ARCHITECTURAL CONSTRAINT:
// This service is STATELESS. It receives a reply payload, classifies it,
// and returns a score. It does NOT write to the database, trigger side
// effects, or modify the reply. The calling controller is responsible
// for persisting the classification and routing to the Velvet Rope.
// ────────────────────────────────────────────────────────────────────────

/** Thermal classification tiers. */
export type ThermalScore = "HOT" | "WARM" | "COLD";

/** The campaign type that generated the original outbound message. */
export type CampaignType =
  | "pipeline_governance"
  | "outbound_scaling"
  | "wedge_offer"
  | "micro_commitment"
  | "custom";

/**
 * Inbound reply payload — the raw data ingested from a prospect's response.
 *
 * This is the canonical input shape for ALL classification requests,
 * regardless of campaign type. Micro-Commitment replies use the exact
 * same structure; they are NOT special-cased at the data layer.
 */
export interface InboundReply {
  /** Unique identifier for this reply event. */
  replyId: string;
  /** The lead/prospect who replied. */
  leadId: string;
  /** The campaign that generated the original outbound message. */
  campaignId: string;
  /** The type of campaign — used for logging, NOT for classification branching. */
  campaignType: CampaignType;
  /** The channel the reply came in on. */
  channel: "email" | "linkedin" | "whatsapp" | "cold_call";
  /** The raw text body of the prospect's reply. */
  body: string;
  /** ISO timestamp of when the reply was received. */
  receivedAt: string;
  /** Optional: the original outbound message for context. */
  originalOutbound?: string;
  /** Optional: pipeline value associated with this deal. */
  pipelineValue?: number;
}

/**
 * Output of the ThermalClassifier. Contains the score, the reasoning,
 * and routing metadata for downstream consumers.
 */
export interface ThermalClassification {
  /** The thermal score assigned to this reply. */
  score: ThermalScore;
  /** Human-readable reasoning for the classification (for audit logs). */
  reasoning: string;
  /** Confidence level (0-1) — future-proofing for ML-based classification. */
  confidence: number;
  /** Whether this reply should be fast-tracked to human review. */
  requiresHumanReview: boolean;
  /** Suggested Velvet Rope routing action. */
  routingAction: "fast_track_triage" | "queue_ai_draft" | "auto_archive";
}

// ── Signal Detection Patterns ───────────────────────────────────────────
// These are keyword/phrase patterns used for rule-based classification.
// In production, these would be supplemented or replaced by an LLM-based
// classifier, but the rule-based layer provides a deterministic floor
// that guarantees no signal is ever misrouted due to LLM hallucination.
// ─────────────────────────────────────────────────────────────────────────

/** Phrases that indicate active buying intent (HOT). */
const HOT_SIGNALS: RegExp[] = [
  /\byes\b/i,
  /\blet'?s do it\b/i,
  /\bbook\s*(a|the)?\s*(call|meeting|demo|time)\b/i,
  /\bschedule\b/i,
  /\bsend\s*(it|the|me|over)\b/i,
  /\binterested\b/i,
  /\bwant\s*to\s*(see|learn|know|hear)\b/i,
  /\bsign\s*me\s*up\b/i,
  /\blet'?s\s*talk\b/i,
  /\bforward\s*(it|this)\s*to\b/i,
  /\bhow\s*(much|soon|quickly)\b/i,
  /\bpricing\b/i,
  /\bbudget\b/i,
  /\bnext\s*step/i,
];

/** Phrases that indicate soft interest but no commitment (WARM). */
const WARM_SIGNALS: RegExp[] = [
  /\bmaybe\b/i,
  /\bnot\s*right\s*now\b/i,
  /\bnext\s*(week|month|quarter)\b/i,
  /\bsend\s*(info|details|more)\b/i,
  /\btell\s*me\s*more\b/i,
  /\bwhat\s*(exactly|specifically)\b/i,
  /\bhow\s*(does|do)\s*(it|this|that)\s*work\b/i,
  /\bcheck\s*with\b/i,
  /\brun\s*it\s*by\b/i,
  /\bfollow\s*up\b/i,
  /\bcurious\b/i,
  /\bneed\s*to\s*think\b/i,
  /\binteresting\b/i,
];

/** Phrases that indicate disengagement or rejection (COLD). */
const COLD_SIGNALS: RegExp[] = [
  /\bno\s*(thanks?|thank\s*you)\b/i,
  /\bunsubscribe\b/i,
  /\bremove\s*me\b/i,
  /\bstop\s*(emailing|contacting|messaging)\b/i,
  /\bnot\s*interested\b/i,
  /\bdon'?t\s*contact\b/i,
  /\bwrong\s*person\b/i,
  /\bleft\s*the\s*company\b/i,
  /\bno\s*longer\b/i,
  /\bopt\s*out\b/i,
  /\bspam\b/i,
];

// ── The Classifier ──────────────────────────────────────────────────────

/**
 * ThermalClassifier — the SINGLE SOURCE OF TRUTH for reply classification.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINT:
 * This function handles ALL inbound replies regardless of campaign type.
 * Micro-Commitment replies are NOT special-cased. They flow through the
 * exact same pattern matching and scoring logic as every other reply.
 * The `campaignType` field is logged for analytics but does NOT influence
 * the classification algorithm.
 *
 * @param reply — The raw inbound reply payload.
 * @returns     — A ThermalClassification with score, reasoning, and routing.
 */
export function classifyReply(reply: InboundReply): ThermalClassification {
  const body = reply.body.trim();

  // ── Edge case: empty or extremely short replies ──────────────────
  if (!body || body.length < 2) {
    return {
      score: "COLD",
      reasoning: "Empty or near-empty reply body — no actionable signal detected.",
      confidence: 0.95,
      requiresHumanReview: false,
      routingAction: "auto_archive",
    };
  }

  // ── Score accumulation ──────────────────────────────────────────────
  // We count signal matches across all three tiers. The tier with the
  // highest match count wins. In case of a tie, we escalate (HOT > WARM > COLD)
  // because a false positive on a $40k deal is cheaper than a false negative.

  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;

  for (const pattern of HOT_SIGNALS) {
    if (pattern.test(body)) hotCount++;
  }
  for (const pattern of WARM_SIGNALS) {
    if (pattern.test(body)) warmCount++;
  }
  for (const pattern of COLD_SIGNALS) {
    if (pattern.test(body)) coldCount++;
  }

  // ── Pipeline value escalation ──────────────────────────────────────
  // If the deal is worth $25k+, we automatically bump WARM → HOT.
  // Losing a high-value deal to a missed warm signal is unacceptable.
  const isHighValue = (reply.pipelineValue ?? 0) >= 25_000;

  // ── Classification decision ────────────────────────────────────────
  let score: ThermalScore;
  let reasoning: string;
  let confidence: number;

  if (hotCount > 0 && hotCount >= coldCount) {
    score = "HOT";
    reasoning = `Detected ${hotCount} active buying signal(s): explicit interest, scheduling intent, or pricing inquiry.`;
    confidence = Math.min(0.95, 0.6 + hotCount * 0.1);
  } else if (coldCount > 0 && coldCount > hotCount && coldCount > warmCount) {
    score = "COLD";
    reasoning = `Detected ${coldCount} disengagement signal(s): opt-out, rejection, or wrong-person indicator.`;
    confidence = Math.min(0.95, 0.6 + coldCount * 0.1);
  } else if (warmCount > 0) {
    score = "WARM";
    reasoning = `Detected ${warmCount} soft-interest signal(s): deferred interest, information request, or conditional engagement.`;
    confidence = Math.min(0.9, 0.5 + warmCount * 0.1);
  } else {
    // No clear signals detected — default to WARM to avoid losing deals.
    // A human reviewer in the Velvet Rope will make the final call.
    score = "WARM";
    reasoning = "No definitive signals detected. Defaulting to WARM to preserve deal optionality — requires human review.";
    confidence = 0.4;
  }

  // ── High-value escalation override ─────────────────────────────────
  if (isHighValue && score === "WARM") {
    score = "HOT";
    reasoning += ` [ESCALATED: Pipeline value $${(reply.pipelineValue ?? 0).toLocaleString()} exceeds $25k threshold — bumped WARM → HOT.]`;
    confidence = Math.min(0.95, confidence + 0.15);
  }

  // ── Routing decision ───────────────────────────────────────────────
  let routingAction: ThermalClassification["routingAction"];
  let requiresHumanReview: boolean;

  switch (score) {
    case "HOT":
      routingAction = "fast_track_triage";
      requiresHumanReview = true;
      break;
    case "WARM":
      routingAction = "queue_ai_draft";
      requiresHumanReview = true;
      break;
    case "COLD":
      routingAction = "auto_archive";
      requiresHumanReview = false;
      break;
  }

  return {
    score,
    reasoning,
    confidence,
    requiresHumanReview,
    routingAction,
  };
}
