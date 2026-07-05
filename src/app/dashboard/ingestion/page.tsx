"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
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

export default function IngestionPage() {
  const router = useRouter();

  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignContext, setCampaignContext] = useState<any>(null);

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
      skipEmptyLines: true,
      transformHeader: (header: string) => header.trim(),
      complete: (results) => {
        if (!results.data.length || !results.meta.fields?.length) {
          setError("CSV file is empty or has no recognisable headers.");
          setFileName(null);
          return;
        }

        const headers = results.meta.fields;
        setCsvColumns(headers);
        setCsvRows(results.data);

        // Auto-map: try exact match, then case-insensitive substring
        setMappings(
          headers.map((col) => {
            const lower = col.toLowerCase();
            const autoMatch = SCHEMA_FIELDS.find(
              (f) =>
                f === lower ||
                lower.includes(f.replace(/_/g, " ")) ||
                lower.includes(f.replace(/_/g, ""))
            );
            return { csvColumn: col, schemaField: autoMatch ?? "" };
          })
        );
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`);
        setFileName(null);
      },
    });
  };

  // ── Mapping update ────────────────────────────────────────────────

  const updateMapping = (index: number, schemaField: string) => {
    setMappings((prev) =>
      prev.map((m, i) => (i === index ? { ...m, schemaField } : m))
    );
  };

  // Check if a schema field is already mapped by another column
  const isFieldTaken = (field: string, currentIndex: number): boolean =>
    field !== "" &&
    mappings.some((m, i) => i !== currentIndex && m.schemaField === field);

  // ── Batch assembly + API call ─────────────────────────────────────

  const handleProcessBatch = async () => {
    setError(null);

    // Validate: first_name and company_name are required mappings
    const mappedFields = new Set(mappings.map((m) => m.schemaField));
    if (!mappedFields.has("first_name") || !mappedFields.has("company_name")) {
      setError(
        `You must map at least "first_name" and "company_name" before processing.`
      );
      return;
    }

    // Build a lookup: schemaField → csvColumn
    const fieldToCsv: Partial<Record<SchemaField, string>> = {};
    for (const m of mappings) {
      if (m.schemaField) {
        fieldToCsv[m.schemaField as SchemaField] = m.csvColumn;
      }
    }

    // Transform rows into LeadPayload[]
    const leads: LeadPayload[] = csvRows.map((row, idx) => {
      const firstName = (
        row[fieldToCsv.first_name ?? ""] ?? ""
      ).trim();
      const companyName = (
        row[fieldToCsv.company_name ?? ""] ?? ""
      ).trim();
      const websiteUrl =
        fieldToCsv.website_url
          ? (row[fieldToCsv.website_url] ?? "").trim() || null
          : null;
      const incidentDetails =
        fieldToCsv.provided_incident_details
          ? (row[fieldToCsv.provided_incident_details] ?? "").trim() || null
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

    const payload: BatchPayload = {
      batch_id: `batch_${Date.now()}`,
      status: "processing",
      context: campaignContext,
      leads: validLeads,
    };

    // ── POST to backend ───────────────────────────────────────────
    setIsProcessing(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`API returned ${res.status}: ${body}`);
      }

      // Success — store response in sessionStorage for the sandbox page
      const data = await res.json();
      sessionStorage.setItem("frameleads_batch", JSON.stringify(data));

      // Route to sandbox
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

  const mappedCount = mappings.filter((m) => m.schemaField !== "").length;
  const canProcess =
    csvRows.length > 0 &&
    mappings.some((m) => m.schemaField === "first_name") &&
    mappings.some((m) => m.schemaField === "company_name") &&
    !isProcessing &&
    campaignContext !== null;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-8 px-4 md:px-0">
      <div className="mb-10 md:mb-12">
        <h1 className="text-4xl font-bold tracking-tight font-heading">
          Data Ingestion
        </h1>
        <p className="text-lg text-muted-foreground mt-3 leading-relaxed">
          Upload your lead list and map columns to the FrameLeads schema.
        </p>
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
            <a href="/dashboard/campaign" className="underline hover:text-amber-300">
              Go to Campaign Settings
            </a>
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

      {/* Column Mapping Table */}
      {csvColumns.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
              <h3 className="text-sm font-medium font-heading">Column Mapping</h3>
            </div>
            <span className="text-xs text-muted-foreground">
              {mappedCount} of {SCHEMA_FIELDS.length} fields mapped
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {mappings.map((mapping, index) => (
              <div
                key={index}
                className="flex items-center gap-4 px-6 py-3 hover:bg-muted/20 transition-colors"
              >
                <span className="w-1/3 text-sm font-mono text-muted-foreground truncate">
                  {mapping.csvColumn}
                </span>
                <ArrowRight className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
                <select
                  value={mapping.schemaField}
                  onChange={(e) => updateMapping(index, e.target.value)}
                  className="flex-1 h-9 rounded-lg border border-zinc-800 bg-[#0a0a0a] text-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                >
                  <option value="" className="bg-[#0a0a0a] text-gray-200">&mdash; skip &mdash;</option>
                  {SCHEMA_FIELDS.map((field) => (
                    <option
                      key={field}
                      value={field}
                      disabled={isFieldTaken(field, index)}
                      className="bg-[#0a0a0a] text-gray-200"
                    >
                      {SCHEMA_LABELS[field]}
                      {isFieldTaken(field, index) ? " (already mapped)" : ""}
                    </option>
                  ))}
                </select>
                {mapping.schemaField && (
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          {/* Footer: stats + Process button */}
          <div className="px-6 py-4 border-t border-border/50 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {csvRows.length} lead{csvRows.length !== 1 ? "s" : ""} will be
              submitted
            </p>
            <button
              id="process-batch-button"
              onClick={handleProcessBatch}
              disabled={!canProcess}
              className="flex items-center gap-2 h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 hover:shadow-lg hover:shadow-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
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
