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
  Shield,
  Edit2,
  Check,
  Lock,
  Download
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

interface Lead {
  lead_id: string;
  first_name: string;
  company_name: string;
  website_url: string | null;
  linkedin_url?: string | null;
  email_address?: string | null;
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
  quota_locked: {
    label: "Locked",
    color: "text-red-400 bg-red-400/10 border-red-400/20",
    icon: Lock,
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

interface SandboxClientProps { userTier: string; monthlyQuota: number; leadsProcessed: number; }
export default function SandboxClient({ userTier, monthlyQuota, leadsProcessed }: SandboxClientProps) {

  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("processing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"email" | "linkedin" | "script" | "whatsapp">("email");
  const [copySuccess, setCopySuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Leads generated state is now controlled entirely by the server component
// ── Admin Recording Bypass (?demo=true in browser URL) ──
  const isDemoAdmin = typeof window !== "undefined" && (
  new URLSearchParams(window.location.search).get("demo") === "true" ||
  localStorage.getItem("frameleads_admin_demo") === "true"
);

// Save admin flag to localStorage if "?demo=true" is ever seen in the URL:
useEffect(() => {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "true") {
    localStorage.setItem("frameleads_admin_demo", "true");
  }
}, []);


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

  const getActiveText = useCallback(() => {
    if (!selectedLead) return "";
    let channelObj: any = null;
    if (activeTab === "email") channelObj = selectedLead.generated_email;
    if (activeTab === "linkedin") channelObj = selectedLead.generated_linkedin;
    if (activeTab === "script") channelObj = selectedLead.generated_script;
    if (activeTab === "whatsapp") channelObj = selectedLead.generated_whatsapp;
    
    if (!channelObj) return "";
    
    let textBody = "";
    if (typeof channelObj === 'string') {
      try {
        const parsed = JSON.parse(channelObj);
        textBody = parsed.body || "";
      } catch {
        textBody = channelObj;
      }
    } else {
      textBody = channelObj.body || "";
    }
    
    if (activeTab === "email" && channelObj.subject) {
      return `Subject: ${channelObj.subject}\n\n${textBody}`;
    }
    
    return textBody;
  }, [selectedLead, activeTab]);

  useEffect(() => {
    setIsEditing(false);
  }, [activeTab, selectedId]);

  const handleEditToggle = () => {
    if (isEditing) {
      if (!selectedLead) return;
      const updateChannel = (channelObj: any, newBody: string) => {
        if (!channelObj) return { body: newBody };
        if (typeof channelObj === 'string') {
          try {
            const parsed = JSON.parse(channelObj);
            return { ...parsed, body: newBody };
          } catch {
            return { body: newBody };
          }
        }
        return { ...channelObj, body: newBody };
      };

      setLeads(current => current.map(l => {
        if (l.lead_id !== selectedId) return l;
        const updated = { ...l };
        if (activeTab === "email") updated.generated_email = updateChannel(l.generated_email, draftText) as any;
        if (activeTab === "linkedin") updated.generated_linkedin = updateChannel(l.generated_linkedin, draftText) as any;
        if (activeTab === "script") updated.generated_script = updateChannel(l.generated_script, draftText) as any;
        if (activeTab === "whatsapp") updated.generated_whatsapp = updateChannel(l.generated_whatsapp, draftText) as any;
        return updated;
      }));
      setIsEditing(false);
    } else {
      setDraftText(getActiveText());
      setIsEditing(true);
    }
  };

  const handleSelect = (lead: Lead) => {
    setSelectedId(lead.lead_id);
    setCopySuccess(false);
  };

  const handleRegenerate = async () => {
    if (!selectedLead) return;
    
    // 1. Create a clean stripped lead so the backend is FORCED to generate fresh copy
    const strippedLead = {
      ...selectedLead,
      generation_status: "queued",
      generated_email: null,
      generated_linkedin: null,
      generated_script: null,
      generated_whatsapp: null,
      force_regenerate: true
    };

    // 2. Update frontend UI to show the loading spinner immediately
    setLeads(current => current.map(l => 
      l.lead_id === selectedLead.lead_id ? strippedLead : l
    ));

    try {
      const payload = {
        batch_id: batchId || `regen_${Date.now()}`,
        leads: [strippedLead], // <-- Send the clean stripped lead, NOT the old completed lead!
        timestamp: Date.now(),
        creditsUsed: leadsProcessed,
        tier: isDemoAdmin ? 'ENTERPRISE' : userTier,
        force_regenerate: true,
        regenerate: true
      };
      
      const res = await fetch(`/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: 'no-store'
      });
      
      if (res.status === 403 && !isDemoAdmin) {
        return;
      }

      if (res.ok) {
        const data = await res.json();
        if (data.error === 'LIMIT_REACHED' && !isDemoAdmin) {
          return;
        }
        
        const updatedLead = data.leads[0];
        setLeads(current => current.map(l => 
          l.lead_id === selectedLead.lead_id ? { ...l, ...updatedLead } : l
        ));
        
        router.refresh();
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
    if (lead.generation_status === "quota_locked") return statusConfig.quota_locked;
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

  const exportToCSV = () => {
    const completedLeads = leads.filter(l => l.generation_status === 'completed');
    if (completedLeads.length === 0) return;

    // Helper to safely escape CSV fields
    const escapeCsv = (str: string | undefined | null) => {
      if (!str) return '""';
      const clean = str.replace(/"/g, '""');
      return `"${clean}"`;
    };

    // Helper to get text payload safely
    const getChannelBody = (channelObj: any) => {
      if (!channelObj) return "";
      if (typeof channelObj === 'string') {
        try {
          const parsed = JSON.parse(channelObj);
          return parsed.body || "";
        } catch {
          return channelObj;
        }
      }
      return channelObj.body || "";
    };

    // Create CSV header
    const headers = [
      "Company Name",
      "Prospect Name",
      "Website URL",
      "LinkedIn URL",
      "Email Address",
      "Generated Email Subject",
      "Generated Email Body",
      "Generated LinkedIn Message",
      "Generated Cold Call Script",
      "Generated WhatsApp Message"
    ];

    const rows = completedLeads.map(lead => {
      let emailSubject = "";
      if (lead.generated_email && (lead.generated_email as any).subject) {
        emailSubject = (lead.generated_email as any).subject;
      }
      
      return [
        escapeCsv(lead.company_name),
        escapeCsv(lead.first_name),
        escapeCsv(lead.website_url),
        escapeCsv(lead.linkedin_url),
        escapeCsv(lead.email_address),
        escapeCsv(emailSubject),
        escapeCsv(getChannelBody(lead.generated_email)),
        escapeCsv(getChannelBody(lead.generated_linkedin)),
        escapeCsv(getChannelBody(lead.generated_script)),
        escapeCsv(getChannelBody(lead.generated_whatsapp))
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `frameleads_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Empty state ───────────────────────────────────────────────────

  // Empty state is now rendered inline below the banner
  const isEmpty = leads.length === 0 && !batchId;

  // ── Render ────────────────────────────────────────────────────────

  console.log("Sandbox Props:", { userTier, monthlyQuota, leadsProcessed });

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-8rem)] lg:h-[calc(100vh-8rem)] relative">

      
      {/* Left Panel Column */}
      <div className="w-full lg:w-1/2 flex flex-col gap-4 min-h-[300px] lg:min-h-0 lg:h-full">
        
        {/* Tier Quota Header */}
        <div className="rounded-2xl border border-primary/30 bg-primary/10 px-5 py-6 mb-5 md:p-6 md:mb-0 flex items-center justify-between shadow-lg shadow-primary/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Monthly Quota</p>
              <p className="text-xs text-muted-foreground mt-0.5">{leadsProcessed} of {monthlyQuota} leads generated</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-primary font-heading">
              {monthlyQuota - leadsProcessed}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-primary/70 font-semibold">REMAINING</p>
          </div>
        </div>

        {/* Left Panel — Lead Table */}
        {isEmpty ? (
          <div className="flex-1 bg-[#0a0a0a] border border-[#1A1A1A] rounded-2xl overflow-hidden flex flex-col items-center justify-center text-center px-4">
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
        ) : (
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden flex-1">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium font-heading">Leads</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {completedCount} of {leads.length} leads generated
            </p>
          </div>
          {completedCount > 0 && (
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 hover:border-primary/40 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download CSV
            </button>
          )}
          {isPolling && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-blue-400 bg-blue-400/10 border-blue-400/20 animate-pulse">
              <Radio className="w-3 h-3" />
              Live
            </span>
          )}
        </div>
        <div className="flex-1 max-h-[40vh] overflow-y-auto md:max-h-[70vh] md:overflow-y-auto custom-scrollbar divide-y divide-border/30">
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
                <div className="flex flex-row items-center w-full md:justify-between gap-3 md:gap-0">
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{lead.first_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {lead.company_name}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border ${status.color}`}
                    >
                      <status.icon className="w-3 h-3" />
                      {status.label}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        </div>
        )}
      </div>

      {/* Right Panel — AI Copy Editor */}
      <div className="w-full lg:w-1/2 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm flex flex-col overflow-hidden min-h-[400px] lg:min-h-0 lg:h-full">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between w-full gap-2">
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
              title={isEditing ? "Save Edits" : "Edit Copy"}
              onClick={handleEditToggle}
            >
              {isEditing ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Edit2 className="w-4 h-4" />
              )}
            </button>
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
        <div className="flex-1 p-6 overflow-y-auto relative">
          {selectedLead?.generated_email ? (
            <>
            <div className={`w-full h-full whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent focus:outline-none ${selectedLead.generation_status === 'quota_locked' ? 'blur-md select-none opacity-50' : ''}`}>
              {isEditing ? (
                <div className="flex flex-col h-full">
                  {activeTab === "email" && (selectedLead.generated_email as any)?.subject && (
                    <div className="text-xs font-bold text-gray-400 mb-2">
                      Subject: {(selectedLead.generated_email as any).subject}
                    </div>
                  )}
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className="w-full h-64 bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 text-zinc-300 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none resize-none"
                    placeholder="Modify the AI-generated copy..."
                  />
                </div>
              ) : (
                (() => {
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
                      <div className="whitespace-pre-wrap">{message.email ? (message.email as any).body : "No email generated."}</div>
                    </div>
                  );
                }

                const renderChannel = (channel: any, fallback: string) => {
                  if (!channel) return fallback;
                  if (typeof channel === 'string') return channel;
                  return channel.body || fallback;
                };

                if (activeTab === "linkedin") {
                  return <div className="whitespace-pre-wrap">{renderChannel(message.linkedin, "No LinkedIn DM generated.")}</div>;
                }

                if (activeTab === "script") {
                  return <div className="whitespace-pre-wrap">{renderChannel(message.coldCall, "No script generated.")}</div>;
                }

                if (activeTab === "whatsapp") {
                  return <div className="whitespace-pre-wrap">{renderChannel(message.whatsapp, "No WhatsApp draft generated.")}</div>;
                }

                return null;
                })()
              )}
            </div>
            
            {selectedLead.generation_status === 'quota_locked' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-[#000000] border border-[#1A1A1A] shadow-2xl p-8 rounded-2xl max-w-sm w-full flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-[#1A1A1A] border border-[#FF5A1F]/20 flex items-center justify-center mb-4">
                    <Lock className="w-6 h-6 text-[#FF5A1F]" />
                  </div>
                  <h3 className="text-xl font-bold font-heading mb-2 text-[#FFFFFF]">Premium Leads Locked</h3>
                  <p className="text-sm text-[#888888] mb-6">You've hit your generation quota. Upgrade to unlock these high-intent prospects.</p>
                  <a 
                    href={userTier === 'MICRO_PILOT' ? "https://whop.com/brandflowstudio/frameleads-24/" : "https://whop.com/brandflowstudio/frameleads-enterprise-autonomous-architecture/"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full h-11 flex items-center justify-center bg-[#FF5A1F] text-[#FFFFFF] font-semibold rounded-lg shadow-lg shadow-[#FF5A1F]/20 hover:bg-[#FF5A1F]/90 transition-colors mb-3"
                  >
                    {userTier === 'MICRO_PILOT' ? 'Upgrade to Core tier' : 'Upgrade to Enterprise tier'}
                  </a>
                  <button 
                    onClick={() => setSelectedId("")}
                    className="text-sm text-[#888888] hover:text-[#FFFFFF] transition-colors"
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            )}
            </>
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
