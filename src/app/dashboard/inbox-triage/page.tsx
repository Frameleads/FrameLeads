
import TriageCommandCenter from "./TriageCommandCenter";
import { prisma } from "@/lib/prisma";

export default async function InboxTriagePage() {

  const nextSignal = await prisma.inboundSignal.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' }
  });

  return <TriageCommandCenter initialData={nextSignal} />;
}
