// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { Suspense } from "react";
import CorePaywall from "@/components/CorePaywall";
import TriageCommandCenter from "./TriageCommandCenter";
import InboxTriageLoading from "./loading";
import { resolveScoutUser } from "@/lib/scout-data";


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
  const userTier = user ? (await prisma.user.findUnique({ where: { id: user.id }, select: { tier: true } }))?.tier ?? 'INACTIVE' : 'INACTIVE';

  // Phase 4: Priority-sorted query — SIGNAL_TRIGGERED items with
  // isHighPriority=true always surface at the top of the triage queue.
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
    select: { status: true, source: true, inputMessage: { select: { sourceId: true } } },
  }) : [];
  const latestBySignal = new Map<string, { status: string; source: string }>();
  for (const row of decisionRows) if (!latestBySignal.has(row.inputMessage.sourceId))
    latestBySignal.set(row.inputMessage.sourceId, { status: row.status, source: row.source });

  return (
    <CorePaywall userTier={userTier} featureName="Inbox Triage">
      <TriageCommandCenter
        initialData={triageSignals.map(signal => ({ ...signal,
          decisionStatus: latestBySignal.get(signal.id)?.status ?? null,
          decisionSource: latestBySignal.get(signal.id)?.source ?? null }))}
        userTier={userTier}
      />
    </CorePaywall>
  );
}
