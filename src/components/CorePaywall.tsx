"use client";

import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";

interface Props {
  children: ReactNode;
  userTier: string | null;
  featureName: string;
}

export default function CorePaywall({ children, userTier, featureName }: Props) {
  const router = useRouter();

  // Strict Fail-Closed Architecture
  // Block if tier is undefined, null, FREE, or MICRO_PILOT
  // ONLY allow if strictly 'CORE' or 'ENTERPRISE'
  const hasCoreAccess = userTier === 'CORE' || userTier === 'ENTERPRISE';

  if (hasCoreAccess) {
    return <>{children}</>;
  }

  // Otherwise, render the blurred paywall
  return (
    <div className="relative w-full h-full min-h-[80vh] overflow-hidden">
      <div className="blur-md pointer-events-none select-none opacity-40">
        {children}
      </div>

      <div className="absolute inset-0 z-40 flex items-center justify-center p-6 text-center">
        <div className="bg-[#000000] border border-[#1A1A1A] shadow-2xl p-8 rounded-2xl max-w-md w-full flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-[#1A1A1A] border border-[#FF5A1F]/20 flex items-center justify-center mb-6">
            <Lock className="w-6 h-6 text-[#FF5A1F]" />
          </div>
          <h2 className="text-2xl font-bold font-heading mb-3 text-[#FFFFFF] tracking-tight">
            CORE FEATURE LOCKED
          </h2>
          <p className="text-sm text-[#888888] mb-8 leading-relaxed">
            The {featureName} is exclusively available on the Core Tier (and above) for seamless deployment.
          </p>
          <a
            href="https://whop.com/brandflowstudio/frameleads-24/"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full h-12 bg-[#FF5A1F] text-[#FFFFFF] font-semibold rounded-xl shadow-lg shadow-[#FF5A1F]/20 hover:bg-[#FF5A1F]/90 hover:shadow-[#FF5A1F]/30 transition-all mb-4 flex items-center justify-center"
          >
            Upgrade to Core
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
  );
}
