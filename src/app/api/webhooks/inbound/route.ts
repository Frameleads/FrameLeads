import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolvePipelineValue } from '@/lib/pipeline-value';
import Anthropic from '@anthropic-ai/sdk';
import { extractApiKey, verifyApiKey } from '@/lib/webhook-auth';

const SYSTEM_PROMPT = `You are an elite sales triage AI. Read this inbound email reply. Score the buying intent from 0-100. Categorize it as HOT (score >= 80), WARM (score 40-79), or COLD (score < 40). Evaluate your confidence in this intent classification. If it is a clear rejection or unsubscribe, score confidence > 90. If it is ambiguous, sarcastic, or complex, score < 70. Return strictly a JSON object: { "intentScore": number, "status": "HOT" | "WARM" | "COLD", "signalAnalysis": "1 sentence explanation", "confidenceScore": number }.`;

function extractJsonObject(rawText: string): any {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Failed to locate JSON object in response: ${rawText}`);
  }
  
  const jsonString = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

export async function POST(req: Request) {
  try {
    const rawKey = extractApiKey(req);
    if (!rawKey) {
      return NextResponse.json({ success: false, error: "Missing FrameLeads API key." }, { status: 401 });
    }
    const auth = await verifyApiKey(rawKey);
    if (!auth.authenticated || !auth.userId) {
      return NextResponse.json({ success: false, error: auth.error || "Invalid API key." }, { status: 401 });
    }

    const payload = await req.json();

    // Dynamically extract fields. This handles both standard Smartlead and Instantly shapes.
    const leadEmail = payload.lead_email || payload.email || "";
    const leadFirstName = payload.lead_first_name || payload.firstName || leadEmail.split('@')[0] || "Unknown prospect";
    const companyName = payload.company_name || payload.companyName || "";
    const replyText = payload.reply_text || payload.text || payload.body || "";
    const pipelineValue = resolvePipelineValue(
      payload.pipeline_value ?? payload.pipelineValue ?? payload.deal_value,
    );

    if (!leadEmail || !replyText) {
      return NextResponse.json({ success: false, error: "A lead email and reply text are required." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    
    let finalIntentScore = 0;
    let finalIntentType = "COLD";
    let finalSignalAnalysis = "No analysis performed due to missing API key.";
    let finalConfidenceScore = 0;
    let finalLifecycleStatus = 'PENDING';

    try {
      if (!apiKey) {
        console.warn("ANTHROPIC_API_KEY is missing. Defaulting intent values.");
      } else {
        const anthropic = new Anthropic({ apiKey });
        
        const response = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 256,
          temperature: 0.2,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Inbound Reply:\n\n${replyText}` }]
        });

        const rawText = (response.content[0] as any).text.trim();
        const claude = extractJsonObject(rawText);
        
        finalIntentScore = claude.intentScore;
        finalIntentType = claude.status;
        finalSignalAnalysis = claude.signalAnalysis;
        finalConfidenceScore = claude.confidenceScore;
        
        finalLifecycleStatus = (claude.status === 'COLD' && claude.confidenceScore >= 90) ? 'AUTO_ARCHIVED' : 'PENDING';
      }
    } catch (anthropicError) {
      console.error("Anthropic Classification Failed:", anthropicError);
      finalSignalAnalysis = "AI Classification Failed.";
      finalLifecycleStatus = 'PENDING';
    }

    // Insert into PostgreSQL via Prisma
    const newSignal = await prisma.inboundSignal.create({
      data: {
        userId: auth.userId,
        prospectName: leadFirstName,
        prospectContext: companyName,
        prospectEmail: leadEmail,
        rawEmail: replyText,
        intentScore: finalIntentScore || 0,
        confidenceScore: finalConfidenceScore || 0,
        intentType: finalIntentType || "COLD",
        signalAnalysis: finalSignalAnalysis || "",
        intentRisk: "Unknown", // Default or you could derive this via AI too
        aiDraft: "Awaiting Triage Draft...",
        pipelineValue,
        dealStage: "Inbound Reply",
        isHighPriority: finalIntentType === "HOT" || finalIntentType === "WARM",
        sourceType: "WEBHOOK",
        signalType: "EMAIL_REPLY",
        status: finalLifecycleStatus
      }
    });

    return NextResponse.json({ success: true, id: newSignal.id }, { status: 200 });
  } catch (error) {
    console.error("Webhook Ingestion Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
