export const dynamic = 'force-dynamic';

import { cookies } from "next/headers";
import SandboxClient from "./SandboxClient";
import { prisma } from "@/lib/prisma";

export default async function SandboxPage() {
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

  return <SandboxClient leadsProcessed={user.leadsProcessed} monthlyQuota={user.monthlyQuota} userTier={user.tier} />;
}
