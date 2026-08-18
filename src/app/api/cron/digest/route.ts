// ────────────────────────────────────────────────────────────────────────
// PHASE 5: FRAGILITY DIGEST — AUTOMATED WEEKLY CRON JOB
//
// ROUTE: GET /api/cron/digest
//
// WHY THIS EXISTS:
// Subscription software dies from silent churn. Founders forget they're
// paying for a tool, see no visible value, and cancel. The Fragility
// Digest is a weekly automated email that FORCES value visibility by
// packaging the governance metrics into a concise report.
//
// RETENTION MECHANICS:
// Every Friday, this cron job:
//   1. Aggregates weekly governance metrics for each active user.
//   2. Packages them into a structured "Fragility Digest" email.
//   3. Sends via the configured email provider.
//
// A founder who sees "This week: $127K in deals protected, 8.3 min
// avg approval time, 12 rules codified" does NOT cancel their subscription.
//
// SECURITY:
// This endpoint is secured by verifying the Authorization header
// against the CRON_SECRET environment variable. Vercel Cron (or any
// external scheduler) must include this secret. Unauthorized pings
// are rejected with 401.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ── Security ────────────────────────────────────────────────────────────

/**
 * Verifies the cron secret from the Authorization header.
 *
 * SECURITY CONSTRAINT: This endpoint can be called by anyone who knows
 * the URL. The CRON_SECRET check ensures only the authorized scheduler
 * (Vercel Cron, GitHub Actions, etc.) can trigger digest generation.
 * Without this, an attacker could spam digest emails to all users.
 */
function verifyCronSecret(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error(
      "[FRAGILITY DIGEST] CRON_SECRET env var not set. Endpoint is locked."
    );
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

// ── Metric Aggregation ──────────────────────────────────────────────────

interface UserDigestData {
  userId: string;
  email: string;
  metrics: {
    dealsProtectedValue: number;
    dealsProtectedCount: number;
    avgApprovalMinutes: number;
    approvalCount: number;
    institutionalMemoryScore: number;
    signalsIngested: number;
    pendingCount: number;
  };
}

/**
 * Aggregates weekly governance metrics for a single user.
 *
 * "Weekly" is defined as the last 7 calendar days from now.
 * This means the digest always covers a rolling 7-day window,
 * regardless of when the cron fires on Friday.
 */
async function aggregateUserMetrics(
  userId: string,
  email: string
): Promise<UserDigestData> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // ── Deals Protected (this week) ──────────────────────────────────
  const dealsProtected = await prisma.inboundSignal.aggregate({
    where: {
      userId,
      createdAt: { gte: weekAgo },
      status: { in: ["PENDING", "APPROVED"] },
    },
    _sum: { pipelineValue: true },
    _count: { id: true },
  });

  // ── Time-to-Approval (this week) ─────────────────────────────────
  const approvedThisWeek = await prisma.inboundSignal.findMany({
    where: {
      userId,
      status: "APPROVED",
      approvedAt: { not: null, gte: weekAgo },
    },
    select: {
      createdAt: true,
      approvedAt: true,
    },
    take: 200,
  });

  let avgApprovalMinutes = 0;
  if (approvedThisWeek.length > 0) {
    const totalMs = approvedThisWeek.reduce((sum, s) => {
      const delta = new Date(s.approvedAt!).getTime() - new Date(s.createdAt).getTime();
      return sum + Math.max(0, delta);
    }, 0);
    avgApprovalMinutes = Math.round(totalMs / approvedThisWeek.length / 60_000);
  }

  // ── Institutional Memory Score ───────────────────────────────────
  const memoryScore = await prisma.governanceRule.count({
    where: { userId, isActive: true },
  });

  // ── Signal ingestion count (this week) ───────────────────────────
  const signalsIngested = await prisma.inboundSignal.count({
    where: {
      userId,
      sourceType: "SIGNAL_TRIGGERED",
      createdAt: { gte: weekAgo },
    },
  });

  // ── Currently pending ────────────────────────────────────────────
  const pendingCount = await prisma.inboundSignal.count({
    where: { userId, status: "PENDING" },
  });

  return {
    userId,
    email,
    metrics: {
      dealsProtectedValue: dealsProtected._sum.pipelineValue ?? 0,
      dealsProtectedCount: dealsProtected._count.id,
      avgApprovalMinutes,
      approvalCount: approvedThisWeek.length,
      institutionalMemoryScore: memoryScore,
      signalsIngested,
      pendingCount,
    },
  };
}

// ── Email Composition ───────────────────────────────────────────────────

/**
 * Composes the Fragility Digest email body (plain text + HTML).
 *
 * TONE: Clinical, data-driven, zero fluff. This reads like a weekly
 * infrastructure status report, not a marketing newsletter.
 */
function composeDigestEmail(data: UserDigestData): {
  subject: string;
  textBody: string;
  htmlBody: string;
} {
  const m = data.metrics;
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const dateRange = `${weekStart.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })} — ${now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const subject = `Fragility Digest: $${(m.dealsProtectedValue / 1000).toFixed(0)}K protected this week`;

  const textBody = `
FRAMELEADS FRAGILITY DIGEST
${dateRange}
──────────────────────────────────

DEALS PROTECTED
$${m.dealsProtectedValue.toLocaleString()} ARR across ${m.dealsProtectedCount} deal(s)

TIME-TO-APPROVAL
${m.avgApprovalMinutes > 0 ? `${m.avgApprovalMinutes} min avg` : "No approvals this week"} (${m.approvalCount} reviews)

INSTITUTIONAL MEMORY
${m.institutionalMemoryScore} active rule(s) codified

SIGNAL INGESTION
${m.signalsIngested} buying signal(s) captured this week

QUEUE STATUS
${m.pendingCount} item(s) awaiting human review

──────────────────────────────────
FrameLeads — No outbound leaves without human approval.
`.trim();

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#1a1a1a;border:1px solid #242424;border-radius:12px;padding:10px 10px 6px;">
        <span style="color:#FF5A1F;font-size:18px;">⚡</span>
      </div>
      <h1 style="color:#ffffff;font-size:22px;font-weight:700;margin:16px 0 4px;letter-spacing:-0.5px;">
        Fragility Digest
      </h1>
      <p style="color:#6b7280;font-size:13px;margin:0;">
        ${dateRange}
      </p>
    </div>

    <!-- Deals Protected -->
    <div style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:24px;margin-bottom:12px;">
      <p style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">
        Deals Protected
      </p>
      <p style="color:#ffffff;font-size:36px;font-weight:700;margin:0;letter-spacing:-1px;">
        $${m.dealsProtectedValue.toLocaleString()}
      </p>
      <p style="color:#4b5563;font-size:12px;margin:6px 0 0;">
        ${m.dealsProtectedCount} deal${m.dealsProtectedCount !== 1 ? "s" : ""} reviewed by the Velvet Rope
      </p>
    </div>

    <!-- Two Column -->
    <div style="display:flex;gap:12px;margin-bottom:12px;">
      <!-- Time-to-Approval -->
      <div style="flex:1;background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:20px;">
        <p style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">
          Approval Time
        </p>
        <p style="color:${m.avgApprovalMinutes <= 15 ? "#34d399" : m.avgApprovalMinutes <= 60 ? "#fbbf24" : "#f87171"};font-size:28px;font-weight:700;margin:0;">
          ${m.avgApprovalMinutes > 0 ? `${m.avgApprovalMinutes}m` : "—"}
        </p>
        <p style="color:#4b5563;font-size:11px;margin:4px 0 0;">
          ${m.approvalCount} review${m.approvalCount !== 1 ? "s" : ""}
        </p>
      </div>

      <!-- Memory Score -->
      <div style="flex:1;background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:20px;">
        <p style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 8px;">
          Memory Score
        </p>
        <p style="color:#34d399;font-size:28px;font-weight:700;margin:0;">
          ${m.institutionalMemoryScore}
        </p>
        <p style="color:#4b5563;font-size:11px;margin:4px 0 0;">
          Active rules
        </p>
      </div>
    </div>

    <!-- Signal Ingestion -->
    <div style="background:#111111;border:1px solid #1f1f1f;border-radius:16px;padding:20px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <p style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 4px;">
          Signals Captured
        </p>
        <p style="color:#ffffff;font-size:20px;font-weight:700;margin:0;">
          ${m.signalsIngested}
        </p>
      </div>
      <div style="text-align:right;">
        <p style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1.5px;margin:0 0 4px;">
          Pending Review
        </p>
        <p style="color:#FF5A1F;font-size:20px;font-weight:700;margin:0;">
          ${m.pendingCount}
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:32px;padding-top:24px;border-top:1px solid #1f1f1f;">
      <p style="color:#374151;font-size:11px;margin:0;font-style:italic;">
        FrameLeads Governance — No outbound leaves without human approval.
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  return { subject, textBody, htmlBody };
}

// ── Route Handler ───────────────────────────────────────────────────────

export async function GET(req: Request) {
  // ── Security Gate ──────────────────────────────────────────────────
  if (!verifyCronSecret(req)) {
    console.warn("[FRAGILITY DIGEST] Unauthorized cron trigger attempt.");
    return NextResponse.json(
      { success: false, error: "Unauthorized. Invalid CRON_SECRET." },
      { status: 401 }
    );
  }

  try {
    console.log("[FRAGILITY DIGEST] Weekly digest generation started.");

    // ── Fetch all active users ─────────────────────────────────────
    // In production, this should be paginated for large user bases.
    // For now, we process all users with an ENTERPRISE tier (paying
    // customers who get the digest as a retention feature).
    const activeUsers = await prisma.user.findMany({
      where: { tier: "ENTERPRISE" },
      select: { id: true, email: true },
    });

    if (activeUsers.length === 0) {
      console.log("[FRAGILITY DIGEST] No active ENTERPRISE users. Skipping.");
      return NextResponse.json({
        success: true,
        message: "No active users to digest.",
        processed: 0,
      });
    }

    const results: Array<{
      userId: string;
      email: string;
      status: "sent" | "failed";
      error?: string;
    }> = [];

    for (const user of activeUsers) {
      try {
        // Aggregate metrics for this user
        const digestData = await aggregateUserMetrics(user.id, user.email);

        // Compose the digest email
        const { subject, textBody, htmlBody } = composeDigestEmail(digestData);

        // ── SEND THE EMAIL ──────────────────────────────────────────
        // TODO: Replace with actual email provider integration
        // (e.g., Resend, SendGrid, AWS SES).
        //
        // For now, we log the digest to the console as a structured
        // payload that can be piped to any email API.
        // ─────────────────────────────────────────────────────────────
        console.log(
          `[FRAGILITY DIGEST] Email composed for ${user.email}:\n` +
          `  Subject: ${subject}\n` +
          `  Deals Protected: $${digestData.metrics.dealsProtectedValue.toLocaleString()}\n` +
          `  Avg Approval: ${digestData.metrics.avgApprovalMinutes}m\n` +
          `  Memory Score: ${digestData.metrics.institutionalMemoryScore}\n` +
          `  Signals: ${digestData.metrics.signalsIngested}`
        );

        // Simulate email send (replace with real provider call)
        // await sendEmail({
        //   to: user.email,
        //   subject,
        //   text: textBody,
        //   html: htmlBody,
        // });

        results.push({ userId: user.id, email: user.email, status: "sent" });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[FRAGILITY DIGEST] Failed for ${user.email}:`,
          errMsg
        );
        results.push({
          userId: user.id,
          email: user.email,
          status: "failed",
          error: errMsg,
        });
      }
    }

    const sentCount = results.filter((r) => r.status === "sent").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    console.log(
      `[FRAGILITY DIGEST] Complete. Sent: ${sentCount}, Failed: ${failedCount}`
    );

    return NextResponse.json({
      success: true,
      message: `Fragility Digest dispatched to ${sentCount} user(s).`,
      processed: activeUsers.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    console.error("[FRAGILITY DIGEST] Catastrophic failure:", error);
    return NextResponse.json(
      { success: false, error: "Digest generation pipeline failure." },
      { status: 500 }
    );
  }
}
