"use client";

import { useState, useEffect } from "react";
import { Save, Settings2, CheckCircle2 } from "lucide-react";

export default function CampaignPage() {
  const [companyName, setCompanyName] = useState("");
  const [valueProposition, setValueProposition] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    // Load existing context
    const stored = localStorage.getItem("campaign_context");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setCompanyName(parsed.company_name || "");
        setValueProposition(parsed.value_proposition || "");
        setTargetAudience(parsed.target_audience || "");
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  const handleSave = () => {
    const payload = {
      company_name: companyName,
      value_proposition: valueProposition,
      target_audience: targetAudience,
    };
    localStorage.setItem("campaign_context", JSON.stringify(payload));
    
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const inputClasses =
    "w-full rounded-xl border border-border/50 bg-transparent px-5 py-4 text-lg text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#FF5A1F] focus:border-transparent disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150";

  return (
    <div className="h-[calc(100vh-6rem)] overflow-hidden flex flex-col">
      <div className="w-full max-w-6xl mx-auto flex flex-col flex-1 min-h-0 px-4 md:px-0">
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

        {/* Form Card */}
        <div className="flex-1 min-h-0 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-5 md:p-8 flex flex-col">
          {/* Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 flex-1 min-h-0">
            {/* Company Name — spans full width */}
            <div className="md:col-span-2 space-y-2.5">
              <label className="block text-lg font-medium text-gray-200">
                Your Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className={inputClasses}
              />
            </div>

            {/* Value Proposition — left column */}
            <div className="space-y-2.5 flex flex-col min-h-0">
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
                className={`${inputClasses} min-h-[200px] flex-1 resize-none`}
              />
            </div>

            {/* Target Audience — right column */}
            <div className="space-y-2.5 flex flex-col min-h-0">
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
                className={`${inputClasses} min-h-[200px] flex-1 resize-none`}
              />
            </div>
          </div>

          {/* Footer — Bottom-Right CTA */}
          <div className="flex items-center justify-end w-full mt-6 pt-6 border-t border-border/50 gap-4 shrink-0">
            {showSuccess && (
              <span className="flex items-center gap-2 text-base text-green-400 mr-auto">
                <CheckCircle2 className="w-5 h-5" />
                Campaign context saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!companyName || !valueProposition || !targetAudience}
              className="flex items-center justify-center gap-2.5 bg-primary text-primary-foreground hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] transition-all duration-200 px-8 h-12 rounded-xl text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-5 h-5" />
              Save Campaign
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
