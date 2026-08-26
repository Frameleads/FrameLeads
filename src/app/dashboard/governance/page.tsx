import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import GovernanceDashboard from "./GovernanceDashboard";

export const dynamic = 'force-dynamic';

export default async function GovernancePage() {
  const cookieStore = await cookies();
  const email = cookieStore.get('user_email')?.value;
  const user = email
    ? await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, tier: true },
      })
    : null;

  const signals = await prisma.inboundSignal.findMany({
    where: { userId: user?.id ?? '__unauthenticated__' },
    orderBy: { createdAt: 'asc' }
  });

  // Task 2: The Telemetry Math
  const approvedSignals = signals.filter(s => s.status === 'APPROVED');
  const pendingCount = signals.filter(s => s.status === 'PENDING').length;
  const autoArchivedCount = signals.filter(s => s.status === 'AUTO_ARCHIVED').length;

  const dealsProtectedValue = approvedSignals.reduce((sum, s) => sum + (s.pipelineValue || 0), 0);
  const dealsProtectedCount = approvedSignals.length;

  let totalLatencyMs = 0;
  let latencyCount = 0;

  // Task 3: Chart Hydration (14-Day Lookback)
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const metricsUserId = user?.id ?? '__unauthenticated__';

  const [totalOutputVolume, currentMonthOutput] = await Promise.all([
    prisma.generatedLead.count({ where: { userId: metricsUserId } }),
    prisma.generatedLead.count({
      where: { userId: metricsUserId, createdAt: { gte: currentMonthStart } },
    }),
  ]);
  
  // Initialize 14 days map
  const timeSeriesMap = new Map<string, { arr: number, latencyMsTotal: number, latencyCount: number }>();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dayStr = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    timeSeriesMap.set(dayStr, { arr: 0, latencyMsTotal: 0, latencyCount: 0 });
  }

  for (const s of approvedSignals) {
    if (!s.approvedAt) continue;

    const created = new Date(s.createdAt).getTime();
    const updated = new Date(s.approvedAt).getTime();
    const latencyMs = updated - created;
    if (latencyMs >= 0) {
      totalLatencyMs += latencyMs;
      latencyCount++;
    }

    if (new Date(s.createdAt) >= fourteenDaysAgo) {
      const dayStr = `${String(s.approvedAt.getMonth() + 1).padStart(2, '0')}/${String(s.approvedAt.getDate()).padStart(2, '0')}`;
      if (timeSeriesMap.has(dayStr)) {
        const stats = timeSeriesMap.get(dayStr)!;
        stats.arr += (s.pipelineValue || 0);
        if (latencyMs >= 0) {
          stats.latencyMsTotal += latencyMs;
          stats.latencyCount++;
        }
      }
    }
  }

  const avgMilliseconds = latencyCount > 0 ? totalLatencyMs / latencyCount : 0;
  const avgMinutes = Math.round(avgMilliseconds / 60000);
  const avgHours = parseFloat((avgMinutes / 60).toFixed(1));

  const rulesCount = await prisma.governanceRule.count({
    where: { userId: user?.id ?? '__unauthenticated__', isActive: true },
  });

  const timeSeriesData = Array.from(timeSeriesMap.entries()).map(([day, stats]) => {
    const avgLatencyMin = stats.latencyCount > 0 ? Math.round((stats.latencyMsTotal / stats.latencyCount) / 60000) : 0;
    return {
      day,
      protectedARR: stats.arr,
      avgLatencyMin
    };
  });

  const positiveIntentCount = signals.filter((signal) => signal.intentScore >= 40).length;
  const positiveIntentRate = signals.length > 0
    ? (positiveIntentCount / signals.length) * 100
    : 0;

  const metrics = {
    dealsProtected: {
      totalValue: dealsProtectedValue,
      dealCount: dealsProtectedCount,
      label: 'Total ARR Protected'
    },
    timeToApproval: {
      avgMilliseconds,
      avgMinutes,
      avgHours,
      sampleSize: latencyCount,
      label: 'Average Latency'
    },
    institutionalMemory: {
      score: rulesCount,
      label: 'Codified Rules'
    },
    queue: {
      pendingCount,
      signalTriggeredCount: autoArchivedCount
    },
    macroMetrics: {
      totalOutputVolume,
      currentMonthOutput,
      positiveIntentRate,
      positiveIntentCount,
      totalSignals: signals.length,
      approvedSignalCount: approvedSignals.length,
      approvedPipelineValue: dealsProtectedValue,
    },
    timeSeriesData
  };

  return (
    <GovernanceDashboard
      initialMetrics={metrics}
      userTier={user?.tier ?? 'INACTIVE'}
    />
  );
}
