// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import TriageCommandCenter from "./TriageCommandCenter";


export default async function InboxTriagePage() {
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
  const pendingSignals = await prisma.inboundSignal.findMany({
    where: {
      userId: user?.id ?? "__unauthenticated__",
      status: "PENDING",
    },
    orderBy: [
      { isHighPriority: "desc" },
      { createdAt: "asc" },
    ],
  });
  return (
    <TriageCommandCenter
      initialData={pendingSignals}
      userTier={user?.tier ?? "INACTIVE"}
    />
  );
}
