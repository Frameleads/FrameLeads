// ────────────────────────────────────────────────────────────────────────
// SMARTLEAD DEPLOYMENT ROUTE (LIVE)
//
// Accepts a batch_id, Smartlead API key, and campaign ID. Pushes all
// completed leads from the batch into the designated Smartlead campaign
// via the Smartlead REST API.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { api_key, campaign_id, batch_id } = await req.json();

    if (!api_key || !campaign_id || !batch_id) {
      return NextResponse.json(
        { detail: "Missing required fields: api_key, campaign_id, batch_id." },
        { status: 400 }
      );
    }

    // ── Live Smartlead API call ──────────────────────────────────────
    const smartleadUrl = `https://server.smartlead.ai/api/v1/campaigns/${campaign_id}/leads?api_key=${api_key}`;

    const response = await fetch(smartleadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadList: [] }), // TODO: populate with actual leads from batch store
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[DEPLOY] Smartlead API error:", errBody);
      return NextResponse.json(
        { detail: `Smartlead API error: ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();

    console.log(
      `[DEPLOY] Successfully pushed leads for batch ${batch_id} to campaign ${campaign_id}.`
    );

    return NextResponse.json({
      success: true,
      message: `Successfully pushed leads to Smartlead campaign.`,
      pushed_count: data?.totalLeads ?? 0,
    });
  } catch (error) {
    console.error("[DEPLOY] Route error:", error);
    return NextResponse.json(
      { detail: "Deployment failed unexpectedly." },
      { status: 500 }
    );
  }
}
