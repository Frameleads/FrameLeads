export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import IngestionClient from "./IngestionClient";

export default async function IngestionPage() {
  const cookieStore = await cookies();
  const email = cookieStore.get('user_email')?.value;
  
  let tier = 'CORE';
  let processed = 0;
  
  if (email) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { tier: true, leadsProcessed: true }
    });
    
    if (user) {
      tier = user.tier;
      processed = user.leadsProcessed || 0;
    }
  }

  return <IngestionClient userTier={tier} leadsProcessed={processed} />;
}
