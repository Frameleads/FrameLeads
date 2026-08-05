// ────────────────────────────────────────────────────────────────────────
// PHASE 2: DETERMINISTIC WORD-COUNT ENFORCEMENT
//
// WHY THIS EXISTS:
// LLMs cannot reliably count their own words via prompt instructions.
// Gemini/Claude will routinely output 90-120 words when instructed to
// write "max 75 words." This is a PHYSICAL CODE-LEVEL BARRIER that
// intercepts AI-generated copy BEFORE it reaches the client or database.
//
// SCOPE ISOLATION (Triage Fencing):
// This middleware is designed to be called ONLY from outbound generation
// endpoints (/api/generate). It must NEVER be imported or invoked from
// /api/triage/* routes. Triage handles complex objection responses on
// high-value deals ($40k+) and needs room to breathe — imposing a 75-word
// cap on a $40,000 deal objection override would be business-destructive.
//
// The architectural boundary is enforced by convention AND by the
// `context` parameter: the function physically refuses to run if
// the context is set to 'triage'.
// ────────────────────────────────────────────────────────────────────────

/** The hard word-count ceiling for outbound generation channels. */
export const OUTBOUND_WORD_LIMIT = 75;

/** Maximum number of regeneration attempts before returning a truncated fallback. */
export const MAX_RETRIES = 2;

/** Pipeline context tag — used to enforce scope isolation. */
export type PipelineContext = "outbound" | "triage";

/**
 * Result of a word-count enforcement check.
 */
export interface WordCountResult {
  /** Whether the text passed the word-count gate. */
  passed: boolean;
  /** The original or truncated text. */
  text: string;
  /** Actual word count of the input text. */
  wordCount: number;
  /** Whether the text was forcibly truncated as a last resort. */
  wasTruncated: boolean;
}

/**
 * Counts words in a string using whitespace tokenization.
 *
 * IMPLEMENTATION NOTE: We split on whitespace boundaries rather than
 * using a regex like /\b\w+\b/ because the latter miscounts hyphenated
 * words (e.g., "logic-driven" = 1 word in copywriting, 2 in regex).
 * Whitespace splitting matches how a human copywriter counts words.
 */
export function countWords(text: string): number {
  if (!text || typeof text !== "string") return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

/**
 * Truncates text to the word limit by slicing at word boundaries.
 * Appends an ellipsis to signal the truncation to downstream consumers.
 */
export function truncateToLimit(text: string, limit: number = OUTBOUND_WORD_LIMIT): string {
  const words = text.trim().split(/\s+/).filter((t) => t.length > 0);
  if (words.length <= limit) return text;
  return words.slice(0, limit).join(" ") + "…";
}

/**
 * Enforces the word-count gate on a single text string.
 *
 * CRITICAL: This function is the physical barrier. If the text exceeds
 * OUTBOUND_WORD_LIMIT, it returns `passed: false`. The caller is
 * responsible for triggering a regeneration attempt.
 *
 * @param text     — The AI-generated copy to validate.
 * @param context  — Pipeline context. If 'triage', the gate is bypassed entirely.
 */
export function enforceWordLimit(
  text: string,
  context: PipelineContext = "outbound"
): WordCountResult {
  // ── SCOPE ISOLATION: Triage bypass ─────────────────────────────────
  // If this function is somehow called from a triage context, it must
  // unconditionally pass. This is a HARD architectural boundary.
  if (context === "triage") {
    return {
      passed: true,
      text,
      wordCount: countWords(text),
      wasTruncated: false,
    };
  }

  const wc = countWords(text);

  if (wc <= OUTBOUND_WORD_LIMIT) {
    return { passed: true, text, wordCount: wc, wasTruncated: false };
  }

  // Gate failed — text exceeds the limit.
  return { passed: false, text, wordCount: wc, wasTruncated: false };
}

/**
 * Validates all four outbound channels in a generated lead payload.
 * Returns per-channel results so the caller knows WHICH channels failed.
 *
 * USAGE: Called from /api/generate AFTER the LLM returns a response
 * and BEFORE the response is sent to the client.
 */
export interface ChannelValidation {
  email: WordCountResult;
  linkedin: WordCountResult;
  coldCall: WordCountResult;
  whatsapp: WordCountResult;
  /** True only if ALL channels passed the gate. */
  allPassed: boolean;
}

export function validateGeneratedChannels(
  generated: {
    email?: { subject?: string; body?: string };
    linkedin?: { body?: string };
    coldCall?: { body?: string };
    whatsapp?: { body?: string };
  },
  context: PipelineContext = "outbound"
): ChannelValidation {
  const email = enforceWordLimit(generated.email?.body || "", context);
  const linkedin = enforceWordLimit(generated.linkedin?.body || "", context);
  const coldCall = enforceWordLimit(generated.coldCall?.body || "", context);
  const whatsapp = enforceWordLimit(generated.whatsapp?.body || "", context);

  return {
    email,
    linkedin,
    coldCall,
    whatsapp,
    allPassed: email.passed && linkedin.passed && coldCall.passed && whatsapp.passed,
  };
}

/**
 * Last-resort truncation applied when all retry attempts have been
 * exhausted. Rather than returning nothing (which breaks the UI),
 * we truncate each channel to the word limit and flag `wasTruncated`.
 *
 * This ensures the Velvet Rope Protocol is still respected: the user
 * sees copy and can manually approve/edit before deployment.
 */
export function forceCompliance(generated: {
  email?: { subject?: string; body?: string };
  linkedin?: { body?: string };
  coldCall?: { body?: string };
  whatsapp?: { body?: string };
}): {
  email: { subject: string; body: string };
  linkedin: { body: string };
  coldCall: { body: string };
  whatsapp: { body: string };
} {
  return {
    email: {
      subject: generated.email?.subject || "",
      body: truncateToLimit(generated.email?.body || ""),
    },
    linkedin: {
      body: truncateToLimit(generated.linkedin?.body || ""),
    },
    coldCall: {
      body: truncateToLimit(generated.coldCall?.body || ""),
    },
    whatsapp: {
      body: truncateToLimit(generated.whatsapp?.body || ""),
    },
  };
}
