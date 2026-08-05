// ────────────────────────────────────────────────────────────────────────
// PHASE 4: SIGNAL PAYLOAD NORMALIZER
//
// WHY THIS EXISTS:
// External tools (Clay, Phantombuster, custom scrapers) each have their
// own payload formats. Clay sends `person.email`, Phantombuster sends
// `result.email`, and custom scrapers send whatever the developer felt
// like that morning. This normalizer extracts a unified schema from
// ANY incoming payload shape so downstream consumers never need to
// know which tool generated the signal.
//
// UNIFIED SCHEMA:
//   prospect_email  — The prospect's email address
//   prospect_name   — The prospect's full name
//   company_name    — The company associated with the signal
//   signal_type     — Categorical tag (FUNDING_ROUND, JOB_CHANGE, etc.)
//   raw_signal_text — The original unstructured signal description
//
// ARCHITECTURE:
// This is a PURE FUNCTION. No database calls, no side effects, no
// network requests. It receives a raw JSON object and returns a
// typed NormalizedSignal or an error. The calling controller handles
// all persistence and downstream routing.
// ────────────────────────────────────────────────────────────────────────

/**
 * Canonical signal types recognized by FrameLeads.
 * External tools can send any string — the normalizer will attempt
 * to match it to one of these. Unrecognized types default to 'OTHER'.
 */
export type SignalType =
  | "FUNDING_ROUND"
  | "JOB_CHANGE"
  | "TECH_STACK_SHIFT"
  | "HIRING_SURGE"
  | "EXECUTIVE_HIRE"
  | "PRODUCT_LAUNCH"
  | "EXPANSION"
  | "PAIN_SIGNAL"
  | "OTHER";

/**
 * The unified signal schema that all downstream consumers operate on.
 * Regardless of whether the source was Clay, Phantombuster, or a
 * custom webhook, the data is always in this shape after normalization.
 */
export interface NormalizedSignal {
  prospectEmail: string;
  prospectName: string;
  companyName: string;
  signalType: SignalType;
  rawSignalText: string;
}

/**
 * Result of a normalization attempt.
 */
export interface NormalizationResult {
  success: boolean;
  signal: NormalizedSignal | null;
  /** Specific fields that were missing or extracted via fallback. */
  warnings: string[];
  error: string | null;
}

// ── Field Extraction Helpers ────────────────────────────────────────────
// Each helper performs a deep, defensive search through common payload
// structures used by Clay, Phantombuster, and generic webhook tools.
// The search order is intentional: most specific paths first, then
// progressively more generic fallbacks.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Recursively searches a nested object for a value matching one of
 * the candidate keys. Returns the first non-empty string found.
 */
function deepExtract(obj: Record<string, any>, candidateKeys: string[]): string {
  // Level 1: direct property match
  for (const key of candidateKeys) {
    if (obj[key] && typeof obj[key] === "string" && obj[key].trim()) {
      return obj[key].trim();
    }
  }

  // Level 2: search inside common wrapper objects
  const wrappers = ["data", "result", "person", "company", "contact", "lead", "payload", "fields"];
  for (const wrapper of wrappers) {
    if (obj[wrapper] && typeof obj[wrapper] === "object" && !Array.isArray(obj[wrapper])) {
      for (const key of candidateKeys) {
        const val = obj[wrapper][key];
        if (val && typeof val === "string" && val.trim()) {
          return val.trim();
        }
      }
    }
  }

  // Level 3: search two levels deep (e.g., data.person.email)
  for (const wrapper of wrappers) {
    if (obj[wrapper] && typeof obj[wrapper] === "object") {
      for (const innerWrapper of wrappers) {
        const inner = obj[wrapper][innerWrapper];
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          for (const key of candidateKeys) {
            const val = inner[key];
            if (val && typeof val === "string" && val.trim()) {
              return val.trim();
            }
          }
        }
      }
    }
  }

  return "";
}

/**
 * Extracts the prospect's email from a payload.
 * Searches through common field names used by Clay, Phantombuster,
 * and generic webhook payloads.
 */
function extractEmail(payload: Record<string, any>): string {
  return deepExtract(payload, [
    "prospect_email",
    "email",
    "emailAddress",
    "email_address",
    "contact_email",
    "work_email",
    "person_email",
  ]);
}

/**
 * Extracts the prospect's name from a payload.
 * Handles both `full_name` fields and `first_name + last_name` composition.
 */
function extractName(payload: Record<string, any>): string {
  // Try full name first
  const fullName = deepExtract(payload, [
    "prospect_name",
    "name",
    "full_name",
    "fullName",
    "contact_name",
    "person_name",
  ]);

  if (fullName) return fullName;

  // Fall back to first + last composition
  const firstName = deepExtract(payload, [
    "first_name",
    "firstName",
    "given_name",
  ]);
  const lastName = deepExtract(payload, [
    "last_name",
    "lastName",
    "family_name",
    "surname",
  ]);

  if (firstName && lastName) return `${firstName} ${lastName}`;
  if (firstName) return firstName;
  if (lastName) return lastName;

  return "";
}

/**
 * Extracts the company name from a payload.
 */
function extractCompany(payload: Record<string, any>): string {
  return deepExtract(payload, [
    "company_name",
    "companyName",
    "company",
    "organization",
    "org_name",
    "account_name",
  ]);
}

/**
 * Extracts the raw signal description text.
 */
function extractSignalText(payload: Record<string, any>): string {
  const text = deepExtract(payload, [
    "raw_signal_text",
    "signal_text",
    "signalText",
    "signal",
    "trigger_text",
    "description",
    "context",
    "notes",
    "message",
    "body",
    "details",
  ]);

  // If no specific signal text found, serialize the entire payload
  // as a fallback so the LLM has SOMETHING to work with.
  if (!text) {
    try {
      return JSON.stringify(payload, null, 0).slice(0, 2000);
    } catch {
      return "";
    }
  }

  return text;
}

// ── Signal Type Classification ──────────────────────────────────────────
// Maps raw signal_type strings from external tools to our canonical enum.
// Uses keyword matching to handle the inevitable inconsistency in how
// different tools label their signals.
// ─────────────────────────────────────────────────────────────────────────

const SIGNAL_TYPE_PATTERNS: Array<{ pattern: RegExp; type: SignalType }> = [
  { pattern: /fund(ing|ed|raise)/i, type: "FUNDING_ROUND" },
  { pattern: /series\s*[a-f]/i, type: "FUNDING_ROUND" },
  { pattern: /raised/i, type: "FUNDING_ROUND" },
  { pattern: /job.?change/i, type: "JOB_CHANGE" },
  { pattern: /new.?(role|position|job|title)/i, type: "JOB_CHANGE" },
  { pattern: /promoted/i, type: "JOB_CHANGE" },
  { pattern: /tech.?stack/i, type: "TECH_STACK_SHIFT" },
  { pattern: /adopted|migrat(ed|ing)|switch(ed|ing)/i, type: "TECH_STACK_SHIFT" },
  { pattern: /hir(ing|ed)|recruit/i, type: "HIRING_SURGE" },
  { pattern: /open.?roles?/i, type: "HIRING_SURGE" },
  { pattern: /exec(utive)?.?hire/i, type: "EXECUTIVE_HIRE" },
  { pattern: /c[eo-]?[tsmo]o|vp\s/i, type: "EXECUTIVE_HIRE" },
  { pattern: /launch(ed|ing)?|ship(ped|ping)?/i, type: "PRODUCT_LAUNCH" },
  { pattern: /expan(d|sion)|new.?(market|office|region)/i, type: "EXPANSION" },
  { pattern: /pain|struggle|churn|complain/i, type: "PAIN_SIGNAL" },
];

/**
 * Classifies a raw signal type string into our canonical enum.
 *
 * Checks the explicit `signal_type` field first, then falls back to
 * scanning the raw signal text for keyword patterns.
 */
function classifySignalType(
  payload: Record<string, any>,
  rawText: string
): SignalType {
  // Check explicit signal_type field
  const explicit = deepExtract(payload, [
    "signal_type",
    "signalType",
    "trigger_type",
    "event_type",
    "type",
  ]);

  const searchText = `${explicit} ${rawText}`.toLowerCase();

  for (const { pattern, type } of SIGNAL_TYPE_PATTERNS) {
    if (pattern.test(searchText)) {
      return type;
    }
  }

  return "OTHER";
}

// ── The Normalizer ──────────────────────────────────────────────────────

/**
 * PAYLOAD NORMALIZER: Transforms any external webhook payload into
 * the unified NormalizedSignal schema.
 *
 * DEFENSIVE BY DESIGN:
 * - Missing `prospect_name` → defaults to "Unknown Prospect" with a warning
 * - Missing `company_name` → defaults to "Unknown Company" with a warning
 * - Missing `prospect_email` → HARD FAIL (we need a routing target)
 * - Missing `signal_text` → serializes entire payload as fallback
 * - Unrecognized `signal_type` → defaults to "OTHER"
 *
 * @param rawPayload — The raw JSON object from the webhook request body.
 * @returns          — A NormalizationResult with the unified signal or an error.
 */
export function normalizeSignalPayload(
  rawPayload: Record<string, any>
): NormalizationResult {
  const warnings: string[] = [];

  // ── Extract fields ──────────────────────────────────────────────
  const prospectEmail = extractEmail(rawPayload);
  const prospectName = extractName(rawPayload);
  const companyName = extractCompany(rawPayload);
  const rawSignalText = extractSignalText(rawPayload);
  const signalType = classifySignalType(rawPayload, rawSignalText);

  // ── Validate required fields ────────────────────────────────────
  // Email is the ONLY hard requirement. Without it, we have no
  // routing target for the outbound message.
  if (!prospectEmail) {
    return {
      success: false,
      signal: null,
      warnings,
      error:
        "Normalization failed: No prospect email found in payload. " +
        "Ensure the webhook includes a field like 'email', 'prospect_email', or 'data.email'.",
    };
  }

  // Basic email format validation
  if (!prospectEmail.includes("@") || !prospectEmail.includes(".")) {
    return {
      success: false,
      signal: null,
      warnings,
      error: `Normalization failed: Invalid email format — "${prospectEmail}".`,
    };
  }

  // ── Soft defaults with warnings ─────────────────────────────────
  let finalName = prospectName;
  if (!finalName) {
    finalName = "Unknown Prospect";
    warnings.push("prospect_name not found — defaulted to 'Unknown Prospect'.");
  }

  let finalCompany = companyName;
  if (!finalCompany) {
    finalCompany = "Unknown Company";
    warnings.push("company_name not found — defaulted to 'Unknown Company'.");
  }

  if (!rawSignalText || rawSignalText === "{}") {
    warnings.push("raw_signal_text empty — LLM draft will have limited context.");
  }

  return {
    success: true,
    signal: {
      prospectEmail,
      prospectName: finalName,
      companyName: finalCompany,
      signalType,
      rawSignalText,
    },
    warnings,
    error: null,
  };
}
