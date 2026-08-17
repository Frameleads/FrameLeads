// ────────────────────────────────────────────────────────────────────────
// AGNOSTIC DEPLOYMENT ENGINE (SMARTLEAD + INSTANTLY)
//
// Accepts platform flag, API key, campaign ID, batch_id, and the generated leads. 
// Maps AI copy to custom variables and pushes directly to the selected sending infrastructure.
// ────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

import { requireMinimumCoreTier } from '@/lib/auth-guard';

export async function POST(req: Request) {
  try {
    const authError = await requireMinimumCoreTier();
    if (authError) return authError;

    // We expect 'platform' ('smartlead' or 'instantly') and the actual 'leads' array
    const { platform = "smartlead", api_key, campaign_id, batch_id, leads } = await req.json();

    if (!api_key || !campaign_id || !batch_id || !leads || !Array.isArray(leads)) {
      return NextResponse.json(
        { detail: "Missing required fields: api_key, campaign_id, batch_id, or leads array." },
        { status: 400 }
      );
    }

    if (platform === "instantly") {
      // ── Live Instantly API Architecture ──────────────────────────────
      const instantlyPayload = {
        api_key: api_key,
        campaign_id: campaign_id,
        skip_if_in_workspace: false,
        leads: leads.map((lead: any) => ({
          email: lead.email,
          first_name: lead.first_name || "Founder",
          last_name: lead.last_name || "",
          company_name: lead.company_name || "",
          website: lead.website_url || "",
          custom_variables: {
            frameleads_email_subject: lead.generated_email?.subject || "",
            frameleads_email_body: lead.generated_email?.body || "",
            frameleads_linkedin: lead.generated_linkedin?.body || "",
            frameleads_coldcall: lead.generated_script?.body || "",
            frameleads_whatsapp: lead.generated_whatsapp?.body || ""
          }
        }))
      };

      const instantlyUrl = 'https://api.instantly.ai/api/v1/lead/add';
      
      const response = await fetch(instantlyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instantlyPayload)
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error("[DEPLOY] Instantly API error:", errBody);
        return NextResponse.json(
          { detail: `Instantly API error: ${response.status}` },
          { status: 502 }
        );
      }

      console.log(`[DEPLOY] Successfully pushed leads for batch ${batch_id} to Instantly campaign ${campaign_id}.`);
      return NextResponse.json({
        success: true,
        platform: "instantly",
        message: `Successfully pushed leads to Instantly campaign.`,
        pushed_count: leads.length,
      });

    } else if (platform === "smartlead") {
      // ── Live Smartlead API Architecture ──────────────────────────────
      const smartleadPayload = {
        leadList: leads.map((lead: any) => ({
          email: lead.email,
          firstName: lead.first_name || "Founder",
          lastName: lead.last_name || "",
          companyName: lead.company_name || "",
          website: lead.website_url || "",
          customFields: {
            frameleads_email_subject: lead.generated_email?.subject || "",
            frameleads_email_body: lead.generated_email?.body || "",
            frameleads_linkedin: lead.generated_linkedin?.body || "",
            frameleads_coldcall: lead.generated_script?.body || "",
            frameleads_whatsapp: lead.generated_whatsapp?.body || ""
          }
        }))
      };

      const smartleadUrl = `https://server.smartlead.ai/api/v1/campaigns/${campaign_id}/leads?api_key=${api_key}`;

      const response = await fetch(smartleadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smartleadPayload), 
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

      console.log(`[DEPLOY] Successfully pushed leads for batch ${batch_id} to Smartlead campaign ${campaign_id}.`);
      return NextResponse.json({
        success: true,
        platform: "smartlead",
        message: `Successfully pushed leads to Smartlead campaign.`,
        pushed_count: data?.totalLeads ?? leads.length,
      });

    } else {
      return NextResponse.json(
        { detail: "Unsupported deployment platform. Must be 'instantly' or 'smartlead'." },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error("[DEPLOY] Route error:", error);
    return NextResponse.json(
      { detail: "Deployment failed unexpectedly." },
      { status: 500 }
    );
  }
}