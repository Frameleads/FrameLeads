// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import TriageCommandCenter from "./TriageCommandCenter";


export default async function InboxTriagePage() {
  // Phase 4: Priority-sorted query — SIGNAL_TRIGGERED items with
  // isHighPriority=true always surface at the top of the triage queue.
  const nextSignal = await prisma.inboundSignal.findFirst({
    where: { status: "PENDING" },
    orderBy: [
      { isHighPriority: "desc" },
      { createdAt: "asc" },
    ],
  });
  return <TriageCommandCenter initialData={nextSignal} />;
}