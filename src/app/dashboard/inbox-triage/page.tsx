// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { Suspense } from "react";
import TriageCommandCenter from "./TriageCommandCenter";
import InboxTriageLoading from "./loading";


export default function InboxTriagePage() {
  return (
    <Suspense fallback={<InboxTriageLoading />}>
      <InboxTriageData />
    </Suspense>
  );
}

async function InboxTriageData() {
  const cookieStore = await cookies();
  const email = cookieStore.get("user_email")?.value;
  const user = email
    ? await prisma.user.findUnique({
        where: { email: email.trim().toLowerCase() },
        select: { id: true, tier: true },
      })
    : null;

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
  return (
    <TriageCommandCenter
      initialData={triageSignals}
      userTier={user?.tier ?? "INACTIVE"}
    />
  );
}
