"use client";

import { useState, useEffect } from "react";
import EnterprisePaywall from "@/components/EnterprisePaywall";
import Link from "next/link";
import {
  Shield,
  Clock,
  Brain,
  TrendingUp,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Zap,
  Activity,
  BarChart3,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ────────────────────────────────────────────────────────────────────────
// PHASE 5: GOVERNANCE DASHBOARD
//
// WHY THIS EXISTS:
// Vanity metrics ("500 emails sent", "32% open rate") tell users nothing
// about governance quality and create a false sense of productivity.
// This dashboard strips ALL vanity metrics and shows ONLY protection
// metrics that prove FrameLeads is actively safeguarding pipeline value.
//
// THE THREE METRICS:
//   1. Deals Protected — Total ARR reviewed/held by the Velvet Rope.
//   2. Time-to-Approval — Average human review latency.
//   3. Institutional Memory Score — Count of codified rules.
//
// THE TWO CHARTS (live-bound to PostgreSQL via /api/governance/metrics):
//   1. Protection Velocity — Cumulative ARR protected over last 14 days.
//   2. Review Latency — Avg time-to-approval per day over last 14 days.
//
// ZERO MOCK DATA. Both charts consume `metrics.timeSeriesData` directly.
// ────────────────────────────────────────────────────────────────────────

// ── Types ───────────────────────────────────────────────────────────────

interface TimeSeriesDataPoint {
  day: string;
  protectedARR: number;
  avgLatencyMin: number;
}

interface GovernanceMetrics {
  dealsProtected: {
    totalValue: number;
    dealCount: number;
    label: string;
  };
  timeToApproval: {
    avgMilliseconds: number;
    avgMinutes: number;
    avgHours: number;
    sampleSize: number;
    label: string;
  };
  institutionalMemory: {
    score: number;
    label: string;
  };
  queue: {
    pendingCount: number;
    signalTriggeredCount: number;
  };
  timeSeriesData: TimeSeriesDataPoint[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function formatApprovalTime(minutes: number): string {
  if (minutes === 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function getApprovalTimeColor(minutes: number): string {
  if (minutes === 0) return "text-gray-500";
  if (minutes <= 15) return "text-emerald-400";
  if (minutes <= 60) return "text-amber-400";
  return "text-red-400";
}

function getApprovalTimeLabel(minutes: number): string {
  if (minutes === 0) return "No approvals yet";
  if (minutes <= 5) return "Rapid Review";
  if (minutes <= 15) return "Healthy Cadence";
  if (minutes <= 60) return "Needs Attention";
  return "Critical Delay";
}

function getMemoryTier(score: number): { color: string; label: string } {
  if (score === 0) return { color: "text-gray-500", label: "No Rules Codified" };
  if (score <= 5) return { color: "text-amber-400", label: "Foundation" };
  if (score <= 15) return { color: "text-blue-400", label: "Growing" };
  if (score <= 30) return { color: "text-emerald-400", label: "Mature" };
  return { color: "text-[#FF5A1F]", label: "Expert System" };
}

// ── Custom Tooltips ─────────────────────────────────────────────────────
// Default Recharts tooltips render with a white background that destroys
// dark-mode aesthetics. These custom components match our UI system.
// ─────────────────────────────────────────────────────────────────────────

function ProtectionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1a] border border-gray-700/60 rounded-xl px-4 py-3 shadow-2xl shadow-black/40">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-sm font-semibold text-white">
        {formatCurrency(payload[0].value)}
        <span className="text-gray-500 font-normal ml-1.5">ARR protected</span>
      </p>
    </div>
  );
}

function LatencyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const mins = payload[0].value;
  return (
    <div className="bg-[#1a1a1a] border border-gray-700/60 rounded-xl px-4 py-3 shadow-2xl shadow-black/40">
      <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">
        {label}
      </p>
      {mins === 0 ? (
        <p className="text-sm text-gray-500">No approvals</p>
      ) : (
        <p className="text-sm font-semibold text-white">
          {mins}m
          <span className={`font-normal ml-1.5 ${mins <= 15 ? "text-emerald-400" : mins <= 60 ? "text-amber-400" : "text-red-400"}`}>
            {mins <= 15 ? "Healthy" : mins <= 60 ? "Moderate" : "Slow"}
          </span>
        </p>
      )}
    </div>
  );
}

// ── Chart Empty State ───────────────────────────────────────────────────

function ChartEmptyState({ label }: { label: string }) {
  return (
    <div className="h-[240px] w-full flex flex-col items-center justify-center gap-3">
      <BarChart3 className="w-8 h-8 text-gray-700" />
      <p className="text-sm text-gray-500">Awaiting Data</p>
      <p className="text-[10px] text-gray-600">
        {label} will populate as signals flow through the Velvet Rope.
      </p>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────

export default function GovernanceDashboard({ initialMetrics }: { initialMetrics: GovernanceMetrics }) {
  const metrics = initialMetrics;
  const [tier, setTier] = useState<string | null>(null);
  
  useEffect(() => {
    setTier(localStorage.getItem('userTier') || 'CORE');
  }, []);

  if (!metrics) return null;

  const memoryTier = getMemoryTier(metrics.institutionalMemory.score);

  // ── Derived chart data ──────────────────────────────────────────────
  // Check if time-series has any non-zero values to decide whether to
  // render charts or the empty state.
  const hasProtectionData = metrics.timeSeriesData.some(
    (d) => d.protectedARR > 0
  );
  const hasLatencyData = metrics.timeSeriesData.some(
    (d) => d.avgLatencyMin > 0
  );

  if (tier === null) return null; // Prevent hydration flicker

  const pageContent = (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 lg:px-0">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 md:mb-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold font-heading tracking-tight flex items-center gap-3">
            <Shield className="w-8 h-8 text-[#FF5A1F]" />
            Governance Health
          </h1>
          <p className="text-base text-muted-foreground mt-2 leading-relaxed">
            Real-time pipeline protection metrics. No vanity numbers.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Live from Database
          </span>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 h-9 px-4 rounded-xl border border-border/50 text-sm text-muted-foreground hover:text-white hover:border-border hover:bg-muted/30 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Primary Metrics Grid ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">

        {/* ─── Metric 1: Deals Protected ────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-7 group hover:border-[#FF5A1F]/30 transition-all duration-300">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#FF5A1F]/5 rounded-full blur-2xl group-hover:bg-[#FF5A1F]/10 transition-all duration-500" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-[#FF5A1F]/10 border border-[#FF5A1F]/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-[#FF5A1F]" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">Deals Protected</p>
                <p className="text-[10px] text-gray-600 mt-0.5">Total pipeline ARR under governance</p>
              </div>
            </div>
            <p className="text-4xl md:text-5xl font-bold text-white tracking-tight font-heading">
              {formatCurrency(metrics.dealsProtected.totalValue)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-sm text-gray-400">
                {metrics.dealsProtected.dealCount} deal{metrics.dealsProtected.dealCount !== 1 ? "s" : ""} reviewed
              </span>
            </div>
          </div>
        </div>

        {/* ─── Metric 2: Time-to-Approval ───────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-7 group hover:border-blue-500/30 transition-all duration-300">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all duration-500" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">Time-to-Approval</p>
                <p className="text-[10px] text-gray-600 mt-0.5">Avg. human review latency</p>
              </div>
            </div>
            <p className={`text-4xl md:text-5xl font-bold tracking-tight font-heading ${getApprovalTimeColor(metrics.timeToApproval.avgMinutes)}`}>
              {formatApprovalTime(metrics.timeToApproval.avgMinutes)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm text-gray-400">
                {getApprovalTimeLabel(metrics.timeToApproval.avgMinutes)}
                {metrics.timeToApproval.sampleSize > 0 && (
                  <span className="text-gray-600"> · {metrics.timeToApproval.sampleSize} reviews</span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* ─── Metric 3: Institutional Memory Score ─────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-7 group hover:border-emerald-500/30 transition-all duration-300">
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all duration-500" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Brain className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">Institutional Memory</p>
                <p className="text-[10px] text-gray-600 mt-0.5">Codified objection-handling rules</p>
              </div>
            </div>
            <p className={`text-4xl md:text-5xl font-bold tracking-tight font-heading ${memoryTier.color}`}>
              {metrics.institutionalMemory.score}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Zap className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm text-gray-400">{memoryTier.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Data Visualizations (Live-Bound) ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">

        {/* ─── Chart 1: Protection Velocity (Area Chart) ────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-7">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-medium text-gray-300">Protection Velocity</h3>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">
                Cumulative ARR protected · 14 days
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#FF5A1F]" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Live</span>
            </div>
          </div>

          {hasProtectionData ? (
            <div className="h-[240px] w-full overflow-x-auto hide-scrollbar pr-4 md:pr-0">
              <div className="min-w-[400px] h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={metrics.timeSeriesData}
                    margin={{ top: 4, right: 20, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="protectionGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#FF5A1F" stopOpacity={0.3} />
                        <stop offset="50%" stopColor="#FF5A1F" stopOpacity={0.08} />
                        <stop offset="100%" stopColor="#FF5A1F" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#4b5563", fontSize: 10 }}
                      interval={Math.max(0, Math.floor(metrics.timeSeriesData.length / 5) - 1)}
                    />
                    <YAxis 
                      stroke="#888888" 
                      tickLine={false} 
                      axisLine={false} 
                      width={60} 
                      tick={{ fontSize: 10, fill: '#888888' }} 
                      tickFormatter={(value) => "$" + (value / 1000) + "k"}
                    />
                    <Tooltip
                      content={<ProtectionTooltip />}
                      cursor={{ stroke: "#FF5A1F", strokeWidth: 1, strokeDasharray: "4 4", strokeOpacity: 0.3 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="protectedARR"
                      stroke="#FF5A1F"
                      strokeWidth={2}
                      fill="url(#protectionGradient)"
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: "#FF5A1F",
                        stroke: "#0a0a0a",
                        strokeWidth: 2,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <ChartEmptyState label="Protection Velocity" />
          )}
        </div>

        {/* ─── Chart 2: Review Latency (Bar Chart) ──────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-7">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h3 className="text-sm font-medium text-gray-300">Review Latency</h3>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-1">
                Avg. time-to-approval · 14 days
              </p>
            </div>
            <div className="absolute top-4 right-4 flex flex-col items-start gap-1.5">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[10px] text-[#888888] tracking-wide">Healthy (≤15m)</span></div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-amber-500"></div><span className="text-[10px] text-[#888888] tracking-wide">Slow (&gt;15m)</span></div>
            </div>
          </div>

          {hasLatencyData ? (
            <div className="h-[240px] w-full overflow-x-auto hide-scrollbar pr-4 md:pr-0">
              <div className="min-w-[400px] h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={metrics.timeSeriesData}
                    margin={{ top: 4, right: 20, left: -20, bottom: 0 }}
                    barCategoryGap="25%"
                  >
                    <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#4b5563", fontSize: 10 }}
                      interval={Math.max(0, Math.floor(metrics.timeSeriesData.length / 5) - 1)}
                    />
                    <YAxis 
                      width={40} 
                      tickLine={false} 
                      axisLine={false} 
                      tick={{ fill: "#9ca3af", fontSize: 11 }} 
                    />
                    <Tooltip
                      content={<LatencyTooltip />}
                      cursor={{ fill: "#ffffff08" }}
                    />
                    <Bar
                      dataKey="avgLatencyMin"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={36}
                      shape={(props: any) => {
                        const { x, y, width, height, payload } = props;
                        if (!height || height <= 0) return null;
                        const isHealthy = payload.avgLatencyMin <= 15;
                        return (
                          <rect
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                            rx={6}
                            ry={6}
                            fill={isHealthy ? "#34d399" : "#fbbf24"}
                            fillOpacity={0.8}
                          />
                        );
                      }}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <ChartEmptyState label="Review Latency" />
          )}
        </div>
      </div>

      {/* ── Queue Status Bar ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-1">Velvet Rope Queue Status</h3>
            <p className="text-xs text-gray-500">Items awaiting human review before deployment.</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-white font-heading">{metrics.queue.pendingCount}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Pending</p>
            </div>
            <div className="w-px h-10 bg-border/50" />
            <div className="text-center">
              <p className="text-2xl font-bold text-[#FF5A1F] font-heading">{metrics.queue.signalTriggeredCount}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mt-0.5">Signal-Triggered</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Governance Philosophy Footer ────────────────────────────── */}
      <div className="mt-6 text-center">
        <p className="text-xs text-gray-600 italic">
          FrameLeads Governance — No outbound leaves without human approval.
        </p>
      </div>
    </div>
  );

  return (
    <EnterprisePaywall userTier={tier} featureName="Governance Dashboard">
      {pageContent}
    </EnterprisePaywall>
  );
}