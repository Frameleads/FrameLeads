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

export default function SandboxPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("processing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"email" | "linkedin" | "script" | "whatsapp">("email");
  const [copySuccess, setCopySuccess] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── Handlers ──────────────────────────────────────────────────────

  const selectedLead = leads.find((l) => l.lead_id === selectedId);

  const handleSelect = (lead: Lead) => {
    setSelectedId(lead.lead_id);
    setCopySuccess(false);
  };

  const handleCopy = async () => {
    if (!selectedLead) return;
    let textToCopy = "";
    if (activeTab === "email") textToCopy = selectedLead.generated_email || "";
    if (activeTab === "linkedin") textToCopy = selectedLead.generated_linkedin || "";
    if (activeTab === "script") textToCopy = selectedLead.generated_script || "";
    if (activeTab === "whatsapp") textToCopy = selectedLead.generated_whatsapp || "";
    
    await navigator.clipboard.writeText(textToCopy);
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
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Left Panel — Lead Table */}
      <div className="w-1/2 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium font-heading">Leads</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {completedCount} of {leads.length} leads generated
            </p>
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
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{lead.first_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {lead.company_name}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${status.color}`}
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
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium font-heading">
              {selectedLead
                ? `${selectedLead.first_name} @ ${selectedLead.company_name}`
                : "Select a lead"}
            </h3>
          </div>
          <div className="flex items-center gap-2">
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
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="px-6 py-3 border-b border-border/50 bg-muted/10 flex gap-4">
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
            <pre className="w-full h-full whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent focus:outline-none">
              {activeTab === "email" && (selectedLead.generated_email || "No email generated.")}
              {activeTab === "linkedin" && (selectedLead.generated_linkedin || "No LinkedIn DM generated.")}
              {activeTab === "script" && (selectedLead.generated_script || "No script generated.")}
              {activeTab === "whatsapp" && (selectedLead.generated_whatsapp || "No WhatsApp draft generated.")}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Loader2 className="w-8 h-8 text-muted-foreground/50 animate-spin mb-4" />
              <p className="text-sm text-muted-foreground">
                {selectedLead
                  ? "Generating copy for this lead\u2026"
                  : "Select a lead to view AI-generated copy"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
