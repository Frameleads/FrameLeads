// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { Suspense } from "react";
import CorePaywall from "@/components/CorePaywall";
import TriageCommandCenter from "./TriageCommandCenter";
import InboxTriageLoading from "./loading";
import { resolveScoutUser } from "@/lib/scout-data";
import { assessRevenueAtRiskBatch } from '@/lib/revenue-risk/service';
import { syncResponseSLAsBatch } from '@/lib/response-sla/service';
import { getResponseSLAPolicy } from '@/lib/response-sla/policy';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';


export default function InboxTriagePage() {
  return (
    <Suspense fallback={<InboxTriageLoading />}>
      <InboxTriageData />
    </Suspense>
  );
}

async function InboxTriageData() {
  const cookieStore = await cookies();
  const user = await resolveScoutUser(prisma,
    cookieStore.get('frameleads_session')?.value, cookieStore.get('user_email')?.value);

  // Phase 4: Priority-sorted query — SIGNAL_TRIGGERED items with
  // isHighPriority=true always surface at the top of the triage queue.
  const userTier = user ? await getUserEntitlementTier(user.id) : 'INACTIVE';
  if (!hasFeatureAccess(userTier, 'INBOX_TRIAGE')) return <CorePaywall userTier={userTier} featureName="Inbox Triage">
    <TriageCommandCenter initialData={[]} slaDueSoonPercent={75} userTier={userTier} />
  </CorePaywall>;
  const triageSignals = await prisma.inboundSignal.findMany({
      where: {
        userId: user?.id ?? "__unauthenticated__",
        status: { in: ["PENDING", "ARCHIVED"] },
      },
      orderBy: [
        { isHighPriority: "desc" },
        { createdAt: "asc" },
      ],
    });
  const decisionRows = triageSignals.length ? await prisma.decision.findMany({
    where: { userId: user!.id, inputMessage: { sourceType: 'INBOUND_SIGNAL',
      sourceId: { in: triageSignals.map(signal => signal.id) } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, source: true, inputMessage: { select: { sourceId: true } } },
  }) : [];
  const latestBySignal = new Map<string, { id: string; status: string; source: string }>();
  for (const row of decisionRows) if (!latestBySignal.has(row.inputMessage.sourceId))
    latestBySignal.set(row.inputMessage.sourceId, { id: row.id, status: row.status, source: row.source });
  const decisionIds = [...latestBySignal.values()].map(row => row.id);
  const isEnterprise = hasFeatureAccess(userTier, 'REVENUE_RISK');
  const [riskRows, slaPolicy] = await Promise.all([
    isEnterprise && user && decisionIds.length ? assessRevenueAtRiskBatch({ userId: user.id, decisionIds }) : Promise.resolve([]),
    isEnterprise && user ? getResponseSLAPolicy(user.id) : Promise.resolve(null),
  ]);
  const riskByDecision = new Map(riskRows.map(row => [row.decisionId, row]));
  const slaRows = isEnterprise && user && decisionIds.length ? await syncResponseSLAsBatch({ userId: user.id,
    decisionIds, risks: riskRows }) : [];
  const slaByDecision = new Map(slaRows.filter(row => row != null).map(row => [row!.decisionId, row!]));

  return (
    <CorePaywall userTier={userTier} featureName="Inbox Triage">
      <TriageCommandCenter
        initialData={triageSignals.map(signal => ({ ...signal,
          decisionStatus: latestBySignal.get(signal.id)?.status ?? null,
          decisionSource: latestBySignal.get(signal.id)?.source ?? null,
          decisionId: latestBySignal.get(signal.id)?.id ?? null,
          revenueRisk: latestBySignal.get(signal.id)?.id ? riskByDecision.get(latestBySignal.get(signal.id)!.id) ?? null : null,
          responseSLA: latestBySignal.get(signal.id)?.id ? slaByDecision.get(latestBySignal.get(signal.id)!.id) ?? null : null }))}
        slaDueSoonPercent={slaPolicy?.dueSoonPercent ?? 75}
        userTier={userTier}
      />
    </CorePaywall>
  );
}
