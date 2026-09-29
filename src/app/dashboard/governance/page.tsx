import { prisma } from '@/lib/prisma';
import { Suspense } from 'react';
import GovernanceDashboard from './GovernanceDashboard';
import GovernanceLoading from './loading';
import { getAuthenticatedEntitlementUser } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export default function GovernancePage() {
  return (
    <Suspense fallback={<GovernanceLoading />}>
      <GovernanceData />
    </Suspense>
  );
}

async function GovernanceData() {
  const user = await getAuthenticatedEntitlementUser();
  if (user?.tier !== 'ENTERPRISE') return <GovernanceDashboard initialMetrics={{
    dealsProtected: { totalValue: 0, dealCount: 0, label: 'Qualified Pipeline Protected' },
    timeToApproval: { avgMilliseconds: 0, avgMinutes: 0, avgHours: 0, sampleSize: 0, label: 'Average Latency' },
    institutionalMemory: { score: 0, label: 'Codified Rules' },
    queue: { pendingCount: 0, signalTriggeredCount: 0, protectionSignalCount: 0 },
    macroMetrics: { totalOutputVolume: 0, currentMonthOutput: 0, positiveIntentRate: 0,
      positiveIntentCount: 0, totalSignals: 0, approvedSignalCount: 0, approvedPipelineValue: 0 },
    timeSeriesData: [],
  }} userTier={user?.tier ?? 'INACTIVE'} />;

  const metricsUserId = user?.id ?? '__unauthenticated__';
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  // Resolve every dashboard metric on the server before hydrating the chart layout.
  const [signals, protectedPipeline, totalOutputVolume, currentMonthOutput, rulesCount] = await Promise.all([
    prisma.inboundSignal.findMany({
      where: {
        userId: metricsUserId,
        status: { not: 'TRASHED' },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.inboundSignal.aggregate({
      where: {
        userId: metricsUserId,
        status: 'APPROVED',
      },
      _sum: { pipelineValue: true },
      _count: { id: true },
    }),
    prisma.generatedLead.count({ where: { userId: metricsUserId } }),
    prisma.generatedLead.count({
      where: { userId: metricsUserId, createdAt: { gte: currentMonthStart } },
    }),
    prisma.governanceRule.count({
      where: { userId: metricsUserId, isActive: true },
    }),
  ]);

  const protectedSignals = signals.filter((signal) => signal.status === 'APPROVED');
  const pendingCount = signals.filter((signal) => signal.status === 'PENDING').length;
  const archivedCount = signals.filter((signal) => signal.status === 'ARCHIVED').length;
  const protectionSignalCount = signals.length;
  const signalTriggeredCount = signals.filter((signal) => signal.sourceType !== 'MANUAL').length;
  const dealsProtectedValue = protectedPipeline._sum.pipelineValue ?? 0;
  const dealsProtectedCount = protectedPipeline._count.id;

  let totalLatencyMs = 0;
  let latencyCount = 0;
  const timeSeriesMap = new Map<string, { arr: number; latencyMsTotal: number; latencyCount: number }>();

  for (let i = 13; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const day = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    timeSeriesMap.set(day, { arr: 0, latencyMsTotal: 0, latencyCount: 0 });
  }

  // Protection velocity follows qualified, actively governed signals.
  for (const signal of protectedSignals) {
    const activityDate = signal.approvedAt ?? signal.createdAt;
    if (activityDate < fourteenDaysAgo) continue;

    const day = `${String(activityDate.getMonth() + 1).padStart(2, '0')}/${String(activityDate.getDate()).padStart(2, '0')}`;
    const stats = timeSeriesMap.get(day);
    if (stats) stats.arr += signal.pipelineValue ?? 0;
  }

  // Review latency is calculated from every governed signal with a review timestamp.
  for (const signal of signals) {
    if (!signal.approvedAt) continue;

    const latencyMs = signal.approvedAt.getTime() - signal.createdAt.getTime();
    if (latencyMs < 0) continue;

    totalLatencyMs += latencyMs;
    latencyCount += 1;

    if (signal.approvedAt >= fourteenDaysAgo) {
      const day = `${String(signal.approvedAt.getMonth() + 1).padStart(2, '0')}/${String(signal.approvedAt.getDate()).padStart(2, '0')}`;
      const stats = timeSeriesMap.get(day);
      if (stats) {
        stats.latencyMsTotal += latencyMs;
        stats.latencyCount += 1;
      }
    }
  }

  const avgMilliseconds = latencyCount > 0 ? totalLatencyMs / latencyCount : 0;
  const avgMinutes = Math.round(avgMilliseconds / 60000);
  const avgHours = Number((avgMinutes / 60).toFixed(1));

  const timeSeriesData = Array.from(timeSeriesMap.entries()).map(([day, stats]) => ({
    day,
    protectedARR: stats.arr,
    avgLatencyMin: stats.latencyCount > 0
      ? Math.round(stats.latencyMsTotal / stats.latencyCount / 60000)
      : 0,
  }));

  const positiveIntentCount = signals.filter((signal) => signal.intentScore >= 40).length;
  const positiveIntentRate = signals.length > 0
    ? (positiveIntentCount / signals.length) * 100
    : 0;

  const metrics = {
    dealsProtected: {
      totalValue: dealsProtectedValue,
      dealCount: dealsProtectedCount,
      label: 'Qualified Pipeline Protected',
    },
    timeToApproval: {
      avgMilliseconds,
      avgMinutes,
      avgHours,
      sampleSize: latencyCount,
      label: 'Average Latency',
    },
    institutionalMemory: {
      score: rulesCount,
      label: 'Codified Rules',
    },
    queue: {
      pendingCount,
      signalTriggeredCount,
      protectionSignalCount,
    },
    macroMetrics: {
      totalOutputVolume,
      currentMonthOutput,
      positiveIntentRate,
      positiveIntentCount,
      totalSignals: signals.length,
      approvedSignalCount: dealsProtectedCount,
      approvedPipelineValue: dealsProtectedValue,
    },
    timeSeriesData,
  };

  return (
    <GovernanceDashboard
      initialMetrics={metrics}
      userTier={user.tier}
    />
  );
}
