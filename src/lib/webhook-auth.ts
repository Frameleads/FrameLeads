// ────────────────────────────────────────────────────────────────────────
// PHASE 4: WEBHOOK AUTHENTICATION MIDDLEWARE
//
// WHY THIS EXISTS:
// The /api/ingestion/webhook endpoint is publicly reachable. Without
// authentication, any actor can POST fabricated signals into a user's
// Velvet Rope queue, polluting their triage pipeline with noise or
// malicious payloads. This middleware verifies that the request was
// sent by an authorized external tool using a pre-shared API key.
//
// AUTHENTICATION FLOW:
//   1. External tool sends API key via `X-FrameLeads-Api-Key` header
//      or `?token=...` query parameter.
//   2. This middleware hashes the provided key using SHA-256.
//   3. The hash is looked up in the `ApiKey` table.
//   4. If found and active → request proceeds. `lastUsedAt` is updated.
//   5. If not found → 401 Unauthorized.
//
// KEY STORAGE:
// API keys are stored as SHA-256 hashes. The raw key is shown to the
// user exactly ONCE at creation time and is never stored. This means
// a database breach does not expose usable API keys.
// ────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * Result of an API key verification attempt.
 */
export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
  keyId: string | null;
  error: string | null;
}

/**
 * Hashes a raw API key using SHA-256 for storage and lookup.
 *
 * WHY SHA-256 AND NOT BCRYPT:
 * API keys are high-entropy random strings (not human-chosen passwords).
 * They don't benefit from bcrypt's intentional slowness. SHA-256 gives
 * us constant-time lookups via the database index on `keyHash`, which
 * is critical for webhook latency (external tools expect < 5s responses).
 */
export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Generates a new raw API key.
 *
 * Format: `fl_sig_` prefix + 32 random hex characters.
 * The prefix makes it easy to identify FrameLeads keys in config files
 * and prevents accidental use of unrelated secrets.
 */
export function generateApiKey(): string {
  return `fl_sig_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Extracts the API key from a Request object.
 *
 * Checks two locations in order:
 *   1. `X-FrameLeads-Api-Key` header (preferred — keeps keys out of URLs/logs)
 *   2. `?token=...` query parameter (fallback for tools that can't set headers)
 */
export function extractApiKey(req: Request): string | null {
  // Check header first (preferred)
  const headerKey = req.headers.get("X-FrameLeads-Api-Key");
  if (headerKey && headerKey.trim()) {
    return headerKey.trim();
  }

  // Fallback: query parameter
  try {
    const url = new URL(req.url);
    const tokenParam = url.searchParams.get("token");
    if (tokenParam && tokenParam.trim()) {
      return tokenParam.trim();
    }
  } catch {
    // Malformed URL — no key found
  }

  return null;
}

/**
 * WEBHOOK AUTH: Verifies an API key against the database.
 *
 * This function:
 *   1. Hashes the provided raw key.
 *   2. Looks up the hash in the `ApiKey` table.
 *   3. Verifies the key is active (not revoked).
 *   4. Updates `lastUsedAt` for audit logging.
 *   5. Returns the associated `userId` for downstream use.
 *
 * TIMING: This function makes exactly ONE database query (findUnique
 * on the indexed `keyHash` column) + ONE update. Total latency is
 * typically < 10ms on a properly indexed PostgreSQL instance.
 *
 * @param rawKey — The raw API key extracted from the request.
 * @returns      — An AuthResult with userId on success, error on failure.
 */
export async function verifyApiKey(rawKey: string): Promise<AuthResult> {
  const keyHash = hashApiKey(rawKey);

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!apiKey) {
    return {
      authenticated: false,
      userId: null,
      keyId: null,
      error: "Invalid API key. Verify your X-FrameLeads-Api-Key header.",
    };
  }

  if (!apiKey.isActive) {
    return {
      authenticated: false,
      userId: null,
      keyId: apiKey.id,
      error: "API key has been revoked. Generate a new key in your workspace settings.",
    };
  }

  // Update lastUsedAt for audit trail (fire-and-forget — don't block the response)
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      console.error("[WEBHOOK AUTH] Failed to update lastUsedAt:", err);
    });

  return {
    authenticated: true,
    userId: apiKey.userId,
    keyId: apiKey.id,
    error: null,
  };
}
