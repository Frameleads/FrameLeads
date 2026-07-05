"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  Rocket, 
  Key, 
  Hash, 
  AlertCircle, 
  Loader2, 
  CheckCircle2,
  Inbox
} from "lucide-react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000";

export default function DeployPage() {
  const router = useRouter();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("frameleads_batch");
      if (stored) {
        const batch = JSON.parse(stored);
        if (batch.batch_id) {
          setBatchId(batch.batch_id);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const handleDeploy = async () => {
    if (!batchId) return;
    
    setError(null);
    setSuccessMsg(null);
    setIsDeploying(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          campaign_id: campaignId,
          batch_id: batchId
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to deploy to Smartlead.");
      }

      const data = await res.json();
      setSuccessMsg(data.message || "Batch successfully pushed to Smartlead!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsDeploying(false);
    }
  };

  // ── Empty State (No Batch) ──────────────────────────────────────────

  if (!batchId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] h-[calc(100vh-8rem)] text-center px-4">
        <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-8">
          <AlertCircle className="w-10 h-10 text-amber-500" />
        </div>
        <h2 className="text-2xl font-semibold font-heading">No Active Batch</h2>
        <p className="text-lg text-muted-foreground mt-2 mb-8 max-w-md">
          You need to process a batch of leads before you can deploy them to Smartlead.
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

  // ── Deploy Form ───────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto space-y-8 px-4 md:px-0">
      <div className="mb-10 md:mb-12">
        <h1 className="text-4xl font-bold tracking-tight flex items-center gap-4 font-heading">
          <Rocket className="w-8 h-8 text-primary" />
          Deploy to Smartlead
        </h1>
        <p className="text-lg text-muted-foreground mt-3 leading-relaxed">
          Push your generated AI outreach copy directly into a Smartlead campaign via API.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-green-500/30 bg-green-500/5 text-green-400 text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p>{successMsg}</p>
        </div>
      )}

      <div className="space-y-6 bg-card/50 backdrop-blur-sm border border-border/50 rounded-2xl p-8">
        
        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
          <Inbox className="w-5 h-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Active Batch</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{batchId}</p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Key className="w-4 h-4 text-muted-foreground" />
            Smartlead API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="e.g. sl_..."
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <Hash className="w-4 h-4 text-muted-foreground" />
            Campaign ID
          </label>
          <input
            type="text"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="e.g. 12345"
            className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <p className="text-xs text-muted-foreground mt-1">
            You can find the Campaign ID in the URL of your Smartlead campaign.
          </p>
        </div>

        <div className="pt-6">
          <button
            onClick={handleDeploy}
            disabled={!apiKey || !campaignId || isDeploying || !!successMsg}
            className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-primary text-primary-foreground text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeploying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Pushing to Smartlead...
              </>
            ) : (
              <>
                Push to Smartlead
                <Rocket className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
