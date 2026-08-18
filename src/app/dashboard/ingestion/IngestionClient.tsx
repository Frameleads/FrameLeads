"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  Shield,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────

interface ColumnMapping {
  csvColumn: string;
  schemaField: string;
}

/** Mirrors backend LeadItem — only the fields we populate at ingestion. */
interface LeadPayload {
  lead_id: string;
  first_name: string;
  company_name: string;
  website_url: string | null;
  provided_incident_details: string | null;
  enrichment_status: "skipped_not_needed" | "pending_scrape";
  generation_status: "queued" | "waiting_on_enrichment";
}

interface BatchPayload {
  batch_id: string;
  status: "processing";
  context: {
    company_name: string;
    value_proposition: string;
    target_audience: string;
  };
  leads: LeadPayload[];
}

// ── Constants ───────────────────────────────────────────────────────────

const SCHEMA_FIELDS = [
  "first_name",
  "company_name",
  "website_url",
  "provided_incident_details",
] as const;

type SchemaField = (typeof SCHEMA_FIELDS)[number];

const SCHEMA_LABELS: Record<SchemaField, string> = {
  first_name: "First Name",
  company_name: "Company Name",
  website_url: "Website URL",
  provided_incident_details: "Incident Details",
};

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

// ── Component ───────────────────────────────────────────────────────────

export default function IngestionClient({ userTier, monthlyQuota, leadsProcessed }: { userTier: string, monthlyQuota: number, leadsProcessed: number }) {
  const router = useRouter();

  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({
    first_name: "",
    company_name: "",
    website_url: "",
    provided_incident_details: ""
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignContext, setCampaignContext] = useState<any>(null);

  const leadsGenerated = leadsProcessed;

  // ── Load Campaign Context ───────────────────────────────────────────

  useEffect(() => {
    try {
      const stored = localStorage.getItem("campaign_context");
      if (stored) setCampaignContext(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith(".csv")) {
      parseCSV(file);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseCSV(file);
  };

  // ── CSV parsing via PapaParse ─────────────────────────────────────

  const parseCSV = (file: File) => {
    setError(null);
    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header: string) => header.trim(),
      complete: (results) => {
        if (!results.data.length || !results.meta.fields?.length) {
          setError("CSV file is empty or has no recognisable headers.");
          setFileName(null);
          return;
        }

        const headers = results.meta.fields;
        
        // Aggressive ghost row removal: Ensure the row has at least one non-empty value across all columns
        const cleanedRows = results.data.filter((row: any) => {
          return Object.values(row).some((val) => {
            if (typeof val === 'string') return val.trim() !== '';
            return val !== null && val !== undefined;
          });
        });

        setCsvColumns(headers);
        setCsvRows(cleanedRows);

        // Auto-map: try exact match, then case-insensitive substring
        const autoMappings: Record<string, string> = {
          first_name: "",
          company_name: "",
          website_url: "",
          provided_incident_details: ""
        };

        const targetFields = ["first_name", "company_name", "website_url", "provided_incident_details"];
        
        targetFields.forEach((schemaField) => {
          const match = headers.find((col) => {
            const lower = col.toLowerCase();
            return (
              lower === schemaField ||
              lower.includes(schemaField.replace(/_/g, " ")) ||
              lower.includes(schemaField.replace(/_/g, ""))
            );
          });
          if (match) {
            autoMappings[schemaField] = match;
          }
        });

        setFieldMappings(autoMappings);
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
        setFileName(null);
      },
    });
  };

  // ── Mapping update ────────────────────────────────────────────────
  
  const updateFieldMapping = (schemaField: string, csvColumn: string) => {
    setFieldMappings((prev) => ({ ...prev, [schemaField]: csvColumn }));
  };

  // ── Batch assembly + API call ─────────────────────────────────────

  const handleProcessBatch = async () => {
    setError(null);

    // Validate: first_name and company_name are required mappings
    if (!fieldMappings.first_name || !fieldMappings.company_name) {
      setError(
        `You must map at least "First Name" and "Company Name" before processing.`
      );
      return;
    }

    // Transform rows into LeadPayload[]
    const leads: LeadPayload[] = csvRows.map((row, idx) => {
      const firstName = (
        row[fieldMappings.first_name] ?? ""
      ).trim();
      const companyName = (
        row[fieldMappings.company_name] ?? ""
      ).trim();
      const websiteUrl =
        fieldMappings.website_url
          ? (row[fieldMappings.website_url] ?? "").trim() || null
          : null;
      const incidentDetails =
        fieldMappings.provided_incident_details
          ? (row[fieldMappings.provided_incident_details] ?? "").trim() || null
          : null;

      const hasWebsite = websiteUrl !== null && websiteUrl !== "";

      return {
        lead_id: `ld_${Date.now()}_${idx.toString().padStart(4, "0")}`,
        first_name: firstName,
        company_name: companyName,
        website_url: websiteUrl,
        provided_incident_details: incidentDetails,
        enrichment_status: hasWebsite ? "pending_scrape" : "skipped_not_needed",
        generation_status: hasWebsite ? "waiting_on_enrichment" : "queued",
      };
    });

    // Filter out rows where required fields are empty
    const validLeads = leads.filter(
      (l) => l.first_name !== "" && l.company_name !== ""
    );

    if (validLeads.length === 0) {
      setError(
        "No valid leads found. Ensure mapped columns contain data for every row."
      );
      return;
    }

    // ── Tier Quota Gate ──────────────────────────────────────────
    // Warn the user if they exceed quota, but DO NOT block the batch.
    // The backend route.ts will slice the array and return quota_locked ghosts.
    if (userTier !== "ENTERPRISE") {
      const limit = monthlyQuota;
      const newTotal = leadsGenerated + validLeads.length;
      
      if (newTotal > limit) {
        const remaining = Math.max(0, limit - leadsGenerated);
        setError(
          `${userTier} tier limit: ${limit} leads. You've generated ${leadsGenerated} so far. ` +
          `This batch has ${validLeads.length} leads, but you only have ${remaining} remaining. ` +
          `The remaining leads will be locked. Upgrade to unlock them.`
        );
      }
    }

    const payload: any = {
      batch_id: `batch_${Date.now()}`,
      status: "processing",
      context: campaignContext,
      leads: validLeads,
      creditsUsed: leadsGenerated,
      tier: userTier,
    };

    // ── POST to backend ───────────────────────────────────────────
    setIsProcessing(true);

    try {
      const res = await fetch(`/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`API returned ${res.status}: ${body}`);
      }

      // Safely parse the response
      const data = await res.json();
      
      // Strict payload validation
      if (!data || !data.leads || !Array.isArray(data.leads)) {
        throw new Error("Invalid generation payload: Missing 'leads' data array from backend.");
      }

      // Success — store response in sessionStorage for the sandbox page
      sessionStorage.setItem("frameleads_batch", JSON.stringify(data));


      // Route to sandbox
      router.refresh();
      router.push("/dashboard/sandbox");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred."
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────

  const mappedCount = Object.values(fieldMappings).filter(Boolean).length;
  const canProcess =
    csvRows.length > 0 &&
    Boolean(fieldMappings.first_name) &&
    Boolean(fieldMappings.company_name) &&
    !isProcessing &&
    campaignContext !== null;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-8 px-4 sm:px-6 md:px-8 lg:px-0">
      <div className="mb-10 md:mb-12">
        <h1 className="text-4xl font-bold tracking-tight font-heading">
          Data Ingestion
        </h1>
        <p className="text-lg text-muted-foreground mt-3 leading-relaxed">
          Upload your lead list and map columns to the FrameLeads schema.
        </p>
        <div className="rounded-2xl mt-6 md:mt-8 border border-primary/30 bg-primary/10 p-6 flex flex-col md:flex-row md:items-center justify-between shadow-lg shadow-primary/5 mb-6">
            <div>
              <h2 className="text-xl font-bold mb-2 tracking-tight uppercase text-orange-500">
                {userTier.replace(/_/g, " ")} TIER
              </h2>
              <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">
                <span>{leadsGenerated} of {monthlyQuota} leads generated</span>
                <span>•</span>
                <span>{Math.max(0, monthlyQuota - leadsGenerated)} remaining</span>
              </div>
            </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {/* Campaign Context Warning */}
      {!campaignContext && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>
            You must define your Campaign Context before processing leads.{" "}
            <Link
              href="/dashboard/campaign"
              prefetch={true}
              className="underline hover:text-amber-300"
            >
              Go to Campaign Settings
            </Link>
          </p>
        </div>
      )}

      {/* Drop Zone */}
      <div
        id="csv-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed rounded-2xl p-16 text-center transition-all duration-300 cursor-pointer min-h-[400px] flex flex-col items-center justify-center ${
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : fileName
            ? "border-green-500/30 bg-green-500/5"
            : "border-border/50 hover:border-primary/30 hover:bg-muted/30"
        }`}
      >
        <input
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          id="csv-file-input"
        />
        <div className="flex flex-col items-center gap-5">
          {fileName ? (
            <>
              <div className="w-20 h-20 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                <Check className="w-10 h-10 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  {fileName}
                </p>
                <p className="text-lg text-muted-foreground mt-2">
                  {csvColumns.length} columns &middot; {csvRows.length} rows
                  detected
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-2xl bg-muted/50 border border-border/50 flex items-center justify-center">
                <Upload className="w-10 h-10 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">
                  Drop your CSV here
                </p>
                <p className="text-lg text-muted-foreground mt-2">
                  or click to browse &middot; .csv files only
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 2x2 Apollo-style Mapping Grid */}
      {csvColumns.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SCHEMA_FIELDS.map((schemaField) => (
            <div
              key={schemaField}
              className="bg-[#1A1A1A] border border-[#242424] rounded-2xl p-6 flex flex-col gap-4 shadow-lg shadow-black/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#FFFFFF]">
                  {SCHEMA_LABELS[schemaField]}
                </span>
                {fieldMappings[schemaField] && (
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                )}
              </div>
              <div className="relative">
                <select
                  value={fieldMappings[schemaField] || ""}
                  onChange={(e) => updateFieldMapping(schemaField, e.target.value)}
                  className="w-full h-11 rounded-xl border border-[#242424] bg-[#000000] text-gray-200 px-4 text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[#FF5A1F] focus:border-[#FF5A1F] transition-all"
                >
                  <option value="" className="bg-[#000000] text-gray-500">
                    &mdash; Skip mapping &mdash;
                  </option>
                  {csvColumns.map((col) => (
                    <option
                      key={col}
                      value={col}
                      className="bg-[#000000] text-gray-200"
                    >
                      {col}
                    </option>
                  ))}
                </select>
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                  <ArrowRight className="w-4 h-4 text-gray-500 rotate-90" />
                </div>
              </div>
            </div>
          ))}
        </div>

          {/* Footer: stats + Process button */}
          <div className="px-6 py-4 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground w-full sm:w-auto text-center sm:text-left">
              {csvRows.length} lead{csvRows.length !== 1 ? "s" : ""} will be submitted
            </p>
            <button
              id="process-batch-button"
              onClick={handleProcessBatch}
              disabled={!canProcess}
              className="flex justify-center items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none w-full sm:w-auto whitespace-normal break-words"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Process Batch
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
