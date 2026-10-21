import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createInboundSignal, identityFromFullName } from '@/lib/prospects/persistence';
import { resolvePipelineValue } from '@/lib/pipeline-value';
import Anthropic from '@anthropic-ai/sdk';
import { extractApiKey, verifyApiKey } from '@/lib/webhook-auth';
import { scheduleInboundDecisions } from '@/lib/decision/schedule';
import { getUserEntitlementTier } from '@/lib/auth-guard';
import { hasFeatureAccess } from '@/lib/entitlements';
import { intentTemperature, isHighPriorityIntent } from '@/lib/intent-temperature';

const SYSTEM_PROMPT = `You are a cautious B2B sales triage analyst. Read the inbound email reply and return strict JSON. Score prospect interest from 0 to 100 (separate from classification confidence): HOT 80-100, WARM 60-79, COLD 0-59. If interest cannot be assessed, return intentScore null. Return { "intentScore": number or null, "status": "HOT" | "WARM" | "COLD", "signalAnalysis": "one sentence", "confidenceScore": number }.`;

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
    const externalId = payload.message_id ?? payload.messageId ?? payload.reply_id ?? payload.replyId;
    const sourceMessageId = typeof externalId === 'string' && externalId.trim() ? externalId.trim().slice(0, 200) : null;

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

    const newSignal = await createInboundSignal(prisma, {
      data: {
        userId: auth.userId, prospectName: leadFirstName, prospectContext: companyName,
        prospectEmail: leadEmail, rawEmail: replyText, intentScore: 0, confidenceScore: 0,
        intentType: 'UNASSESSED', signalAnalysis: 'Awaiting analysis', intentRisk: 'Unknown',
        aiDraft: 'Awaiting Triage Draft...', pipelineValue, dealStage: 'Inbound Reply',
        isHighPriority: false, sourceType: 'WEBHOOK', signalType: 'EMAIL_REPLY', sourceMessageId, status: 'PENDING'
      }
    }, identityFromFullName(leadFirstName, companyName));
    scheduleInboundDecisions(auth.userId, [newSignal.id]);

    const mayAnalyze = hasFeatureAccess(await getUserEntitlementTier(auth.userId), 'DECISION_ENGINE');

    const apiKey = process.env.ANTHROPIC_API_KEY || "";
    
    let finalIntentScore = 0;
    let finalIntentType = "UNASSESSED";
    let finalSignalAnalysis = "No analysis performed due to missing API key.";
    let finalConfidenceScore = 0;
    let finalLifecycleStatus = 'PENDING';

    try {
      if (!mayAnalyze) {
        finalSignalAnalysis = 'Reply saved; Decision Engine access is not included in this tier.';
      } else if (!apiKey) {
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
        
        const score = typeof claude.intentScore === 'number' && Number.isFinite(claude.intentScore) && claude.intentScore >= 0 && claude.intentScore <= 100
          ? Math.round(claude.intentScore) : null;
        finalIntentScore = score ?? 0;
        finalIntentType = intentTemperature(score) ?? 'UNASSESSED';
        finalSignalAnalysis = typeof claude.signalAnalysis === 'string' ? claude.signalAnalysis.slice(0, 500) : 'Review the reply manually.';
        finalConfidenceScore = typeof claude.confidenceScore === 'number' && Number.isFinite(claude.confidenceScore) && claude.confidenceScore >= 0 && claude.confidenceScore <= 100
          ? Math.round(claude.confidenceScore) : 0;
        finalLifecycleStatus = 'PENDING';
      }
    } catch (anthropicError) {
      console.error("Anthropic Classification Failed:", anthropicError);
      finalSignalAnalysis = "AI Classification Failed.";
      finalLifecycleStatus = 'PENDING';
    }

    try {
      await prisma.inboundSignal.update({ where: { id: newSignal.id }, data: {
        intentScore: finalIntentScore || 0, confidenceScore: finalConfidenceScore || 0,
        intentType: finalIntentType, signalAnalysis: finalSignalAnalysis || '',
        isHighPriority: isHighPriorityIntent(finalIntentType === 'UNASSESSED' ? null : finalIntentScore),
        status: finalLifecycleStatus,
      } });
    } catch (updateError) {
      console.error('Legacy classification update failed after inbound persistence', updateError);
    }

    return NextResponse.json({ success: true, id: newSignal.id }, { status: 200 });
  } catch (error) {
    console.error("Webhook Ingestion Error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
