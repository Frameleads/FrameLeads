// ────────────────────────────────────────────────────────────────────────
// PHASE 5: GOVERNANCE METRICS API
//
// This endpoint aggregates the three governance health metrics:
//   1. Deals Protected — Sum of pipelineValue for all PENDING + APPROVED signals
//   2. Time-to-Approval — Average delta between createdAt and approvedAt
//   3. Institutional Memory Score — Count of active GovernanceRules
//
// PHASE 5 REFINEMENT: Time-series data for recharts visualizations.
//   - Fetches InboundSignal records from the last 14 days.
//   - Groups by calendar date (UTC).
//   - Returns per-day protectedARR and avgLatencyMin for chart binding.
//
// WHY THESE METRICS:
// Vanity metrics ("500 emails sent") tell you nothing about governance
// quality. These three metrics prove that FrameLeads is actively
// PROTECTING pipeline value, REDUCING decision latency, and CODIFYING
// institutional knowledge. They are the retention anchors.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// ── Time-Series Helpers ─────────────────────────────────────────────────

const TIME_SERIES_WINDOW_DAYS = 14;

/**
 * Formats a Date to "MMM DD" (e.g., "Jul 28") in UTC to guarantee
 * consistent grouping regardless of server timezone.
 */
function formatDateLabel(date: Date): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Returns a UTC date string (YYYY-MM-DD) for consistent grouping.
 */
function toUTCDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Generates a complete array of date keys for the last N days,
 * ensuring every day has a slot even if no database records exist.
 * This prevents gaps in the chart x-axis.
 */
function generateDateSlots(days: number): Array<{ key: string; label: string }> {
  const slots: Array<{ key: string; label: string }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - i
    ));
    slots.push({
      key: toUTCDateKey(d),
      label: formatDateLabel(d),
    });
  }
  return slots;
}

import { requireEnterpriseTier } from '@/lib/auth-guard';

export async function GET() {
  try {
    const authError = await requireEnterpriseTier();
    if (authError) return authError;
    // ── Metric 1: Deals Protected ──────────────────────────────────
    // Sum of pipelineValue for ALL signals that have passed through
    // or are currently sitting in the Velvet Rope (PENDING + APPROVED).
    // This represents the total ARR that FrameLeads governance has
    // actively reviewed and protected from rogue AI or premature sends.
    //
    // We use Prisma's aggregate() for a single efficient SQL query
    // rather than fetching all records and summing in JS.
    // ────────────────────────────────────────────────────────────────

    const dealsProtected = await prisma.inboundSignal.aggregate({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
      },
      _sum: {
        pipelineValue: true,
      },
      _count: {
        id: true,
      },
    });

    // ── Metric 2: Time-to-Approval ─────────────────────────────────
    // Average time (in milliseconds) between an InboundSignal being
    // created and a human approving it. Only signals with both
    // createdAt AND approvedAt are included (excludes PENDING items
    // that haven't been reviewed yet).
    //
    // We fetch the raw timestamps and compute the average in JS
    // because Prisma doesn't support DATEDIFF aggregation natively.
    // For production scale (>100k records), this should be replaced
    // with a raw SQL query using AVG(EXTRACT(EPOCH FROM ...)).
    // ────────────────────────────────────────────────────────────────

    const approvedSignals = await prisma.inboundSignal.findMany({
      where: {
        status: "APPROVED",
        approvedAt: { not: null },
      },
      select: {
        createdAt: true,
        approvedAt: true,
      },
      take: 500, // Cap to prevent memory issues on large datasets
      orderBy: { approvedAt: "desc" }, // Most recent approvals first
    });

    let avgApprovalTimeMs = 0;
    if (approvedSignals.length > 0) {
      const totalMs = approvedSignals.reduce((sum, s) => {
        const created = new Date(s.createdAt).getTime();
        const approved = new Date(s.approvedAt!).getTime();
        return sum + Math.max(0, approved - created);
      }, 0);
      avgApprovalTimeMs = totalMs / approvedSignals.length;
    }

    // Convert to human-readable format
    const avgMinutes = Math.round(avgApprovalTimeMs / 60_000);
    const avgHours = Math.round((avgApprovalTimeMs / 3_600_000) * 10) / 10;

    // ── Metric 3: Institutional Memory Score ───────────────────────
    // Count of active GovernanceRules. Each rule represents a piece
    // of tribal knowledge codified into the system — custom objection
    // handlers, negative CTAs, specific response frameworks.
    //
    // A higher score means the system is accumulating domain expertise
    // that outlasts individual team members.
    // ────────────────────────────────────────────────────────────────

    const memoryScore = await prisma.governanceRule.count({
      where: {
        isActive: true,
      },
    });

    // ── Additional context metrics ─────────────────────────────────
    const pendingCount = await prisma.inboundSignal.count({
      where: { status: "PENDING" },
    });

    const signalTriggeredCount = await prisma.inboundSignal.count({
      where: { sourceType: "SIGNAL_TRIGGERED" },
    });

    // ── Time-Series Data for Charts ────────────────────────────────
    // Fetch all PENDING + APPROVED signals from the last 14 days and
    // all APPROVED signals with approvedAt in the same window.
    // Group by calendar date (UTC) to produce per-day data points
    // for the Protection Velocity and Review Latency charts.
    //
    // WHY 14 DAYS:
    // 7 days is too short for a meaningful trendline — one inactive
    // weekend flattens the chart. 14 days gives two full work weeks
    // plus weekends, showing a clear trajectory.
    // ────────────────────────────────────────────────────────────────

    const windowStart = new Date();
    windowStart.setUTCDate(windowStart.getUTCDate() - TIME_SERIES_WINDOW_DAYS);
    windowStart.setUTCHours(0, 0, 0, 0);

    // Fetch signals created in the window for protection ARR
    const recentSignals = await prisma.inboundSignal.findMany({
      where: {
        status: { in: ["PENDING", "APPROVED"] },
        createdAt: { gte: windowStart },
      },
      select: {
        pipelineValue: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Fetch approved signals in the window for latency calculation
    const recentApprovals = await prisma.inboundSignal.findMany({
      where: {
        status: "APPROVED",
        approvedAt: { not: null, gte: windowStart },
      },
      select: {
        createdAt: true,
        approvedAt: true,
      },
      orderBy: { approvedAt: "asc" },
    });

    // Build date slots to guarantee every day has an entry
    const dateSlots = generateDateSlots(TIME_SERIES_WINDOW_DAYS);

    // Accumulate daily protection ARR
    const dailyARR: Record<string, number> = {};
    for (const signal of recentSignals) {
      const key = toUTCDateKey(new Date(signal.createdAt));
      dailyARR[key] = (dailyARR[key] || 0) + signal.pipelineValue;
    }

    // Accumulate daily latency (sum of minutes + count for averaging)
    const dailyLatency: Record<string, { totalMinutes: number; count: number }> = {};
    for (const signal of recentApprovals) {
      const key = toUTCDateKey(new Date(signal.approvedAt!));
      const deltaMs = new Date(signal.approvedAt!).getTime() - new Date(signal.createdAt).getTime();
      const deltaMin = Math.max(0, Math.round(deltaMs / 60_000));
      if (!dailyLatency[key]) {
        dailyLatency[key] = { totalMinutes: 0, count: 0 };
      }
      dailyLatency[key].totalMinutes += deltaMin;
      dailyLatency[key].count += 1;
    }

    // Assemble the time-series array with cumulative ARR
    let cumulativeARR = 0;
    const timeSeriesData = dateSlots.map(({ key, label }) => {
      const dayARR = dailyARR[key] || 0;
      cumulativeARR += dayARR;
      const latencyEntry = dailyLatency[key];
      const avgLatencyMin = latencyEntry
        ? Math.round(latencyEntry.totalMinutes / latencyEntry.count)
        : 0;

      return {
        day: label,
        protectedARR: cumulativeARR,
        avgLatencyMin,
      };
    });

    return NextResponse.json({
      success: true,
      metrics: {
        dealsProtected: {
          totalValue: dealsProtected._sum.pipelineValue ?? 0,
          dealCount: dealsProtected._count.id,
          label: "Deals Protected (ARR)",
        },
        timeToApproval: {
          avgMilliseconds: avgApprovalTimeMs,
          avgMinutes,
          avgHours,
          sampleSize: approvedSignals.length,
          label: "Avg. Time-to-Approval",
        },
        institutionalMemory: {
          score: memoryScore,
          label: "Institutional Memory Score",
        },
        queue: {
          pendingCount,
          signalTriggeredCount,
        },
        timeSeriesData,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[GOVERNANCE METRICS] Aggregation failure:", error);
    return NextResponse.json(
      { success: false, error: "Failed to aggregate governance metrics." },
      { status: 500 }
    );
  }
}
