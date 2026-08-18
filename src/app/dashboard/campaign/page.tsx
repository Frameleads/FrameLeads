"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Save, Settings2, CheckCircle2, ChevronDown, Loader2, Sparkles } from "lucide-react";

// ── CTA Style Options ─────────────────────────────────────────────────
// Each CTA style maps to a specific closing technique injected into the
// LLM system prompt at generation time. The "Wedge Offer" is unique: it
// requires a secondary input because the user must define THEIR specific
// audit/resource name. This prevents the AI from hallucinating a generic
// offer and forces domain-specific positioning.
// ───────────────────────────────────────────────────────────────────────

type CtaStyleKey =
  | "self_serve_audit"
  | "call_diagnostic"
  | "send_memo"
  | "wedge_offer"
  | "custom";

interface CtaOption {
  key: CtaStyleKey;
  label: string;
  description: string;
  /** If true, reveals a secondary input field for the user to define specifics. */
  requiresDetail: boolean;
}

const CTA_OPTIONS: CtaOption[] = [
  {
    key: "self_serve_audit",
    label: "Self-Serve Audit Link",
    description: "Default — Low commitment. Drops a link to a self-serve diagnostic.",
    requiresDetail: false,
  },
  {
    key: "call_diagnostic",
    label: "Call / Diagnostic",
    description: "15-minute walkthrough. Higher intent, higher friction.",
    requiresDetail: false,
  },
  {
    key: "send_memo",
    label: "Send a Memo or Resource",
    description: "Async teardown PDF. Positions authority without requiring a live meeting.",
    requiresDetail: false,
  },
  {
    key: "wedge_offer",
    label: "Wedge Offer (Audit/Resource)",
    description: "Position a specific audit, playbook, or resource as the entry point. You must define the offer below.",
    requiresDetail: true,
  },
  {
    key: "custom",
    label: "Custom",
    description: "Use Campaign Context rules. The AI will infer the close from your value proposition.",
    requiresDetail: false,
  },
];

// ── Component ───────────────────────────────────────────────────────

export default function CampaignPage() {
  const [companyName, setCompanyName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [valueProposition, setValueProposition] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  // ────────────────────────────────────────────────────────────────────
  // PHASE 1 UPDATE: CTA is now stored as a structured key, not a raw
  // string. This allows the downstream generation pipeline to branch
  // on `ctaStyleKey` and conditionally inject the `wedgeOfferDetail`
  // into the system prompt ONLY when the user has explicitly defined it.
  // ────────────────────────────────────────────────────────────────────
  const [ctaStyleKey, setCtaStyleKey] = useState<CtaStyleKey>("self_serve_audit");
  const [wedgeOfferDetail, setWedgeOfferDetail] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [magicAssistLoading, setMagicAssistLoading] = useState(false);
  const [magicAssistError, setMagicAssistError] = useState("");

  const router = useRouter();

  // The currently selected CTA option object (derived state, not stored)
  const selectedCta = CTA_OPTIONS.find((o) => o.key === ctaStyleKey)!;

  useEffect(() => {
    // Load existing context — backward compatible with the old string format.
    const stored = localStorage.getItem("campaign_context");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCompanyName(parsed.company_name || "");
        setSenderName(parsed.sender_name || "");
        setValueProposition(parsed.value_proposition || "");
        setTargetAudience(parsed.target_audience || "");
        setWebsiteUrl(parsed.website_url || "");

        // Migration: if the old format stored `preferred_cta_style` as a raw
        // label string, attempt to match it to the new key-based system.
        if (parsed.cta_style_key) {
          setCtaStyleKey(parsed.cta_style_key);
          setWedgeOfferDetail(parsed.wedge_offer_detail || "");
        } else if (parsed.preferred_cta_style) {
          const legacy = parsed.preferred_cta_style.toLowerCase();
          const match = CTA_OPTIONS.find((o) =>
            legacy.includes(o.label.toLowerCase().slice(0, 10))
          );
          setCtaStyleKey(match?.key || "self_serve_audit");
        }
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  const handleSave = () => {
    // ────────────────────────────────────────────────────────────────
    // PAYLOAD STRUCTURE: The downstream LLM prompt builder reads
    // `cta_style_key` to determine which closing framework to inject.
    // If key === "wedge_offer", it also reads `wedge_offer_detail`
    // to insert the user's specific offer name into the prompt.
    // The legacy `preferred_cta_style` field is preserved for
    // backward compatibility with any existing prompt templates.
    // ────────────────────────────────────────────────────────────────
    const payload = {
      company_name: companyName,
      sender_name: senderName,
      website_url: websiteUrl,
      value_proposition: valueProposition,
      target_audience: targetAudience,
      preferred_cta_style: selectedCta.label,
      cta_style_key: ctaStyleKey,
      wedge_offer_detail: ctaStyleKey === "wedge_offer" ? wedgeOfferDetail : "",
    };
    localStorage.setItem("campaign_context", JSON.stringify(payload));

    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      router.push("/dashboard/ingestion");
    }, 1000);
  };

  const handleMagicAssist = async () => {
    if (!websiteUrl) return;
    setMagicAssistLoading(true);
    setMagicAssistError("");
    try {
      const res = await fetch("/api/magic-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: websiteUrl }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.targetAudience) setTargetAudience(data.targetAudience);
        if (data.valueProposition) setValueProposition(data.valueProposition);
      } else {
        setMagicAssistError(data.error || "Magic Assist failed. Please try again.");
      }
    } catch (err: any) {
      setMagicAssistError("Network error. Could not reach Magic Assist.");
    } finally {
      setMagicAssistLoading(false);
    }
  };

  const inputClasses =
    "rounded-xl border border-border/50 bg-transparent text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#FF5A1F] focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150";

  return (
    <div className="h-screen overflow-y-auto flex flex-col">
      <div className="w-full max-w-6xl mx-auto flex flex-col px-4 md:px-0 pb-12">
        {/* Header */}
        <div className="pt-2 pb-6 md:pb-8 shrink-0">
          <h1 className="text-4xl font-bold flex items-center gap-4 font-heading tracking-tight">
            <Settings2 className="w-8 h-8 text-primary" />
            Campaign Context
          </h1>
          <p className="text-lg text-muted-foreground mt-3 leading-relaxed">
            Define your brand identity and offer. The AI uses this context to
            automatically tailor its generated outreach to your specific business.
          </p>
        </div>

        {/* The DOM Rebuild */}
        <div className="flex flex-col gap-8 md:grid md:grid-cols-2 pb-24 overflow-y-auto bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-5 md:p-8">
          
          {/* Block 1: Company Name */}
          <div className="w-full md:col-span-1 flex flex-col gap-2">
            <label className="block text-lg font-medium text-gray-200">
              Your Company Name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className={`w-full p-4 text-sm leading-relaxed ${inputClasses}`}
            />
          </div>

          {/* Block 1.5: Sender Name */}
          <div className="w-full md:col-span-1 flex flex-col gap-2">
            <label className="block text-lg font-medium text-gray-200">
              Sender Name
            </label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="e.g. Akram"
              className={`w-full p-4 text-sm leading-relaxed ${inputClasses}`}
            />
          </div>

          {/* Block 2: Magic Assist — Website URL */}
          <div className="w-full md:col-span-2 flex flex-col gap-2">
            <label className="block text-lg font-medium text-gray-200">
              Company Website URL
            </label>
            <p className="text-sm text-gray-500 leading-relaxed">
              Paste your website URL and let AI suggest your target audience and value proposition.
            </p>
            <div className="flex flex-col w-full gap-3">
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="e.g. https://yourcompany.com"
                className={`w-full flex-1 p-4 text-sm leading-relaxed ${inputClasses}`}
              />
              <button
                onClick={handleMagicAssist}
                disabled={!websiteUrl || magicAssistLoading}
                className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 whitespace-nowrap"
              >
                {magicAssistLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Magic Assist</>
                )}
              </button>
            </div>
            {magicAssistError && (
              <p className="text-xs text-red-400 mt-1">{magicAssistError}</p>
            )}
          </div>

          {/* Block 2: Value Proposition */}
          <div className="w-full flex flex-col gap-2">
            <label className="block text-lg font-medium text-gray-200">
              Value Proposition
            </label>
            <p className="text-sm text-gray-500 leading-relaxed">
              What exactly do you do and what results do you drive?
            </p>
            <textarea
              value={valueProposition}
              onChange={(e) => setValueProposition(e.target.value)}
              placeholder="e.g. We build autonomous AI infrastructure that scales marketing agencies past $1M/mo without adding headcount."
              className={`min-h-[200px] w-full resize-none p-4 text-sm leading-relaxed ${inputClasses}`}
            />
          </div>

          {/* Block 3: Target Audience */}
          <div className="w-full flex flex-col gap-2">
            <label className="block text-lg font-medium text-gray-200">
              Target Audience
            </label>
            <p className="text-sm text-gray-500 leading-relaxed">
              Who are you trying to reach?
            </p>
            <textarea
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="e.g. Founders of B2B service businesses doing $30k-$150k/mo who are trapped in daily operations."
              className={`min-h-[200px] w-full resize-none p-4 text-sm leading-relaxed ${inputClasses}`}
            />
          </div>

          {/* ─────────────────────────────────────────────────────────────
              Block 4: CTA Style Selector (PHASE 1 UPDATE)
              
              UX CONSTRAINT: The "Wedge Offer" option is deliberately NOT
              the default. New users should start with "Self-Serve Audit"
              which requires zero configuration. The Wedge Offer secondary
              input only renders when explicitly selected, preventing
              cognitive overload for first-time users.
              
              DATA CONSTRAINT: `wedge_offer_detail` is per-campaign state,
              NOT a global setting. Different campaigns can have different
              wedge offers. This is stored in localStorage alongside the
              campaign context and cleared if the user switches away from
              the Wedge Offer CTA type.
          ───────────────────────────────────────────────────────────────── */}
          <div className="w-full md:col-span-2 flex flex-col gap-2 border-t border-border/50 pt-6">
            <label className="block text-lg font-medium text-gray-200">
              Preferred CTA Style
            </label>
            <p className="text-sm text-gray-500 leading-relaxed">
              Defines how generated copy closes across Email, LinkedIn, and Inbox Triage.
            </p>
            <div className="relative w-full md:w-2/3">
              <select
                value={ctaStyleKey}
                onChange={(e) => {
                  const newKey = e.target.value as CtaStyleKey;
                  setCtaStyleKey(newKey);
                  // Clear wedge offer detail when switching AWAY from wedge offer
                  // to prevent stale data from leaking into future prompts.
                  if (newKey !== "wedge_offer") {
                    setWedgeOfferDetail("");
                  }
                }}
                className={`w-full p-4 text-sm leading-relaxed cursor-pointer appearance-none pr-10 ${inputClasses}`}
              >
                {CTA_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key} className="bg-[#121212] text-white">
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
            </div>

            {/* CTA Description — dynamically updates based on selection */}
            <p className="text-xs text-gray-500 mt-1 italic">
              {selectedCta.description}
            </p>

            {/* ───────────────────────────────────────────────────────────
                CONDITIONAL SECONDARY INPUT: Wedge Offer Detail
                
                This field ONLY renders when the user explicitly selects
                "Wedge Offer (Audit/Resource)". It forces the user to
                define their specific offer name so the AI has a concrete
                asset to reference in the CTA rather than hallucinating
                a generic "free audit" that doesn't exist.
                
                Examples:
                - "Outbound Fragility Audit"
                - "Pipeline Governance Playbook"  
                - "Revenue Architecture Teardown"
            ─────────────────────────────────────────────────────────────── */}
            {selectedCta.requiresDetail && (
              <div className="mt-4 p-4 rounded-xl border border-[#FF5A1F]/30 bg-[#FF5A1F]/5 flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF5A1F] animate-pulse" />
                  Define Your Wedge Offer
                </label>
                <p className="text-xs text-gray-500 leading-relaxed">
                  What specific audit, playbook, or resource will you offer as the entry point?
                  The AI will reference this exact name in every generated CTA.
                </p>
                <input
                  type="text"
                  value={wedgeOfferDetail}
                  onChange={(e) => setWedgeOfferDetail(e.target.value)}
                  placeholder='e.g. "Outbound Fragility Audit"'
                  className={`w-full p-3 text-sm leading-relaxed ${inputClasses} border-[#FF5A1F]/20 focus:ring-[#FF5A1F]`}
                />
              </div>
            )}
          </div>

          {/* Block 5: Save Action */}
          <div className="w-full md:col-span-2 flex justify-center md:justify-start mt-8">
            <div className="flex items-center gap-4">
              <button
                onClick={handleSave}
                disabled={
                  !companyName ||
                  !valueProposition ||
                  !targetAudience ||
                  // Block save if Wedge Offer is selected but the detail field is empty.
                  // This prevents the AI from receiving an empty wedge offer instruction.
                  (ctaStyleKey === "wedge_offer" && !wedgeOfferDetail.trim())
                }
                className="flex shrink-0 items-center justify-center gap-2.5 bg-primary text-primary-foreground hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] transition-all duration-200 px-8 h-12 rounded-xl text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-5 h-5" />
                Save Campaign
              </button>
              {showSuccess && (
                <span className="flex items-center gap-2 text-base text-[#22C55E] whitespace-nowrap" role="status">
                  <CheckCircle2 className="w-5 h-5" />
                  Campaign context saved
                </span>
              )}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
