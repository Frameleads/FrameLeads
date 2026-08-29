"use client";

import { createContext, ReactNode, useContext } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { ENTERPRISE_CHECKOUT_URL } from "@/lib/checkout";

interface Props {
  children: ReactNode;
  userTier: string | null;
  featureName: string;
}

const EnterprisePaywallContext = createContext(false);

export function useEnterprisePaywallLocked() {
  return useContext(EnterprisePaywallContext);
}

export default function EnterprisePaywall({ children, userTier, featureName }: Props) {
  const router = useRouter();

  // Strict Fail-Closed Architecture
  // Block unless the user has Enterprise access.
  // ONLY allow if strictly 'ENTERPRISE'
  const hasEnterpriseAccess = userTier === 'ENTERPRISE';

  if (hasEnterpriseAccess) {
    return (
      <EnterprisePaywallContext.Provider value={false}>
        {children}
      </EnterprisePaywallContext.Provider>
    );
  }

  // Otherwise, render the blurred paywall
  return (
    <EnterprisePaywallContext.Provider value={true}>
      <div className="relative w-full h-full">
        <div className="filter blur-md opacity-40 pointer-events-none select-none">
          {children}
        </div>

        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 p-6 text-center">
          <div className="bg-[#1A1A1A] border border-[#242424] shadow-2xl p-8 rounded-2xl max-w-md w-full flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#1A1A1A] border border-[#FF5A1F]/20 flex items-center justify-center mb-6">
              <Lock className="w-6 h-6 text-[#FF5A1F]" />
            </div>
            <h2 className="text-2xl font-bold font-heading uppercase mb-3 text-[#FFFFFF] tracking-wide">
              ENTERPRISE FEATURE LOCKED
            </h2>
            <p className="text-sm font-sans text-[#888888] mb-8 leading-relaxed">
              The {featureName} is exclusively available on the Enterprise Tier to protect high-ticket pipelines.
            </p>
            <a
              href={ENTERPRISE_CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#FF5A1F] hover:bg-[#e5511c] text-white font-semibold px-6 py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(255,90,31,0.4)] border-none"
            >
              Upgrade to Enterprise
            </a>
            <button
              onClick={() => router.back()}
              className="mt-4 text-sm text-[#888888] hover:text-[#FFFFFF] transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </EnterprisePaywallContext.Provider>
  );
}
