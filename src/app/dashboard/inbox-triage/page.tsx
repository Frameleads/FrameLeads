// Force Next.js to render this page dynamically at request time, never at build time:
export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import TriageCommandCenter from "./TriageCommandCenter";
import { cookies } from "next/headers";

export default async function InboxTriagePage() {
  const nextSignal = await prisma.inboundSignal.findFirst({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  const cookieStore = await cookies();
  const tier = cookieStore.get("tier")?.value || "CORE";

  return <TriageCommandCenter initialData={nextSignal} userTier={tier} />;
}