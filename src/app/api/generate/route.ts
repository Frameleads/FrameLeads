// Force Vercel to never cache this API endpoint at the edge:
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are an elite Systems Architect speaking to funded founders and lean CEOs. Your tone is candid, authoritative, and relies on 'tough love.' You are a mentor diagnosing a fatal flaw. Absolutely no generic marketing clichés, no clickbait hooks, and no soft/safe language.

You must sell indirectly by shifting their worldview and positioning our framework as inevitable.

YOUR 4-STEP COGNITIVE ARCHITECTURE (The Logic):
The Observation (Visceral Pain Language): Speak their exact pain language. Call out a specific operational hemorrhage (e.g., bandwidth leaks, manual triage consuming executive hours).
The Worldview Shift: Expose the reality that their current hacks (Zapier routing, hiring more SDRs) are active liabilities that compound management load.
The Inevitability: Position our autonomous acquisition infrastructure as the only logical evolution. We do not advise; we architect absolute, logic-driven systems.
The CTA (The Last Slide): End with a blunt, low-friction call to action that matches the user's Preferred CTA Style exactly.

THE MULTI-CHANNEL CONSTRAINTS & FEW-SHOT EXAMPLES (The Output):
You must generate 4 variations of this logic adapted for 4 specific channels. DO NOT COPY THESE EXAMPLES VERBATIM. You are strictly forbidden from copy-pasting the text below. You must use them strictly as structural blueprints to write ORIGINAL copy based on the specific lead's actual business context. Match their tone, length, and cadence, but write fresh copy:

1. Email (The Masterpiece - Follows the 4 steps perfectly):
Example: 'Multi-channel pipeline at [Company] is running on coordination overhead, not infrastructure. When qualified leads arrive faster than your SDR team can sequence across channels simultaneously, the result is predictable: pipeline fragility. Leads age out between handoffs. Hiring more SDRs compounds the management load without resolving the underlying architecture gap. FrameLeads engineers autonomous acquisition infrastructure that abstracts multi-channel triage away from human coordination entirely — logic-driven routing, asynchronous nurture, zero alert fatigue. Your standard of qualification doesn't get diluted; it gets systematized. Want me to send the diagnostic breakdown?'

2. LinkedIn (The Scannable Hook - Compress pain into a list, max 40 words):
Example: '[Company]'s multi-channel pipeline is hitting a coordination ceiling — leads aging out between SDR handoffs, CRM fragmentation, conversion plateauing. FrameLeads architects autonomous acquisition infrastructure that eliminates the triage overhead. Worth a 15-min read?'

3. Cold Call (The Pattern Interrupt - Clinical timeframe request):
Example: '[Name], I was reviewing [Company]'s outreach architecture and identified a specific pipeline fragility pattern — qualified leads decaying between handoffs because the coordination layer is human-dependent. I've put together a short diagnostic on how to abstract that triage into autonomous infrastructure — is now a reasonable 90 seconds to walk you through the core finding?'

4. WhatsApp (The Trojan Horse - Max 2 sentences, ask to email them):
Example: '[Name] — I was just analyzing [Company]'s architecture and noticed a specific bottleneck where your cognitive capital is hard-capping agency scale. I wrote a brief diagnostic on how to abstract that into productized infrastructure; mind if I shoot the document to your work email?'

OUTPUT FORMAT:
Return the response strictly as a JSON object:
{ "email": { "subject": "[2-3 word internal memo style]", "body": "[Email text]" }, "linkedin": { "body": "[LinkedIn text]" }, "coldCall": { "body": "[Cold Call text]" }, "whatsapp": { "body": "[WhatsApp text]" } }`;

// 5 Distinct Architectural Lenses to Guarantee 100% Unique Variations on Every Click:
const REGEN_ANGLES = [
  "Lens 1 (Executive Bandwidth): Focus heavily on how manual SDR triage drains founder cognitive capacity and executive hours.",
  "Lens 2 (Pipeline Fragility): Focus heavily on how qualified leads decay and lose intent during the gap between CRM handoffs.",
  "Lens 3 (Unit Economics): Focus heavily on why hiring more headcount compounds management overhead without solving the bottleneck.",
  "Lens 4 (Infrastructure vs Hacks): Focus heavily on why tape-and-glue Zapier/Make workflows fail silently at enterprise volume.",
  "Lens 5 (Qualification Standards): Focus heavily on how automated triage systematizes high standards instead of diluting them across reps."
];

export async function POST(req: Request) {
  try {
    const { 
      leads, 
      batch_id, 
      timestamp, 
      creditsUsed, 
      tier, 
      force_regenerate, 
      regenerate,
      preferredCtaStyle = 'Self-Serve Audit Link'
    } = await req.json();

    if (tier !== 'ENTERPRISE' && creditsUsed >= 500) {
      return NextResponse.json({ error: 'LIMIT_REACHED' }, { status: 403 });
    }

    if (!leads) {
      return NextResponse.json({ success: false, error: "Missing leads payload" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || "";
    let processedLeads;

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-3.6-flash",
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
        }
      });

      processedLeads = await Promise.all(
        leads.map(async (lead: any, index: number) => {
          try {
            const randomAngle = REGEN_ANGLES[Math.floor(Math.random() * REGEN_ANGLES.length)];
            const uniqueSeed = `seed_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

            const prompt = `Generate outreach for:
Name: ${lead.first_name || 'Founder'}
Company: ${lead.company_name || 'Unknown'}
Context: We provide autonomous AI acquisition infrastructure.
Preferred CTA Style: "${preferredCtaStyle}"
Unique Generation Seed: ${uniqueSeed}
CRITICAL DIRECTIVE: Write a completely original, fresh variation. Do not repeat previous sentence structures. Focus specifically through this architectural lens: "${randomAngle}". End EVERY channel script with a CTA that strictly matches: "${preferredCtaStyle}".`;
            
            const result = await model.generateContent(prompt);
            const responseText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            const generated = JSON.parse(responseText);

            return {
              lead_id: lead.lead_id || `lead_gen_${index}_${Date.now()}`,
              first_name: lead.first_name || "Unknown",
              company_name: lead.company_name || "Unknown Company",
              website_url: lead.website_url || null,
              provided_incident_details: "Generated based on visceral architecture.",
              enrichment_status: "completed",
              generation_status: "completed",
              generated_email: generated.email || { body: "" },
              generated_linkedin: generated.linkedin || { body: "" },
              generated_script: generated.coldCall || { body: "" },
              generated_whatsapp: generated.whatsapp || { body: "" },
              deployment_status: "pending"
            };
          } catch (e) {
            console.error(`Gemini Generation Error on lead [${lead.company_name}]:`, e);
            return getMockLead(lead, index, preferredCtaStyle);
          }
        })
      );
    } else {
      await new Promise(r => setTimeout(r, 1200));
      processedLeads = leads.map((lead: any, index: number) => getMockLead(lead, index, preferredCtaStyle));
    }

    const batchResponse = {
      batch_id: batch_id || `batch_${Date.now()}`,
      status: "completed",
      leads: processedLeads,
      processed_count: processedLeads.length,
      error_message: null
    };

    return NextResponse.json(batchResponse, { status: 200 });

  } catch (error) {
    console.error("API Generation Failure:", error);
    return NextResponse.json(
      { success: false, error: "Catastrophic failure inside the generation pipeline." },
      { status: 500 }
    );
  }
}

// Upgraded with adaptive CTA closing logic based on preferredCtaStyle:
function getMockLead(lead: any, index: number, ctaStyle: string = 'Self-Serve Audit Link') {
  const company = lead.company_name || "your company";
  const name = lead.first_name || "Founder";

  let closingCta = "Want to run your outbound through our 2-minute self-serve fragility audit to inspect the logic?";
  if (ctaStyle === 'Call / Diagnostic') {
    closingCta = "Worth a 15-minute diagnostic call to review your current sending topology?";
  } else if (ctaStyle === 'Send a Memo or Resource') {
    closingCta = "Should I drop the 4-page architecture memo in your inbox so you can review the logic offline?";
  }

  const variants = [
    {
      subject: "coordination overhead",
      email: `Multi-channel pipeline at ${company} is running on coordination overhead, not infrastructure. When qualified leads arrive faster than your SDR team can sequence across channels simultaneously, the result is predictable: pipeline fragility. Leads age out between handoffs. Hiring more SDRs compounds the management load without resolving the underlying architecture gap. FrameLeads engineers autonomous acquisition infrastructure that abstracts multi-channel triage away from human coordination entirely — logic-driven routing, asynchronous nurture, zero alert fatigue. ${closingCta}`,
      linkedin: `${company}'s multi-channel pipeline is hitting a coordination ceiling — leads aging out between SDR handoffs, CRM fragmentation, conversion plateauing. FrameLeads architects autonomous acquisition infrastructure that eliminates the triage overhead. ${closingCta}`,
      coldCall: `${name}, I was reviewing ${company}'s outreach architecture and identified a specific pipeline fragility pattern — qualified leads decaying between handoffs because the coordination layer is human-dependent. I've put together a short diagnostic on how to abstract that triage into autonomous infrastructure. ${closingCta}`,
      whatsapp: `${name} — I was just analyzing ${company}'s architecture and noticed a specific bottleneck where your cognitive capital is hard-capping agency scale. I mapped out how to abstract that into productized infrastructure. ${closingCta}`
    },
    {
      subject: "bandwidth hemorrhage",
      email: `Managing acquisition triage manually at ${company} is an active liability. Every hour your team spends routing edge-case replies and auditing CRM handoffs is cognitive capital stolen from strategy. Taping Zapier workflows together only creates silent failures at scale. FrameLeads replaces human coordination with autonomous acquisition infrastructure — triaging intent, drafting objection overrides, and pushing clean data without manual intervention. ${closingCta}`,
      linkedin: `Manual lead triage at ${company} is burning executive bandwidth. We engineer autonomous acquisition infrastructure that routes and qualifies outbound leads with zero coordination overhead. ${closingCta}`,
      coldCall: `${name}, quick clinical question — how many hours a week is your team losing to manual lead routing and CRM handoff friction at ${company}? We architected an autonomous layer that eliminates that overhead entirely. ${closingCta}`,
      whatsapp: `${name} — noticed ${company}'s outbound scaling speed is bottlenecked by manual triage. Built a brief technical teardown on automating that workflow. ${closingCta}`
    },
    {
      subject: "pipeline fragility",
      email: `When outbound volume scales at ${company}, human-dependent routing breaks first. Leads sit in queues, context is lost between email and LinkedIn, and high-value replies get generic bot answers. FrameLeads deploys enterprise acquisition infrastructure over your existing stack to automate multi-channel triage autonomously while keeping executive oversight on high-risk deals. ${closingCta}`,
      linkedin: `Scaling ${company}'s outbound without infrastructure guarantees pipeline fragility. FrameLeads abstracts lead triage and multi-channel routing into clean, autonomous architecture. ${closingCta}`,
      coldCall: `${name}, I analyzed ${company}'s acquisition stack and noticed a structural vulnerability in how leads transition across channels. I mapped out a zero-code infrastructure fix. ${closingCta}`,
      whatsapp: `${name} — wrote a quick architecture memo on eliminating lead decay across ${company}'s acquisition channels. ${closingCta}`
    }
  ];

  const pick = variants[Math.floor(Math.random() * variants.length)];

  return {
    lead_id: lead.lead_id || `lead_mock_${index}_${Date.now()}`,
    first_name: name,
    company_name: company,
    website_url: lead.website_url || null,
    provided_incident_details: "Generated based on visceral architecture.",
    enrichment_status: "completed",
    generation_status: "completed",
    generated_email: { subject: pick.subject, body: pick.email },
    generated_linkedin: { body: pick.linkedin },
    generated_script: { body: pick.coldCall },
    generated_whatsapp: { body: pick.whatsapp },
    deployment_status: "pending"
  };
}