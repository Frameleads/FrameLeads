"use client";

import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  Download,
  Search,
  Mail,
  BrainCircuit,
  ExternalLink,
  Trash2,
  Linkedin
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

type GeneratedChannel = string | { subject?: string; body?: string } | null;
type SandboxTab = "email" | "linkedin" | "script" | "whatsapp" | "intelligence";

interface Lead {
  id: string;
  lead_id: string;
  first_name: string;
  raw_first_name?: string;
  last_name?: string;
  company_name: string;
  website_url: string | null;
  linkedin_url?: string | null;
  linkedInUrl?: string | null;
  email?: string | null;
  email_address?: string | null;
  emailAddress?: string | null;
  companyName?: string;
  score?: number | null;
  target_group?: string | null;
  created_at?: string;
  provided_incident_details: string | null;
  enrichment_status: string;
  generation_status: string;
  generated_email: GeneratedChannel;
  generated_linkedin: GeneratedChannel;
  generated_script: GeneratedChannel;
  generated_whatsapp: GeneratedChannel;
  coldCallDraft?: string | null;
  whatsAppDraft?: string | null;
  listId?: string | null;
  deployment_status: string;
}

interface LeadListSummary {
  id: string;
  name: string;
  _count?: { leads: number };
}

function parseChannel(channel: GeneratedChannel): { subject: string; body: string } {
  if (!channel) return { subject: "", body: "" };

  if (typeof channel === "object") {
    return {
      subject: channel.subject?.trim() || "",
      body: channel.body?.trim() || "",
    };
  }

  try {
    const parsed = JSON.parse(channel);
    if (parsed && typeof parsed === "object") {
      return {
        subject: typeof parsed.subject === "string" ? parsed.subject.trim() : "",
        body: typeof parsed.body === "string" ? parsed.body.trim() : "",
      };
    }
  } catch {
    // Plain database draft; handled below.
  }

  return { subject: "", body: channel.trim() };
}

function parseEmailDraft(channel: GeneratedChannel): { subject: string; body: string } {
  const parsed = parseChannel(channel);
  const lines = parsed.body.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const plainLine = lines[index].replaceAll("*", "").trim();
    const subjectMarkerIndex = plainLine.toLowerCase().indexOf("subject:");

    if (subjectMarkerIndex === -1) {
      cleanedLines.push(lines[index]);
      continue;
    }

    const inlineSubject = plainLine.slice(subjectMarkerIndex + "subject:".length).trim();
    if (!inlineSubject) {
      let nextLineIndex = index + 1;
      while (nextLineIndex < lines.length && !lines[nextLineIndex].trim()) {
        nextLineIndex++;
      }
      if (nextLineIndex < lines.length) index = nextLineIndex;
    }
  }

  return {
    subject: "",
    body: cleanedLines.join("\n").trim(),
  };
}

function buildLinkedInHandoffUrl(rawUrl?: string | null): string | null {
  if (!rawUrl?.trim()) return null;

  try {
    const trimmedUrl = rawUrl.trim();
    const normalizedUrl = trimmedUrl.startsWith("http://") || trimmedUrl.startsWith("https://")
      ? trimmedUrl
      : `https://${trimmedUrl}`;
    const url = new URL(normalizedUrl);
    const hostname = url.hostname.toLowerCase();
    const isLinkedIn = hostname === "linkedin.com" || hostname.endsWith(".linkedin.com");
    if (!isLinkedIn || (url.protocol !== "http:" && url.protocol !== "https:")) return null;

    url.searchParams.set("frameleads_active", "true");
    return url.toString();
  } catch {
    return null;
  }
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

interface SandboxClientProps {
  userTier: string;
  monthlyQuota: number;
  leadsProcessed: number;
  initialLeads: Lead[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  initialQuery: string;
}

export default function SandboxClient({
  userTier,
  monthlyQuota,
  leadsProcessed,
  initialLeads,
  currentPage,
  totalPages,
  totalCount,
  initialQuery,
}: SandboxClientProps) {

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("processing");
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<SandboxTab>("email");
  const [copySuccess, setCopySuccess] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [deletingLeadId, setDeletingLeadId] = useState<string | null>(null);
  const [movingLeadId, setMovingLeadId] = useState<string | null>(null);
  const [leadLists, setLeadLists] = useState<LeadListSummary[]>([]);
  const [handoffToast, setHandoffToast] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedListId = searchParams.get("list");

  const loadLeadLists = useCallback(async () => {
    try {
      const response = await fetch("/api/lists", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setLeadLists(Array.isArray(result.lists) ? result.lists : []);
    } catch {
      // Keep the Sandbox usable if list metadata is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    loadLeadLists();
    window.addEventListener("frameleads:lists-changed", loadLeadLists);
    return () => window.removeEventListener("frameleads:lists-changed", loadLeadLists);
  }, [loadLeadLists]);

  useEffect(() => {
    setSearchQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setLeads(initialLeads);
    setSelectedId((current) =>
      initialLeads.some((lead) => lead.lead_id === current)
        ? current
        : initialLeads[0]?.lead_id || ""
    );
  }, [initialLeads]);

  useEffect(() => {
    const queryInUrl = searchParams.get("q")?.trim() || "";
    if (searchQuery.trim() === queryInUrl) return;

    const timeout = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const normalizedQuery = searchQuery.trim();

      if (normalizedQuery) {
        params.set("q", normalizedQuery);
      } else {
        params.delete("q");
      }
      params.delete("page");

      const queryString = params.toString();
      startTransition(() => {
        router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [pathname, router, searchParams, searchQuery]);

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(page));
    }

    const queryString = params.toString();
    startTransition(() => {
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    });
  };

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
        if (batch.status !== "completed" && batch.status !== "failed") {
          setBatchId(batch.batch_id);
          setBatchStatus(batch.status);
          setLeads(batch.leads);
          if (batch.leads.length > 0) {
            setSelectedId(batch.leads[0].lead_id);
          }
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
  const parsedEmailDraft = parseEmailDraft(selectedLead?.generated_email || null);
  const gmailSubject = `Pipeline triage: ${selectedLead?.companyName || selectedLead?.company_name || "Your Pipeline"}`;
  const recipientEmail = selectedLead?.email || selectedLead?.email_address || selectedLead?.emailAddress || "";
  const gmailHref = selectedLead
    ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(recipientEmail)}&su=${encodeURIComponent(gmailSubject)}&body=${encodeURIComponent(parsedEmailDraft.body)}`
    : "https://mail.google.com/mail/?view=cm&fs=1";
  const linkedInHandoffUrl = buildLinkedInHandoffUrl(
    selectedLead?.linkedInUrl || selectedLead?.linkedin_url
  );

  const getActiveText = useCallback(() => {
    if (!selectedLead) return "";

    if (activeTab === "intelligence") {
      return [
        `First Name: ${selectedLead.raw_first_name || selectedLead.first_name || "—"}`,
        `Last Name: ${selectedLead.last_name || "—"}`,
        `Company Name: ${selectedLead.company_name || "—"}`,
        `LinkedIn URL: ${selectedLead.linkedin_url || "—"}`,
        `Website URL: ${selectedLead.website_url || "—"}`,
        `Score: ${selectedLead.score ?? "—"}`,
        `Target Group: ${selectedLead.target_group || "—"}`,
        `Created At: ${selectedLead.created_at || "—"}`,
        `Incident Details: ${selectedLead.provided_incident_details || "—"}`,
      ].join("\n");
    }

    if (activeTab === "email") {
      const email = parseEmailDraft(selectedLead.generated_email);
      return `${email.subject ? `Subject: ${email.subject}\n\n` : ""}${email.body}`;
    }

    let channelObj: any = null;
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
    
    return textBody;
  }, [selectedLead, activeTab]);

  useEffect(() => {
    setIsEditing(false);
  }, [activeTab, selectedId]);

  const handleEditToggle = () => {
    if (activeTab === "intelligence") return;
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

  const handleClearSandbox = async () => {
    const confirmed = window.confirm(
      "Are you sure? This will permanently delete all leads from your Sandbox. This action cannot be undone, and generation credits will not be refunded."
    );
    if (!confirmed) return;

    setIsClearing(true);
    try {
      const response = await fetch("/api/leads/clear", { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Failed to clear the Sandbox.");
      }

      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      sessionStorage.removeItem("frameleads_batch");
      setLeads([]);
      setSelectedId("");
      setBatchId(null);
      setBatchStatus("completed");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to clear the Sandbox.");
    } finally {
      setIsClearing(false);
    }
  };

  const handleDeleteLead = async (lead: Lead) => {
    const confirmed = window.confirm(
      `Delete ${lead.first_name || "this lead"} from your Sandbox? This action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingLeadId(lead.id);
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}`, {
        method: "DELETE",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || "Failed to delete the lead.");
      }

      setLeads((current) => {
        const remainingLeads = current.filter((item) => item.id !== lead.id);
        setSelectedId((currentId) =>
          currentId === lead.lead_id ? remainingLeads[0]?.lead_id || "" : currentId
        );
        return remainingLeads;
      });
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete the lead.");
    } finally {
      setDeletingLeadId(null);
    }
  };

  const handleMoveLead = async (lead: Lead, nextListId: string) => {
    const listId = nextListId || null;
    setMovingLeadId(lead.id);
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Failed to move the lead.");

      setLeads((current) => {
        const updatedLeads = current.map((item) =>
          item.id === lead.id ? { ...item, listId } : item
        );
        const visibleLeads = selectedListId && selectedListId !== listId
          ? updatedLeads.filter((item) => item.id !== lead.id)
          : updatedLeads;
        setSelectedId((currentId) =>
          currentId === lead.lead_id && !visibleLeads.some((item) => item.lead_id === currentId)
            ? visibleLeads[0]?.lead_id || ""
            : currentId
        );
        return visibleLeads;
      });
      window.dispatchEvent(new Event("frameleads:lists-changed"));
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to move the lead.");
    } finally {
      setMovingLeadId(null);
    }
  };

  const handleRegenerate = async () => {
    if (!selectedLead || activeTab === "intelligence") return;
    
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
        listId: selectedLead.listId || null,
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
    if (activeTab === "email" || activeTab === "intelligence") textToCopy = getActiveText();
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

  const handleLinkedInHandoff = async () => {
    if (!selectedLead || !linkedInHandoffUrl) return;

    const linkedInDraftBody = parseChannel(selectedLead.generated_linkedin).body;
    try {
      await navigator.clipboard.writeText(linkedInDraftBody);
      setHandoffToast(true);
      setTimeout(() => setHandoffToast(false), 2200);
      window.open(linkedInHandoffUrl, "_blank", "noopener,noreferrer");
    } catch {
      window.alert("Unable to copy the LinkedIn draft to your clipboard.");
    }
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
  const isEmpty = leads.length === 0 && !batchId && !searchQuery.trim();

  // ── Render ────────────────────────────────────────────────────────

  console.log("Sandbox Props:", { userTier, monthlyQuota, leadsProcessed });

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-8rem)] lg:h-[calc(100vh-8rem)] relative">

      
      {/* Left Panel Column */}
      <div className="w-full lg:w-1/2 flex flex-col gap-4 min-h-[300px] lg:min-h-0 lg:h-full">
        
        {/* Tier Quota Header */}
        <div className="rounded-2xl border border-primary/30 bg-primary/10 px-5 py-6 mb-6 md:p-6 md:mb-0 flex items-center justify-between shadow-lg shadow-primary/5 shrink-0">
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
        {/* Persisted lead search */}
        <div className="relative shrink-0">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search leads by name or company..."
            aria-label="Search generated leads"
            className="h-11 w-full rounded-xl border border-border/50 bg-card/50 pl-11 pr-11 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
          />
          {isNavigating && (
            <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>

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
              {batchId
                ? `${completedCount} of ${leads.length} leads generated`
                : `${leads.length} of ${totalCount} saved leads`}
            </p>
          </div>
          {completedCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-primary bg-primary/10 border border-primary/20 rounded-md hover:bg-primary/20 hover:border-primary/40 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download CSV
              </button>
              <button
                type="button"
                onClick={handleClearSandbox}
                disabled={isClearing}
                className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isClearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Clear Sandbox
              </button>
            </div>
          )}
          {isPolling && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border text-blue-400 bg-blue-400/10 border-blue-400/20 animate-pulse">
              <Radio className="w-3 h-3" />
              Live
            </span>
          )}
        </div>
        <div className="flex-1 max-h-[40vh] overflow-y-auto md:max-h-[70vh] md:overflow-y-auto custom-scrollbar divide-y divide-border/30">
          {leads.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              No leads match “{initialQuery}”.
            </div>
          ) : leads.map((lead) => {
            const status = getStatus(lead);
            const isActive = lead.lead_id === selectedId;
            return (
              <div
                key={lead.lead_id}
                className={`flex w-full items-center transition-all duration-150 ${
                  isActive
                    ? "bg-primary/5 border-l-2 border-l-primary"
                    : "hover:bg-muted/30 border-l-2 border-l-transparent"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSelect(lead)}
                  className="min-w-0 flex-1 px-6 py-4 text-left"
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
                <div className="relative ml-2 shrink-0">
                  <select
                    value={lead.listId || ""}
                    onChange={(event) => handleMoveLead(lead, event.target.value)}
                    disabled={movingLeadId === lead.id}
                    aria-label={`Move ${lead.first_name || "lead"} to list`}
                    title="Move to List"
                    className="h-8 max-w-32 appearance-none rounded-lg border border-border/60 bg-background py-1 pl-2 pr-7 text-[11px] text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">No list</option>
                    {leadLists.map((list) => (
                      <option key={list.id} value={list.id}>{list.name}</option>
                    ))}
                  </select>
                  {movingLeadId === lead.id && (
                    <Loader2 className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-primary" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteLead(lead)}
                  disabled={deletingLeadId === lead.id}
                  aria-label={`Delete ${lead.first_name || "lead"}`}
                  title="Delete lead"
                  className="mr-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingLeadId === lead.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            );
          })}
        </div>
        {!batchId && (
          <div className="flex items-center justify-between border-t border-border/50 bg-muted/10 px-4 py-3">
            <button
              type="button"
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage <= 1 || isNavigating}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-muted-foreground">
              Page <span className="font-semibold text-foreground">{currentPage}</span> of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage >= totalPages || isNavigating}
              className="rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
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
            {activeTab !== "intelligence" && (
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
            )}
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
            {activeTab !== "intelligence" && (
              <button
                className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Regenerate"
                onClick={handleRegenerate}
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
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
          <button
            onClick={() => setActiveTab("intelligence")}
            className={`text-sm font-medium pb-2 border-b-2 transition-colors ${
              activeTab === "intelligence" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Intelligence
          </button>
        </div>
        <div className="flex-1 p-6 overflow-y-auto relative">
          {selectedLead && (selectedLead.generated_email || activeTab === "intelligence") ? (
            <>
            <div className={`w-full h-full whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground bg-transparent focus:outline-none ${selectedLead.generation_status === 'quota_locked' ? 'blur-md select-none opacity-50' : ''}`}>
              {isEditing ? (
                <div className="flex flex-col h-full">
                  {activeTab === "email" && (
                    <div className="text-xs font-bold text-gray-400 mb-2">
                      Subject: {gmailSubject}
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
                    <div className="flex flex-col gap-5">
                      <div className="rounded-xl border border-border/50 bg-muted/10 px-4 py-3">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Subject
                        </p>
                        <p className="font-medium text-foreground">
                          {gmailSubject}
                        </p>
                      </div>
                      <div>
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Message
                        </p>
                        <div className="whitespace-pre-wrap text-foreground">
                          {parsedEmailDraft.body || "No email generated."}
                        </div>
                      </div>
                      <a
                        href={gmailHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5A1F] px-5 text-sm font-semibold text-white shadow-lg shadow-[#FF5A1F]/20 transition-all hover:bg-[#ff6b35] hover:shadow-[#FF5A1F]/30 active:scale-[0.99]"
                      >
                        <Mail className="h-4 w-4" />
                        Send via Gmail
                      </a>
                    </div>
                  );
                }

                if (activeTab === "intelligence") {
                  const intelligenceFields = [
                    { label: "First Name", value: selectedLead.raw_first_name || selectedLead.first_name || "—" },
                    { label: "Last Name", value: selectedLead.last_name || "—" },
                    { label: "Company Name", value: selectedLead.company_name || "—" },
                    {
                      label: "LinkedIn URL",
                      value: selectedLead.linkedInUrl && selectedLead.linkedInUrl.includes('linkedin.com')
                        ? selectedLead.linkedInUrl
                        : "No LinkedIn URL provided",
                      href: selectedLead.linkedInUrl && selectedLead.linkedInUrl.includes('linkedin.com')
                        ? (selectedLead.linkedInUrl.startsWith('http') ? selectedLead.linkedInUrl : `https://${selectedLead.linkedInUrl}`)
                        : undefined
                    },
                    { label: "Website URL", value: selectedLead.website_url || "—", href: selectedLead.website_url ? (selectedLead.website_url.startsWith("http") ? selectedLead.website_url : `https://${selectedLead.website_url}`) : undefined },
                    { label: "Score", value: selectedLead.score?.toString() || "—" },
                    { label: "Target Group", value: selectedLead.target_group || "—" },
                    { label: "Created At", value: selectedLead.created_at || "—" },
                  ];

                  return (
                    <div className="flex flex-col gap-5 whitespace-normal">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                          <BrainCircuit className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-foreground">Lead Intelligence</h4>
                          <p className="text-xs text-muted-foreground">Persisted source data for this prospect</p>
                        </div>
                      </div>

                      <dl className="overflow-hidden rounded-xl border border-border/50 bg-muted/10">
                        {intelligenceFields.map((field) => (
                          <div
                            key={field.label}
                            className="grid grid-cols-[120px_minmax(0,1fr)] gap-4 border-b border-border/40 px-4 py-3 last:border-b-0"
                          >
                            <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                            <dd className="min-w-0 break-words text-sm text-foreground">
                              {field.href ? (
                                <a
                                  href={field.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                                >
                                  <span className="truncate">{field.value}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ) : field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>

                      <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Raw Incident Details
                        </p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                          {selectedLead.provided_incident_details || "No incident details recorded."}
                        </p>
                      </div>
                    </div>
                  );
                }

                const renderChannel = (channel: any, fallback: string) => {
                  if (!channel) return fallback;
                  if (typeof channel === 'string') return channel;
                  return channel.body || fallback;
                };

                if (activeTab === "linkedin") {
                  return (
                    <div className="flex flex-col gap-5">
                      <div className="whitespace-pre-wrap">
                        {renderChannel(message.linkedin, "No LinkedIn DM generated.")}
                      </div>
                      <button
                        type="button"
                        onClick={handleLinkedInHandoff}
                        disabled={!linkedInHandoffUrl}
                        className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0A66C2] px-5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-[#0b74de] hover:shadow-blue-600/30 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Linkedin className="h-4 w-4" />
                        Send via LinkedIn
                      </button>
                      <div className="mt-4 p-4 bg-gray-800/40 border border-gray-700/60 rounded-lg text-sm text-gray-400 text-center w-full shadow-sm">
                        <p className="flex justify-center items-center gap-2 mb-2">
                          <span className="text-[#FF5A36]">⚡</span>
                          <strong className="text-gray-200 tracking-wide">Zero-Ban Handoff</strong>
                        </p>
                        <p className="leading-relaxed">
                          To keep your account 100% safe from automation bans, we securely copy your drafted message to your system clipboard. When the profile opens, simply press <code className="bg-gray-700 text-gray-200 px-1.5 py-0.5 rounded text-xs mx-1 font-mono">Cmd + V</code> (or Ctrl + V) to paste and send.
                        </p>
                      </div>
                    </div>
                  );
                }

                if (activeTab === "script") {
                  return <div className="whitespace-pre-wrap">{renderChannel(message.coldCall || selectedLead.coldCallDraft, "No script generated.")}</div>;
                }

                if (activeTab === "whatsapp") {
                  return <div className="whitespace-pre-wrap">{renderChannel(message.whatsapp || selectedLead.whatsAppDraft, "No WhatsApp draft generated.")}</div>;
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
      {handoffToast && (
        <div className="fixed bottom-6 right-6 z-[220] flex items-center gap-2 rounded-xl border border-green-500/30 bg-[#111111] px-4 py-3 text-sm font-medium text-green-400 shadow-2xl shadow-black/60">
          <CheckCircle2 className="h-4 w-4" />
          Draft copied to clipboard!
        </div>
      )}
    </div>
  );
}
