// ────────────────────────────────────────────────────────────────────────
// PHASE 3: THROTTLE PROTOCOL — HARD-CAP RATE LIMITING
//
// WHY THIS EXISTS:
// Spam-cannons burn infrastructure. Sending 200+ cold emails per day
// from a single inbox is the fastest way to get flagged, blacklisted,
// and permanently damage domain deliverability. Even "warming" services
// can't recover a domain once it hits a major blacklist.
//
// THE RULE:
// A strict, UNCHANGEABLE limit of 30 emails per inbox per day.
// This is hardcoded as a constant — it is NOT configurable via the UI,
// NOT overridable by admin settings, and NOT adjustable per-user.
// The number 30 is derived from deliverability best practices for
// cold outbound on domains less than 90 days old.
//
// ARCHITECTURE:
// This module provides two functions:
//   1. `checkThrottle()` — Pre-flight check that queries the database
//      to count today's sends for a specific inbox. Returns pass/fail.
//   2. `recordSend()` — Records a successful send in the OutboundLog
//      table for future throttle checks.
//
// Both functions use Prisma ORM for parameterized queries to prevent
// SQL injection. The date boundary uses UTC midnight-to-midnight to
// ensure consistent counting regardless of the user's timezone.
// ────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

// ── THE HARD CAP ────────────────────────────────────────────────────────
// DO NOT make this configurable. DO NOT expose this to the UI.
// DO NOT create an admin override. This is a governance constraint,
// not a preference.
//
// If a customer needs to send more than 30/day/inbox, they must
// connect additional sending inboxes — which is the architecturally
// correct solution because it distributes volume across domains.
// ─────────────────────────────────────────────────────────────────────────

const DAILY_SEND_LIMIT_PER_INBOX = 30 as const;

/**
 * Result of a throttle pre-flight check.
 */
export interface ThrottleCheckResult {
  /** Whether the inbox is allowed to send. */
  allowed: boolean;
  /** How many emails this inbox has sent today. */
  sentToday: number;
  /** The hard cap (always 30). */
  dailyLimit: typeof DAILY_SEND_LIMIT_PER_INBOX;
  /** How many sends remain before the throttle engages. */
  remaining: number;
  /** If throttled, the status tag to persist on the deployment record. */
  status: "ready" | "governance_throttled";
  /** Human-readable message for the frontend. */
  message: string;
}

/**
 * Computes the UTC midnight boundaries for "today."
 *
 * Uses UTC to guarantee deterministic counting regardless of
 * server timezone, user timezone, or deployment region.
 * A send at 11:59pm UTC counts for today; 12:00am UTC starts fresh.
 */
function getTodayBoundaries(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  return { start, end };
}

/**
 * THROTTLE PROTOCOL: Pre-flight check.
 *
 * This function MUST be called immediately before attempting to send
 * ANY outbound email from a specific inbox. It queries the database
 * to count how many emails this inbox has already sent today.
 *
 * If `sentToday >= 30`, the function returns `allowed: false` with
 * a status of `governance_throttled`. The calling controller MUST
 * halt deployment for this inbox and log the throttle event.
 *
 * PARAMETERIZED QUERY: Uses Prisma's `count()` with typed `where`
 * clauses — no raw SQL, no string concatenation, no injection risk.
 *
 * @param inboxId — The unique ID of the SendingInbox being checked.
 * @returns       — A ThrottleCheckResult indicating send/halt.
 */
export async function checkThrottle(
  inboxId: string
): Promise<ThrottleCheckResult> {
  const { start, end } = getTodayBoundaries();

  // Count all emails sent by this inbox within today's UTC window.
  const sentToday = await prisma.outboundLog.count({
    where: {
      inboxId: inboxId,
      sentAt: {
        gte: start,
        lte: end,
      },
      // Only count successfully sent emails — failed/bounced don't
      // consume the quota.
      status: "sent",
    },
  });

  const remaining = Math.max(0, DAILY_SEND_LIMIT_PER_INBOX - sentToday);
  const allowed = sentToday < DAILY_SEND_LIMIT_PER_INBOX;

  if (!allowed) {
    return {
      allowed: false,
      sentToday,
      dailyLimit: DAILY_SEND_LIMIT_PER_INBOX,
      remaining: 0,
      status: "governance_throttled",
      message:
        `Inbox throttled: ${sentToday}/${DAILY_SEND_LIMIT_PER_INBOX} daily sends consumed. ` +
        `Deployment halted to protect domain reputation. Resumes at 00:00 UTC.`,
    };
  }

  return {
    allowed: true,
    sentToday,
    dailyLimit: DAILY_SEND_LIMIT_PER_INBOX,
    remaining,
    status: "ready",
    message: `${remaining} sends remaining today (${sentToday}/${DAILY_SEND_LIMIT_PER_INBOX} used).`,
  };
}

/**
 * Records a successful outbound send in the OutboundLog table.
 *
 * This MUST be called AFTER a successful email dispatch — not before.
 * The log entry is what future `checkThrottle()` calls count against.
 * If this function fails, the send still happened but won't be counted,
 * which means the throttle may under-count by 1. This is acceptable —
 * under-counting by 1 is safer than over-sending by 30.
 *
 * @param inboxId — The ID of the sending inbox.
 * @param leadId  — The ID of the lead who received the email.
 * @param channel — The outbound channel (defaults to "email").
 */
export async function recordSend(
  inboxId: string,
  leadId: string,
  channel: string = "email"
): Promise<void> {
  await prisma.outboundLog.create({
    data: {
      inboxId,
      leadId,
      channel,
      status: "sent",
      sentAt: new Date(),
    },
  });
}

/**
 * Batch pre-flight check: validates throttle status for a list of
 * leads against a specific inbox.
 *
 * Returns the maximum number of leads that can be sent from this
 * inbox today without exceeding the throttle. The calling controller
 * should slice the deployment queue to this count.
 *
 * @param inboxId    — The ID of the sending inbox.
 * @param queueSize  — The total number of leads in the deployment queue.
 * @returns          — ThrottleCheckResult with `remaining` capped to queueSize.
 */
export async function preflightBatchCheck(
  inboxId: string,
  queueSize: number
): Promise<ThrottleCheckResult & { deployableCount: number }> {
  const result = await checkThrottle(inboxId);
  const deployableCount = Math.min(result.remaining, queueSize);

  return {
    ...result,
    deployableCount,
    message: result.allowed
      ? `${deployableCount} of ${queueSize} leads can be deployed (${result.remaining} sends remaining).`
      : result.message,
  };
}
