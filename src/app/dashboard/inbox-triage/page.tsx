import { cookies } from "next/headers";
import { Lock } from "lucide-react";
import TriageCommandCenter from "./TriageCommandCenter";
import { prisma } from "@/lib/prisma";

export default async function InboxTriagePage() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("frameleads_session")?.value;
  
  let isAuthorized = false;

  if (sessionToken) {
    try {
      // Ping the Whop API (using our .env credentials) to verify if they hold the specific $297 Enterprise pass.
      // In a real implementation, you might pass the sessionToken or user ID to a membership endpoint.
      // Here we simulate the server-side gatekeeper logic.
      
      const res = await fetch("https://api.whop.com/api/v2/me", {
        headers: {
          "Authorization": `Bearer ${process.env.WHOP_CLIENT_SECRET || sessionToken}`,
          "Content-Type": "application/json"
        }
      });
      
      // We also check the 'tier' cookie set by our auth callback for local dev bypass
      const tier = cookieStore.get("tier")?.value;
      
      if (res.ok || sessionToken === "auth_success") {
        if (tier === "enterprise") {
          isAuthorized = true;
        }
      }
    } catch (error) {
      console.error("Failed to verify Whop Enterprise status:", error);
    }
  }

  const isDev = process.env.NODE_ENV === 'development';

  if (!isAuthorized && !isDev) {
    return (
      <div className="flex items-center justify-center min-h-[500px] h-[calc(100vh-8rem)] px-4">
        <div className="max-w-xl w-full rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-10 md:p-14 text-center">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-8">
            <Lock className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-heading font-bold text-foreground mb-4">
            Enterprise Cognitive Architecture Required
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed mb-10">
            Upgrade your Whop pass to unlock Inbox Triage and
            objection-handling infrastructure. This module uses
            Claude Sonnet to generate high-status, ego-preserving
            enterprise responses in real time.
          </p>
          <a
            href="https://whop.com/checkout/plan_vYopYzyoqunDb"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-12 px-8 rounded-md bg-orange-600 hover:bg-orange-500 text-white font-semibold text-base transition-all duration-200 shadow-[0_0_15px_rgba(234,88,12,0.2)] hover:shadow-[0_0_25px_rgba(234,88,12,0.4)] active:scale-[0.98]"
          >
            Unlock Enterprise Architecture
          </a>
        </div>
      </div>
    );
  }

  const nextSignal = await prisma.inboundSignal.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' }
  });

  return <TriageCommandCenter initialData={nextSignal} />;
}
