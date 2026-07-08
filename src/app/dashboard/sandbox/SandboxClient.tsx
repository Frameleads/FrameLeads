"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Globe,
  Sparkles,
  CheckCircle2,
  Loader2,
  Copy,
  RotateCcw,
  Inbox,
  Radio,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

interface Lead {
  lead_id: string;
  first_name: string;
  company_name: string;
  website_url: string | null;
  provided_incident_details: string | null;
  enrichment_status: string;
  generation_status: string;
  generated_email: string | null;
  generated_linkedin: string | null;
  generated_script: string | null;
  generated_whatsapp: string | null;
  deployment_status: string;
}

interface BatchResponse {
  batch_id: string;
  status: string;
  leads: Lead[];
  processed_count: number;
  error_message: string | null;
}

// ── Status badge config ─────────────────────────────────────────────

const statusConfig: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  completed: {
    label: "Completed",
    color: "text-green-400 bg-green-400/10 border-green-400/20",
    icon: CheckCircle2,
  },
  queued: {
    label: "Generating Copy\u2026",
    color: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    icon: Loader2,
  },
  pending_scrape: {
    label: "Scraping Website\u2026",
    color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    icon: Globe,
  },
  waiting_on_enrichment: {
    label: "Awaiting Enrichment",
    color: "text-purple-400 bg-purple-400/10 border-purple-400/20",
    icon: Loader2,
  },
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

const POLL_INTERVAL_MS = 3_000;

// ── Component ───────────────────────────────────────────────────────

export default function SandboxClient({ userTier }: { userTier: string }) {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("processing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"email" | "linkedin" | "script" | "whatsapp">("email");
  const [copySuccess, setCopySuccess] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState(4);
  const [isPaywallActive, setIsPaywallActive] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Paywall Trigger Fix: evaluate updated state immediately after limit breach
  useEffect(() => {
    if (userTier === 'CORE' && creditsRemaining <= 0) {
      setIsPaywallActive(true);
    }
  }, [creditsRemaining, userTier]);

  // ── Load initial batch from sessionStorage ────────────────────────

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("frameleads_batch");
      if (stored) {
        const batch: BatchResponse = JSON.parse(stored);
        setBatchId(batch.batch_id);
        setBatchStatus(batch.status);
        setLeads(batch.leads);
        if (batch.leads.length > 0) {
          setSelectedId(batch.leads[0].lead_id);
        }
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // ── Polling logic ─────────────────────────────────────────────────

  const fetchBatch = useCallback(async () => {
    if (!batchId) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/batch/${batchId}`);
      if (!res.ok) return;
      const data: BatchResponse = await res.json();

      setBatchStatus(data.status);
      setLeads(data.leads);

      // Stop polling when the batch is fully done
      if (data.status === "completed" || data.status === "failed") {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    } catch {
      // network blip — keep polling
    }
  }, [batchId, selectedId]);

  useEffect(() => {
    if (!batchId || batchStatus === "completed" || batchStatus === "failed") {
      return;
    }

    // Start polling
    pollingRef.current = setInterval(fetchBatch, POLL_INTERVAL_MS);

    // Also fire immediately
    fetchBatch();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [batchId, batchStatus, fetchBatch]);

  const [loadingTextIndex, setLoadingTextIndex] = useState(0);
  const loadingStrings = ["Scraping Infrastructure...", "Analyzing Parameters...", "Deploying Logic..."];

  useEffect(() => {
    const int = setInterval(() => {
      setLoadingTextIndex(prev => (prev + 1) % loadingStrings.length);
    }, 800);
    return () => clearInterval(int);
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────

  const selectedLead = leads.find((l) => l.lead_id === selectedId);

  const handleSelect = (lead: Lead) => {
    setSelectedId(lead.lead_id);
    setCopySuccess(false);
  };

  const handleRegenerate = async () => {
    if (!selectedLead || (userTier === 'CORE' && isPaywallActive)) return;
    
    if (userTier === 'CORE' && creditsRemaining <= 0) {
      setIsPaywallActive(true);
      return;
    }
    
    // Strip generated data to force the UI into a loading state
    setLeads(current => current.map(l => 
      l.lead_id === selectedLead.lead_id 
        ? { ...l, generated_email: null, generation_status: "queued" } 
        : l
    ));

    try {
      const payload = {
        batch_id: batchId || `regen_${Date.now()}`,
        leads: [selectedLead],
        timestamp: Date.now(),
        creditsUsed: 500 - creditsRemaining, // For backend simulation
        tier: userTier
      };
      const res = await fetch(`/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      
      if (res.status === 403) {
        setIsPaywallActive(true);
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data.error === 'LIMIT_REACHED') {
          setIsPaywallActive(true);
          return;
        }
        
        const updatedLead = data.leads[0];
        setLeads(current => current.map(l => 
          l.lead_id === selectedLead.lead_id ? { ...l, ...updatedLead } : l
        ));
        
        data.leads.forEach(() => {
          setCreditsRemaining(prev => Math.max(0, prev - 1));
        });
      }
    } catch (e) {
      console.error("Regeneration failed", e);
    }
  };

  const handleCopy = async () => {
    if (!selectedLead) return;
    let textToCopy: any = "";
    if (activeTab === "email") textToCopy = selectedLead.generated_email || "";
    if (activeTab === "linkedin") textToCopy = selectedLead.generated_linkedin || "";
    if (activeTab === "script") textToCopy = selectedLead.generated_script || "";
    if (activeTab === "whatsapp") textToCopy = selectedLead.generated_whatsapp || "";
    
    if (typeof textToCopy === 'string') {
      try {
        const parsed = JSON.parse(textToCopy);
        if (typeof parsed === 'object' && parsed !== null) {
          textToCopy = (activeTab === "email" && parsed.subject ? `Subject: ${parsed.subject}\n\n` : '') + (parsed.body || '');
        }
      } catch { /* ignore */ }
    } else if (typeof textToCopy === 'object' && textToCopy !== null) {
      textToCopy = (activeTab === "email" && textToCopy.subject ? `Subject: ${textToCopy.subject}\n\n` : '') + (textToCopy.body || '');
    }

    await navigator.clipboard.writeText(String(textToCopy));
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const getStatus = (lead: Lead) => {
    if (lead.generation_status === "completed") return statusConfig.completed;
    if (lead.generation_status === "queued") return statusConfig.queued;
    if (lead.enrichment_status === "pending_scrape")
      return statusConfig.pending_scrape;
    return statusConfig.waiting_on_enrichment;
  };

  const completedCount = leads.filter(
    (l) => l.generation_status === "completed"
  ).length;

  const isPolling = batchStatus === "processing" && pollingRef.current !== null;

  // ── Empty state ───────────────────────────────────────────────────

  if (leads.length === 0 && !batchId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] h-[calc(100vh-8rem)] text-center px-4">
        <div className="w-20 h-20 rounded-2xl bg-muted/50 border border-border/50 flex items-center justify-center mb-8">
          <Inbox className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-semibold font-heading">No leads yet</h2>
        <p className="text-lg text-muted-foreground mt-2 mb-8 max-w-md">
          Upload a CSV in the Ingestion tab to get started.
        </p>
        <button
          onClick={() => router.push("/dashboard/ingestion")}
          className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-medium transition-all hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98]"
        >
          Go to Ingestion
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)] relative">
      {isPaywallActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-md rounded-2xl">
          <div className="bg-card border border-border shadow-2xl p-8 rounded-2xl max-w-lg text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
              <span className="text-red-500 font-bold text-2xl">!</span>
            </div>
            <h2 className="text-2xl font-bold font-heading mb-3">Core Infrastructure Limit Reached</h2>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Your acquisition volume has outscaled the Core tier. Upgrade to Velvet Rope for unmetered generation.
            </p>
            <button
              onClick={() => {}}
              className="h-12 px-8 rounded-xl bg-primary text-primary-foreground text-base font-medium transition-all hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] w-full"
            >
              Upgrade Infrastructure
            </button>
          </div>
        </div>
      )}
      
      {/* Left Panel — Lead Table */}
      <div className="w-1/2 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium font-heading">Leads</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {completedCount} of {leads.length} leads generated
            </p>
            {userTier === 'CORE' && (
              <p className="text-xs font-semibold text-primary mt-1">
                Infrastructure Bandwidth: {creditsRemaining} / 500 Remaining
              </p>
            )}
          </div>
          {isPolling && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-blue-400 bg-blue-400/10 border-blue-400/20 animate-pulse">
              <Radio className="w-3 h-3" />
              Live
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/30">
          {leads.map((lead) => {
            const status = getStatus(lead);
            const isActive = lead.lead_id === selectedId;
            return (
              <button
                key={lead.lead_id}
                onClick={() => handleSelect(lead)}
                className={`w-full text-left px-6 py-4 transition-all duration-150 ${
                  isActive
                    ? "bg-primary/5 border-l-2 border-l-primary"
                    : "hover:bg-muted/30 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-0">
                  <div>
                    <p className="text-sm font-medium">{lead.first_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {lead.company_name}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border self-start md:self-auto ${status.color}`}
                  >
                    <status.icon className="w-3 h-3" />
                    {status.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Panel — AI Copy Editor */}
      <div className="w-1/2 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-start justify-between w-full gap-2 pr-4">
          <div className="flex items-center gap-3 truncate">
            <Sparkles className="w-4 h-4 text-primary shrink-0" />
            <h3 className="text-sm font-medium font-heading truncate">
              {selectedLead
                ? `${selectedLead.first_name} @ ${selectedLead.company_name}`
                : "Select a lead"}
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Copy to clipboard"
              onClick={handleCopy}
            >
              {copySuccess ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
            <button
              className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Regenerate"
              onClick={handleRegenerate}
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-6 py-3 border-b border-border/50 bg-muted/10 flex overflow-x-auto hide-scrollbar whitespace-nowrap gap-4 w-full pr-4">
          <button
            onClick={() => setActiveTab("email")}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              activeTab === "email" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Email
          </button>
          <button
            onClick={() => setActiveTab("linkedin")}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              activeTab === "linkedin" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            LinkedIn
          </button>
          <button
            onClick={() => setActiveTab("script")}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              activeTab === "script" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Cold Call
          </button>
          <button
            onClick={() => setActiveTab("whatsapp")}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              activeTab === "whatsapp" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            WhatsApp
          </button>
        </div>
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedLead?.generated_email ? (
            <div className="w-full h-full whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent focus:outline-none">
              {(() => {
                // The JSON Parser: Construct the message object locally from the backend payload mapping
                let message = {
                  email: selectedLead.generated_email,
                  linkedin: selectedLead.generated_linkedin,
                  coldCall: selectedLead.generated_script,
                  whatsapp: selectedLead.generated_whatsapp
                };

                // The Tab Router: Conditional map based on activeTab
                if (activeTab === "email") {
                  return (
                    <div className="flex flex-col">
                      {message.email && (message.email as any).subject && (
                        <div className="text-xs font-bold text-gray-400 mb-2">Subject: {(message.email as any).subject}</div>
                      )}
                      <div>{message.email ? (message.email as any).body : "No email generated."}</div>
                    </div>
                  );
                }

                if (activeTab === "linkedin") {
                  return <div>{message.linkedin ? (message.linkedin as any).body : "No LinkedIn DM generated."}</div>;
                }

                if (activeTab === "script") {
                  return <div>{message.coldCall ? (message.coldCall as any).body : "No script generated."}</div>;
                }

                if (activeTab === "whatsapp") {
                  return <div>{message.whatsapp ? (message.whatsapp as any).body : "No WhatsApp draft generated."}</div>;
                }

                return null;
              })()}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Loader2 className="w-8 h-8 text-muted-foreground/50 animate-spin mb-4" />
              <p className="text-sm text-muted-foreground transition-all duration-300">
                {selectedLead
                  ? loadingStrings[loadingTextIndex]
                  : "Select a lead to view AI-generated copy"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
