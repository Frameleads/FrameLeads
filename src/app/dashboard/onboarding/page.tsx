"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  FileText,
  Target,
  TrendingUp,
  Briefcase,
  Shield,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Lock,
  Webhook,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

/** Campaign Template represents a pre-built, proven outreach configuration
 *  that lets new users bypass the complexity of defining their own campaign
 *  context, CTA strategy, and target audience from scratch.
 *
 *  UX CONSTRAINT: These templates exist to solve the Day-1 churn problem.
 *  If a new user has to configure everything manually, they leave before
 *  experiencing value. Templates give them a working pipeline in < 60 seconds.
 */
interface CampaignTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  /** Pre-filled campaign context that gets saved to localStorage */
  prefilledContext: {
    company_name: string;
    value_proposition: string;
    target_audience: string;
    preferred_cta_style: string;
    cta_style_key: string;
    wedge_offer_detail: string;
  };
  /** Visual tag for the template card */
  tag: string;
  tagColor: string;
}

// ── Campaign Template Library ───────────────────────────────────────────
// These are static, proven configurations. They are NOT customizable on
// this screen. The user selects one, it pre-fills their Campaign Context,
// and they proceed directly to Ingestion. Customization happens later in
// the Campaign Builder if they want to refine.
// ─────────────────────────────────────────────────────────────────────────

const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "pipeline_governance",
    name: "Pipeline Governance",
    description:
      "Protect high-ticket deals from rogue AI and silent software failures. Target operations leaders trapped in manual triage.",
    icon: Shield,
    prefilledContext: {
      company_name: "",
      value_proposition:
        "We build autonomous pipeline governance infrastructure that protects high-ticket deals from rogue AI and silent software failures — enforcing human approval before anything sends.",
      target_audience:
        "Founders and COOs of B2B service businesses doing $50k-$300k/mo who are losing deals to pipeline fragility and manual coordination overhead.",
      preferred_cta_style: "Self-Serve Audit Link",
      cta_style_key: "self_serve_audit",
      wedge_offer_detail: "",
    },
    tag: "Recommended",
    tagColor: "text-[#FF5A1F] bg-[#FF5A1F]/10 border-[#FF5A1F]/20",
  },
  {
    id: "outbound_scaling",
    name: "Outbound Scaling Engine",
    description:
      "Replace SDR coordination overhead with autonomous multi-channel sequencing. Built for agencies hitting a headcount ceiling.",
    icon: TrendingUp,
    prefilledContext: {
      company_name: "",
      value_proposition:
        "We engineer autonomous acquisition infrastructure that scales outbound past the SDR headcount ceiling — multi-channel sequencing without coordination overhead.",
      target_audience:
        "Agency founders doing $30k-$150k/mo who are trapped in daily SDR management and can't scale without hiring more bodies.",
      preferred_cta_style: "Call / Diagnostic",
      cta_style_key: "call_diagnostic",
      wedge_offer_detail: "",
    },
    tag: "High Volume",
    tagColor: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  },
  {
    id: "wedge_offer_play",
    name: "Wedge Offer Positioning",
    description:
      "Lead with a high-value audit or teardown as the entry point. Positions authority without requiring a live meeting.",
    icon: Briefcase,
    prefilledContext: {
      company_name: "",
      value_proposition:
        "We provide diagnostic-first consulting infrastructure — identifying critical operational hemorrhages before proposing solutions.",
      target_audience:
        "Funded founders and lean CEOs in B2B SaaS and services who are skeptical of cold outreach but responsive to genuine operational insights.",
      preferred_cta_style: "Wedge Offer (Audit/Resource)",
      cta_style_key: "wedge_offer",
      wedge_offer_detail: "Outbound Fragility Audit",
    },
    tag: "New",
    tagColor: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  },
];

// ── Component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();

  // ── Default Path State ──────────────────────────────────────────────
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [userCompanyName, setUserCompanyName] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);

  // ── Advanced Path State ─────────────────────────────────────────────
  // UX CONSTRAINT: Advanced capabilities are COLLAPSED by default.
  // Signal Ingestion configuration is visually gated behind this toggle
  // so new users are not overwhelmed with webhook/API configuration on
  // their first session. Only power users who know what Clay/Phantombuster
  // are will expand this section.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookCopied, setWebhookCopied] = useState(false);

  // The generated webhook endpoint (would be per-user in production)
  const generatedWebhookUrl = "https://api.frameleads.io/v1/signals/ingest";

  const selectedTemplate = CAMPAIGN_TEMPLATES.find((t) => t.id === selectedTemplateId);

  // ── Handlers ────────────────────────────────────────────────────────

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId);
  };

  const handleDeploy = async () => {
    if (!selectedTemplate || !userCompanyName.trim()) return;
    setIsDeploying(true);

    // Merge the user's company name into the template's prefilled context
    const campaignContext = {
      ...selectedTemplate.prefilledContext,
      company_name: userCompanyName.trim(),
    };

    // Persist to localStorage — same format the Campaign Builder reads
    localStorage.setItem("campaign_context", JSON.stringify(campaignContext));

    // Brief artificial delay for perceived processing
    await new Promise((r) => setTimeout(r, 800));

    // Route directly to ingestion — skip the Campaign Builder entirely
    // since the template has already populated all required fields.
    router.push("/dashboard/ingestion");
  };

  const handleCopyWebhook = async () => {
    await navigator.clipboard.writeText(generatedWebhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  // ── Styles ──────────────────────────────────────────────────────────

  const inputClasses =
    "rounded-xl border border-border/50 bg-transparent text-foreground ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#FF5A1F] focus:border-transparent transition-all duration-150";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 lg:px-0 py-8 md:py-12">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="text-center mb-10 md:mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#FF5A1F]/20 bg-[#FF5A1F]/5 text-[#FF5A1F] text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            Pipeline Governance
          </div>
          <h1 className="text-3xl md:text-4xl font-bold font-heading tracking-tight text-white">
            Launch Your First Campaign
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-2xl mx-auto leading-relaxed">
            Select a proven campaign template to get immediate time-to-value.
            Upload your leads and start generating outreach in under 60 seconds.
          </p>
        </div>

        {/* ────────────────────────────────────────────────────────────
            DEFAULT PATH: Campaign Template Selection
            
            UX RATIONALE: Templates are the primary onboarding path.
            They eliminate the need for new users to understand CTA
            strategies, audience targeting, or value prop framing
            before they can see the product work. Each template
            pre-fills the ENTIRE campaign context, so the user only
            needs to add their company name and upload a CSV.
        ──────────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
          {CAMPAIGN_TEMPLATES.map((template) => {
            const isSelected = selectedTemplateId === template.id;
            const Icon = template.icon;

            return (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className={`relative text-left p-6 rounded-2xl border-2 transition-all duration-200 flex flex-col gap-4 group ${
                  isSelected
                    ? "border-[#FF5A1F] bg-[#FF5A1F]/5 shadow-lg shadow-[#FF5A1F]/10"
                    : "border-border/50 bg-card/50 hover:border-border hover:bg-card/80"
                }`}
              >
                {/* Tag */}
                <span
                  className={`absolute top-4 right-4 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border ${template.tagColor}`}
                >
                  {template.tag}
                </span>

                {/* Icon */}
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
                    isSelected
                      ? "bg-[#FF5A1F]/15 text-[#FF5A1F]"
                      : "bg-muted/50 text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <Icon className="w-6 h-6" />
                </div>

                {/* Copy */}
                <div>
                  <h3
                    className={`text-base font-semibold mb-1.5 transition-colors ${
                      isSelected ? "text-white" : "text-gray-300 group-hover:text-white"
                    }`}
                  >
                    {template.name}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {template.description}
                  </p>
                </div>

                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#FF5A1F] flex items-center justify-center shadow-lg shadow-[#FF5A1F]/30">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Company Name + Deploy (visible only after template selection) ── */}
        {selectedTemplate && (
          <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 md:p-8 mb-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex flex-col md:flex-row md:items-end gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Your Company Name
                </label>
                <p className="text-xs text-gray-500 mb-3">
                  This is the only field you need to fill. Everything else is pre-configured by the template.
                </p>
                <input
                  type="text"
                  value={userCompanyName}
                  onChange={(e) => setUserCompanyName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  className={`w-full p-4 text-sm leading-relaxed ${inputClasses}`}
                  autoFocus
                />
              </div>
              <button
                onClick={handleDeploy}
                disabled={!userCompanyName.trim() || isDeploying}
                className="flex items-center justify-center gap-2.5 bg-[#FF5A1F] text-white hover:bg-[#FF5A1F]/90 hover:shadow-lg hover:shadow-[#FF5A1F]/20 active:scale-[0.98] transition-all duration-200 px-8 h-12 rounded-xl text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isDeploying ? (
                  <>
                    <Sparkles className="w-5 h-5 animate-pulse" />
                    Deploying...
                  </>
                ) : (
                  <>
                    Deploy Campaign
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>

            {/* Template preview — what gets pre-filled */}
            <div className="mt-6 pt-5 border-t border-border/30">
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 font-medium">
                Template Preview
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 text-xs mb-1">CTA Strategy</p>
                  <p className="text-gray-300">{selectedTemplate.prefilledContext.preferred_cta_style}</p>
                </div>
                <div className="md:col-span-2">
                  <p className="text-gray-500 text-xs mb-1">Target Audience</p>
                  <p className="text-gray-300 line-clamp-2">{selectedTemplate.prefilledContext.target_audience}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ────────────────────────────────────────────────────────────
            ADVANCED PATH: Signal Ingestion Configuration
            
            UX RATIONALE: This section is COLLAPSED by default. The
            toggle uses visual "lock" iconography to signal that this
            is a power-user feature. Opening it reveals webhook
            configuration for receiving signals from external scrapers
            (Clay, Phantombuster, etc.).
            
            CHURN PREVENTION: By hiding this behind an explicit toggle,
            new users never see webhook URLs, API keys, or integration
            complexity during their first session. They get to value
            (template → upload CSV → see generated copy) without ever
            encountering this screen.
        ──────────────────────────────────────────────────────────────── */}
        <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm overflow-hidden">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-muted/20 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/50 border border-border/50 flex items-center justify-center group-hover:border-border transition-colors">
                {showAdvanced ? (
                  <Webhook className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <Lock className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">
                  Advanced Capabilities
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Signal Ingestion, Webhook Configuration, Scraper Integration
                </p>
              </div>
            </div>
            {showAdvanced ? (
              <ChevronUp className="w-5 h-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-5 h-5 text-muted-foreground" />
            )}
          </button>

          {showAdvanced && (
            <div className="px-6 pb-6 animate-in fade-in slide-in-from-top-2 duration-300">
              {/* Warning Banner */}
              <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm mb-6">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Requires External Tooling</p>
                  <p className="text-xs text-amber-400/70 mt-1">
                    Signal Ingestion requires an active subscription to a data
                    provider (e.g., Clay, Phantombuster, or a custom scraping
                    pipeline). If you don&apos;t have one, start with a Campaign Template above.
                  </p>
                </div>
              </div>

              {/* Webhook Endpoint */}
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Your Ingest Webhook Endpoint
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Point your Clay or Phantombuster webhook to this URL. Incoming
                    signals will appear in your Inbox Triage queue for AI-powered
                    objection handling.
                  </p>
                  <div className="flex items-center gap-3">
                    <div className={`flex-1 p-3 text-sm font-mono text-gray-400 bg-[#0a0a0a] rounded-xl border border-border/50 truncate`}>
                      {generatedWebhookUrl}
                    </div>
                    <button
                      onClick={handleCopyWebhook}
                      className="h-11 px-5 rounded-xl border border-border/50 text-sm font-medium text-gray-300 hover:text-white hover:border-border hover:bg-muted/30 transition-all whitespace-nowrap"
                    >
                      {webhookCopied ? (
                        <span className="flex items-center gap-1.5 text-green-400">
                          <CheckCircle2 className="w-4 h-4" /> Copied
                        </span>
                      ) : (
                        "Copy URL"
                      )}
                    </button>
                  </div>
                </div>

                {/* Custom Webhook Source (Optional) */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Custom Source URL <span className="text-gray-500 font-normal">(Optional)</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    If you&apos;re sending signals from a custom source, paste its
                    origin URL here for verification and logging.
                  </p>
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="e.g. https://app.clay.com/webhooks/..."
                    className={`w-full p-3 text-sm leading-relaxed ${inputClasses}`}
                  />
                </div>

                {/* Integration Status Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-2">
                  {[
                    { name: "Clay", status: "Not Connected", connected: false },
                    { name: "Phantombuster", status: "Not Connected", connected: false },
                    { name: "Custom Webhook", status: webhookUrl ? "Configured" : "Not Configured", connected: !!webhookUrl },
                  ].map((integration) => (
                    <div
                      key={integration.name}
                      className={`flex items-center justify-between p-3 rounded-xl border text-sm ${
                        integration.connected
                          ? "border-green-500/30 bg-green-500/5"
                          : "border-border/50 bg-card/30"
                      }`}
                    >
                      <span className="text-gray-300 font-medium">{integration.name}</span>
                      <span
                        className={`text-xs ${
                          integration.connected ? "text-green-400" : "text-gray-500"
                        }`}
                      >
                        {integration.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Skip to Campaign Builder link ───────────────────────── */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Want full control?{" "}
            <a
              href="/dashboard/campaign"
              className="text-[#FF5A1F] hover:text-[#FF5A1F]/80 underline underline-offset-4 transition-colors"
            >
              Open the Campaign Builder
            </a>{" "}
            to configure everything manually.
          </p>
        </div>

      </div>
    </div>
  );
}
