export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import IngestionClient from "./IngestionClient";

export default async function IngestionPage() {
  const cookieStore = await cookies();
  const email = cookieStore.get('user_email')?.value;
  
  if (!email) {
    return <div>Unauthorized</div>;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { tier: true, monthlyQuota: true, leadsProcessed: true }
  });
  
  if (!user) {
    return <div>User not found</div>;
  }

  return <IngestionClient userTier={user.tier} monthlyQuota={user.monthlyQuota} leadsProcessed={user.leadsProcessed} />;
}
