"use client";

import { useRouter } from "next/navigation";

// ────────────────────────────────────────────────────────────────────────
// ENTERPRISE FEATURE LOCKED MODAL
//
// A reusable FOMO-driven paywall modal to be used within the strict 
// wrapper pattern to overlay disabled page content.
// ────────────────────────────────────────────────────────────────────────

interface EnterpriseFeatureLockedProps {
  featureName: string;
  description: string;
}

export default function EnterpriseFeatureLocked({
  featureName,
  description,
}: EnterpriseFeatureLockedProps) {
  const router = useRouter();

  return (
    <div className="pointer-events-auto w-full max-w-lg mx-4 bg-[#0e0e0e] border border-gray-800 rounded-2xl p-10 shadow-2xl shadow-black/60 text-center flex flex-col items-center">
      {/* Lock Icon */}
      <div className="w-16 h-16 rounded-full border border-gray-700 bg-[#161616] flex items-center justify-center mb-6">
        <svg
          className="w-7 h-7 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </div>

      {/* Header */}
      <h2
        className="text-xl font-bold text-white tracking-wide mb-2"
        style={{ fontFamily: "Oxanium, sans-serif" }}
      >
        ENTERPRISE FEATURE LOCKED
      </h2>
      <p className="text-sm text-gray-400 mb-1 font-medium">{featureName}</p>

      {/* Description */}
      <p
        className="text-gray-500 text-sm max-w-sm mb-8 leading-relaxed"
        style={{ fontFamily: "Space Grotesk, sans-serif" }}
      >
        {description}
      </p>

      {/* CTA: Upgrade */}
      <a
        href="https://whop.com/checkout/plan_vYopYzyoqunDb"
        target="_blank"
        rel="noopener noreferrer"
        className="w-full h-12 flex items-center justify-center rounded-xl bg-[#FF5A1F] text-white text-sm font-semibold tracking-wide transition-all hover:bg-[#FF5A1F]/90 hover:shadow-lg hover:shadow-[#FF5A1F]/20 active:scale-[0.98]"
      >
        Upgrade to Enterprise
      </a>

      {/* CTA: Maybe Later (ghost) */}
      <button
        onClick={() => router.back()}
        className="mt-4 text-sm text-gray-600 hover:text-gray-400 transition-colors"
      >
        Maybe Later
      </button>
    </div>
  );
}
