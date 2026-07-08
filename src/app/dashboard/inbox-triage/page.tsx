
import TriageCommandCenter from "./TriageCommandCenter";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

export default async function InboxTriagePage() {

  const nextSignal = await prisma.inboundSignal.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' }
  });
  const cookieStore = await cookies();
  const tier = cookieStore.get('tier')?.value || 'CORE';

  return <TriageCommandCenter initialData={nextSignal} userTier={tier} />;
}
