export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import IngestionClient from "./IngestionClient";
import { verifiedCustomerUser } from '@/lib/customer-session';

export default async function IngestionPage() {
  const principal = await verifiedCustomerUser();
  if (!principal) {
    return <div>Unauthorized</div>;
  }

  const user = await prisma.user.findUnique({
    where: { id: principal.id },
    select: { tier: true, monthlyQuota: true, leadsProcessed: true }
  });
  
  if (!user) {
    return <div>User not found</div>;
  }

  return <IngestionClient userTier={user.tier} monthlyQuota={user.monthlyQuota} leadsProcessed={user.leadsProcessed} />;
}
