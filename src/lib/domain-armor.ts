// ────────────────────────────────────────────────────────────────────────
// PHASE 3: DOMAIN ARMOR — ROOT DOMAIN BLOCK
//
// WHY THIS EXISTS:
// Sending cold outbound from a root brand domain (e.g., @company.com)
// is a catastrophic deliverability risk. If the domain gets flagged by
// spam filters, ALL company email (including internal, customer support,
// and transactional) is compromised. This is an extinction-level event
// for a business's email infrastructure.
//
// THE RULE:
// Users MUST send outbound from secondary/lookalike domains (e.g.,
// @trycompany.com, @getcompany.io). This utility physically blocks
// deployment if the sender email's domain matches the user's root
// brand domain.
//
// ARCHITECTURE:
// This is a STATELESS validation function. It receives two strings
// (root domain + sender email), performs domain extraction and
// comparison, and returns a pass/fail result. It does NOT interact
// with the database or trigger side effects. The calling controller
// is responsible for halting deployment on failure.
// ────────────────────────────────────────────────────────────────────────

/**
 * Result of a Domain Armor validation check.
 */
export interface DomainArmorResult {
  /** Whether the sender email passed the domain check. */
  passed: boolean;
  /** The extracted domain from the sender email. */
  senderDomain: string;
  /** The user's root brand domain being protected. */
  rootBrandDomain: string;
  /** Human-readable error message if the check failed. */
  error: string | null;
}

/**
 * Extracts the domain portion from an email address.
 *
 * Handles edge cases:
 * - Whitespace trimming
 * - Case normalization (domains are case-insensitive per RFC 5321)
 * - Malformed emails (returns empty string)
 *
 * @param email — A full email address (e.g., "outbound@trycompany.com")
 * @returns     — The lowercase domain (e.g., "trycompany.com"), or "" if invalid.
 */
export function extractDomain(email: string): string {
  if (!email || typeof email !== "string") return "";
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex === -1 || atIndex === trimmed.length - 1) return "";
  return trimmed.slice(atIndex + 1);
}

/**
 * Normalizes a domain string for comparison.
 *
 * - Strips leading "www." (a common user input error)
 * - Lowercases everything
 * - Trims whitespace
 *
 * @param domain — A raw domain string (e.g., "www.Company.com")
 * @returns      — The normalized domain (e.g., "company.com")
 */
export function normalizeDomain(domain: string): string {
  if (!domain || typeof domain !== "string") return "";
  return domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

/**
 * DOMAIN ARMOR: Root Domain Block
 *
 * Compares the authenticated user's root brand domain against the
 * sender email address attempting to deploy the campaign.
 *
 * GOVERNANCE RULE:
 * If the sender email's domain EXACTLY matches the root brand domain,
 * deployment is physically blocked with a specific error message.
 *
 * IMPORTANT: This check is MANDATORY before any outbound deployment.
 * The calling controller must verify `result.passed === true` before
 * proceeding. There is no override, no admin bypass, no "are you sure?"
 * confirmation. This is a hard block.
 *
 * @param rootBrandDomain — The user's registered root brand domain (e.g., "company.com").
 * @param senderEmail     — The specific email address attempting to send (e.g., "outbound@trycompany.com").
 * @returns               — A DomainArmorResult indicating pass/fail.
 */
export function validateSenderDomain(
  rootBrandDomain: string,
  senderEmail: string
): DomainArmorResult {
  const normalizedRoot = normalizeDomain(rootBrandDomain);
  const senderDomain = extractDomain(senderEmail);

  // ── Input validation ───────────────────────────────────────────────
  if (!normalizedRoot) {
    // If no root brand domain is configured, we cannot validate.
    // This is a configuration error — block deployment defensively.
    return {
      passed: false,
      senderDomain,
      rootBrandDomain: rootBrandDomain || "",
      error:
        "Deployment blocked: No root brand domain configured in workspace settings. " +
        "Please set your root brand domain before deploying outbound campaigns.",
    };
  }

  if (!senderDomain) {
    return {
      passed: false,
      senderDomain: "",
      rootBrandDomain: normalizedRoot,
      error:
        "Deployment blocked: Invalid sender email address. " +
        "Please connect a valid sending inbox.",
    };
  }

  // ── THE CORE CHECK ─────────────────────────────────────────────────
  // Exact domain match = catastrophic risk. Block immediately.
  //
  // We compare the FULL domain, not substrings. This means:
  //   "company.com"    vs "company.com"     → BLOCKED ✗
  //   "trycompany.com" vs "company.com"     → ALLOWED ✓
  //   "mail.company.com" vs "company.com"   → ALLOWED ✓ (subdomain ≠ root)
  //   "company.io"     vs "company.com"     → ALLOWED ✓ (different TLD)
  //
  // NOTE: We deliberately do NOT block subdomains of the root domain
  // (e.g., "mail.company.com"). Subdomains carry their own reputation
  // and are a legitimate sending strategy. Only the EXACT root match
  // is blocked.
  // ───────────────────────────────────────────────────────────────────

  if (senderDomain === normalizedRoot) {
    return {
      passed: false,
      senderDomain,
      rootBrandDomain: normalizedRoot,
      error:
        "Deployment blocked: FrameLeads Governance prevents sending outbound from your root brand domain. " +
        "Please connect a secondary lookalike domain.",
    };
  }

  // ── Domain is safe — deployment can proceed ────────────────────────
  return {
    passed: true,
    senderDomain,
    rootBrandDomain: normalizedRoot,
    error: null,
  };
}
