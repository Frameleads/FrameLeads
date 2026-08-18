"use client";

import { createContext, ReactNode, useContext } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";

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
      <div className="relative w-full h-full min-h-[80vh] overflow-hidden">
        <div className="pointer-events-none select-none">
          {children}
        </div>

        <div className="absolute inset-0 z-50 backdrop-blur-md bg-[#000000]/80 flex flex-col items-center justify-center p-6 text-center">
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
              href="https://whop.com/brandflowstudio/frameleads-enterprise-autonomous-architecture/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-12 bg-[#FF5A1F] text-[#FFFFFF] font-semibold rounded-xl shadow-lg shadow-[#FF5A1F]/20 hover:bg-[#FF5A1F]/90 hover:shadow-[#FF5A1F]/30 transition-all mb-4 flex items-center justify-center"
            >
              Upgrade to Enterprise
            </a>
            <button
              onClick={() => router.back()}
              className="text-sm text-[#888888] hover:text-[#FFFFFF] transition-colors"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </EnterprisePaywallContext.Provider>
  );
}
