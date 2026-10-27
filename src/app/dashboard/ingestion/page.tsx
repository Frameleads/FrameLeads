import { monthlyLeadQuotaForTier } from '@/lib/entitlements';
export const dynamic = 'force-dynamic';

import { prisma } from "@/lib/prisma";
import IngestionClient from "./IngestionClient";
import Link from "next/link";
import { verifiedCustomerUser } from '@/lib/customer-session';

export default async function IngestionPage() {
  const principal = await verifiedCustomerUser();
  if (!principal) {
    // A temporary Whop userinfo failure must not impersonate an explicit logout.
    // Never expose ingestion data until the verified principal is restored.
    return <div role="alert" className="mx-auto max-w-lg space-y-4 p-8 text-white">
      <h1 className="text-xl font-semibold">Session could not be verified</h1>
      <p className="text-sm text-white/70">This may be a temporary connection issue or an expired Whop session. No account data was loaded.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/ingestion" className="rounded-lg bg-[#FF5A1F] px-4 py-2 text-black">Retry verification</Link>
        <Link href="/login" className="rounded-lg border border-white/20 px-4 py-2">Sign in again</Link>
      </div>
    </div>;
  }

  const user = await prisma.user.findUnique({
    where: { id: principal.id },
    select: { tier: true, monthlyQuota: true, leadsProcessed: true, microPilotOutboundUsed: true }
  });
  
  if (!user) {
    return <div>User not found</div>;
  }

  return <IngestionClient userTier={user.tier} monthlyQuota={monthlyLeadQuotaForTier(user.tier)}
    leadsProcessed={user.tier === 'MICRO_PILOT' ? user.microPilotOutboundUsed : user.leadsProcessed} />;
}
